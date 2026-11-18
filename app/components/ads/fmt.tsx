import { ctr, cpc, type M } from '@/lib/ads/types';

export const n0 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '-' : Math.round(v).toLocaleString('ko-KR'));
export const p2 = (v: number) => `${v.toFixed(2)}%`;
export const rk = (v: number | null | undefined) => (v == null ? '-' : v.toFixed(1));

export async function api<T = any>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('로그인이 필요합니다.');
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `오류 (${res.status})`);
  return j as T;
}

/** 증감 표시: ▲ 빨강(증가) / ▼ 파랑(감소) */
export function Delta({ cur, prev, kind = 'num', invert = false }: { cur: number; prev: number | undefined; kind?: 'num' | 'pct' | 'rate'; invert?: boolean }) {
  if (prev == null) return <span className="muted">-</span>;
  const d = cur - prev;
  if (kind === 'rate') {
    if (!prev) return <span className="muted">-</span>;
    const r = (d / prev) * 100;
    const cls = r === 0 ? '' : (r > 0) !== invert ? 'up' : 'down';
    return <span className={`delta ${cls}`}>{r > 0 ? '+' : ''}{r.toFixed(1)}%</span>;
  }
  if (d === 0) return <span className="delta">0</span>;
  const cls = (d > 0) !== invert ? 'up' : 'down';
  return (
    <span className={`delta ${cls}`}>
      {d > 0 ? '▲' : '▼'}
      {kind === 'pct' ? `${Math.abs(d).toFixed(2)}%p` : n0(Math.abs(d))}
    </span>
  );
}

/** 표준 지표 셀 5~6개 */
export function MetricCells({ m, rank = true }: { m: M | undefined; rank?: boolean }) {
  if (!m) {
    return (
      <>
        <td className="num muted">-</td><td className="num muted">-</td><td className="num muted">-</td>
        <td className="num muted">-</td><td className="num muted">-</td>{rank && <td className="num muted">-</td>}
      </>
    );
  }
  return (
    <>
      <td className="num">{n0(m.imp)}</td>
      <td className="num">{n0(m.clk)}</td>
      <td className="num">{p2(ctr(m))}</td>
      <td className="num">{n0(cpc(m))}</td>
      <td className="num">{n0(m.cost)}</td>
      {rank && <td className="num">{rk(m.rank)}</td>}
    </>
  );
}

export const METRIC_HEADS = ['노출수', '클릭수', '클릭률', '평균클릭비용', '광고비', '평균노출순위'];

export function DeltaRows({ cur, prev, label = '전월 대비 ', rank = true, lead = 1, trail = 0 }: { cur?: M; prev?: M; label?: string; rank?: boolean; lead?: number; trail?: number }) {
  const tail = Array.from({ length: trail }, (_, i) => <td key={i} />);
  if (!cur || !prev) return null;
  return (
    <>
      <tr className="delta-row">
        <td colSpan={lead}>{label}증감분</td>
        <td className="num"><Delta cur={cur.imp} prev={prev.imp} /></td>
        <td className="num"><Delta cur={cur.clk} prev={prev.clk} /></td>
        <td className="num"><Delta cur={ctr(cur)} prev={ctr(prev)} kind="pct" /></td>
        <td className="num"><Delta cur={cpc(cur)} prev={cpc(prev)} /></td>
        <td className="num"><Delta cur={cur.cost} prev={prev.cost} /></td>
        {rank && <td />}
        {tail}
      </tr>
      <tr className="delta-row">
        <td colSpan={lead}>{label}증감률</td>
        <td className="num"><Delta cur={cur.imp} prev={prev.imp} kind="rate" /></td>
        <td className="num"><Delta cur={cur.clk} prev={prev.clk} kind="rate" /></td>
        <td className="num"><Delta cur={ctr(cur)} prev={ctr(prev)} kind="rate" /></td>
        <td className="num"><Delta cur={cpc(cur)} prev={cpc(prev)} kind="rate" /></td>
        <td className="num"><Delta cur={cur.cost} prev={prev.cost} kind="rate" /></td>
        {rank && <td />}
        {tail}
      </tr>
    </>
  );
}
