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
  bg: [number, number, number]; // 대표 배경색 (단색 채우기용)
  bgShare: number; // 테두리 중 배경으로 판정된 비율 (0~1)
  model: Uint8ClampedArray; // 위치별 배경색 지도 (작업 해상도, RGB)
  gradient: boolean; // 배경이 위치에 따라 달라지는지 (그라데이션)
  labels: Int32Array; // 작업 해상도 라벨 (0 = 배경)
  objects: SegObject[];
}

const diff = (d: Uint8ClampedArray, i: number, bg: number[]) => Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
const diffM = (d: Uint8ClampedArray, i: number, m: Uint8ClampedArray, j: number) => Math.abs(d[i] - m[j]) + Math.abs(d[i + 1] - m[j + 1]) + Math.abs(d[i + 2] - m[j + 2]);

/**
 * 위치별 배경색 지도 추정 (단색·그라데이션 공용)
 * 1) 화면을 격자 칸으로 나눠 칸마다 가장 많은 색을 구함
 * 2) 테두리 칸에서 시작해, 색이 부드럽게 이어지는 칸만 배경으로 인정 (카드처럼 뚝 다른 색 덩어리는 제외)
 * 3) 인정 못 받은 칸은 주변 배경 칸으로 채우고, 칸 사이는 부드럽게 보간
 */
