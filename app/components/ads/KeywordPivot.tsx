'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, n0, rk } from './fmt';
import { SortTh, sortRows, type Sort } from './sort';

type Row = { keyword: string; month: string; imp: number; clk: number; cost: number; rank: number | null };
type Metric = 'imp' | 'clk' | 'cost' | 'rank';
const METRICS: { id: Metric; label: string }[] = [
  { id: 'clk', label: '클릭수' },
  { id: 'imp', label: '노출수' },
  { id: 'cost', label: '광고비' },
  { id: 'rank', label: '평균노출순위' },
];

/** 엑셀 피벗테이블(광고그룹 → 키워드 → 월) 대체 화면 */
export default function KeywordPivot({ accountId, month, months }: { accountId: number; month: string; months: string[] }) {
  const [groups, setGroups] = useState<{ ad_group: string; n: number }[]>([]);
  const [group, setGroup] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [metric, setMetric] = useState<Metric>('clk');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(30);
  const [sort, setSort] = useState<Sort>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams({ account: String(accountId), month });
    if (group) qs.set('group', group);
    api<{ groups: typeof groups; group: string | null; rows: Row[] }>(`/api/ads/keyword-trend?${qs}`)
      .then((j) => {
        setGroups(j.groups);
        if (!group) setGroup(j.group);
        setRows(j.rows);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [accountId, month, group]);

  const table = useMemo(() => {
    const by = new Map<string, Map<string, Row>>();
    for (const r of rows) {
      if (!by.has(r.keyword)) by.set(r.keyword, new Map());
      by.get(r.keyword)!.set(r.month, r);
    }
    const list = [...by.entries()]
      .filter(([k]) => !q || k.toLowerCase().includes(q.toLowerCase()))
      .map(([keyword, ms]) => {
        const tot = months.reduce((a, m) => a + (ms.get(m)?.[metric === 'rank' ? 'imp' : metric] ?? 0), 0);
        return { keyword, ms, tot };
      })
      .sort((a, b) => b.tot - a.tot);
    const num = (r: Row | undefined) => (!r ? null : metric === 'rank' ? r.rank : r[metric]);
    return sortRows(list, sort, (x, k) => (k === 'kw' ? x.keyword : k === 'tot' ? x.tot : num(x.ms.get(k))));
  }, [rows, months, metric, q, sort]);

  const val = (r: Row | undefined) => {
    if (!r) return '';
    if (metric === 'rank') return rk(r.rank);
    return r[metric] ? n0(r[metric]) : '-';
  };

  if (error) return <div className="msg err">{error}</div>;

  return (
    <>
      <div className="btn-row no-print" style={{ marginBottom: 8 }}>
        <select value={group ?? ''} onChange={(e) => setGroup(e.target.value)} style={{ width: 'auto' }}>
          {groups.map((g) => <option key={g.ad_group} value={g.ad_group}>{g.ad_group} ({g.n})</option>)}
        </select>
        <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)} style={{ width: 'auto' }}>
          {METRICS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <input type="text" placeholder="키워드 검색" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 180 }} />
        {loading && <span className="hint" style={{ alignSelf: 'center' }}>불러오는 중…</span>}
      </div>
      <p className="hint print-only">{group} · {METRICS.find((m) => m.id === metric)?.label}</p>
      <div className="table-wrap pivot-wrap">
        <table className="rp-table compact pivot">
          <thead>
            <tr>
              <SortTh label="키워드" k="kw" className="sticky" sort={sort} onSort={setSort} />
              {months.map((m) => <SortTh key={m} label={m.slice(2).replace('-', '.')} k={m} className={`num ${m === month ? 'cur-col' : ''}`} sort={sort} onSort={setSort} />)}
              {metric !== 'rank' && <SortTh label="합계" k="tot" className="num" sort={sort} onSort={setSort} />}
            </tr>
          </thead>
          <tbody>
            {table.map((r, i) => (
              <tr key={r.keyword} className={i >= limit ? 'more-row' : ''}>
                <td className="sticky"><b>{r.keyword}</b></td>
                {months.map((m) => <td key={m} className={`num ${m === month ? 'cur-col' : ''}`}>{val(r.ms.get(m))}</td>)}
                {metric !== 'rank' && <td className="num"><b>{n0(r.tot)}</b></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.length > limit && (
        <div className="btn-row no-print" style={{ marginTop: 8, alignItems: 'center' }}>
          <button onClick={() => setLimit((l) => l + 50)}>더 보기 ({table.length - limit}개 남음)</button>
          <button onClick={() => setLimit(table.length)}>전체 보기</button>
          <span className="hint">인쇄·PDF·HTML에는 전체 {table.length}개가 모두 나옵니다.</span>
        </div>
      )}
      <p className="hint">평균노출순위는 숫자가 작을수록 위에 노출됩니다. 정렬은 표시 기간 합계 기준(순위는 노출수 기준)입니다.</p>
    </>
  );
}
