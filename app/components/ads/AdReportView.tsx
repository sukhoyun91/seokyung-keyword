'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ctr, cpc, monthLabel, type AdReport, type M } from '@/lib/ads/types';
import { api, n0, p2, rk, Delta, MetricCells, DeltaRows, METRIC_HEADS } from './fmt';
import TrendChart from './TrendChart';
import KeywordPivot from './KeywordPivot';
import ExecDashboard from './ExecDashboard';
import { Blk, Flow, LayoutProvider, useLayoutState, type LayoutMap } from './Layout';

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

/** HTML 다운로드 전용 스타일: 폭 750px, 본문 10.5pt · 표 10pt */
const EXPORT_CSS = `
html { font-size: 14px; }
body { background: #fff; margin: 0; padding: 0; font-size: 10.5pt; }
.container.report { width: 750px; max-width: 750px; margin: 0 auto; padding: 16px 0 28px; box-sizing: border-box; }
.report .rp-sec, .report .rp-head { padding: 12px 12px; }
.report h1 { font-size: 16pt; } .report h2 { font-size: 13pt; } .report h3 { font-size: 11pt; }
.report .hint, .report .info-box, .report .cmp-box li, .report .chart-legend, .report .ex-legend, .report .ex-note, .report .kpi-label, .report .kpi-d, .report .ex-td, .report .ex-tl { font-size: 10pt; }
.report .rp-table th, .report .rp-table td, .report .rp-table.compact th, .report .rp-table.compact td, .report .rp-table.cmp th, .report .rp-table.cmp td, .report .pivot th, .report .pivot td { font-size: 10pt; padding: 4px 5px; }
.report .rp-table td.num, .report .rp-table th.num { white-space: nowrap; }
.report .rp-table th { word-break: keep-all; }
.report .kpi-v { font-size: 14pt; } .report .ex-tv { font-size: 14pt; } .report .ex-headline { font-size: 11pt; }
.report .opinion-print { white-space: pre-wrap; line-height: 1.7; font-size: 10.5pt; }
.report .note-edit:empty::before { content: ''; }
.report .table-wrap { overflow-x: auto; }
.html-foot { color: #8a93a3; font-size: 9pt; text-align: center; margin: 14px auto 0; width: 750px; }
`;

