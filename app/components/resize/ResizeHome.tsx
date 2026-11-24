'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PRESET_GROUPS, type SizePreset } from '@/lib/resize/presets';
import { cutPiece, segment, thumbnails, type Segmentation } from '@/lib/resize/segment';
import { ROLE_LABEL, fallbackGroups, fallbackPlan, makeGroup, placePlan, sanitizePlan, type Group, type Plan } from '@/lib/resize/layout';
import BoardEditor, { renderBoard, type Board, type El } from './BoardEditor';

export interface Piece {
  canvas: HTMLCanvasElement;
  url: string;
  w: number; // 원본 픽셀 크기 (확대율 경고용)
  h: number;
  label: string;
}

const hex = (c: number[]) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
let RUN = 0;

export default function ResizeHome() {
  const [file, setFile] = useState<{ name: string; url: string } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [seg, setSeg] = useState<Segmentation | null>(null);
  const [threshold, setThreshold] = useState(45);
  const [spread, setSpread] = useState(6);
  const [groups, setGroups] = useState<Group[]>([]);
  const pieces = useRef(new Map<string, Piece>());
  const [, setPv] = useState(0);
  const [over, setOver] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set(['ig-portrait', 'sig-v-fhd']));
  const [custom, setCustom] = useState({ w: '', h: '' });
  const [customs, setCustoms] = useState<SizePreset[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [active, setActive] = useState<string>('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);

  const allPresets = useMemo(() => [...PRESET_GROUPS.flatMap((g) => g.items), ...customs], [customs]);

  // ── 원본 올리기
  async function pickFile(f: File | undefined) {
    if (!f) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) return setMsg({ ok: false, text: 'PNG·JPG·WEBP 이미지를 올려 주세요.' });
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setFile({ name: f.name, url });
      setMsg(null);
      runSegment(img, threshold, spread, true);
    };
    img.onerror = () => setMsg({ ok: false, text: '이미지를 읽지 못했습니다.' });
    img.src = url;
  }

  function buildPieces(gs: Group[], s: Segmentation) {
    const img = imgRef.current!;
    for (const g of gs) {
      if (pieces.current.has(g.id)) continue;
      const p = cutPiece(img, s, g.objectIds);
      pieces.current.set(g.id, { canvas: p.canvas, url: p.canvas.toDataURL('image/png'), w: p.box.w, h: p.box.h, label: g.label });
      g.box = p.box; // 여백 포함 상자로 맞춤 (배치 계산과 조각 크기 일치)
    }
    setPv((v) => v + 1);
  }

  function runSegment(img: HTMLImageElement, th: number, sp: number, resetBoards: boolean) {
    const s = segment(img, { threshold: th, spread: sp });
    setSeg(s);
    const run = ++RUN;
    const gs = fallbackGroups(s.objects, s.srcW, s.srcH).map((g) => ({ ...g, id: `r${run}:${g.id}` }));
    buildPieces(gs, s);
    setGroups(gs);
    if (resetBoards) setBoards((bs) => bs.map((b) => ({ ...b, bg: hex(s.bg), els: [], past: [], future: [], source: '' })));
    if (s.bgShare < 0.6) setMsg({ ok: false, text: `배경이 단색이 아닌 것 같습니다 (테두리 중 배경색 ${Math.round(s.bgShare * 100)}%). 개체 분리가 부정확할 수 있으니 결과를 확인하세요.` });
  }

  // 원본 미리보기 + 묶음 상자
  useEffect(() => {
    const cv = previewRef.current;
    const img = imgRef.current;
    if (!cv || !img || !seg) return;
    const k = Math.min(1, 520 / seg.srcW);
    cv.width = Math.round(seg.srcW * k);
    cv.height = Math.round(seg.srcH * k);
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    const colors = ['#ff2d95', '#00c2ff', '#ffd400', '#7cff4f', '#ff7a00', '#b18cff', '#00ffc8', '#ff4d4d'];
    groups.forEach((g, i) => {
      ctx.strokeStyle = colors[i % colors.length];
      ctx.lineWidth = 2;
      ctx.setLineDash(g.role === 'decoration' ? [4, 3] : []);
      ctx.strokeRect(g.box.x * k, g.box.y * k, g.box.w * k, g.box.h * k);
    });
  }, [seg, groups, file]);

  // ── 사이즈 → 보드
  function makeBoards() {
    const sel = allPresets.filter((p) => picked.has(p.key));
    if (!sel.length) return setMsg({ ok: false, text: '사이즈를 하나 이상 고르세요.' });
    setBoards((old) => {
      const keep = old.filter((b) => picked.has(b.key));
      const add = sel.filter((p) => !old.some((b) => b.key === p.key)).map((p) => ({ key: p.key, label: p.label, W: p.w, H: p.h, bg: seg ? hex(seg.bg) : '#ffffff', els: [], past: [], future: [], source: '' as const }));
      const next = [...keep, ...add];
      if (!next.some((b) => b.key === active)) setActive(next[0]?.key ?? '');
      return next;
    });
  }

  function addCustom() {
    const w = Number(custom.w);
    const h = Number(custom.h);
    if (!(w >= 50 && h >= 50 && w <= 8000 && h <= 8000)) return setMsg({ ok: false, text: '가로·세로는 50~8000 사이로 입력하세요.' });
    const key = `custom-${w}x${h}`;
    if (!customs.some((c) => c.key === key)) setCustoms([...customs, { key, label: `직접 입력`, w, h }]);
    setPicked(new Set([...picked, key]));
    setCustom({ w: '', h: '' });
  }

  // ── 배치 적용
  function applyPlans(gs: Group[], plans: Record<string, Plan | undefined>, keys: string[], source: 'ai' | 'auto') {
    setBoards((bs) =>
      bs.map((b) => {
        if (!keys.includes(b.key)) return b;
        const plan = sanitizePlan(plans[b.key] ?? fallbackPlan(gs), gs);
        const pl = placePlan(gs, plan, b.W, b.H);
        const deco = new Set(gs.filter((g) => g.role === 'decoration').map((g) => g.id));
        // 장식은 뒤에
        pl.sort((a, c) => Number(deco.has(c.groupId)) - Number(deco.has(a.groupId)));
        const els: El[] = pl.map((p, i) => ({ id: `${p.groupId}#${i}`, kind: 'image', groupId: p.groupId, x: p.x, y: p.y, w: p.w, h: p.h }));
        return { ...b, els, past: b.els.length ? [...b.past, b.els] : b.past, future: [], source };
      }),
    );
  }

  async function aiConvert(onlyActive: boolean) {
    if (!seg || !imgRef.current) return;
    const targets = boards.filter((b) => !onlyActive || b.key === active);
    if (!targets.length) return setMsg({ ok: false, text: '먼저 사이즈를 고르고 보드를 만드세요.' });
    setBusy(`AI가 개체를 묶고 ${targets.length}개 사이즈 배치를 정하는 중… (10~30초)`);
    setMsg(null);
    try {
      const th = thumbnails(imgRef.current, seg);
      const res = await fetch('/api/resize/layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clean: th.clean,
          marked: th.marked,
          srcW: seg.srcW,
          srcH: seg.srcH,
          objects: seg.objects.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })),
          sizes: targets.map((b) => ({ key: b.key, w: b.W, h: b.H })),
        }),
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `오류 (${res.status})`);
      const run = ++RUN;
      const gs: Group[] = j.groups.map((g: any) =>
        makeGroup(`r${run}:${g.id}`, g.label, g.role, seg.objects.filter((o) => g.objectIds.includes(o.id)), seg.srcW, seg.srcH),
      );
      buildPieces(gs, seg);
      setGroups(gs);
      // AI 가 준 묶음 id 를 화면 내부 id(r번호:id)로 바꿈
      const pre = (id: string) => `r${run}:${id}`;
      const plans: Record<string, Plan> = {};
      for (const [key, pl] of Object.entries(j.plans ?? {}) as [string, Plan][]) {
        plans[key] = { rows: pl.rows.map((r) => r.map(pre)), decor: pl.decor.map((d) => ({ ...d, groupId: pre(d.groupId) })) };
      }
      applyPlans(gs, plans, targets.map((b) => b.key), 'ai');
      setMsg({ ok: true, text: `AI 변환 완료: ${gs.length}개 묶음으로 ${targets.length}개 사이즈를 배치했습니다. 개체를 끌어서 옮기거나 모서리로 크기를 조정하세요.` });
    } catch (e: any) {
      setMsg({ ok: false, text: `${e.message} — 'AI 없이 자동 배치'로도 시작할 수 있습니다.` });
    }
    setBusy('');
  }

  function autoConvert(onlyActive: boolean) {
    if (!seg) return;
    const targets = boards.filter((b) => !onlyActive || b.key === active).map((b) => b.key);
    const run = ++RUN;
    const gs = fallbackGroups(seg.objects, seg.srcW, seg.srcH).map((g) => ({ ...g, id: `r${run}:${g.id}` }));
    buildPieces(gs, seg);
    setGroups(gs);
    applyPlans(gs, {}, targets, 'auto');
  }

  async function downloadAll() {
    if (!boards.some((b) => b.els.length)) return;
    setBusy('이미지를 만드는 중…');
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const base = (file?.name ?? 'image').replace(/\.[^.]+$/, '');
      for (const b of boards) {
        if (!b.els.length) continue;
        const blob = await renderBoard(b, pieces.current, 'image/png');
        zip.file(`${base}_${b.W}x${b.H}_${b.key}.png`, blob);
      }
      const out = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(out);
      a.download = `${base}_리사이징.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
    setBusy('');
  }

  const board = boards.find((b) => b.key === active) ?? null;
  const setBoard = (fn: (b: Board) => Board) => setBoards((bs) => bs.map((b) => (b.key === active ? fn(b) : b)));

  return (
    <div className="container wide">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h1>이미지 리사이징</h1>
        <span className="hint">원본 이미지를 여러 사이즈로 재배치합니다. 이미지는 이 브라우저 안에서만 처리하고 저장하지 않습니다.</span>
      </div>
      {msg && <div className={`msg ${msg.ok ? 'ok' : 'err'}`} style={{ position: 'sticky', top: 68, zIndex: 20 }}>{msg.text}</div>}

      <div className="rz-layout">
        {/* ── 왼쪽: 원본 */}
        <div className="panel rz-left">
          <h2>1. 원본 이미지</h2>
          <div
            className={`drop ${over ? 'over' : ''}`}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); pickFile(e.dataTransfer.files[0]); }}
          >
            {file ? <><b>{file.name}</b><div className="hint">다른 이미지로 바꾸려면 클릭</div></> : <>이미지를 끌어 놓거나 클릭해서 선택<div className="hint">PNG·JPG·WEBP · 배경이 단색에 가까울수록 정확합니다</div></>}
          </div>
          <input ref={fileInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />

          {seg && (
            <>
              <canvas ref={previewRef} className="rz-preview" />
              <div className="hint" style={{ margin: '6px 0' }}>
                {seg.srcW}×{seg.srcH} · 배경색 <span className="swatch" style={{ background: hex(seg.bg) }} /> {hex(seg.bg)} · 개체 {seg.objects.length}개 · 묶음 {groups.length}개
              </div>
              <details>
                <summary className="hint">개체 찾기 설정</summary>
                <label>배경과 구분하는 정도 <span className="hint">{threshold} (낮을수록 옅은 그림자까지 개체로)</span></label>
                <input type="range" min={15} max={150} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
                <label>가까운 조각 묶기 <span className="hint">{spread} (클수록 크게 묶음)</span></label>
                <input type="range" min={2} max={25} value={spread} onChange={(e) => setSpread(Number(e.target.value))} />
                <button style={{ marginTop: 6 }} onClick={() => imgRef.current && runSegment(imgRef.current, threshold, spread, false)}>개체 다시 찾기</button>
              </details>
              <div className="rz-groups">
                {groups.map((g) => {
                  const p = pieces.current.get(g.id);
                  return (
                    <div key={g.id} className="rz-group" title={g.label}>
                      {p && <img src={p.url} alt="" />}
                      <span>{g.label}</span>
                      <span className="hint">{ROLE_LABEL[g.role]}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* ── 오른쪽: 사이즈·보드 */}
        <div className="rz-right">
          <div className="panel">
            <h2>2. 사이즈 <span className="hint">(여러 개 선택 가능)</span></h2>
            <div className="rz-presets">
              {PRESET_GROUPS.map((g) => (
                <div key={g.name} className="rz-pgroup">
                  <b>{g.name}</b>
                  {g.items.map((p) => (
                    <label key={p.key} className="chk">
                      <input type="checkbox" checked={picked.has(p.key)} onChange={(e) => { const s = new Set(picked); e.target.checked ? s.add(p.key) : s.delete(p.key); setPicked(s); }} />
                      {p.label} <span className="hint">{p.w}×{p.h}</span>
                    </label>
                  ))}
                </div>
              ))}
              <div className="rz-pgroup">
                <b>직접 입력</b>
                {customs.map((p) => (
                  <label key={p.key} className="chk">
                    <input type="checkbox" checked={picked.has(p.key)} onChange={(e) => { const s = new Set(picked); e.target.checked ? s.add(p.key) : s.delete(p.key); setPicked(s); }} />
                    <span className="hint">{p.w}×{p.h}</span>
                  </label>
                ))}
                <div className="filters">
                  <input type="text" inputMode="numeric" placeholder="가로" value={custom.w} onChange={(e) => setCustom({ ...custom, w: e.target.value.replace(/\D/g, '') })} style={{ width: 70 }} />
                  ×
                  <input type="text" inputMode="numeric" placeholder="세로" value={custom.h} onChange={(e) => setCustom({ ...custom, h: e.target.value.replace(/\D/g, '') })} style={{ width: 70 }} />
                  <button onClick={addCustom}>추가</button>
                </div>
              </div>
            </div>
            <div className="btn-row" style={{ marginTop: 10, alignItems: 'center' }}>
              <button className="primary" onClick={makeBoards}>조정 보드 만들기 ({picked.size})</button>
              {boards.length > 0 && seg && (
                <>
                  <button className="accent" onClick={() => aiConvert(false)} disabled={!!busy}>AI 변환 (보드 {boards.length}개 전체)</button>
                  <button onClick={() => autoConvert(false)} disabled={!!busy}>AI 없이 자동 배치</button>
                  <button onClick={downloadAll} disabled={!!busy || !boards.some((b) => b.els.length)}>전체 내려받기 (ZIP)</button>
                </>
              )}
              {!seg && <span className="hint">왼쪽에 원본 이미지를 먼저 올리세요.</span>}
            </div>
            {busy && <div className="msg">{busy}</div>}
          </div>

          {boards.length > 0 && (
            <div className="panel">
              <div className="dtabs" style={{ marginTop: 0 }}>
                {boards.map((b) => (
                  <button key={b.key} className={b.key === active ? 'on' : ''} onClick={() => setActive(b.key)}>
                    {b.W}×{b.H} <span className="hint">{b.label}</span>{b.els.length ? ' ✓' : ''}
                  </button>
                ))}
              </div>
              {board && (
                <BoardEditor
                  key={board.key}
                  board={board}
                  pieces={pieces.current}
                  groups={groups}
                  onChange={setBoard}
                  onAi={() => aiConvert(true)}
                  onAuto={() => autoConvert(true)}
                  busy={!!busy}
                  hasImage={!!seg}
                  fileBase={(file?.name ?? 'image').replace(/\.[^.]+$/, '')}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
