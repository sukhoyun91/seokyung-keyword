'use client';
import { useState, type MouseEvent, type ReactNode, type ThHTMLAttributes } from 'react';
import { ctr, cpc, type M } from '@/lib/ads/types';

/* ── 표 정렬 (머리글 옆 ▲ 오름차순 / ▼ 내림차순) ── */
export type Sort = { k: string; dir: 1 | -1 } | null;

export function useSort(init: Sort = null) {
  const [sort, setSort] = useState<Sort>(init);
  return { sort, setSort };
}

/** 정렬 가능한 머리글: ▲ 누르면 오름차순, ▼ 누르면 내림차순, 같은 것을 다시 누르면 해제. 글자를 누르면 내림차순→오름차순→해제 */
export function SortTh({ label, k, sort, onSort, className = '', ...rest }: { label: ReactNode; k: string; sort: Sort; onSort: (s: Sort) => void; className?: string } & ThHTMLAttributes<HTMLTableCellElement>) {
  const on = sort?.k === k ? sort.dir : 0;
  const pick = (dir: 1 | -1) => (e: MouseEvent) => {
    e.stopPropagation();
    onSort(on === dir ? null : { k, dir });
  };
  return (
    <th
      {...rest}
      className={`${className} sortable ${on ? 'sorted' : ''}`}
      onClick={() => onSort(on === 0 ? { k, dir: -1 } : on === -1 ? { k, dir: 1 } : null)}
      title="▲ 오름차순 · ▼ 내림차순"
    >
      <span className="th-in">
        <span>{label}</span>
        <span className="sort-ic no-print" aria-hidden>
          <i className={on === 1 ? 'on' : ''} onClick={pick(1)}>▲</i>
          <i className={on === -1 ? 'on' : ''} onClick={pick(-1)}>▼</i>
        </span>
      </span>
    </th>
  );
}

/** 지표 값 (정렬용) */
export function mval(m: M | undefined | null, k: string): number | null {
  if (!m) return null;
  switch (k) {
    case 'imp': return m.imp;
    case 'clk': return m.clk;
    case 'ctr': return ctr(m);
    case 'cpc': return cpc(m);
    case 'cost': return m.cost;
    case 'rank': return m.rank ?? null;
  }
  return null;
}
export const METRIC_KEYS = ['imp', 'clk', 'ctr', 'cpc', 'cost', 'rank'];

/** 안정 정렬: 빈 값은 항상 맨 아래, 글자는 한국어 순 */
export function sortRows<T>(rows: T[], sort: Sort, get: (row: T, k: string) => number | string | null | undefined): T[] {
  if (!sort) return rows;
  const out = rows.map((r, i) => ({ r, i, v: get(r, sort.k) }));
  out.sort((a, b) => {
    const av = a.v, bv = b.v;
    const ae = av == null || av === '', be = bv == null || bv === '';
    if (ae || be) return ae && be ? a.i - b.i : ae ? 1 : -1;
    const c = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'ko', { numeric: true });
    return c * sort.dir || a.i - b.i;
  });
  return out.map((x) => x.r);
}
