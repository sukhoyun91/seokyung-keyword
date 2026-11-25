'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PRESET_GROUPS, type SizePreset } from '@/lib/resize/presets';
import { backgroundCanvas, cutPiece, cutRect, segment, thumbnails, type Box, type Segmentation } from '@/lib/resize/segment';
import { ROLE_LABEL, fallbackGroups, fallbackPlan, makeGroup, placePlan, sanitizePlan, type Group, type Plan } from '@/lib/resize/layout';
import BoardEditor, { BG_KEY, renderBoard, type Board, type El } from './BoardEditor';

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
  const [excluded, setExcluded] = useState<Set<number>>(new Set()); // 지운 개체 (AI 변환·자동 배치에서 제외)
  const [regionMode, setRegionMode] = useState(false);
  const [rect, setRect] = useState<Box | null>(null); // 원본 좌표
  const rectStart = useRef<{ x: number; y: number } | null>(null);
  const live = (s: Segmentation) => s.objects.filter((o) => !excluded.has(o.id));

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
    setExcluded(new Set());
    const bgc = backgroundCanvas(s);
    pieces.current.set(BG_KEY, { canvas: bgc, url: bgc.toDataURL('image/png'), w: bgc.width, h: bgc.height, label: '배경' });
    const run = ++RUN;
    const gs = fallbackGroups(s.objects, s.srcW, s.srcH).map((g) => ({ ...g, id: `r${run}:${g.id}` }));
    buildPieces(gs, s);
    setGroups(gs);
    setBoards((bs) => bs.map((b) => ({ ...b, bg: hex(s.bg), bgMode: s.gradient ? 'image' : 'solid', ...(resetBoards ? { els: [], past: [], future: [], source: '' as const } : {}) })));
    if (s.bgShare < 0.6)
      setMsg({ ok: false, text: `배경이 복잡해 보입니다 (테두리 중 배경으로 판정 ${Math.round(s.bgShare * 100)}%). 뭉친 개체는 '영역 지정'으로 직접 잘라 쓰세요.` });
    else if (s.gradient) setMsg({ ok: true, text: '그라데이션 배경을 인식했습니다. 보드 배경은 원본 배경을 늘려서 채웁니다 (보드 위 메뉴에서 단색으로 바꿀 수 있음).' });
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
      if (g.id === BG_KEY) return;
      ctx.strokeStyle = colors[i % colors.length];
      ctx.lineWidth = 2;
      ctx.setLineDash(g.role === 'decoration' ? [4, 3] : []);
      ctx.strokeRect(g.box.x * k, g.box.y * k, g.box.w * k, g.box.h * k);
    });
    if (rect) {
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.fillStyle = 'rgba(25,160,255,.25)';
      ctx.fillRect(rect.x * k, rect.y * k, rect.w * k, rect.h * k);
      ctx.strokeRect(rect.x * k, rect.y * k, rect.w * k, rect.h * k);
    }
  }, [seg, groups, file, rect]);

  // 원본 미리보기에서 영역 긋기 → 개체 만들기
  const toSrc = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const cv = ev.currentTarget;
    const r = cv.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / r.width) * (seg?.srcW ?? 1), y: ((ev.clientY - r.top) / r.height) * (seg?.srcH ?? 1) };
  };
  function regionDown(ev: React.PointerEvent<HTMLCanvasElement>) {
    if (!regionMode || !seg) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    rectStart.current = toSrc(ev);
    setRect({ ...rectStart.current, w: 0, h: 0 });
  }
  function regionMove(ev: React.PointerEvent<HTMLCanvasElement>) {
    const a = rectStart.current;
    if (!a) return;
    const b = toSrc(ev);
    setRect({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });
  }
  function regionUp() {
    const r = rect;
    rectStart.current = null;
    if (!r || !seg || !imgRef.current || r.w < 8 || r.h < 8) return setRect(null);
    const n = groups.filter((g) => g.label.startsWith('지정 영역')).length + 1;
    const id = `r${++RUN}:area`;
    const p = cutRect(imgRef.current, seg, r);
    pieces.current.set(id, { canvas: p.canvas, url: p.canvas.toDataURL('image/png'), w: p.box.w, h: p.box.h, label: `지정 영역 ${n}` });
    const g: Group = { id, label: `지정 영역 ${n}`, role: 'other', objectIds: [], box: p.box, edge: { l: p.box.x <= 3, t: p.box.y <= 3, r: p.box.x + p.box.w >= seg.srcW - 3, b: p.box.y + p.box.h >= seg.srcH - 3 } };
    setGroups((gs) => [...gs, g]);
    // 지금 보고 있는 보드에 바로 넣기 (원본과 같은 비율 위치)
    setBoards((bs) =>
      bs.map((b) => {
        if (b.key !== active) return b;
        const s = Math.min(b.W / seg.srcW, b.H / seg.srcH);
        const el: El = { id: `${id}#0`, kind: 'image', groupId: id, w: Math.round(p.box.w * s), h: Math.round(p.box.h * s), x: Math.round(p.box.x * s + (b.W - seg.srcW * s) / 2), y: Math.round(p.box.y * s + (b.H - seg.srcH * s) / 2) };
        return { ...b, els: [...b.els, el], past: [...b.past, b.els], future: [] };
      }),
    );
    setRect(null);
    setPv((v) => v + 1);
    setMsg({ ok: true, text: `'지정 영역 ${n}'을(를) 만들었습니다.${boards.some((b) => b.key === active) ? ' 지금 보드에 넣었습니다.' : ''} 다른 보드에는 '빠진 개체 넣기'로 넣으세요.` });
  }

  // 묶음(개체) 지우기: 모든 보드에서 빼고, AI 변환·자동 배치에서도 제외
  function removeGroup(g: Group) {
    setGroups((gs) => gs.filter((x) => x.id !== g.id));
    setExcluded((ex) => new Set([...ex, ...g.objectIds]));
    setBoards((bs) => bs.map((b) => (b.els.some((e) => e.kind === 'image' && e.groupId === g.id) ? { ...b, els: b.els.filter((e) => !(e.kind === 'image' && e.groupId === g.id)), past: [...b.past, b.els], future: [] } : b)));
  }

  // ── 사이즈 → 보드
  function makeBoards() {
    const sel = allPresets.filter((p) => picked.has(p.key));
    if (!sel.length) return setMsg({ ok: false, text: '사이즈를 하나 이상 고르세요.' });
    setBoards((old) => {
      const keep = old.filter((b) => picked.has(b.key));
      const add = sel.filter((p) => !old.some((b) => b.key === p.key)).map((p) => ({ key: p.key, label: p.label, W: p.w, H: p.h, bg: seg ? hex(seg.bg) : '#ffffff', bgMode: (seg?.gradient ? 'image' : 'solid') as Board['bgMode'], els: [], past: [], future: [], source: '' as const }));
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
          objects: live(seg).map(({ id, x, y, w, h }) => ({ id, x, y, w, h })),
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
        makeGroup(`r${run}:${g.id}`, g.label, g.role, live(seg).filter((o) => g.objectIds.includes(o.id)), seg.srcW, seg.srcH),
      ).filter((g: Group) => g.objectIds.length);
      const areas = groups.filter((g) => g.label.startsWith('지정 영역'));
      buildPieces(gs, seg);
      setGroups([...gs, ...areas]);
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
    const gs = fallbackGroups(live(seg), seg.srcW, seg.srcH).map((g) => ({ ...g, id: `r${run}:${g.id}` }));
    buildPieces(gs, seg);
    setGroups([...gs, ...groups.filter((g) => g.label.startsWith('지정 영역'))]);
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
              <canvas
                ref={previewRef}
                className={`rz-preview ${regionMode ? 'region' : ''}`}
                onPointerDown={regionDown}
                onPointerMove={regionMove}
                onPointerUp={regionUp}
              />
              <div className="btn-row" style={{ marginTop: 6 }}>
                <button className={regionMode ? 'primary' : ''} onClick={() => { setRegionMode(!regionMode); setRect(null); }}>
                  {regionMode ? '영역 지정 중… (끝내기)' : '✂ 영역 지정해서 개체 만들기'}
                </button>
              </div>
              {regionMode && <div className="hint">원본 위에서 끌어 사각형을 그으면 그 부분이 개체가 됩니다. 뭉쳐서 나뉘지 않는 부분을 직접 자를 때 쓰세요.</div>}
              <div className="hint" style={{ margin: '6px 0' }}>
                {seg.srcW}×{seg.srcH} · 배경 {seg.gradient ? '그라데이션' : <><span className="swatch" style={{ background: hex(seg.bg) }} /> {hex(seg.bg)}</>} · 개체 {live(seg).length}개 · 묶음 {groups.length}개
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
                      <button className="rz-del" title="이 개체 지우기 (모든 보드에서 빠지고 AI 변환에서도 제외)" onClick={() => removeGroup(g)}>✕</button>
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
