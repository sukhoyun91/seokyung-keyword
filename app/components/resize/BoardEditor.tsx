'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Group } from '@/lib/resize/layout';
import type { Piece } from './ResizeHome';

export type El =
  | { id: string; kind: 'image'; groupId: string; x: number; y: number; w: number; h: number }
  | { id: string; kind: 'text'; text: string; x: number; y: number; w: number; h: number; size: number; color: string; bold: boolean };

export interface Board {
  key: string;
  label: string;
  W: number;
  H: number;
  bg: string;
  bgMode: 'solid' | 'image'; // image = 원본 배경(그라데이션)을 보드 크기로 늘림
  els: El[];
  past: El[][];
  future: El[][];
  source: '' | 'ai' | 'auto';
}

export const BG_KEY = '__background__';
const FONT = "'Pretendard', -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
const LH = 1.25;

let measureCtx: CanvasRenderingContext2D | null = null;
export function measureText(text: string, size: number, bold: boolean) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  const ctx = measureCtx!;
  ctx.font = `${bold ? 700 : 400} ${size}px ${FONT}`;
  const lines = text.split('\n');
  const w = Math.max(10, ...lines.map((l) => ctx.measureText(l || ' ').width));
  return { w: Math.ceil(w), h: Math.ceil(lines.length * size * LH) };
}

/** 보드 → 이미지 파일 (정확한 픽셀 크기) */
export async function renderBoard(b: Board, pieces: Map<string, Piece>, type: 'image/png' | 'image/jpeg'): Promise<Blob> {
  const cv = document.createElement('canvas');
  cv.width = b.W;
  cv.height = b.H;
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const bgp = pieces.get(BG_KEY);
  if (b.bgMode === 'image' && bgp) ctx.drawImage(bgp.canvas, 0, 0, b.W, b.H);
  else {
    ctx.fillStyle = b.bg;
    ctx.fillRect(0, 0, b.W, b.H);
  }
  for (const e of b.els) {
    if (e.kind === 'image') {
      const p = pieces.get(e.groupId);
      if (p) ctx.drawImage(p.canvas, e.x, e.y, e.w, e.h);
    } else {
      ctx.font = `${e.bold ? 700 : 400} ${e.size}px ${FONT}`;
      ctx.fillStyle = e.color;
      ctx.textBaseline = 'top';
      e.text.split('\n').forEach((line, i) => ctx.fillText(line, e.x, e.y + i * e.size * LH + (e.size * (LH - 1)) / 2));
    }
  }
  return new Promise((ok, bad) => cv.toBlob((bl) => (bl ? ok(bl) : bad(new Error('이미지를 만들지 못했습니다.'))), type, 0.95));
}

type Drag = { mode: 'move' | 'resize'; id: string; corner?: 'nw' | 'ne' | 'sw' | 'se'; sx: number; sy: number; orig: El; before: El[] };