/** 숨은 틀 안에서 실제 크기를 재서 넘치는 개체를 넓히고, 그래프 글자를 10~11pt(13.3~14.7px)로 맞춤 */
function fitForExport(doc: Document) {
  const STEPS = [25, 33.33, 50, 100];
  const pctOf = (el: HTMLElement) => {
    const p = el.parentElement!.getBoundingClientRect().width || 1;
    return Math.round((el.getBoundingClientRect().width / p) * 100);
  };
  const widen = (el: HTMLElement) => {
    const cur = pctOf(el);
    const next = STEPS.find((s) => s > cur + 2) ?? 100;
    el.style.width = next >= 100 ? '100%' : `calc(${next}% - var(--gap, 12px) * ${(1 - next / 100).toFixed(4)})`;
  };
  // 0) 그래프가 넓은 칸에서 지나치게 커지지 않도록 원래 크기의 1.3배까지만
  doc.querySelectorAll<SVGSVGElement>('svg[viewBox]').forEach((sv) => {
    const vb = Number(sv.getAttribute('viewBox')!.split(/\s+/)[2]) || 0;
    if (vb > 260) { sv.style.maxWidth = `${Math.round(vb * 1.3)}px`; sv.style.display = 'block'; }
  });
  // 1) 좁아서 내용이 넘치는 개체 → 같은 폭의 형제와 함께 한 단계씩 넓힘
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    doc.querySelectorAll<HTMLElement>('.blk-flow').forEach((flow) => {
      // iframe 안 요소는 이 창의 HTMLElement 와 다른 종류라 instanceof 대신 classList 로 판별
      const kids = Array.from(flow.children).filter((x) => x.classList.contains('blk')) as HTMLElement[];
      const narrow = kids.filter((k) => pctOf(k) < 98);
      const over = narrow.filter((k) => k.scrollWidth > k.clientWidth + 2 || Array.from(k.querySelectorAll<HTMLElement>('.table-wrap')).some((t) => t.scrollWidth > t.clientWidth + 2));
      // 그래프가 너무 작게 줄어드는 개체 (글자가 10pt 아래로 내려가는 비율)
      const tiny = narrow.filter((k) => Array.from(k.querySelectorAll('svg[viewBox]')).some((sv) => {
        const vb = Number(sv.getAttribute('viewBox')!.split(/\s+/)[2]) || 1;
        return vb > 260 && sv.getBoundingClientRect().width / vb < 0.75;
      }));
      for (const k of [...new Set([...over, ...tiny])]) {
        const w = pctOf(k);
        kids.filter((x) => Math.abs(pctOf(x) - w) <= 2).forEach(widen);
        changed = true;
      }
    });
    if (!changed) break;
  }
  // 2) 그래프 글자 크기 10~11pt
  doc.querySelectorAll<SVGSVGElement>('svg[viewBox]').forEach((sv) => {
    const vb = Number(sv.getAttribute('viewBox')!.split(/\s+/)[2]) || 0;
    const k = vb ? sv.getBoundingClientRect().width / vb : 0;
    if (!k) return;
    sv.querySelectorAll<SVGTextElement>('text').forEach((t) => {
      const fs = parseFloat(doc.defaultView!.getComputedStyle(t).fontSize) || 12;
      const eff = Math.min(14.7, Math.max(13.3, fs * k));
      t.style.fontSize = `${(eff / k).toFixed(2)}px`;
    });
  });
  // 3) 그래도 넘치는 표: 글자 칸은 줄바꿈 허용 (숫자는 그대로)
  doc.querySelectorAll<HTMLElement>('.table-wrap').forEach((w) => {
    if (w.scrollWidth <= w.clientWidth + 2) return;
    w.querySelectorAll<HTMLElement>('td:not(.num), th:not(.num)').forEach((c) => { c.style.whiteSpace = 'normal'; c.style.wordBreak = 'keep-all'; });
    // 긴 머리글은 두 줄로 (예: 평균클릭비용 → 평균 / 클릭비용)
    if (w.scrollWidth > w.clientWidth + 2)
      w.querySelectorAll<HTMLElement>('th').forEach((c) => {
        const t = (c.textContent ?? '').trim();
        if (/^평균.{4,}$/.test(t)) c.innerHTML = `평균<br>${t.slice(2)}`;
        else if (/^(하루예산|지역타겟|세금계산서|쿠폰사용)$/.test(t)) c.innerHTML = `${t.slice(0, 2)}<br>${t.slice(2)}`;
        c.style.whiteSpace = 'normal';
      });
    if (w.scrollWidth > w.clientWidth + 2) w.querySelectorAll<HTMLElement>('td, th').forEach((c) => { c.style.paddingLeft = '3px'; c.style.paddingRight = '3px'; });
  });
}