function estimateBackground(d: Uint8ClampedArray, ww: number, wh: number, threshold: number) {
  const cs = Math.max(6, Math.round(Math.max(ww, wh) / 28));
  const gw = Math.ceil(ww / cs);
  const gh = Math.ceil(wh / cs);
  const G = gw * gh;
  const col = new Float32Array(G * 3);
  const share = new Float32Array(G);

  const cellStats = (model: Uint8ClampedArray | null) => {
    for (let gy = 0; gy < gh; gy++)
      for (let gx = 0; gx < gw; gx++) {
        const c = gy * gw + gx;
        const x0 = gx * cs, y0 = gy * cs;
        const x1 = Math.min(ww, x0 + cs), y1 = Math.min(wh, y0 + cs);
        const n = (x1 - x0) * (y1 - y0);
        if (model) {
          // 2차: 지금 지도 기준 배경 픽셀만 평균
          let r = 0, g = 0, b = 0, k = 0;
          for (let y = y0; y < y1; y++)
            for (let x = x0; x < x1; x++) {
              const p = y * ww + x;
              if (diffM(d, p * 4, model, p * 3) <= threshold) { r += d[p * 4]; g += d[p * 4 + 1]; b += d[p * 4 + 2]; k++; }
            }
          if (k >= n * 0.25) { col[c * 3] = r / k; col[c * 3 + 1] = g / k; col[c * 3 + 2] = b / k; share[c] = k / n; }
          else share[c] = 0;
          continue;
        }
        const hist = new Map<number, number>();
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) {
            const i = (y * ww + x) * 4;
            const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
            hist.set(key, (hist.get(key) ?? 0) + 1);
          }
        let bk = 0, bn = -1;
        for (const [key, v] of hist) if (v > bn) { bn = v; bk = key; }
        const mr = ((bk >> 8) & 15) * 16 + 8, mg = ((bk >> 4) & 15) * 16 + 8, mb = (bk & 15) * 16 + 8;
        let r = 0, g = 0, b = 0, k = 0;
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) {
            const i = (y * ww + x) * 4;
            if (Math.abs(d[i] - mr) + Math.abs(d[i + 1] - mg) + Math.abs(d[i + 2] - mb) <= 36) { r += d[i]; g += d[i + 1]; b += d[i + 2]; k++; }
          }
        col[c * 3] = k ? r / k : mr; col[c * 3 + 1] = k ? g / k : mg; col[c * 3 + 2] = k ? b / k : mb;
        share[c] = k / n;
      }
  };
  const cdiff = (a: number, b: number) => Math.abs(col[a * 3] - col[b * 3]) + Math.abs(col[a * 3 + 1] - col[b * 3 + 1]) + Math.abs(col[a * 3 + 2] - col[b * 3 + 2]);
  const nbrs = (c: number) => {
    const gx = c % gw, gy = (c - gx) / gw, out: number[] = [];
    if (gx > 0) out.push(c - 1);
    if (gx < gw - 1) out.push(c + 1);
    if (gy > 0) out.push(c - gw);
    if (gy < gh - 1) out.push(c + gw);
    return out;
  };

  const build = (): { model: Uint8ClampedArray; ok: Uint8Array } => {
    // 테두리에서 부드럽게 이어지는 칸만 배경으로
    const ok = new Uint8Array(G);
    const q: number[] = [];
    for (let c = 0; c < G; c++) {
      const gx = c % gw, gy = (c - gx) / gw;
      if ((gx === 0 || gy === 0 || gx === gw - 1 || gy === gh - 1) && share[c] >= 0.5) { ok[c] = 1; q.push(c); }
    }
    while (q.length) {
      const c = q.shift()!;
      for (const n of nbrs(c)) if (!ok[n] && share[n] >= 0.35 && cdiff(c, n) <= 40) { ok[n] = 1; q.push(n); }
    }
    // 테두리에 걸친 그림 칸(가장자리 장식 등) 제외: 주변 배경 칸과 많이 다르면 탈락
    for (let c = 0; c < G; c++) {
      if (!ok[c]) continue;
      const ns = nbrs(c).filter((n) => ok[n]);
      if (ns.length >= 2 && ns.every((n) => cdiff(c, n) > 45)) ok[c] = 0;
    }
    // 빈 칸 채우기 (주변 배경 칸 평균을 퍼뜨림)
    const known = Uint8Array.from(ok);
    const fc = Float32Array.from(col);
    let left = G - known.reduce((a, b) => a + b, 0);
    if (left === G) return { model: new Uint8ClampedArray(0), ok };
    while (left > 0) {
      const add: [number, number, number, number][] = [];
      for (let c = 0; c < G; c++) {
        if (known[c]) continue;
        let r = 0, g = 0, b = 0, k = 0;
        for (const n of nbrs(c)) if (known[n]) { r += fc[n * 3]; g += fc[n * 3 + 1]; b += fc[n * 3 + 2]; k++; }
        if (k) add.push([c, r / k, g / k, b / k]);
      }
      if (!add.length) break;
      for (const [c, r, g, b] of add) { fc[c * 3] = r; fc[c * 3 + 1] = g; fc[c * 3 + 2] = b; known[c] = 1; left--; }
    }
    // 칸 → 픽셀 (칸 중심 기준 이중선형 보간)
    const model = new Uint8ClampedArray(ww * wh * 3);
    for (let y = 0; y < wh; y++) {
      const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / cs - 0.5));
      const y0 = Math.floor(fy), y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < ww; x++) {
        const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / cs - 0.5));
        const x0 = Math.floor(fx), x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
        const a = y0 * gw + x0, b = y0 * gw + x1, c = y1 * gw + x0, e = y1 * gw + x1;
        const o = (y * ww + x) * 3;
        for (let ch = 0; ch < 3; ch++)
          model[o + ch] = (fc[a * 3 + ch] * (1 - tx) + fc[b * 3 + ch] * tx) * (1 - ty) + (fc[c * 3 + ch] * (1 - tx) + fc[e * 3 + ch] * tx) * ty;
      }
    }
    return { model, ok };
  };

  cellStats(null);
  let { model, ok } = build();
  if (!model.length) return null;
  cellStats(model); // 2차: 지도 기준 배경 픽셀만으로 칸 색을 다시 계산
  ({ model, ok } = build());
  if (!model.length) return null;
  // 그라데이션 여부: 배경 칸 색의 범위
  let mn = [255, 255, 255], mx = [0, 0, 0];
  for (let c = 0; c < G; c++) if (ok[c]) for (let ch = 0; ch < 3; ch++) { mn[ch] = Math.min(mn[ch], col[c * 3 + ch]); mx[ch] = Math.max(mx[ch], col[c * 3 + ch]); }
  const range = mx[0] - mn[0] + mx[1] - mn[1] + mx[2] - mn[2];
  return { model, gradient: range > 40 };
}

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
  // 위치별 배경 지도 (실패하면 단색 지도)
  const est = estimateBackground(d, ww, wh, opts.threshold);
  const N = ww * wh;
  let model: Uint8ClampedArray;
  if (est) model = est.model;
  else {
    model = new Uint8ClampedArray(N * 3);
    for (let p = 0; p < N; p++) { model[p * 3] = bg[0]; model[p * 3 + 1] = bg[1]; model[p * 3 + 2] = bg[2]; }
  }
  const gradient = !!est?.gradient;
  // 대표 배경색 = 테두리 지도 평균
  let near = 0;
  const avg = [0, 0, 0];
  const chk = (x: number, y: number) => {
    const p = y * ww + x;
    if (diffM(d, p * 4, model, p * 3) <= opts.threshold) near++;
    avg[0] += model[p * 3]; avg[1] += model[p * 3 + 1]; avg[2] += model[p * 3 + 2];
  };
  for (let x = 0; x < ww; x++) {
    chk(x, 0);
    chk(x, wh - 1);
  }
  for (let y = 1; y < wh - 1; y++) {
    chk(0, y);
    chk(ww - 1, y);
  }
  if (gradient) for (let ch = 0; ch < 3; ch++) bg[ch] = Math.round(avg[ch] / border);

  // 개체 마스크 (그 자리의 배경색과 비교)
  const mask = new Uint8Array(N);
  for (let p = 0; p < N; p++) mask[p] = diffM(d, p * 4, model, p * 3) > opts.threshold ? 1 : 0;

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
  return { srcW, srcH, ww, wh, scale, bg, bgShare: border ? near / border : 0, labels, objects, model, gradient };
}

