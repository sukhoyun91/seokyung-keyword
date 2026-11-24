/**
 * 원본 이미지에서 배경과 다른 덩어리(개체)를 찾습니다. 브라우저 전용 (canvas)
 * 배경이 단색에 가까울수록 정확합니다.
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface SegObject extends Box {
  id: number;
  area: number; // 실제 개체 픽셀 수 (작업 해상도)
}
export interface Segmentation {
  srcW: number;
  srcH: number;
  ww: number; // 작업 해상도
  wh: number;
  scale: number; // 작업/원본
  bg: [number, number, number];
  bgShare: number; // 테두리 중 배경색 비율 (0~1)
  labels: Int32Array; // 작업 해상도 라벨 (0 = 배경)
  objects: SegObject[];
}

const diff = (d: Uint8ClampedArray, i: number, bg: number[]) => Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);

export function segment(img: CanvasImageSource & { width: number; height: number }, opts: { threshold: number; spread: number }): Segmentation {
  const srcW = img.width;
  const srcH = img.height;
  const scale = Math.min(1, 900 / Math.max(srcW, srcH));
  const ww = Math.max(1, Math.round(srcW * scale));
  const wh = Math.max(1, Math.round(srcH * scale));
  const cv = document.createElement('canvas');
  cv.width = ww;
  cv.height = wh;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, ww, wh);
  const d = ctx.getImageData(0, 0, ww, wh).data;

  // 배경색: 테두리 픽셀의 최빈 색
  const hist = new Map<number, { n: number; r: number; g: number; b: number }>();
  let border = 0;
  const add = (x: number, y: number) => {
    const i = (y * ww + x) * 4;
    const k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
    const h = hist.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    h.n++;
    h.r += d[i];
    h.g += d[i + 1];
    h.b += d[i + 2];
    hist.set(k, h);
    border++;
  };
  for (let x = 0; x < ww; x++) {
    add(x, 0);
    add(x, wh - 1);
  }
  for (let y = 1; y < wh - 1; y++) {
    add(0, y);
    add(ww - 1, y);
  }
  let best = { n: 0, r: 0, g: 0, b: 0 };
  for (const h of hist.values()) if (h.n > best.n) best = h;
  const bg: [number, number, number] = [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)];
  // 근처 색까지 포함한 배경 비율
  let near = 0;
  const chk = (x: number, y: number) => {
    if (diff(d, (y * ww + x) * 4, bg) <= opts.threshold) near++;
  };
  for (let x = 0; x < ww; x++) {
    chk(x, 0);
    chk(x, wh - 1);
  }
  for (let y = 1; y < wh - 1; y++) {
    chk(0, y);
    chk(ww - 1, y);
  }

  // 개체 마스크
  const N = ww * wh;
  const mask = new Uint8Array(N);
  for (let p = 0; p < N; p++) mask[p] = diff(d, p * 4, bg) > opts.threshold ? 1 : 0;

  // 팽창 (가까운 조각을 한 덩어리로)
  const r = Math.max(1, Math.round((opts.spread * ww) / 1000));
  const tmp = new Uint8Array(N);
  for (let y = 0; y < wh; y++) {
    let run = 0;
    const row = y * ww;
    for (let x = 0; x < Math.min(r, ww); x++) run += mask[row + x];
    for (let x = 0; x < ww; x++) {
      if (x + r < ww) run += mask[row + x + r];
      if (x - r - 1 >= 0) run -= mask[row + x - r - 1];
      tmp[row + x] = run > 0 ? 1 : 0;
    }
  }
  const dil = new Uint8Array(N);
  for (let x = 0; x < ww; x++) {
    let run = 0;
    for (let y = 0; y < Math.min(r, wh); y++) run += tmp[y * ww + x];
    for (let y = 0; y < wh; y++) {
      if (y + r < wh) run += tmp[(y + r) * ww + x];
      if (y - r - 1 >= 0) run -= tmp[(y - r - 1) * ww + x];
      dil[y * ww + x] = run > 0 ? 1 : 0;
    }
  }

  // 연결 요소
  const labels = new Int32Array(N);
  const stack = new Int32Array(N);
  let next = 0;
  const raw: { x0: number; y0: number; x1: number; y1: number; area: number }[] = [];
  for (let p = 0; p < N; p++) {
    if (!dil[p] || labels[p]) continue;
    next++;
    let sp = 0;
    stack[sp++] = p;
    labels[p] = next;
    const o = { x0: ww, y0: wh, x1: -1, y1: -1, area: 0 };
    while (sp) {
      const q = stack[--sp];
      const x = q % ww;
      const y = (q - x) / ww;
      if (mask[q]) {
        o.area++;
        if (x < o.x0) o.x0 = x;
        if (x > o.x1) o.x1 = x;
        if (y < o.y0) o.y0 = y;
        if (y > o.y1) o.y1 = y;
      }
      if (x > 0 && dil[q - 1] && !labels[q - 1]) { labels[q - 1] = next; stack[sp++] = q - 1; }
      if (x < ww - 1 && dil[q + 1] && !labels[q + 1]) { labels[q + 1] = next; stack[sp++] = q + 1; }
      if (y > 0 && dil[q - ww] && !labels[q - ww]) { labels[q - ww] = next; stack[sp++] = q - ww; }
      if (y < wh - 1 && dil[q + ww] && !labels[q + ww]) { labels[q + ww] = next; stack[sp++] = q + ww; }
    }
    raw.push(o);
  }

  const minArea = Math.max(12, N * 0.00015);
  const objects: SegObject[] = [];
  raw.forEach((o, i) => {
    if (o.area < minArea || o.x1 < 0) return;
    const x = Math.max(0, Math.floor(o.x0 / scale));
    const y = Math.max(0, Math.floor(o.y0 / scale));
    const x2 = Math.min(srcW, Math.ceil((o.x1 + 1) / scale));
    const y2 = Math.min(srcH, Math.ceil((o.y1 + 1) / scale));
    objects.push({ id: i + 1, x, y, w: x2 - x, h: y2 - y, area: o.area });
  });
  return { srcW, srcH, ww, wh, scale, bg, bgShare: border ? near / border : 0, labels, objects };
}

/** 개체 묶음을 원본 해상도로 잘라 배경을 투명하게 만든 조각 */
export function cutPiece(img: CanvasImageSource, seg: Segmentation, objectIds: number[], pad = 6): { canvas: HTMLCanvasElement; box: Box } {
  const objs = seg.objects.filter((o) => objectIds.includes(o.id));
  const x0 = Math.max(0, Math.min(...objs.map((o) => o.x)) - pad);
  const y0 = Math.max(0, Math.min(...objs.map((o) => o.y)) - pad);
  const x1 = Math.min(seg.srcW, Math.max(...objs.map((o) => o.x + o.w)) + pad);
  const y1 = Math.min(seg.srcH, Math.max(...objs.map((o) => o.y + o.h)) + pad);
  const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const cv = document.createElement('canvas');
  cv.width = box.w;
  cv.height = box.h;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, x0, y0, box.w, box.h, 0, 0, box.w, box.h);
  const id = ctx.getImageData(0, 0, box.w, box.h);
  const d = id.data;
  const keep = new Set(objectIds);
  for (let y = 0; y < box.h; y++) {
    const wy = Math.min(seg.wh - 1, Math.floor((y0 + y) * seg.scale));
    for (let x = 0; x < box.w; x++) {
      const wx = Math.min(seg.ww - 1, Math.floor((x0 + x) * seg.scale));
      const i = (y * box.w + x) * 4;
      if (!keep.has(seg.labels[wy * seg.ww + wx])) {
        d[i + 3] = 0;
        continue;
      }
      const df = diff(d, i, seg.bg);
      d[i + 3] = Math.max(0, Math.min(255, (df - 6) * 12));
    }
  }
  ctx.putImageData(id, 0, 0);
  return { canvas: cv, box };
}

/** AI 에 보낼 축소본 (번호 상자 표시본 포함) */
export function thumbnails(img: CanvasImageSource, seg: Segmentation): { clean: string; marked: string } {
  const cv = document.createElement('canvas');
  cv.width = seg.ww;
  cv.height = seg.wh;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(img, 0, 0, seg.ww, seg.wh);
  const clean = cv.toDataURL('image/jpeg', 0.85).split(',')[1];
  ctx.lineWidth = 2;
  ctx.font = 'bold 14px sans-serif';
  for (const o of seg.objects) {
    const x = o.x * seg.scale;
    const y = o.y * seg.scale;
    ctx.strokeStyle = '#ff00d4';
    ctx.strokeRect(x, y, o.w * seg.scale, o.h * seg.scale);
    const t = String(o.id);
    const tw = ctx.measureText(t).width + 6;
    ctx.fillStyle = '#ff00d4';
    ctx.fillRect(x, Math.max(0, y - 16), tw, 16);
    ctx.fillStyle = '#fff';
    ctx.fillText(t, x + 3, Math.max(12, y - 3));
  }
  const marked = cv.toDataURL('image/jpeg', 0.85).split(',')[1];
  return { clean, marked };
}