function lastDay(month: string) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export default function AdReportView({ accountId, month, userName }: { accountId: number; month: string; userName: string }) {
  const [r, setR] = useState<AdReport | null>(null);
  const [error, setError] = useState('');
  const [span, setSpan] = useState<{ from: number; to: number } | null>(null); // null = 최근 13개월
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
  const { layout, setLayout, set: setBlk, setMany: setBlks } = useLayoutState({});
  const [edit, setEdit] = useState(false);
  const [saved, setSaved] = useState<LayoutMap>({});
  const [rowNotes, setRowNotes] = useState<Record<string, string>>({});
  const [labelTick, setLabelTick] = useState(0);
  const labelsRef = useRef(new Map<string, string>());

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
    api<{ layout: LayoutMap }>(`/api/ads/layout?account=${accountId}`).then((j) => setLayout(j.layout ?? {})).catch(() => {});
    api<{ notes: { scope: string; row_key: string; month: string; note: string }[] }>(`/api/ads/rownotes?account=${accountId}`)
      .then((j) => setRowNotes(Object.fromEntries(j.notes.map((n) => [`${n.scope}|${n.row_key}|${n.month}`, n.note]))))
      .catch(() => {});
  }, [accountId]);
  useEffect(() => { if (edit) setLabelTick((x) => x + 1); }, [edit]);

  const noteOf = (scope: string, key: string, m: string) => rowNotes[`${scope}|${key}|${m}`] ?? '';
  async function saveRowNote(scope: 'ctype' | 'group', key: string, m: string, note: string) {
    if ((rowNotes[`${scope}|${key}|${m}`] ?? '') === note.trim()) return;
    try {
      await api('/api/ads/rownotes', 'PUT', { accountId, scope, key, month: m, note });
      setRowNotes((x) => ({ ...x, [`${scope}|${key}|${m}`]: note.trim() }));
      notify(true, '비고를 저장했습니다.');
    } catch (e: any) {
      notify(false, e.message);
    }
  }
  async function saveLayout() {
    try {
      await api('/api/ads/layout', 'PUT', { accountId, layout: Object.keys(layout).length ? layout : null });
      setEdit(false);
      notify(true, '배치를 저장했습니다. 이 광고주의 모든 달 보고서·인쇄·HTML에 적용됩니다.');
    } catch (e: any) {
      notify(false, e.message);
    }
  }
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

  /**
   * 지금 화면의 보고서를 한 파일짜리 HTML로 저장 (스타일 포함, 편집 도구 제외)
   * - 폭 750px 고정, 본문·표 글자 10~11pt
   * - 숨은 틀(iframe)에 실제로 그려 보고: 좁아서 넘치는 개체는 넓히고, 그래프 글자는 10~11pt로 맞춤
   */
  async function downloadHtml() {
    const src = document.querySelector('.container.report');
    if (!src || !r) return;
    setHtmlBusy(true);
    const frame = document.createElement('iframe');
    try {
      const node = src.cloneNode(true) as HTMLElement;
      node.classList.remove('editing');
      node.querySelectorAll('.no-print, .ex-tip, .blk-bar, .blk-rw, .blk-rh, script').forEach((el) => el.remove());
      node.querySelectorAll('.print-only').forEach((el) => el.classList.remove('print-only'));
      node.querySelectorAll('[style*="position: sticky"]').forEach((el) => el.remove());
      node.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'));
      let css = '';
      for (const sh of Array.from(document.styleSheets)) {
        try { css += Array.from(sh.cssRules).map((x) => x.cssText).join('\n') + '\n'; } catch { /* 외부 시트 무시 */ }
      }
      const title = `${r.account.name} 네이버 검색광고 ${monthLabel(month)} 결과 보고`;
      const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/</g, '&lt;')}</title>