/** 원본 해상도 좌표의 배경색 (지도에서 가져옴) */
function alphaFill(d: Uint8ClampedArray, box: Box, seg: Segmentation, keep: ((label: number) => boolean) | null) {
  for (let y = 0; y < box.h; y++) {
    const wy = Math.min(seg.wh - 1, Math.floor((box.y + y) * seg.scale));
    for (let x = 0; x < box.w; x++) {
      const wx = Math.min(seg.ww - 1, Math.floor((box.x + x) * seg.scale));
      const i = (y * box.w + x) * 4;
      const p = wy * seg.ww + wx;
      if (keep && !keep(seg.labels[p])) {
        d[i + 3] = 0;
        continue;
      }
      d[i + 3] = Math.max(0, Math.min(255, (diffM(d, i, seg.model, p * 3) - 6) * 12));
    }
  }
}

function crop(img: CanvasImageSource, box: Box) {
  const cv = document.createElement('canvas');
  cv.width = box.w;
  cv.height = box.h;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  return { cv, ctx, id: ctx.getImageData(0, 0, box.w, box.h) };
}

/** 개체 묶음을 원본 해상도로 잘라 배경을 투명하게 만든 조각 */
export function cutPiece(img: CanvasImageSource, seg: Segmentation, objectIds: number[], pad = 6): { canvas: HTMLCanvasElement; box: Box } {
  const objs = seg.objects.filter((o) => objectIds.includes(o.id));
  const x0 = Math.max(0, Math.min(...objs.map((o) => o.x)) - pad);
  const y0 = Math.max(0, Math.min(...objs.map((o) => o.y)) - pad);
  const x1 = Math.min(seg.srcW, Math.max(...objs.map((o) => o.x + o.w)) + pad);
  const y1 = Math.min(seg.srcH, Math.max(...objs.map((o) => o.y + o.h)) + pad);
  const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const { cv, ctx, id } = crop(img, box);
  const keep = new Set(objectIds);
  alphaFill(id.data, box, seg, (l) => keep.has(l));
  ctx.putImageData(id, 0, 0);
  return { canvas: cv, box };
}

/** 사용자가 그은 영역을 그대로 잘라 개체로 (배경만 투명하게) */
export function cutRect(img: CanvasImageSource, seg: Segmentation, r: Box): { canvas: HTMLCanvasElement; box: Box } {
  const box = { x: Math.max(0, Math.round(r.x)), y: Math.max(0, Math.round(r.y)), w: 0, h: 0 };
  box.w = Math.max(1, Math.min(seg.srcW - box.x, Math.round(r.w)));
  box.h = Math.max(1, Math.min(seg.srcH - box.y, Math.round(r.h)));
  const { cv, ctx, id } = crop(img, box);
  alphaFill(id.data, box, seg, null);
  ctx.putImageData(id, 0, 0);
  return { canvas: cv, box };
}

/** 배경 지도 → 캔버스 (보드 배경 '원본 배경 늘리기'용) */
export function backgroundCanvas(seg: Segmentation): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = seg.ww;
  cv.height = seg.wh;
  const ctx = cv.getContext('2d')!;
  const id = ctx.createImageData(seg.ww, seg.wh);
  for (let p = 0; p < seg.ww * seg.wh; p++) {
    id.data[p * 4] = seg.model[p * 3];
    id.data[p * 4 + 1] = seg.model[p * 3 + 1];
    id.data[p * 4 + 2] = seg.model[p * 3 + 2];
    id.data[p * 4 + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return cv;
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
