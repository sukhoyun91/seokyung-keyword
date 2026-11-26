'use client';
import { createContext, useContext, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react';

/**
 * 보고서 화면 배치 편집
 * - <Flow>: 개체를 담는 줄바꿈 상자 (flex-wrap)
 * - <Blk id>: 옮기기(같은 상자 안에서 순서·나란히 배치), 크기(가로 %, 세로 px), 삭제(숨김)
 * 배치는 광고주별로 DB에 저장되어 화면·인쇄·HTML 다운로드에 모두 반영됩니다.
 */
export type BlkState = { order?: number; w?: number; h?: number; hidden?: boolean };
export type LayoutMap = Record<string, BlkState>;

type Ctx = {
  edit: boolean;
  layout: LayoutMap;
  set: (id: string, patch: Partial<BlkState> | null) => void;
  setMany: (patches: Record<string, Partial<BlkState>>) => void;
  labels: Map<string, string>;
};
const LayoutCtx = createContext<Ctx>({ edit: false, layout: {}, set: () => {}, setMany: () => {}, labels: new Map() });
export const useLayout = () => useContext(LayoutCtx);

export function LayoutProvider({ value, children }: { value: Omit<Ctx, 'labels'> & { labels?: Map<string, string> }; children: ReactNode }) {
  const labels = useRef(value.labels ?? new Map<string, string>()).current;
  return <LayoutCtx.Provider value={{ ...value, labels }}>{children}</LayoutCtx.Provider>;
}

const GAP = 12;

export function Flow({ children, className = '', gap = GAP, style }: { children: ReactNode; className?: string; gap?: number; style?: CSSProperties }) {
  return (
    <div className={`blk-flow ${className}`} style={{ columnGap: gap, rowGap: gap, ...style, ['--gap' as any]: `${gap}px` }}>
      {children}
    </div>
  );
}


export function Blk({ id, label, w: defW = 100, className = '', children, style }: { id: string; label: string; w?: number; className?: string; children: ReactNode; style?: CSSProperties }) {
  const { edit, layout, set, setMany, labels } = useLayout();
  labels.set(id, label);
  const st = layout[id] ?? {};
  const ref = useRef<HTMLDivElement>(null);
  const w = st.w ?? defW;

  if (st.hidden && !edit) return null;
  if (st.hidden && edit) {
    return (
      <div className="blk blk-hidden no-print" style={{ order: st.order, width: '100%' }}>
        숨긴 개체: {label} <button onClick={() => set(id, { hidden: false })}>되살리기</button>
      </div>
    );
  }

  const css: CSSProperties = {
    ...style,
    order: st.order,
    width: w >= 100 ? '100%' : `calc(${w}% - var(--gap, ${GAP}px) * ${(1 - w / 100).toFixed(4)})`,
    height: st.h ? `${st.h}px` : undefined,
    overflow: st.h ? 'auto' : undefined,
  };

  /** 같은 상자 안 형제 개체 (화면에 보이는 순서대로) */
  const siblings = (el: HTMLElement) =>
    Array.from(el.parentElement?.children ?? [])
      .filter((x): x is HTMLElement => x instanceof HTMLElement && Boolean(x.dataset.blk))
      .map((x, i) => ({ x, i, o: Number(getComputedStyle(x).order) || 0 }))
      .sort((a, b) => a.o - b.o || a.i - b.i)
      .map((s) => s.x);

  /** 옮기기: 손잡이를 누른 채 끌면, 같은 상자 안의 다른 개체 앞/뒤에 놓임 (마우스·터치 공용) */
  const startMove = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const me = ref.current!;
    const parent = me.parentElement!;
    let target: HTMLElement | null = null;
    let pos: 'before' | 'after' = 'before';
    const clear = () => parent.querySelectorAll(':scope > .blk-over-before, :scope > .blk-over-after').forEach((x) => x.classList.remove('blk-over-before', 'blk-over-after'));
    me.classList.add('blk-dragging');
    document.body.classList.add('blk-moving');
    // 화면 위·아래 끝으로 끌면 자동으로 스크롤
    let lastY = e.clientY;
    const auto = window.setInterval(() => {
      if (lastY < 70) window.scrollBy(0, -18);
      else if (lastY > window.innerHeight - 50) window.scrollBy(0, 18);
    }, 30);
    const move = (ev: PointerEvent) => {
      lastY = ev.clientY;
      let el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      while (el && !(el.parentElement === parent && el.dataset.blk)) el = el.parentElement;
      clear();
      target = el && el !== me ? el : null;
      if (!target) return;
      const r = target.getBoundingClientRect();
      const side = r.width < parent.getBoundingClientRect().width * 0.9;
      pos = side ? (ev.clientX < r.left + r.width / 2 ? 'before' : 'after') : ev.clientY < r.top + r.height / 2 ? 'before' : 'after';
      target.classList.add(`blk-over-${pos}`);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.clearInterval(auto);
      clear();
      me.classList.remove('blk-dragging');
      document.body.classList.remove('blk-moving');
      if (!target) return;
      const list = siblings(me).filter((x) => x !== me);
      list.splice(list.indexOf(target) + (pos === 'after' ? 1 : 0), 0, me);
      const patches: Record<string, Partial<BlkState>> = {};
      list.forEach((x, i) => (patches[x.dataset.blk!] = { order: i }));
      setMany(patches);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** 크기 조절: 오른쪽 끝(가로), 아래 끝(세로) */
  const startResize = (mode: 'w' | 'h') => (e: RPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = ref.current!;
    const flow = el.parentElement!.getBoundingClientRect();
    const top = el.getBoundingClientRect().top;
    const left = el.getBoundingClientRect().left;
    const move = (ev: PointerEvent) => {
      if (mode === 'w') {
        const pct = Math.round((((ev.clientX - left) / flow.width) * 100) / 5) * 5;
        set(id, { w: Math.min(100, Math.max(15, pct)) });
      } else {
        set(id, { h: Math.max(60, Math.round(ev.clientY - top)) });
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      ref={ref}
      data-blk={id}
      className={`blk ${className} ${edit ? 'blk-edit' : ''}`}
      style={css}
    >
      {edit && (
        <div className="blk-bar no-print">
          <span className="blk-grip" title="끌어서 옮기기 (같은 상자 안에서 앞뒤·나란히)" onPointerDown={startMove}>
            ⠿ {label}
          </span>
          <span className="blk-size">{w}%{st.h ? ` · ${st.h}px` : ''}</span>
          {(st.w != null || st.h != null) && <button title="원래 크기" onClick={() => set(id, { w: undefined, h: undefined })}>↺</button>}
          <button title="삭제 (보고서에서 숨김)" className="blk-del" onClick={() => set(id, { hidden: true })}>✕</button>
        </div>
      )}
      {children}
      {edit && (
        <>
          <span className="blk-rw no-print" title="가로 크기 (끌기 · 두 번 누르면 원래대로)" onPointerDown={startResize('w')} onDoubleClick={() => set(id, { w: undefined })} />
          <span className="blk-rh no-print" title="세로 크기 (끌기 · 두 번 누르면 원래대로)" onPointerDown={startResize('h')} onDoubleClick={() => set(id, { h: undefined })} />
        </>
      )}
    </div>
  );
}

/** 편집 중 상태 관리 (저장 전 변경분) */
export function useLayoutState(initial: LayoutMap) {
  const [layout, setLayout] = useState<LayoutMap>(initial);
  const clean = (s: BlkState) => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined && v !== false)) as BlkState;
  const set = (id: string, patch: Partial<BlkState> | null) =>
    setLayout((L) => {
      const next = { ...L };
      if (patch === null) delete next[id];
      else {
        const v = clean({ ...(L[id] ?? {}), ...patch });
        if (Object.keys(v).length) next[id] = v;
        else delete next[id];
      }
      return next;
    });
  const setMany = (patches: Record<string, Partial<BlkState>>) =>
    setLayout((L) => {
      const next = { ...L };
      for (const [id, p] of Object.entries(patches)) next[id] = clean({ ...(L[id] ?? {}), ...p });
      return next;
    });
  return { layout, setLayout, set, setMany };
}