<style>${css}
${EXPORT_CSS}
</style></head><body>
${node.outerHTML}
<div class="html-foot">${r.account.company ?? ''} · ${new Date().toLocaleString('ko-KR')} 저장 · 서경방송 마케팅 도구</div>
</body></html>`;
      frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:820px;height:1200px;border:0;visibility:hidden';
      frame.srcdoc = html;
      document.body.appendChild(frame);
      // 보고서가 실제로 그려질 때까지 기다림 (빈 문서 load 이벤트에 속지 않도록)
      let doc: Document | null = null;
      for (let i = 0; i < 100 && !doc; i++) {
        await new Promise((ok) => setTimeout(ok, 50));
        const d = frame.contentDocument;
        if (d && d.readyState === 'complete' && d.querySelector('.container.report')) doc = d;
      }
      if (!doc) throw new Error('보고서를 그리지 못했습니다.');
      await new Promise((ok) => setTimeout(ok, 50));
      fitForExport(doc);
      const out = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
      const blob = new Blob([out], { type: 'text/html;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `검색광고보고서_${r.account.name}_${month}.html`.replace(/[\\/:*?"<>|\s]+/g, '_');
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      if (opDirty) notify(true, 'HTML로 저장했습니다. (담당자 의견은 아직 저장 전 내용이 들어갔습니다)');
    } catch (e: any) {
      notify(false, `HTML 저장 실패: ${e?.message ?? e}`);
    } finally {
      frame.remove();
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
    const curIdx = Math.max(0, r.months.indexOf(month));
    const from = span ? Math.min(span.from, curIdx) : Math.max(0, curIdx - 12);
    const to = span ? Math.min(span.to, curIdx) : curIdx;
    const shown = r.months.slice(from, to + 1);
    const tot = (m: string) => r.totals.find((t) => t.month === m);
    const cs = (type: string, m: string) => r.campaignTypes.series.find((s) => s.type === type && s.month === m);
    const gs = (g: string, m: string) => r.adGroups.series.find((s) => s.ad_group === g && s.month === m);
    const ms = (g: string, md: string, m: string) => r.media.find((s) => s.ad_group === g && s.media === md && s.month === m);
    const mediaGroups = [...new Set(r.media.map((x) => x.ad_group))];
    const mediaNames = (g: string) => [...new Set(r.media.filter((x) => x.ad_group === g).map((x) => x.media))].sort();
    return { curIdx, from, to, shown, tot, cs, gs, ms, mediaGroups, mediaNames };
  }, [r, span, month]);

  if (error) return <div className="container"><div className="msg err">{error}</div><a href="/ads">← 목록으로</a></div>;
  if (!r || !view) return <div className="container"><div className="panel empty">보고서를 만드는 중…</div></div>;

  const { curIdx, from, to, shown, tot, cs, gs, ms, mediaGroups, mediaNames } = view;
  const spanText = shown.length ? `${monthLabel(shown[0])} ~ ${monthLabel(shown[shown.length - 1])} (${shown.length}개월)` : '';
  void labelTick;
  const hiddenIds = Object.keys(layout).filter((id) => layout[id]?.hidden);
  const labelOf = (id: string) => labelsRef.current.get(id) ?? id;
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
  const grpCur = r.adGroups.groups.map((g) => ({ g, c: gs(g.ad_group, month)! })).filter((x) => x.c);
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
    <LayoutProvider value={{ edit, layout, set: setBlk, setMany: setBlks, labels: labelsRef.current }}>
    <div className={`container report ${edit ? 'editing' : ''}`}>
      {/* ── 도구 막대 */}
      <div className="toolbar no-print">
        <a href="/ads"><button>← 목록</button></a>
        <select value={month} onChange={(e) => (window.location.href = `/ads/report?account=${accountId}&month=${e.target.value}`)} style={{ width: 'auto' }}>
          {[...r.months].reverse().map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <RangeSlider months={r.months.slice(0, curIdx + 1)} from={from} to={to} onChange={(a, b) => setSpan({ from: a, to: b })} onReset={() => setSpan(null)} />
        <span className="spacer" />
        {!edit ? (
          <button onClick={() => { setSaved(layout); setEdit(true); }}>레이아웃 편집</button>
        ) : (
          <>
            <span className="hint">⠿ 끌어서 옮기기 · 오른쪽/아래 끝을 끌어 크기 · ✕ 삭제</span>
            <button onClick={() => { if (confirm('이 광고주 보고서의 배치를 기본값으로 되돌릴까요?')) setLayout({}); }}>기본 배치</button>
            <button onClick={() => { setLayout(saved); setEdit(false); }}>취소</button>
            <button className="primary" onClick={saveLayout}>배치 저장</button>
          </>
        )}
        <button onClick={downloadHtml} disabled={htmlBusy || edit}>HTML 다운로드</button>
        <button className="accent" onClick={() => window.print()} disabled={edit}>인쇄 / PDF 저장</button>
      </div>
      {flash && <div className={`msg ${flash.ok ? 'ok' : 'err'} no-print`} style={{ position: 'sticky', top: 68, zIndex: 5 }}>{flash.text}</div>}
      {edit && hiddenIds.length > 0 && (
        <div className="msg warn no-print blk-hidden-list">
          숨긴 개체 {hiddenIds.length}개:{' '}
          {hiddenIds.map((id) => <button key={id} onClick={() => setBlk(id, { hidden: false })}>{labelOf(id)} 되살리기</button>)}
        </div>
      )}

      <Flow className="rp-root" gap={16}>
      {/* ── 표지 */}
      <Blk id="cover" label="표지">
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
      </Blk>

      {/* ── 한눈에 보기 (임원용 시각화) */}
      <Blk id="exec" label="한눈에 보기">
        <ExecDashboard r={r} month={month} shown={shown} />
      </Blk>

      {/* ── 1. 요약 */}
      <Blk id="sec1" label="1. 광고 성과 요약">
      <section className="rp-sec">
        <h2><span className="no">1</span>광고 성과 요약 <span className="hint">{monthLabel(month)} vs 전월 {prevLabel}</span></h2>
        {!hasPrev && (
          <div className="msg warn">
            비교할 전월({prevLabel}) 자료가 DB에 없습니다{prevHasData ? ' (계정·캠페인 합계 없음)' : ''}. 이 보고서는 전월 대비 비교로 작성됩니다 —
            <a href="/data"> 원천자료 관리</a>에서 {prevLabel} 파일을 올리거나 네이버 API로 가져온 뒤 다시 열어 주세요.
          </div>
        )}
        <Flow>
        {cur && (
          <Blk id="sec1.kpis" label="요약 지표">
            <Flow gap={10}>
            {[
              { label: '노출수', v: n0(cur.imp), d: <Delta cur={cur.imp} prev={prev?.imp} kind="rate" /> },
              { label: '클릭수', v: n0(cur.clk), d: <Delta cur={cur.clk} prev={prev?.clk} kind="rate" /> },
              { label: '클릭률', v: p2(ctr(cur)), d: prev ? <Delta cur={ctr(cur)} prev={ctr(prev)} kind="pct" /> : null },
              { label: '평균클릭비용', v: `${n0(cpc(cur))}원`, d: prev ? <Delta cur={cpc(cur)} prev={cpc(prev)} kind="rate" /> : null },
              { label: '광고비 (VAT 포함)', v: `${n0(cur.cost)}원`, d: <Delta cur={cur.cost} prev={prev?.cost} kind="rate" /> },
            ].map((k) => (
              <Blk key={k.label} id={`sec1.kpi.${k.label}`} label={k.label} w={20}>
              <div className="kpi">
                <div className="kpi-label">{k.label}</div>
                <div className="kpi-v">{k.v}</div>
                <div className="kpi-d">{hasPrev ? <>전월 대비 {k.d}</> : <span className="muted">전월 자료 없음</span>}</div>
              </div>
              </Blk>
            ))}
            </Flow>
          </Blk>
        )}
        {changes.length > 0 && (
          <Blk id="sec1.changes" label="전월 대비 주요 변화">
          <div className="info-box cmp-box">
            <b>전월 대비 주요 변화</b>
            <ul>{changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </div>
          </Blk>
        )}
        <Blk id="sec1.table" label="캠페인 합계 표">
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
        </Blk>
        <Blk id="sec1.tax" label="세금계산서·쿠폰">
          {cur && (cur.tax_invoice != null || cur.coupon) && (
            <p className="hint">세금계산서 {n0(cur.tax_invoice)}원{cur.coupon ? ` · 무상 쿠폰 사용 ${n0(cur.coupon)}원` : ''}</p>
          )}
        </Blk>
        </Flow>
      </section>
      </Blk>

      {/* ── 2. 담당자 의견 */}
      <Blk id="sec2" label="2. 담당자 의견">
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
      </Blk>

      {/* ── 3. 월별 실적 */}
      <Blk id="sec3" label="3. 월별 실적 통계">
      <section className="rp-sec">
        <h2><span className="no">3</span>월별 실적 통계 <span className="hint">전체 캠페인 (VAT 포함, 원) · {spanText}</span></h2>
        <Flow>
        <Blk id="sec3.chart" label="월별 추이 그래프">
          <TrendChart data={shown.map((m) => tot(m)!).filter(Boolean)} highlight={month} />
        </Blk>
        <Blk id="sec3.table" label="월별 실적 표">
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
        </Blk>
        </Flow>
      </section>
      </Blk>

      {/* ── 4. 캠페인 유형별 */}
      {r.campaignTypes.types.length > 0 && (
        <Blk id="sec4" label="4. 캠페인 유형별 운영 현황">
        <section className="rp-sec">
          <h2><span className="no">4</span>캠페인 유형별 운영 현황 <span className="hint">{spanText}</span></h2>
          <Flow className="flow-tables">
            {r.campaignTypes.types.map((t) => (
              <Blk key={t} id={`sec4.t.${t}`} label={`유형 ${t}`} w={50}>
                <TrendTable title={t} months={shown} cur={month} get={(m) => cs(t, m)} prevMonth={r.prevMonth}
                  note={(m) => noteOf('ctype', t, m)} onNote={(m, v) => saveRowNote('ctype', t, m, v)} />
              </Blk>
            ))}
          </Flow>
        </section>
        </Blk>
      )}

      {/* ── 5. 광고그룹별 */}
      {r.adGroups.groups.length > 0 && (
        <Blk id="sec5" label="5. 광고그룹별 운영 현황">
        <section className="rp-sec">
          <h2><span className="no">5</span>광고그룹별 운영 현황 <span className="hint">{monthLabel(month)}</span></h2>
          <Flow>
          <Blk id="sec5.table" label="광고그룹 당월 표">
          <div className="table-wrap">
            <table className="rp-table grp-tbl">
              <thead>
                <tr><th>캠페인 유형</th><th>광고그룹</th>{METRIC_HEADS.map((h) => <th key={h} className="num">{h}</th>)}<th className="num">하루예산</th><th>지역타겟</th><th className="note-h">비고</th></tr>
              </thead>
              <tbody>
                {grpCur.map(({ g, c }) => {
                  const st = r.adGroups.settings.find((x) => x.ad_group === g.ad_group);
                  return (
                    <tr key={g.ad_group}>
                      <td>{g.type || g.campaign || '-'}</td>
                      <td><b>{g.ad_group}</b></td>
                      <MetricCells m={c} />
                      <td className="num">{n0(st?.daily_budget)}</td>
                      <td>{st?.region_target || '-'}</td>
                      <td className="note-cell"><NoteCell value={noteOf('group', g.ad_group, month)} onSave={(v) => saveRowNote('group', g.ad_group, month, v)} /></td>
                    </tr>
                  );
                })}
                <tr className="sum-row">
                  <td colSpan={2}>합계</td>
                  <MetricCells m={sumM(grpCur.map((x) => x.c))} />
                  <td /><td /><td />
                </tr>
              </tbody>
            </table>
          </div>
          </Blk>
            {r.adGroups.groups.map((g) => (
              <Blk key={g.ad_group} id={`sec5.g.${g.ad_group}`} label={`그룹 ${g.ad_group}`} w={50}>
                <TrendTable title={g.ad_group} sub={g.type} months={shown} cur={month} get={(m) => gs(g.ad_group, m)} prevMonth={r.prevMonth} />
              </Blk>
            ))}
          </Flow>
        </section>
        </Blk>
      )}

      {/* ── 6. 매체 */}
      {mediaGroups.length > 0 && (
        <Blk id="sec6" label="6. 검색/콘텐츠 매체 현황">
        <section className="rp-sec">
          <h2><span className="no">6</span>광고그룹별 검색/콘텐츠 매체 현황</h2>
          <Flow>
          <Blk id="sec6.table" label="매체 표">
            <div className="table-wrap">
              <table className="rp-table media-tbl">
                <thead>
                  <tr><th>광고그룹</th><th>매체</th>{METRIC_HEADS.map((h) => <th key={h} className="num">{h}</th>)}<th className="num">전월 노출</th><th className="num">노출 증감</th><th className="num">전월 클릭</th><th className="num">클릭 증감</th><th className="num">전월 광고비</th><th className="num">광고비 증감</th></tr>
                </thead>
                <tbody>
                  {mediaGroups.map((g) => {
                    // 당월·전월 모두 자료가 없는 매체는 빼고, 남은 줄 수만큼 광고그룹 칸을 합침 (칸 밀림 방지)
                    const rows = mediaNames(g).filter((md) => ms(g, md, month) || ms(g, md, r.prevMonth));
                    return rows.map((md, i) => {
                      const c = ms(g, md, month);
                      const p = ms(g, md, r.prevMonth);
                      return (
                        <tr key={g + md} className={i === 0 ? 'grp-first' : ''}>
                          {i === 0 && <td rowSpan={rows.length} className="grp-name"><b>{g}</b></td>}
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
                    });
                  })}
                </tbody>
              </table>
            </div>
          </Blk>
          <Blk id="sec6.info" label="매체 설명">
            <div className="info-box">
              <b>검색 매체</b>: 네이버 통합검색·검색탭 등 검색 결과 지면. 구매·상담 등 목적이 뚜렷한 고객이라 전환율과 클릭당 비용이 높습니다.<br />
              <b>콘텐츠 매체</b>: 블로그·카페·지식iN 등 콘텐츠 지면. 브랜드 인지도 확산용으로 클릭률과 클릭당 비용이 낮고, 노출이 일시적으로 크게 늘거나 줄 수 있습니다.
            </div>
          </Blk>
            {mediaGroups.flatMap((g) =>
              mediaNames(g).map((md) => (
                <Blk key={g + md} id={`sec6.m.${g}.${md}`} label={`${g} · ${md}`} w={50}>
                  <TrendTable title={`${g} · ${md}`} months={shown} cur={month} get={(m) => ms(g, md, m)} prevMonth={r.prevMonth} />
                </Blk>
              )),
            )}
          </Flow>
        </section>
        </Blk>
      )}

      {/* ── 7. 키워드 */}
      {r.keywords.length > 0 && (
        <Blk id="sec7" label="7. 키워드 운영 현황">
        <section className="rp-sec">
          <h2><span className="no">7</span>키워드 운영 현황 ({Number(mm)}월, 전월 대비)</h2>
          <div className="btn-row no-print" style={{ marginBottom: 8 }}>
            <select value={kwGroup} onChange={(e) => setKwGroup(e.target.value)} style={{ width: 'auto' }}>
              <option value="">전체 광고그룹</option>
              {kwGroups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <button onClick={() => setKwAll((v) => !v)}>{kwAll ? '상위 30개만' : `전체 ${kwList.length}개 보기`}</button>
          </div>
          <Blk id="sec7.table" label="키워드 표">
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
          </Blk>
        </section>
        </Blk>
      )}

      {/* ── 8. 키워드 추이 */}
      {r.keywords.length > 0 && (
        <Blk id="sec8" label="8. 키워드 누적 추이">
        <section className="rp-sec">
          <h2><span className="no">8</span>키워드 누적 추이</h2>
          <KeywordPivot accountId={accountId} month={month} months={shown} />
        </section>
        </Blk>
      )}

      {/* ── 9. 검색어 */}
      {r.searchTerms.typeSummary.length > 0 && (
        <Blk id="sec9" label="9. 검색유형별 검색어">
        <section className="rp-sec">
          <h2><span className="no">9</span>광고그룹별 검색유형(일치/확장) 검색어</h2>
          <Flow>
          <Blk id="sec9.types" label="검색유형 요약 표" w={58}>
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
          </Blk>
          {r.searchTerms.risers.length > 0 && (
          <Blk id="sec9.risers" label="클릭이 늘어난 검색어" w={42}>
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
          </Blk>
          )}
          <Blk id="sec9.top" label="당월 주요 검색어 표">
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
          </Blk>
          </Flow>
        </section>
        </Blk>
      )}
      </Flow>

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
    </LayoutProvider>
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

function TrendTable({ title, sub, months, cur, get, prevMonth, note, onNote }: { title: string; sub?: string; months: string[]; cur: string; get: (m: string) => M | undefined; prevMonth: string; note?: (m: string) => string; onNote?: (m: string, v: string) => void }) {
  const rows = months.filter((m) => get(m));
  if (!rows.length) return null;
  return (
    <div className="trend-card">
      <h3>{title} {sub && <span className="hint">{sub}</span>}</h3>
      <div className="table-wrap">
        <table className="rp-table compact">
          <thead><tr><th>기간</th>{METRIC_HEADS.map((h) => <th key={h} className="num">{h}</th>)}{note && <th className="note-h">비고</th>}</tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m} className={m === cur ? 'cur' : ''}>
                <td>{m.replace('-', '.')}</td>
                <MetricCells m={get(m)} />
                {note && <td className="note-cell"><NoteCell value={note(m)} onSave={(v) => onNote?.(m, v)} /></td>}
              </tr>
            ))}
            <DeltaRows cur={get(cur)} prev={get(prevMonth)} label="" trail={note ? 1 : 0} />
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 표 안 비고 칸: 화면에서 바로 입력, 칸을 벗어나면 저장. 인쇄·HTML에는 글자만 */
function NoteCell({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // 입력 중인 칸은 건드리지 않고, 저장된 값이 바뀌면 글자만 맞춤 (React 자식으로 넣으면 입력 글자가 겹침)
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current && ref.current.textContent !== value) ref.current.textContent = value;
  }, [value]);
  return (
    <div
      ref={ref}
      className="note-edit"
      contentEditable
      suppressContentEditableWarning
      data-ph="입력"
      onBlur={(e) => onSave((e.currentTarget.textContent ?? '').trim())}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLElement).blur(); } }}
    />
  );
}

/** 추이 기간: 두 손잡이 스크롤 (기본 최근 13개월) */
function RangeSlider({ months, from, to, onChange, onReset }: { months: string[]; from: number; to: number; onChange: (a: number, b: number) => void; onReset: () => void }) {
  const max = Math.max(0, months.length - 1);
  if (max < 1) return null;
  const pct = (i: number) => (i / max) * 100;
  return (
    <div className="range-box" title="추이 표·그래프에 보여 줄 기간">
      <span className="hint">추이</span>
      <b>{monthLabel(months[from])}</b>
      <div className="range2">
        <div className="range2-track" />
        <div className="range2-fill" style={{ left: `${pct(from)}%`, width: `${pct(to) - pct(from)}%` }} />
        <input type="range" min={0} max={max} value={from} aria-label="시작 달" onChange={(e) => onChange(Math.min(Number(e.target.value), to), to)} />
        <input type="range" min={0} max={max} value={to} aria-label="끝 달" onChange={(e) => onChange(from, Math.max(Number(e.target.value), from))} />
      </div>
      <b>{monthLabel(months[to])}</b>
      <span className="hint">{to - from + 1}개월</span>
      <button className="link-btn" onClick={onReset}>최근 13개월</button>
      <button className="link-btn" onClick={() => onChange(0, max)}>전체</button>
    </div>
  );
}
