'use client';
import { useEffect, useMemo, useState } from 'react';
import { ctr, cpc, monthLabel, type AdReport, type M } from '@/lib/ads/types';
import { api, n0, p2, rk, Delta, MetricCells, DeltaRows, METRIC_HEADS } from './fmt';
import TrendChart from './TrendChart';
import KeywordPivot from './KeywordPivot';
import ExecDashboard from './ExecDashboard';

const sumM = (list: M[]): M => {
  const imp = list.reduce((a, b) => a + b.imp, 0);
  const rw = list.filter((x) => x.rank != null);
  const ri = rw.reduce((a, b) => a + Math.max(b.imp, 1), 0);
  return {
    imp,
    clk: list.reduce((a, b) => a + b.clk, 0),
    cost: list.reduce((a, b) => a + b.cost, 0),
    rank: ri ? Math.round((rw.reduce((a, b) => a + (b.rank ?? 0) * Math.max(b.imp, 1), 0) / ri) * 10) / 10 : null,
  };
};

const rate = (c: number, p: number | undefined) => (p ? `${c >= p ? '+' : ''}${(((c - p) / p) * 100).toFixed(1)}%` : '신규');
const diffTxt = (c: number, p: number) => `${n0(p)} → ${n0(c)} (${c - p >= 0 ? '+' : ''}${n0(c - p)})`;

/** 전월·당월·증감 3칸 */
function Cmp3({ c, p, hasPrev }: { c: number | undefined; p: number | undefined; hasPrev: boolean }) {
  return (
    <>
      <td className="num muted-cell">{hasPrev ? n0(p ?? 0) : '-'}</td>
      <td className="num">{c == null ? '-' : n0(c)}</td>
      <td className="num">{hasPrev ? <Delta cur={c ?? 0} prev={p ?? 0} /> : <span className="muted">-</span>}</td>
    </>
  );
}
const CMP_SUB = (n: number) => Array.from({ length: n }).flatMap((_, i) => [<th key={`p${i}`} className="num sub">전월</th>, <th key={`c${i}`} className="num sub">당월</th>, <th key={`d${i}`} className="num sub">증감</th>]);