export default function BoardEditor({
  board, pieces, groups, onChange, onAi, onAuto, busy, hasImage, fileBase,
}: {
  board: Board;
  pieces: Map<string, Piece>;
  groups: Group[];
  onChange: (fn: (b: Board) => Board) => void;
  onAi: () => void;
  onAuto: () => void;
  busy: boolean;
  hasImage: boolean;
  fileBase: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(700);
  const [sel, setSel] = useState<string | null>(null);
  const [guides, setGuides] = useState<{ v: boolean; h: boolean }>({ v: false, h: false });
  const drag = useRef<Drag | null>(null);
  // 자르기: 선택한 개체 안에서 남길 범위 (0~1 비율)
  const [crop, setCrop] = useState<{ id: string; l: number; t: number; r: number; b: number } | null>(null);
  const cropDrag = useRef<{ edge: string; sx: number; sy: number; start: { l: number; t: number; r: number; b: number }; w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => setBoxW(wrap.current?.clientWidth ?? 700));
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  const maxH = typeof window !== 'undefined' ? Math.max(360, window.innerHeight * 0.72) : 700;
  const k = Math.min((boxW - 4) / board.W, maxH / board.H, 1);

  const selEl = board.els.find((e) => e.id === sel) ?? null;
  useEffect(() => {
    if (crop && crop.id !== sel) setCrop(null);
  }, [sel]);

  // 변경 + 되돌리기 기록
  const commit = (els: El[], before = board.els) => onChange((b) => ({ ...b, els, past: [...b.past.slice(-49), before], future: [] }));
  const live = (els: El[]) => onChange((b) => ({ ...b, els }));
  const undo = () => onChange((b) => (b.past.length ? { ...b, els: b.past[b.past.length - 1], past: b.past.slice(0, -1), future: [b.els, ...b.future] } : b));
  const redo = () => onChange((b) => (b.future.length ? { ...b, els: b.future[0], future: b.future.slice(1), past: [...b.past, b.els] } : b));

  const update = (id: string, patch: Partial<El>) => commit(board.els.map((e) => (e.id === id ? ({ ...e, ...patch } as El) : e)));
  const remove = (id: string) => { commit(board.els.filter((e) => e.id !== id)); setSel(null); };
  const duplicate = (id: string) => {
    const e = board.els.find((x) => x.id === id);
    if (!e) return;
    const c = { ...e, id: `${e.id}+${Date.now()}`, x: e.x + 20, y: e.y + 20 } as El;
    commit([...board.els, c]);
    setSel(c.id);
  };
  const order = (id: string, dir: 'front' | 'back') => {
    const e = board.els.find((x) => x.id === id)!;
    const rest = board.els.filter((x) => x.id !== id);
    commit(dir === 'front' ? [...rest, e] : [e, ...rest]);
  };
  const center = (id: string, axis: 'x' | 'y') => {
    const e = board.els.find((x) => x.id === id)!;
    update(id, axis === 'x' ? { x: Math.round((board.W - e.w) / 2) } : { y: Math.round((board.H - e.h) / 2) });
  };
  const addText = () => {
    const size = Math.round(Math.min(board.W, board.H) * 0.05);
    const m = measureText('문구를 입력하세요', size, true);
    const e: El = { id: `t${Date.now()}`, kind: 'text', text: '문구를 입력하세요', size, color: '#ffffff', bold: true, x: Math.round((board.W - m.w) / 2), y: Math.round(board.H * 0.06), w: m.w, h: m.h };
    commit([...board.els, e]);
    setSel(e.id);
  };
  const addGroup = (gid: string) => {
    const p = pieces.get(gid);
    if (!p) return;
    const s = Math.min(1, (board.W * 0.4) / p.w, (board.H * 0.4) / p.h);
    const e: El = { id: `${gid}#a${Date.now()}`, kind: 'image', groupId: gid, w: Math.round(p.w * s), h: Math.round(p.h * s), x: Math.round((board.W - p.w * s) / 2), y: Math.round((board.H - p.h * s) / 2) };
    commit([...board.els, e]);
    setSel(e.id);
  };

  // 끌기
  function down(ev: React.PointerEvent, el: El, mode: Drag['mode'], corner?: Drag['corner']) {
    ev.stopPropagation();
    ev.preventDefault();
    if (crop) return; // 자르는 중에는 이동·크기 조정 안 함
    setSel(el.id);
    drag.current = { mode, id: el.id, corner, sx: ev.clientX, sy: ev.clientY, orig: el, before: board.els };
    (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
  }
  function move(ev: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (ev.clientX - d.sx) / k;
    const dy = (ev.clientY - d.sy) / k;
    const o = d.orig;
    let n: El;
    if (d.mode === 'move') {
      let x = o.x + dx;
      let y = o.y + dy;
      const snap = 8 / k;
      const cx = x + o.w / 2;
      const cy = y + o.h / 2;
      const v = Math.abs(cx - board.W / 2) < snap;
      const h = Math.abs(cy - board.H / 2) < snap;
      if (v) x = board.W / 2 - o.w / 2;
      if (h) y = board.H / 2 - o.h / 2;
      setGuides({ v, h });
      n = { ...o, x: Math.round(x), y: Math.round(y) };
    } else {
      const c = d.corner!;
      const sxSign = c === 'ne' || c === 'se' ? 1 : -1;
      const sySign = c === 'sw' || c === 'se' ? 1 : -1;
      const ratio = o.h / o.w;
      // 가로·세로 중 더 크게 움직인 쪽 기준, 비율 유지
      const dw = Math.abs(dx * sxSign) > Math.abs((dy * sySign) / ratio) ? dx * sxSign : (dy * sySign) / ratio;
      const w = Math.max(12, o.w + dw);
      const h = w * ratio;
      const x = sxSign < 0 ? o.x + (o.w - w) : o.x;
      const y = sySign < 0 ? o.y + (o.h - h) : o.y;
      n = o.kind === 'text' ? { ...o, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), size: Math.max(6, Math.round((o.size * w) / o.w)) } : { ...o, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
    }
    live(d.before.map((e) => (e.id === d.id ? n : e)));
  }
  function up() {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setGuides({ v: false, h: false });
    onChange((b) => (b.els === d.before ? b : { ...b, past: [...b.past.slice(-49), d.before], future: [] }));
  }

  // 키보드
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if (crop) {
        if (e.key === 'Enter') { e.preventDefault(); applyCrop(); }
        if (e.key === 'Escape') { e.preventDefault(); setCrop(null); }
        return;
      }
      if (!sel) return;
      const step = e.shiftKey ? 10 : 1;
      const el = board.els.find((x) => x.id === sel);
      if (!el) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(sel); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); update(sel, { x: el.x - step }); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); update(sel, { x: el.x + step }); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); update(sel, { y: el.y - step }); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); update(sel, { y: el.y + step }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function startCrop() {
    if (!selEl || selEl.kind !== 'image') return;
    setCrop({ id: selEl.id, l: 0, t: 0, r: 1, b: 1 });
  }
  function cropDown(ev: React.PointerEvent, edge: string) {
    if (!crop) return;
    ev.stopPropagation();
    ev.preventDefault();
    const el = board.els.find((e) => e.id === crop.id)!;
    cropDrag.current = { edge, sx: ev.clientX, sy: ev.clientY, start: { ...crop }, w: el.w * k, h: el.h * k };
    (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
  }
  function cropMove(ev: React.PointerEvent) {
    const d = cropDrag.current;
    if (!d || !crop) return;
    ev.stopPropagation();
    const fx = (ev.clientX - d.sx) / d.w;
    const fy = (ev.clientY - d.sy) / d.h;
    const s0 = d.start;
    const MIN = 0.03;
    const n = { ...s0 };
    if (d.edge === 'move') {
      const cw = s0.r - s0.l, ch = s0.b - s0.t;
      n.l = Math.min(1 - cw, Math.max(0, s0.l + fx)); n.r = n.l + cw;
      n.t = Math.min(1 - ch, Math.max(0, s0.t + fy)); n.b = n.t + ch;
    } else {
      if (d.edge.includes('l')) n.l = Math.min(s0.r - MIN, Math.max(0, s0.l + fx));
      if (d.edge.includes('r')) n.r = Math.max(s0.l + MIN, Math.min(1, s0.r + fx));
      if (d.edge.includes('t')) n.t = Math.min(s0.b - MIN, Math.max(0, s0.t + fy));
      if (d.edge.includes('b')) n.b = Math.max(s0.t + MIN, Math.min(1, s0.b + fy));
    }
    setCrop({ ...crop, ...n });
  }
  function cropUp() {
    cropDrag.current = null;
  }
  /** 자르기 적용: 원본 조각에서 남길 부분만 새 조각으로 만들어 바꿔 끼움 (되돌리기 가능) */
  function applyCrop() {
    if (!crop) return;
    const el = board.els.find((e) => e.id === crop.id);
    if (!el || el.kind !== 'image') return setCrop(null);
    const p = pieces.get(el.groupId);
    if (!p) return setCrop(null);
    const sx = Math.round(crop.l * p.w), sy = Math.round(crop.t * p.h);
    const sw = Math.max(1, Math.round((crop.r - crop.l) * p.w)), sh = Math.max(1, Math.round((crop.b - crop.t) * p.h));
    const cv = document.createElement('canvas');
    cv.width = sw;
    cv.height = sh;
    cv.getContext('2d')!.drawImage(p.canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    const gid = `${el.groupId}~c${Date.now()}`;
    pieces.set(gid, { canvas: cv, url: cv.toDataURL('image/png'), w: sw, h: sh, label: `${p.label} (자름)` });
    const n: El = { ...el, groupId: gid, x: Math.round(el.x + crop.l * el.w), y: Math.round(el.y + crop.t * el.h), w: Math.max(1, Math.round((crop.r - crop.l) * el.w)), h: Math.max(1, Math.round((crop.b - crop.t) * el.h)) };
    commit(board.els.map((e) => (e.id === el.id ? n : e)));
    setCrop(null);
  }

  async function download(type: 'image/png' | 'image/jpeg') {
    const blob = await renderBoard(board, pieces, type);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${fileBase}_${board.W}x${board.H}.${type === 'image/png' ? 'png' : 'jpg'}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // 확대율 (원본 대비)
  const zoomOf = (e: El) => (e.kind === 'image' ? e.w / (pieces.get(e.groupId)?.w || e.w) : 1);
  const onBoard = new Set(board.els.filter((e) => e.kind === 'image').map((e) => (e as any).groupId));
  const missing = groups.filter((g) => !onBoard.has(g.id) && pieces.has(g.id) && g.id !== BG_KEY);
  const outside = (e: El) => e.x < -1 || e.y < -1 || e.x + e.w > board.W + 1 || e.y + e.h > board.H + 1;

  return (
    <div className="rz-editor">
      <div className="rz-toolbar">
        <button className="accent" onClick={onAi} disabled={busy || !hasImage}>이 사이즈만 AI 변환</button>
        <button onClick={onAuto} disabled={busy || !hasImage}>AI 없이 배치</button>
        <span className="rz-sep" />
        <button onClick={undo} disabled={!board.past.length} title="Ctrl+Z">되돌리기</button>
        <button onClick={redo} disabled={!board.future.length} title="Ctrl+Shift+Z">다시</button>
        <button onClick={addText}>+ 글자</button>
        {missing.length > 0 && (
          <select value="" onChange={(e) => e.target.value && addGroup(e.target.value)} style={{ width: 'auto', padding: '5px 8px' }}>
            <option value="">+ 빠진 개체 넣기 ({missing.length})</option>
            {missing.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        )}
        <select value={board.bgMode} onChange={(e) => onChange((b) => ({ ...b, bgMode: e.target.value as Board['bgMode'] }))} style={{ width: 'auto', padding: '5px 8px' }} title="보드 배경">
          <option value="image" disabled={!pieces.has(BG_KEY)}>배경: 원본 배경 늘리기</option>
          <option value="solid">배경: 단색</option>
        </select>
        {board.bgMode === 'solid' && <input type="color" value={board.bg} onChange={(e) => onChange((b) => ({ ...b, bg: e.target.value }))} style={{ width: 34, height: 28, padding: 0 }} title="배경색" />}
        <span className="rz-sep" />
        <button className="primary" onClick={() => download('image/png')} disabled={!board.els.length}>PNG</button>
        <button onClick={() => download('image/jpeg')} disabled={!board.els.length}>JPG</button>
      </div>

      <div className="rz-work">
        <div ref={wrap} className="rz-stage-wrap">
          <div
            className="rz-stage"
            style={{
              width: board.W * k,
              height: board.H * k,
              background: board.bgMode === 'image' && pieces.get(BG_KEY) ? `center / 100% 100% no-repeat url(${pieces.get(BG_KEY)!.url})` : board.bg,
            }}
            onPointerDown={() => !crop && setSel(null)}
            onPointerMove={(e) => (cropDrag.current ? cropMove(e) : move(e))}
            onPointerUp={() => (cropDrag.current ? cropUp() : up())}
            onPointerCancel={() => (cropDrag.current ? cropUp() : up())}
          >
            {board.els.map((e) => {
              const st = { left: e.x * k, top: e.y * k, width: e.w * k, height: e.h * k };
              return (
                <div key={e.id} className={`rz-el ${e.id === sel ? 'sel' : ''} ${outside(e) ? 'out' : ''}`} style={st} onPointerDown={(ev) => down(ev, e, 'move')}>
                  {e.kind === 'image' ? (
                    <img src={pieces.get(e.groupId)?.url} alt="" draggable={false} />
                  ) : (
                    <div className="rz-text" style={{ fontSize: e.size * k, color: e.color, fontWeight: e.bold ? 700 : 400, lineHeight: LH, fontFamily: FONT }}>{e.text}</div>
                  )}
                  {e.id === sel && !crop && (['nw', 'ne', 'sw', 'se'] as const).map((c) => <span key={c} className={`rz-h ${c}`} onPointerDown={(ev) => down(ev, e, 'resize', c)} />)}
                  {crop && crop.id === e.id && (
                    <div className="rz-crop">
                      <div className="rz-crop-box" style={{ left: `${crop.l * 100}%`, top: `${crop.t * 100}%`, width: `${(crop.r - crop.l) * 100}%`, height: `${(crop.b - crop.t) * 100}%` }} onPointerDown={(ev) => cropDown(ev, 'move')}>
                        {(['t', 'b', 'l', 'r', 'tl', 'tr', 'bl', 'br'] as const).map((h) => <span key={h} className={`rz-ch ${h}`} onPointerDown={(ev) => cropDown(ev, h)} />)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {guides.v && <div className="rz-guide v" style={{ left: (board.W / 2) * k }} />}
            {guides.h && <div className="rz-guide h" style={{ top: (board.H / 2) * k }} />}
            {!board.els.length && (
              <div className="rz-empty">
                {board.W}×{board.H}
                <div>{hasImage ? '위의 [이 사이즈만 AI 변환] 또는 [AI 변환]을 누르세요' : '왼쪽에 원본 이미지를 올리세요'}</div>
              </div>
            )}
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            {board.W}×{board.H} · 화면 {Math.round(k * 100)}% 크기로 표시 · 끌어서 이동, 모서리로 크기(비율 유지), 방향키 1px(Shift 10px), Delete 삭제, Ctrl+Z 되돌리기
          </div>
        </div>

        <div className="rz-side">
          {selEl ? (
            <div className="rz-props">
              <b>{selEl.kind === 'text' ? '글자' : pieces.get((selEl as any).groupId)?.label ?? '개체'}</b>
              {selEl.kind === 'text' && (
                <>
                  <textarea
                    rows={3}
                    value={selEl.text}
                    onChange={(ev) => {
                      const m = measureText(ev.target.value, selEl.size, selEl.bold);
                      live(board.els.map((x) => (x.id === selEl.id ? { ...selEl, text: ev.target.value, w: m.w, h: m.h } : x)));
                    }}
                    onBlur={() => commit(board.els)}
                  />
                  <div className="filters">
                    <label>크기</label>
                    <input type="number" value={selEl.size} min={6} max={600} style={{ width: 70 }} onChange={(ev) => { const size = Number(ev.target.value) || 6; const m = measureText(selEl.text, size, selEl.bold); update(selEl.id, { size, w: m.w, h: m.h } as any); }} />
                    <input type="color" value={selEl.color} onChange={(ev) => update(selEl.id, { color: ev.target.value } as any)} style={{ width: 34, height: 28, padding: 0 }} />
                    <label className="chk"><input type="checkbox" checked={selEl.bold} onChange={(ev) => { const m = measureText(selEl.text, selEl.size, ev.target.checked); update(selEl.id, { bold: ev.target.checked, w: m.w, h: m.h } as any); }} />굵게</label>
                  </div>
                </>
              )}
              <div className="filters">
                <label>X</label><input type="number" value={selEl.x} style={{ width: 70 }} onChange={(ev) => update(selEl.id, { x: Number(ev.target.value) })} />
                <label>Y</label><input type="number" value={selEl.y} style={{ width: 70 }} onChange={(ev) => update(selEl.id, { y: Number(ev.target.value) })} />
              </div>
              {selEl.kind === 'image' && (
                <div className="filters">
                  <label>가로</label>
                  <input type="number" value={selEl.w} style={{ width: 70 }} onChange={(ev) => { const w = Math.max(12, Number(ev.target.value) || 12); update(selEl.id, { w, h: Math.round((selEl.h / selEl.w) * w) }); }} />
                  <span className="hint">원본 대비 {Math.round(zoomOf(selEl) * 100)}%</span>
                </div>
              )}
              {zoomOf(selEl) > 1.6 && <div className="hint" style={{ color: 'var(--warn)' }}>원본보다 {zoomOf(selEl).toFixed(1)}배 커서 흐려 보일 수 있습니다.</div>}
              {selEl.kind === 'image' && (
                crop && crop.id === selEl.id ? (
                  <div className="rz-crop-bar">
                    <span className="hint">보드에서 테두리·모서리를 끌어 남길 부분을 정하세요 (안쪽을 끌면 이동).</span>
                    <div className="btn-row">
                      <button className="primary" onClick={applyCrop}>자르기 적용</button>
                      <button onClick={() => setCrop({ ...crop, l: 0, t: 0, r: 1, b: 1 })}>처음대로</button>
                      <button onClick={() => setCrop(null)}>취소</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={startCrop}>✂ 자르기</button>
                )
              )}
              <div className="btn-row">
                <button onClick={() => center(selEl.id, 'x')}>가로 가운데</button>
                <button onClick={() => center(selEl.id, 'y')}>세로 가운데</button>
                <button onClick={() => order(selEl.id, 'front')}>맨 앞</button>
                <button onClick={() => order(selEl.id, 'back')}>맨 뒤</button>
                <button onClick={() => duplicate(selEl.id)}>복제</button>
                <button className="danger" onClick={() => remove(selEl.id)}>삭제</button>
              </div>
            </div>
          ) : (
            <div className="hint">보드에서 개체를 누르면 위치·크기를 숫자로 고치거나, 순서·복제·삭제를 할 수 있습니다.</div>
          )}

          <div className="rz-layers">
            <b>개체 목록</b> <span className="hint">(아래일수록 앞)</span>
            {board.els.map((e) => {
              const z = zoomOf(e);
              return (
                <button key={e.id} className={`rz-layer ${e.id === sel ? 'on' : ''}`} onClick={() => setSel(e.id)}>
                  {e.kind === 'image' ? <img src={pieces.get(e.groupId)?.url} alt="" /> : <span className="rz-t">T</span>}
                  <span className="rz-name">{e.kind === 'image' ? pieces.get(e.groupId)?.label ?? '개체' : e.text.split('\n')[0]}</span>
                  {z > 1.6 && <span title="원본보다 많이 확대됨" style={{ color: 'var(--warn)' }}>⚠</span>}
                  {outside(e) && <span title="보드 밖으로 나감" style={{ color: 'var(--err)' }}>↗</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
