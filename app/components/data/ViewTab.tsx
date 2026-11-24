'use client';
import { useEffect, useMemo, useState } from 'react';
import { LEVELS, LEVEL_LABEL, type AdLevel } from '@/lib/ads/parse';
import { monthLabel } from '@/lib/ads/types';
import { HAS_RANK, LEVEL_TEXT_COLS, cpcOf, ctrOf, type DataRow } from '@/lib/ads/columns';
import { api, n0 } from '../ads/fmt';
import type { Directory } from '../ads/directory';

const PAGE = 100;

export default function ViewTab({ dir }: { dir: Directory }) {
  const sel = dir.account;
  const months = useMemo(() => (sel ? [...new Set(sel.coverage.map((c) => c.month))].sort() : []), [sel]);
  const [level, setLevel] = useState<AdLevel>('campaign');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [qApplied, setQApplied] = useState('');
  const [sort, setSort] = useState<'default' | 'cost' | 'imp'>('default');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ rows: DataRow[]; total: number; sum: { imp: number; clk: number; cost: number } } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // 계정이 바뀌면 최근 달로
  useEffect(() => {
    const last = months.at(-1) ?? '';
    setFrom(last);
    setTo(last);
    setPage(0);
  }, [sel?.id, months.length]);

  useEffect(() => {
    if (!sel || !from || !to) {
      setData(null);
      return;
    }
    let stop = false;
    setBusy(true);
    setErr('');
    const qs = new URLSearchParams({ account: String(sel.id), level, from, to, q: qApplied, sort, offset: String(page * PAGE), limit: String(PAGE) });
    api<{ rows: DataRow[]; total: number; sum: { imp: number; clk: number; cost: number } }>(`/api/ads/data?${qs}`)
      .then((j) => !stop && setData(j))
      .catch((e) => !stop && setErr(e.message))
      .finally(() => !stop && setBusy(false));
    return () => {
      stop = true;
    };
  }, [sel?.id, level, from, to, qApplied, sort, page]);

  if (!sel) return <div className="panel"><div className="empty">왼쪽에서 광고 계정을 선택하세요.</div></div>;
  if (!months.length) return <div className="panel"><div className="empty">이 계정에 저장된 자료가 없습니다. '업로드' 탭에서 먼저 올려 주세요.</div></div>;

  const cols = LEVEL_TEXT_COLS[level];
  const rank = HAS_RANK[level];
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  const covOf = (l: string) => sel.coverage.filter((c) => c.level === l && c.month >= from && c.month <= to).reduce((s, c) => s + c.rows, 0);

  return (
    <div className="panel">
      <h2>DB 자료 조회 <span className="hint">{dir.company?.name} › {sel.name}</span></h2>
      <div className="seg" style={{ marginBottom: 10 }}>
        {LEVELS.map((l) => (
          <button key={l} className={l === level ? 'on' : ''} onClick={() => { setLevel(l); setPage(0); }}>
            {LEVEL_LABEL[l]} <span className="hint">{n0(covOf(l))}</span>
          </button>
        ))}
      </div>
      <div className="filters">
        <label>기간</label>
        <select value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); setPage(0); }}>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <span>~</span>
        <select value={to} onChange={(e) => { setTo(e.target.value); if (e.target.value < from) setFrom(e.target.value); setPage(0); }}>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <button onClick={() => { setFrom(months[0]); setTo(months.at(-1)!); setPage(0); }}>전체 기간</button>
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (setQApplied(q), setPage(0))} placeholder="광고그룹·키워드·검색어 찾기 (Enter)" style={{ maxWidth: 260 }} />
        <select value={sort} onChange={(e) => { setSort(e.target.value as any); setPage(0); }}>
          <option value="default">월·이름 순</option>
          <option value="cost">비용 많은 순</option>
          <option value="imp">노출 많은 순</option>
        </select>
      </div>
      {err && <div className="msg err">{err}</div>}
      {data && (
        <div className="hint" style={{ margin: '8px 0' }}>
          {n0(data.total)}행 · 노출 {n0(data.sum.imp)} · 클릭 {n0(data.sum.clk)} · 비용 {n0(data.sum.cost)}원
          {busy && ' · 불러오는 중…'}
        </div>
      )}
      <div className="table-wrap" style={{ maxHeight: 620 }}>
        <table>
          <thead>
            <tr>
              <th>월</th>
              {cols.map((c) => <th key={c.key}>{c.label}</th>)}
              <th className="num">노출수</th><th className="num">클릭수</th><th className="num">클릭률</th><th className="num">평균CPC</th><th className="num">총비용</th>
              {rank && <th className="num">평균순위</th>}
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r, i) => (
              <tr key={i}>
                <td>{r.month}</td>
                {cols.map((c) => <td key={c.key}>{r[c.key] || <span className="muted">-</span>}</td>)}
                <td className="num">{n0(r.impressions)}</td>
                <td className="num">{n0(r.clicks)}</td>
                <td className="num">{ctrOf(r).toFixed(2)}%</td>
                <td className="num">{n0(cpcOf(r))}</td>
                <td className="num">{n0(r.cost)}</td>
                {rank && <td className="num">{r.avg_rank == null ? '-' : Number(r.avg_rank).toFixed(1)}</td>}
              </tr>
            ))}
            {data && !data.rows.length && <tr><td colSpan={9} className="empty">조건에 맞는 자료가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      {data && pages > 1 && (
        <div className="btn-row" style={{ marginTop: 10, alignItems: 'center' }}>
          <button disabled={page === 0} onClick={() => setPage(page - 1)}>이전</button>
          <span className="hint">{page + 1} / {pages} 쪽</span>
          <button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>다음</button>
        </div>
      )}
    </div>
  );
}