function lastDay(month: string) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export default function AdReportView({ accountId, month, userName }: { accountId: number; month: string; userName: string }) {
  const [r, setR] = useState<AdReport | null>(null);
  const [error, setError] = useState('');
  const [range, setRange] = useState<'13' | 'all'>('13');
  const [kwGroup, setKwGroup] = useState('');
  const [kwAll, setKwAll] = useState(false);
  const [opinion, setOpinion] = useState('');
  const [opDirty, setOpDirty] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState('');
  const [htmlBusy, setHtmlBusy] = useState(false);
  const [inputs, setInputs] = useState({ tax_invoice: '', coupon: '', note: '' });
  const [groupSet, setGroupSet] = useState<Record<string, { daily_budget: string; region_target: string }>>({});
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    try {
      const j = await api<AdReport>(`/api/ads/report?account=${accountId}&month=${month}`);
      setR(j);
      setOpinion(j.notes.opinion);
      setOpDirty(false);
      setInputs({
        tax_invoice: j.notes.tax_invoice == null ? '' : String(j.notes.tax_invoice),
        coupon: j.notes.coupon == null ? '' : String(j.notes.coupon),
        note: j.notes.note,
      });
      const gs: Record<string, { daily_budget: string; region_target: string }> = {};
      for (const g of j.adGroups.groups) {
        const s = j.adGroups.settings.find((x) => x.ad_group === g.ad_group);
        gs[g.ad_group] = { daily_budget: s?.daily_budget == null ? '' : String(s.daily_budget), region_target: s?.region_target ?? '' };
      }
      setGroupSet(gs);
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => { load(); }, [accountId, month]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (opDirty) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [opDirty]);

  function notify(ok: boolean, text: string) {
    setFlash({ ok, text });
    setTimeout(() => setFlash(null), 4000);
  }

  async function genOpinion() {
    if (opinion.trim() && !confirm('지금 작성된 의견을 AI 초안으로 바꿀까요?')) return;
    setAiBusy(true);
    try {
      const j = await api<{ opinion: string }>('/api/ads/opinion', 'POST', { accountId, month });
      if (!j.opinion?.trim()) throw new Error('AI 초안이 비어 있습니다. 다시 눌러 주세요.');
      setAiErr('');
      setOpinion(j.opinion);
      setOpDirty(true);
      notify(true, 'AI 초안을 만들었습니다. 내용을 확인·수정한 뒤 [의견 저장]을 누르세요.');
    } catch (e: any) {
      const m = /Unexpected|JSON|\(50[24]\)/.test(e.message) ? 'AI 응답 시간이 초과됐습니다. 다시 눌러 주세요.' : e.message;
      setAiErr(m);
      notify(false, m);
    } finally {
      setAiBusy(false);
    }
  }

  /** 지금 화면의 보고서를 한 파일짜리 HTML로 저장 (스타일 포함, 편집 도구 제외) */
  function downloadHtml() {
    const src = document.querySelector('.container.report');
    if (!src || !r) return;
    setHtmlBusy(true);
    try {
      const node = src.cloneNode(true) as HTMLElement;
      node.querySelectorAll('.no-print, .ex-tip, script').forEach((el) => el.remove());
      node.querySelectorAll('.print-only').forEach((el) => el.classList.remove('print-only'));
      node.querySelectorAll('[style*="position: sticky"]').forEach((el) => el.remove());
      let css = '';
      for (const sh of Array.from(document.styleSheets)) {
        try { css += Array.from(sh.cssRules).map((x) => x.cssText).join('\n') + '\n'; } catch { /* 외부 시트 무시 */ }
      }
      const title = `${r.account.name} 네이버 검색광고 ${monthLabel(month)} 결과 보고`;
      const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/</g, '&lt;')}</title>
<style>${css}
body { background: #f4f6f9; }
.container.report { max-width: 1180px; margin: 0 auto; padding: 20px 16px 40px; }
.opinion-print { white-space: pre-wrap; line-height: 1.7; }
.html-foot { color: #8a93a3; font-size: .75rem; text-align: center; margin-top: 18px; }
</style></head><body>
${node.outerHTML}
<div class="html-foot">${r.account.company ?? ''} · ${new Date().toLocaleString('ko-KR')} 저장 · 서경방송 마케팅 도구</div>
</body></html>`;
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `검색광고보고서_${r.account.name}_${month}.html`.replace(/[\\/:*?"<>|\s]+/g, '_');
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      if (opDirty) notify(true, 'HTML로 저장했습니다. (담당자 의견은 아직 저장 전 내용이 들어갔습니다)');
    } finally {
      setHtmlBusy(false);
    }
  }

  async function saveNotes(body: Record<string, unknown>, okText: string) {
    try {
      await api('/api/ads/notes', 'PUT', { accountId, month, ...body });
      notify(true, okText);
      if ('opinion' in body) setOpDirty(false);
      if (!('opinion' in body) || Object.keys(body).length > 1) load();
    } catch (e: any) {
      notify(false, e.message);
    }
  }

  const view = useMemo(() => {
    if (!r) return null;
    const idx = r.months.indexOf(month);
    const shown = range === 'all' ? r.months : r.months.slice(Math.max(0, idx - 12), idx + 1);
    const tot = (m: string) => r.totals.find((t) => t.month === m);
    const cs = (type: string, m: string) => r.campaignTypes.series.find((s) => s.type === type && s.month === m);
    const gs = (g: string, m: string) => r.adGroups.series.find((s) => s.ad_group === g && s.month === m);
    const ms = (g: string, md: string, m: string) => r.media.find((s) => s.ad_group === g && s.media === md && s.month === m);
    const mediaGroups = [...new Set(r.media.map((x) => x.ad_group))];
    const mediaNames = (g: string) => [...new Set(r.media.filter((x) => x.ad_group === g).map((x) => x.media))].sort();
    return { shown, tot, cs, gs, ms, mediaGroups, mediaNames };
  }, [r, range, month]);

  if (error) return <div className="container"><div className="msg err">{error}</div><a href="/ads">← 목록으로</a></div>;
  if (!r || !view) return <div className="container"><div className="panel empty">보고서를 만드는 중…</div></div>;

  const { shown, tot, cs, gs, ms, mediaGroups, mediaNames } = view;
  const cur = tot(month);
  const prev = tot(r.prevMonth);
  const hasPrev = Boolean(prev);
  const [yy, mm] = month.split('-');
  const kwList = r.keywords.filter((k) => !kwGroup || k.ad_group === kwGroup);
  const kwShown = kwAll ? kwList : kwList.slice(0, 30);
  const kwGroups = [...new Set(r.keywords.map((k) => k.ad_group))];
  const curTypes = r.campaignTypes.types.filter((t) => cs(t, month) || cs(t, r.prevMonth));
  const stGroups = [...new Set(r.searchTerms.typeSummary.map((s) => s.ad_group))];
  const prevLabel = monthLabel(r.prevMonth);
  const prevHasData = r.months.includes(r.prevMonth);
  // 광고그룹 전월/당월 비교 (두 달 다 없으면 제외)
  const grpCmp = r.adGroups.groups
    .map((g) => ({ g, c: gs(g.ad_group, month), p: gs(g.ad_group, r.prevMonth) }))
    .filter((x) => x.c || x.p);
  const changes: string[] = [];
  if (cur && prev) {
    changes.push(`전체: 노출 ${rate(cur.imp, prev.imp)}, 클릭 ${rate(cur.clk, prev.clk)}, 클릭률 ${p2(ctr(prev))} → ${p2(ctr(cur))}, 평균클릭비용 ${n0(cpc(prev))}원 → ${n0(cpc(cur))}원 (${rate(cpc(cur), cpc(prev))}), 광고비 ${rate(cur.cost, prev.cost)}`);
    for (const t of curTypes) {
      const c = cs(t, month), p = cs(t, r.prevMonth);
      if (c && p) changes.push(`${t}: 클릭 ${diffTxt(c.clk, p.clk)}건, 광고비 ${rate(c.cost, p.cost)}`);
      else if (c) changes.push(`${t}: 당월 신규 운영 (클릭 ${n0(c.clk)}건)`);
      else if (p) changes.push(`${t}: 당월 미운영 (전월 클릭 ${n0(p.clk)}건)`);
    }
    const both = grpCmp.filter((x) => x.c && x.p).map((x) => ({ name: x.g.ad_group, d: x.c!.clk - x.p!.clk, c: x.c!, p: x.p! }));
    const ups = [...both].filter((x) => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 3);
    const downs = [...both].filter((x) => x.d < 0).sort((a, b) => a.d - b.d).slice(0, 3);
    if (ups.length) changes.push(`클릭 증가 광고그룹: ${ups.map((x) => `${x.name} ${diffTxt(x.c.clk, x.p.clk)}`).join(' · ')}`);
    if (downs.length) changes.push(`클릭 감소 광고그룹: ${downs.map((x) => `${x.name} ${diffTxt(x.c.clk, x.p.clk)}`).join(' · ')}`);
    const newG = grpCmp.filter((x) => x.c && !x.p).map((x) => x.g.ad_group);
    const stopG = grpCmp.filter((x) => !x.c && x.p).map((x) => x.g.ad_group);
    if (newG.length) changes.push(`신규 광고그룹: ${newG.join(', ')}`);
    if (stopG.length) changes.push(`당월 미운영 광고그룹 (전월만 실적): ${stopG.join(', ')}`);
    const kwUp = r.keywords.filter((k) => k.clk - k.prevClk > 0).sort((a, b) => b.clk - b.prevClk - (a.clk - a.prevClk)).slice(0, 3);
    if (kwUp.length) changes.push(`클릭 증가 키워드: ${kwUp.map((k) => `${k.keyword} ${diffTxt(k.clk, k.prevClk)}`).join(' · ')}`);
    const kwNew = r.keywords.filter((k) => k.keyword !== '-' && !k.prevImp && !k.prevClk && k.imp > 0).length;
    if (kwNew) changes.push(`전월 노출이 없던 키워드 중 당월 노출된 키워드 ${kwNew}개`);
  }

  return (
    <div className="container report">
      {/* ── 도구 막대 */}
      <div className="toolbar no-print">
        <a href="/ads"><button>← 목록</button></a>
        <select value={month} onChange={(e) => (window.location.href = `/ads/report?account=${accountId}&month=${e.target.value}`)} style={{ width: 'auto' }}>
          {[...r.months].reverse().map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <select value={range} onChange={(e) => setRange(e.target.value as any)} style={{ width: 'auto' }}>
          <option value="13">추이: 최근 13개월</option>
          <option value="all">추이: 전체 기간</option>
        </select>
        <span className="spacer" />
        <button onClick={downloadHtml} disabled={htmlBusy}>HTML 다운로드</button>
        <button className="accent" onClick={() => window.print()}>인쇄 / PDF 저장</button>
      </div>
      {flash && <div className={`msg ${flash.ok ? 'ok' : 'err'} no-print`} style={{ position: 'sticky', top: 68, zIndex: 5 }}>{flash.text}</div>}

      {/* ── 표지 */}
      <header className="rp-head">
        {r.account.logo && <img className="rp-logo" src={r.account.logo} alt={r.account.company ?? ''} />}
        <div className="rp-kicker">{r.account.company ? `${r.account.company} · ` : ''}검색광고 운영 결과 보고</div>
        <h1>{r.account.name} 네이버 검색광고 {Number(yy).toString().slice(2)}년 {Number(mm)}월 결과 보고</h1>
        <div className="hint">
          운영기간 {yy}.{mm}.01 ~ {yy}.{mm}.{lastDay(month)} · 계정 {r.account.customer_id} · 작성 {userName} · {new Date().toLocaleDateString('ko-KR')}
        </div>
        {!r.coverage.account && !r.coverage.campaign && (
          <div className="msg warn no-print">이 달의 계정·캠페인 보고서가 없습니다. 요약 수치가 비어 보일 수 있습니다.</div>
        )}
      </header>

      {/* ── 한눈에 보기 (임원용 시각화) */}
      <ExecDashboard r={r} month={month} shown={shown} />

      {/* ── 1. 요약 */}
      <section className="rp-sec">
        <h2><span className="no">1</span>광고 성과 요약 <span className="hint">{monthLabel(month)} vs 전월 {prevLabel}</span></h2>
        {!hasPrev && (
          <div className="msg warn">
            비교할 전월({prevLabel}) 자료가 DB에 없습니다{prevHasData ? ' (계정·캠페인 합계 없음)' : ''}. 이 보고서는 전월 대비 비교로 작성됩니다 —
            <a href="/data"> 원천자료 관리</a>에서 {prevLabel} 파일을 올리거나 네이버 API로 가져온 뒤 다시 열어 주세요.
          </div>
        )}
        {cur && (
          <div className="kpis">
            {[
              { label: '노출수', v: n0(cur.imp), d: <Delta cur={cur.imp} prev={prev?.imp} kind="rate" /> },
              { label: '클릭수', v: n0(cur.clk), d: <Delta cur={cur.clk} prev={prev?.clk} kind="rate" /> },
              { label: '클릭률', v: p2(ctr(cur)), d: prev ? <Delta cur={ctr(cur)} prev={ctr(prev)} kind="pct" /> : null },
              { label: '평균클릭비용', v: `${n0(cpc(cur))}원`, d: prev ? <Delta cur={cpc(cur)} prev={cpc(prev)} kind="rate" /> : null },
              { label: '광고비 (VAT 포함)', v: `${n0(cur.cost)}원`, d: <Delta cur={cur.cost} prev={prev?.cost} kind="rate" /> },
            ].map((k) => (
              <div key={k.label} className="kpi">
                <div className="kpi-label">{k.label}</div>
                <div className="kpi-v">{k.v}</div>
                <div className="kpi-d">{hasPrev ? <>전월 대비 {k.d}</> : <span className="muted">전월 자료 없음</span>}</div>
              </div>
            ))}
          </div>
        )}
        {changes.length > 0 && (
          <div className="info-box cmp-box">
            <b>전월 대비 주요 변화</b>
            <ul>{changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </div>
        )}
        {curTypes.length > 0 && (
          <div className="table-wrap">
            <table className="rp-table">
              <thead>
                <tr><th>기간</th><th>캠페인</th>{METRIC_HEADS.map((h) => <th key={h} className="num">{h}</th>)}</tr>
              </thead>
              <tbody>
                {[r.prevMonth, month].filter((m) => r.months.includes(m)).map((m) => (
                  <PeriodBlock key={m} label={monthLabel(m, true)} rows={curTypes.map((t) => ({ name: t, m: cs(t, m) }))} total={tot(m)} />
                ))}
                <DeltaRows cur={cur} prev={prev} lead={2} />
              </tbody>
            </table>
          </div>
        )}
        {cur && (cur.tax_invoice != null || cur.coupon) && (
          <p className="hint">세금계산서 {n0(cur.tax_invoice)}원{cur.coupon ? ` · 무상 쿠폰 사용 ${n0(cur.coupon)}원` : ''}</p>
        )}
      </section>

      {/* ── 2. 담당자 의견 */}
      <section className="rp-sec">
        <h2><span className="no">2</span>담당자 의견</h2>
        <div className="no-print">
          <textarea
            className="opinion"
            value={opinion}
            onChange={(e) => { setOpinion(e.target.value); setOpDirty(true); }}
            placeholder="[AI 초안 만들기]를 누르면 이 달의 데이터를 바탕으로 초안을 작성합니다. 직접 쓰셔도 됩니다."
          />
          <div className="btn-row" style={{ marginTop: 8, alignItems: 'center' }}>
            <button onClick={genOpinion} disabled={aiBusy || !cur}>{aiBusy ? <><span className="spinner dark" />작성 중…</> : 'AI 초안 만들기'}</button>
            <button className="primary" onClick={() => saveNotes({ opinion }, '의견을 저장했습니다.')} disabled={!opDirty}>의견 저장</button>
            <button onClick={() => navigator.clipboard.writeText(opinion).then(() => notify(true, '복사했습니다. 전자결재 본문에 붙여 넣으세요.'))} disabled={!opinion}>복사</button>
            {opDirty && <span className="hint" style={{ color: 'var(--warn)' }}>저장되지 않은 변경 사항이 있습니다.</span>}
            {!opDirty && r.notes.updated_at && r.notes.opinion && <span className="hint">저장됨 · {r.notes.opinion_by} {new Date(r.notes.updated_at).toLocaleString('ko-KR')}</span>}
          </div>
          {aiErr && <div className="msg err" style={{ marginTop: 8 }}>AI 초안 실패: {aiErr}</div>}
          <p className="hint">AI 초안은 숫자를 데이터에서만 가져오도록 했지만, 저장 전 반드시 확인하세요.</p>
        </div>
        <div className="print-only opinion-print">{opinion || '(작성된 의견 없음)'}</div>
      </section>

      {/* ── 3. 월별 실적 */}
      <section className="rp-sec">
        <h2><span className="no">3</span>월별 실적 통계 <span className="hint">전체 캠페인 (VAT 포함, 원)</span></h2>
        <TrendChart data={shown.map((m) => tot(m)!).filter(Boolean)} highlight={month} />
        <div className="table-wrap">
          <table className="rp-table">
            <thead>
              <tr><th>기간</th>{METRIC_HEADS.slice(0, 5).map((h) => <th key={h} className="num">{h}</th>)}<th className="num">세금계산서</th><th className="num">쿠폰사용</th><th>비고</th></tr>
            </thead>
            <tbody>
              {shown.map((m) => {
                const t = tot(m)!;
                return (
                  <tr key={m} className={m === month ? 'cur' : ''}>
                    <td>{monthLabel(m)}</td>
                    <MetricCells m={t} rank={false} />
                    <td className="num">{n0(t.tax_invoice)}</td>
                    <td className="num">{t.coupon ? n0(t.coupon) : '-'}</td>
                    <td className="note-cell">{t.note}</td>
                  </tr>
                );
              })}
              <DeltaRows cur={cur} prev={prev} rank={false} trail={3} />
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 4. 캠페인 유형별 */}
      {r.campaignTypes.types.length > 0 && (
        <section className="rp-sec">
          <h2><span className="no">4</span>캠페인 유형별 운영 현황</h2>
          <div className="grid-tables">
            {r.campaignTypes.types.map((t) => (
              <TrendTable key={t} title={t} months={shown} cur={month} get={(m) => cs(t, m)} prevMonth={r.prevMonth} />
            ))}
          </div>
        </section>
      )}

      {/* ── 5. 광고그룹별 */}
      {r.adGroups.groups.length > 0 && (
        <section className="rp-sec">
          <h2><span className="no">5</span>광고그룹별 운영 현황 <span className="hint">전월 대비</span></h2>
          <div className="table-wrap">
            <table className="rp-table cmp">
              <thead>
                <tr>
                  <th rowSpan={2}>캠페인 유형</th><th rowSpan={2}>광고그룹</th>
                  <th colSpan={3} className="grp">노출수</th><th colSpan={3} className="grp">클릭수</th><th colSpan={3} className="grp">광고비</th>
                  <th colSpan={2} className="grp">클릭률</th><th colSpan={2} className="grp">평균노출순위</th>
                  <th rowSpan={2} className="num">하루예산</th><th rowSpan={2}>지역타겟</th>
                </tr>
                <tr>{CMP_SUB(3)}<th className="num sub">전월</th><th className="num sub">당월</th><th className="num sub">전월</th><th className="num sub">당월</th></tr>
              </thead>
              <tbody>
                {grpCmp.map(({ g, c, p }) => {
                  const st = r.adGroups.settings.find((x) => x.ad_group === g.ad_group);
                  return (
                    <tr key={g.ad_group}>
                      <td>{g.type || g.campaign || '-'}</td>
                      <td><b>{g.ad_group}</b>{hasPrev && !p && <span className="tag new">신규</span>}{!c && <span className="tag stop">미운영</span>}</td>
                      <Cmp3 c={c?.imp} p={p?.imp} hasPrev={hasPrev} />
                      <Cmp3 c={c?.clk} p={p?.clk} hasPrev={hasPrev} />
                      <Cmp3 c={c?.cost} p={p?.cost} hasPrev={hasPrev} />
                      <td className="num muted-cell">{p ? p2(ctr(p)) : '-'}</td>
                      <td className="num">{c ? p2(ctr(c)) : '-'}</td>
                      <td className="num muted-cell">{rk(p?.rank)}</td>
                      <td className="num">{rk(c?.rank)}</td>
                      <td className="num">{n0(st?.daily_budget)}</td>
                      <td>{st?.region_target || '-'}</td>
                    </tr>
                  );
                })}
                {(() => {
                  const sc = sumM(grpCmp.map((x) => x.c).filter(Boolean) as M[]);
                  const sp = sumM(grpCmp.map((x) => x.p).filter(Boolean) as M[]);
                  return (
                    <tr className="sum-row">
                      <td colSpan={2}>합계</td>
                      <Cmp3 c={sc.imp} p={sp.imp} hasPrev={hasPrev} />
                      <Cmp3 c={sc.clk} p={sp.clk} hasPrev={hasPrev} />
                      <Cmp3 c={sc.cost} p={sp.cost} hasPrev={hasPrev} />
                      <td className="num">{hasPrev ? p2(ctr(sp)) : '-'}</td><td className="num">{p2(ctr(sc))}</td>
                      <td /><td /><td /><td />
                    </tr>
                  );
                })()}
              </tbody>
            </table>
          </div>
          <div className="grid-tables">
            {r.adGroups.groups.map((g) => (
              <TrendTable key={g.ad_group} title={g.ad_group} sub={g.type} months={shown} cur={month} get={(m) => gs(g.ad_group, m)} prevMonth={r.prevMonth} />
            ))}
          </div>
        </section>
      )}

      {/* ── 6. 매체 */}
      {mediaGroups.length > 0 && (
        <section className="rp-sec">
          <h2><span className="no">6</span>광고그룹별 검색/콘텐츠 매체 현황</h2>
          <div className="table-wrap">
            <table className="rp-table">
              <thead>
                <tr><th>광고그룹</th><th>매체</th>{METRIC_HEADS.map((h) => <th key={h} className="num">{h}</th>)}<th className="num">전월 노출</th><th className="num">노출 증감</th><th className="num">전월 클릭</th><th className="num">클릭 증감</th><th className="num">전월 광고비</th><th className="num">광고비 증감</th></tr>
              </thead>
              <tbody>
                {mediaGroups.map((g) =>
                  mediaNames(g).map((md, i) => {
                    const c = ms(g, md, month);
                    const p = ms(g, md, r.prevMonth);
                    if (!c && !p) return null;
                    return (
                      <tr key={g + md}>
                        {i === 0 && <td rowSpan={mediaNames(g).length}><b>{g}</b></td>}
                        <td>{md}</td>
                        <MetricCells m={c} />
                        <td className="num muted-cell">{hasPrev ? n0(p?.imp ?? 0) : '-'}</td>
                        <td className="num">{hasPrev ? <Delta cur={c?.imp ?? 0} prev={p?.imp ?? 0} /> : '-'}</td>
                        <td className="num muted-cell">{hasPrev ? n0(p?.clk ?? 0) : '-'}</td>
                        <td className="num">{hasPrev ? <Delta cur={c?.clk ?? 0} prev={p?.clk ?? 0} /> : '-'}</td>
                        <td className="num muted-cell">{hasPrev ? n0(p?.cost ?? 0) : '-'}</td>
                        <td className="num">{hasPrev ? <Delta cur={c?.cost ?? 0} prev={p?.cost ?? 0} /> : '-'}</td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
          <div className="info-box">
            <b>검색 매체</b>: 네이버 통합검색·검색탭 등 검색 결과 지면. 구매·상담 등 목적이 뚜렷한 고객이라 전환율과 클릭당 비용이 높습니다.<br />
            <b>콘텐츠 매체</b>: 블로그·카페·지식iN 등 콘텐츠 지면. 브랜드 인지도 확산용으로 클릭률과 클릭당 비용이 낮고, 노출이 일시적으로 크게 늘거나 줄 수 있습니다.
          </div>
          <div className="grid-tables">
            {mediaGroups.flatMap((g) =>
              mediaNames(g).map((md) => (
                <TrendTable key={g + md} title={`${g} · ${md}`} months={shown} cur={month} get={(m) => ms(g, md, m)} prevMonth={r.prevMonth} />
              )),
            )}
          </div>
        </section>
      )}

      {/* ── 7. 키워드 */}
      {r.keywords.length > 0 && (
        <section className="rp-sec">
          <h2><span className="no">7</span>키워드 운영 현황 ({Number(mm)}월, 전월 대비)</h2>
          <div className="btn-row no-print" style={{ marginBottom: 8 }}>
            <select value={kwGroup} onChange={(e) => setKwGroup(e.target.value)} style={{ width: 'auto' }}>
              <option value="">전체 광고그룹</option>
              {kwGroups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <button onClick={() => setKwAll((v) => !v)}>{kwAll ? '상위 30개만' : `전체 ${kwList.length}개 보기`}</button>
          </div>
          <div className="table-wrap">
            <table className="rp-table">
              <thead>
                <tr><th>광고그룹</th><th>키워드</th>{METRIC_HEADS.map((h) => <th key={h} className="num">{h}</th>)}<th className="num">전월 클릭</th><th className="num">클릭 증감</th><th className="num">전월 광고비</th><th className="num">광고비 증감</th></tr>
              </thead>
              <tbody>
                {kwShown.map((k) => (
                  <tr key={k.ad_group + k.keyword}>
                    <td>{k.ad_group}</td>
                    <td><b>{k.keyword}</b></td>
                    <MetricCells m={k} />
                    <td className="num">{n0(k.prevClk)}</td>
                    <td className="num"><Delta cur={k.clk} prev={hasPrev ? k.prevClk : undefined} /></td>
                    <td className="num muted-cell">{hasPrev ? n0(k.prevCost) : '-'}</td>
                    <td className="num"><Delta cur={k.cost} prev={hasPrev ? k.prevCost : undefined} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!kwAll && kwList.length > 30 && <p className="hint">클릭수 순 상위 30개 (전체 {kwList.length}개)</p>}
        </section>
      )}

      {/* ── 8. 키워드 추이 */}
      {r.keywords.length > 0 && (
        <section className="rp-sec">
          <h2><span className="no">8</span>키워드 누적 추이</h2>
          <KeywordPivot accountId={accountId} month={month} months={shown} />
        </section>
      )}

      {/* ── 9. 검색어 */}
      {r.searchTerms.typeSummary.length > 0 && (
        <section className="rp-sec">
          <h2><span className="no">9</span>광고그룹별 검색유형(일치/확장) 검색어</h2>
          <div className="grid-2">
            <div className="table-wrap">
              <table className="rp-table">
                <thead>
                  <tr>
                    <th rowSpan={2}>광고그룹 / 검색유형</th>
                    <th colSpan={2} className="num">노출수</th><th colSpan={2} className="num">클릭수</th>
                    <th rowSpan={2} className="num">노출 차이</th><th rowSpan={2} className="num">클릭 차이</th>
                  </tr>
                  <tr>
                    <th className="num">{r.prevMonth.replace('-', '.')}</th><th className="num">{month.replace('-', '.')}</th>
                    <th className="num">{r.prevMonth.replace('-', '.')}</th><th className="num">{month.replace('-', '.')}</th>
                  </tr>
                </thead>
                <tbody>
                  {stGroups.map((g) => {
                    const rows = r.searchTerms.typeSummary.filter((s) => s.ad_group === g);
                    const s = rows.reduce((a, b) => ({ prevImp: a.prevImp + b.prevImp, curImp: a.curImp + b.curImp, prevClk: a.prevClk + b.prevClk, curClk: a.curClk + b.curClk }), { prevImp: 0, curImp: 0, prevClk: 0, curClk: 0 });
                    return [
                      <tr key={g} className="sum-row">
                        <td>{g}</td>
                        <td className="num">{n0(s.prevImp)}</td><td className="num">{n0(s.curImp)}</td>
                        <td className="num">{n0(s.prevClk)}</td><td className="num">{n0(s.curClk)}</td>
                        <td className="num"><Delta cur={s.curImp} prev={s.prevImp} /></td>
                        <td className="num"><Delta cur={s.curClk} prev={s.prevClk} /></td>
                      </tr>,
                      ...rows.map((x) => (
                        <tr key={g + x.search_type}>
                          <td style={{ paddingLeft: 22 }}>{x.search_type}</td>
                          <td className="num">{n0(x.prevImp)}</td><td className="num">{n0(x.curImp)}</td>
                          <td className="num">{n0(x.prevClk)}</td><td className="num">{n0(x.curClk)}</td>
                          <td className="num"><Delta cur={x.curImp} prev={x.prevImp} /></td>
                          <td className="num"><Delta cur={x.curClk} prev={x.prevClk} /></td>
                        </tr>
                      )),
                    ];
                  })}
                </tbody>
              </table>
            </div>
            {r.searchTerms.risers.length > 0 && (
              <div className="info-box" style={{ margin: 0 }}>
                <b>클릭이 늘어난 검색어</b>
                <ol style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                  {r.searchTerms.risers.map((s) => (
                    <li key={s.ad_group + s.term + s.search_type}>
                      {s.term} <span className="hint">({s.ad_group}·{s.search_type})</span> : {n0(s.prevClk)}건 → {n0(s.curClk)}건 <span className="delta up">(+{n0(s.curClk - s.prevClk)}건)</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
          <h3 style={{ marginTop: 16 }}>당월 주요 검색어 <span className="hint">클릭수 순 상위 {Math.min(30, r.searchTerms.top.length)}개</span></h3>
          <div className="table-wrap">
            <table className="rp-table">
              <thead>
                <tr><th>광고그룹</th><th>검색어</th><th>검색유형</th>{METRIC_HEADS.slice(0, 5).map((h) => <th key={h} className="num">{h}</th>)}<th className="num">전월 클릭</th><th className="num">클릭 증감</th></tr>
              </thead>
              <tbody>
                {r.searchTerms.top.slice(0, 30).map((s) => (
                  <tr key={s.ad_group + s.term + s.search_type}>
                    <td>{s.ad_group}</td><td><b>{s.term}</b></td><td>{s.search_type}</td>
                    <MetricCells m={s} rank={false} />
                    <td className="num muted-cell">{n0(s.prevClk)}</td>
                    <td className="num"><Delta cur={s.clk} prev={hasPrev ? s.prevClk : undefined} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── 월별 입력 (화면 전용) */}
      <section className="rp-sec no-print input-sec">
        <h2>이 달 입력값 <span className="hint">원천 파일에 없는 값 · 보고서에 반영됨</span></h2>
        <div className="grid-3">
          <div><label>세금계산서 금액 (원)</label><input type="text" inputMode="numeric" value={inputs.tax_invoice} onChange={(e) => setInputs({ ...inputs, tax_invoice: e.target.value })} placeholder="세금계산서 공급가 합계" /></div>
          <div><label>무상 쿠폰 사용 (원)</label><input type="text" inputMode="numeric" value={inputs.coupon} onChange={(e) => setInputs({ ...inputs, coupon: e.target.value })} placeholder="없으면 비움" /></div>
          <div><label>비고 (월별 실적표에 표시)</label><input type="text" value={inputs.note} onChange={(e) => setInputs({ ...inputs, note: e.target.value })} placeholder="예: [지역_렌트카] 하루예산 30,000→50,000원 조정" /></div>
        </div>
        {r.adGroups.groups.length > 0 && (
          <>
            <h3 style={{ marginTop: 14 }}>광고그룹 설정 <span className="hint">비워 두면 지난달 값을 그대로 씁니다</span></h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>광고그룹</th><th>하루예산 (원)</th><th>지역타겟</th></tr></thead>
                <tbody>
                  {r.adGroups.groups.map((g) => (
                    <tr key={g.ad_group}>
                      <td>{g.ad_group}</td>
                      <td><input type="text" inputMode="numeric" value={groupSet[g.ad_group]?.daily_budget ?? ''} onChange={(e) => setGroupSet({ ...groupSet, [g.ad_group]: { ...groupSet[g.ad_group], daily_budget: e.target.value } })} /></td>
                      <td><input type="text" value={groupSet[g.ad_group]?.region_target ?? ''} onChange={(e) => setGroupSet({ ...groupSet, [g.ad_group]: { ...groupSet[g.ad_group], region_target: e.target.value } })} placeholder="예: 경남/부산" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <button
          className="primary"
          style={{ marginTop: 12 }}
          onClick={() =>
            saveNotes(
              {
                ...inputs,
                groups: Object.entries(groupSet).map(([ad_group, v]) => ({ ad_group, ...v })),
              },
              '입력값을 저장했습니다.',
            )
          }
        >
          입력값 저장
        </button>
      </section>
    </div>
  );
}

function PeriodBlock({ label, rows, total }: { label: string; rows: { name: string; m: M | undefined }[]; total: M | undefined }) {
  return (
    <>
      {rows.map((x, i) => (
        <tr key={x.name}>
          {i === 0 && <td rowSpan={rows.length} className="period">{label}</td>}
          <td>{x.name}</td>
          <MetricCells m={x.m} />
        </tr>
      ))}
      <tr className="sum-row">
        <td colSpan={2}>소계</td>
        <MetricCells m={total} />
      </tr>
    </>
  );
}

function TrendTable({ title, sub, months, cur, get, prevMonth }: { title: string; sub?: string; months: string[]; cur: string; get: (m: string) => M | undefined; prevMonth: string }) {
  const rows = months.filter((m) => get(m));
  if (!rows.length) return null;
  return (
    <div className="trend-card">
      <h3>{title} {sub && <span className="hint">{sub}</span>}</h3>
      <div className="table-wrap">
        <table className="rp-table compact">
          <thead><tr><th>기간</th>{METRIC_HEADS.map((h) => <th key={h} className="num">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m} className={m === cur ? 'cur' : ''}>
                <td>{m.replace('-', '.')}</td>
                <MetricCells m={get(m)} />
              </tr>
            ))}
            <DeltaRows cur={get(cur)} prev={get(prevMonth)} label="" />
          </tbody>
        </table>
      </div>
    </div>
  );
}
