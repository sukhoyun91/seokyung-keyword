'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../ads/fmt';
import { KIND_LABEL, STEP_LABEL, TRUST_LABEL, type EvReport, type EvSource, type StepKey, type Trust } from '@/lib/events/types';

const STEPS: StepKey[] = ['tour', 'gov', 'news', 'summarize'];
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const TRUST_CLS: Record<Trust, string> = { official: 'low', cross: 'ai', check: 'mid' };

function md(d: string) {
  if (!d) return '';
  const t = new Date(`${d}T00:00:00Z`);
  return `${t.getUTCMonth() + 1}.${t.getUTCDate()}(${DOW[t.getUTCDay()]})`;
}
function period(s: string, e: string, text: string) {
  if (!s) return text || '날짜 미확인';
  if (!e || e === s) return md(s);
  return `${md(s)} ~ ${md(e)}`;
}

export default function EventReportView({ id, autoRun }: { id: number; autoRun: boolean }) {
  const [r, setR] = useState<EvReport | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState<StepKey | null>(null);
  const [memo, setMemo] = useState('');
  const [memoDirty, setMemoDirty] = useState(false);
  const [fRegion, setFRegion] = useState('');
  const [fTrust, setFTrust] = useState<'' | Trust>('');
  const [showAllSrc, setShowAllSrc] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const started = useRef(false);

  async function load() {
    try {
      const j = await api<EvReport>(`/api/events/${id}`);
      setR(j);
      if (!memoDirty) setMemo(j.memo);
      return j;
    } catch (e: any) {
      setError(e.message);
      return null;
    }
  }

  function notify(ok: boolean, text: string) {
    setFlash({ ok, text });
    setTimeout(() => setFlash(null), 5000);
  }

  /** 대기 중인 단계를 순서대로 실행 (하나 실패해도 다음 출처는 계속, 정리는 수집이 하나라도 되면 실행) */
  async function runPending(rep: EvReport, only?: StepKey) {
    const todo = only ? [only] : STEPS.filter((k) => ['pending', 'running'].includes(rep.steps[k]?.status ?? 'pending'));
    for (const k of todo) {
      setRunning(k);
      try {
        await api(`/api/events/${id}/step`, 'POST', { step: k });
      } catch (e: any) {
        notify(false, `${STEP_LABEL[k]}: ${e.message}`);
      }
      await load();
    }
    setRunning(null);
  }

  useEffect(() => {
    load().then((j) => {
      if (!j || started.current) return;
      const pending = STEPS.some((k) => (j.steps[k]?.status ?? 'pending') === 'pending');
      if (autoRun && pending) {
        started.current = true;
        runPending(j);
      }
    });
  }, [id]);

  const srcMap = useMemo(() => new Map((r?.sources ?? []).map((s) => [s.id, s])), [r]);
  if (error) return <div className="container"><div className="msg err">{error}</div><a href="/events">← 목록으로</a></div>;
  if (!r) return <div className="container"><div className="panel empty">불러오는 중…</div></div>;

  const res = r.result;
  const events = (res?.events ?? []).map((e, i) => ({ ...e, idx: i }));
  const shown = events.filter((e) => (!fRegion || e.region === fRegion) && (!fTrust || e.trust === fTrust));
  const regionsInResult = [...new Set(events.map((e) => e.region).filter(Boolean))];
  const usedIds = new Set([...events.flatMap((e) => e.sourceIds), ...(res?.related ?? []).map((x) => x.sourceId), ...(res?.conflicts ?? []).flatMap((c) => c.sourceIds)]);
  const srcList = showAllSrc ? r.sources : r.sources.filter((s) => usedIds.has(s.id));
  const count = (t: Trust) => events.filter((e) => e.trust === t).length;
  const byKind = (k: EvSource['kind']) => r.sources.filter((s) => s.kind === k).length;
  const stepsActive = STEPS.some((k) => ['pending', 'running'].includes(r.steps[k]?.status ?? ''));

  async function saveMemo() {
    try {
      await api(`/api/events/${id}`, 'PUT', { memo });
      setMemoDirty(false);
      notify(true, '메모를 저장했습니다.');
    } catch (e: any) {
      notify(false, e.message);
    }
  }
  async function removeEvent(idx: number) {
    if (!confirm('이 행사를 보고서에서 뺄까요? (검증 메모의 제외 목록으로 옮겨집니다)')) return;
    try {
      await api(`/api/events/${id}`, 'PUT', { removeEvent: idx });
      load();
    } catch (e: any) {
      notify(false, e.message);
    }
  }
  async function rename() {
    const t = prompt('보고서 제목', r!.title);
    if (!t) return;
    await api(`/api/events/${id}`, 'PUT', { title: t });
    load();
  }
  function copyText() {
    const lines = [
      `■ ${r!.title}`,
      `검색 기간 ${r!.period_start} ~ ${r!.period_end} / 지역 ${r!.regions.join(', ')}`,
      '',
      res?.overview ?? '',
      '',
      ...shown.map((e) => `- ${period(e.start, e.end, e.dateText)} [${e.region}] ${e.name}${e.venue ? ` / ${e.venue}` : ''} (${TRUST_LABEL[e.trust]})${e.summary ? `\n  ${e.summary}` : ''}\n  근거: ${e.sourceIds.map((sid) => srcMap.get(sid)?.url).filter(Boolean).join(' , ')}`),
    ];
    navigator.clipboard.writeText(lines.join('\n')).then(() => notify(true, '복사했습니다.'));
  }

  const SrcRef = ({ sid }: { sid: string }) => {
    const s = srcMap.get(sid);
    if (!s) return null;
    return (
      <a className={`src-ref k-${s.kind}`} href={s.url} target="_blank" rel="noreferrer" title={`${KIND_LABEL[s.kind]} · ${s.title}`}>
        {sid}
      </a>
    );
  };

  return (
    <div className="container report ev-report">
      <div className="toolbar no-print">
        <a href="/events"><button>← 목록</button></a>
        <button onClick={rename}>제목 변경</button>
        <span className="spacer" />
        {res && <button onClick={copyText}>텍스트 복사</button>}
        {res && !running && <button onClick={() => { if (confirm('수집한 자료로 AI 정리를 다시 할까요? (담당자가 뺀 항목도 다시 나올 수 있습니다)')) runPending(r, 'summarize'); }}>AI 다시 정리</button>}
        <button className="accent" onClick={() => window.print()} disabled={!res}>인쇄 / PDF 저장</button>
      </div>
      {flash && <div className={`msg ${flash.ok ? 'ok' : 'err'} no-print`} style={{ position: 'sticky', top: 8, zIndex: 5 }}>{flash.text}</div>}

      <header className="rp-head">
        <div className="rp-kicker">지역 축제·행사 정보 수집 보고</div>
        <h1>{r.title}</h1>
        <div className="ev-meta">
          <span><b>검색 기간</b> {r.period_start} ~ {r.period_end}</span>
          <span><b>작성일</b> {new Date(r.created_at).toLocaleDateString('ko-KR')} ({r.created_by_name})</span>
          <span><b>지역</b> {r.regions.join(', ')}</span>
          <span><b>검색어</b> {r.keywords.join(', ')}</span>
          <span><b>수집 자료</b> 관광공사 {byKind('tour')} · 지자체 {byKind('gov')} · 뉴스 {byKind('news')}</span>
        </div>
        <details className="collect-log no-print">
          <summary>수집 내역 보기</summary>
          <ul>
            {STEPS.map((k) => {
              const st = r.steps[k];
              if (!st) return null;
              return (
                <li key={k}>
                  <b>{STEP_LABEL[k]}</b>: {st.status === 'done' ? `${st.count ?? 0}건` : st.status === 'skipped' ? '사용 안 함' : st.status === 'error' ? '오류' : '대기'}
                  {st.message ? ` — ${st.message}` : ''}
                </li>
              );
            })}
          </ul>
        </details>
      </header>

      {/* ── 수집 진행 */}
      {(stepsActive || running || STEPS.some((k) => r.steps[k]?.status === 'error') || !res) && (
        <section className="rp-sec no-print">
          <h2>수집 진행</h2>
          <div className="steps">
            {STEPS.map((k) => {
              const st = r.steps[k] ?? { status: 'pending' };
              const isRun = running === k;
              return (
                <div key={k} className={`step s-${isRun ? 'running' : st.status}`}>
                  <div className="step-dot">{st.status === 'done' ? '✓' : st.status === 'error' ? '!' : st.status === 'skipped' ? '–' : isRun ? <span className="spinner dark" /> : '·'}</div>
                  <div>
                    <b>{STEP_LABEL[k]}</b>
                    <div className="hint">
                      {isRun ? '진행 중…' : st.status === 'done' ? `${st.count ?? 0}건${st.message ? ` · ${st.message}` : ''}` : st.status === 'skipped' ? '사용 안 함' : st.status === 'error' ? st.message : '대기'}
                    </div>
                  </div>
                  {!running && (st.status === 'error' || (st.status === 'pending' && !stepsActive)) && <button onClick={() => runPending(r, k)}>다시 시도</button>}
                </div>
              );
            })}
          </div>
          {!running && stepsActive && <button className="primary" style={{ marginTop: 10 }} onClick={() => runPending(r)}>남은 단계 진행</button>}
        </section>
      )}

      {res && (
        <>
          <section className="rp-sec">
            <h2><span className="no">1</span>요약</h2>
            <div className="kpis">
              <div className="kpi"><div className="kpi-label">수집된 행사</div><div className="kpi-v">{events.length}건</div><div className="kpi-d">제외 {res.excluded.length}건</div></div>
              <div className="kpi"><div className="kpi-label">공식 확인</div><div className="kpi-v" style={{ color: 'var(--ok)' }}>{count('official')}</div><div className="kpi-d">관광공사·지자체 근거</div></div>
              <div className="kpi"><div className="kpi-label">복수 출처</div><div className="kpi-v" style={{ color: 'var(--brand)' }}>{count('cross')}</div><div className="kpi-d">서로 다른 언론 2곳 이상</div></div>
              <div className="kpi"><div className="kpi-label">확인 필요</div><div className="kpi-v" style={{ color: 'var(--warn)' }}>{count('check')}</div><div className="kpi-d">출처 1곳·날짜 미확인</div></div>
              <div className="kpi"><div className="kpi-label">출처 간 차이</div><div className="kpi-v">{res.conflicts.length}</div><div className="kpi-d">아래 검증 메모 참고</div></div>
            </div>
            <p className="overview">{res.overview}</p>
          </section>

          <section className="rp-sec">
            <h2><span className="no">2</span>축제·행사 목록 <span className="hint">기간순 · 근거 번호를 누르면 원문이 열립니다</span></h2>
            <div className="btn-row no-print" style={{ marginBottom: 8 }}>
              <select value={fRegion} onChange={(e) => setFRegion(e.target.value)} style={{ width: 'auto' }}>
                <option value="">전체 지역</option>
                {regionsInResult.map((x) => <option key={x}>{x}</option>)}
              </select>
              <select value={fTrust} onChange={(e) => setFTrust(e.target.value as any)} style={{ width: 'auto' }}>
                <option value="">전체 신뢰도</option>
                {(['official', 'cross', 'check'] as Trust[]).map((t) => <option key={t} value={t}>{TRUST_LABEL[t]}</option>)}
              </select>
              <span className="hint" style={{ alignSelf: 'center' }}>{shown.length}건 표시</span>
            </div>
            {shown.length === 0 ? (
              <div className="empty" style={{ padding: 30 }}>조건에 맞는 행사가 없습니다.</div>
            ) : (
              <div className="table-wrap">
                <table className="rp-table ev-table">
                  <thead>
                    <tr><th style={{ width: 120 }}>기간</th><th>행사</th><th style={{ width: 150 }}>지역·장소</th><th>내용</th><th style={{ width: 120 }}>근거·신뢰도</th><th className="no-print" /></tr>
                  </thead>
                  <tbody>
                    {shown.map((e) => (
                      <tr key={e.idx}>
                        <td>
                          <b>{period(e.start, e.end, e.dateText)}</b>
                          {e.dateText && e.start && <div className="hint">원문: {e.dateText}</div>}
                        </td>
                        <td><b>{e.name}</b><div><span className="badge">{e.category}</span></div>{e.organizer && <div className="hint">주최 {e.organizer}</div>}</td>
                        <td>{e.region}<div className="hint">{e.venue}</div></td>
                        <td>
                          {e.summary}
                          {e.notes.length > 0 && <ul className="ev-notes">{e.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
                        </td>
                        <td>
                          <div className="src-refs">{e.sourceIds.map((sid) => <SrcRef key={sid} sid={sid} />)}</div>
                          <span className={`badge ${TRUST_CLS[e.trust]}`}>{TRUST_LABEL[e.trust]}</span>
                        </td>
                        <td className="no-print"><button className="danger x-btn" title="보고서에서 빼기" onClick={() => removeEvent(e.idx)}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="hint">
              <b>공식 확인</b> 관광공사 공식 정보 또는 지자체 사이트 원문에서 날짜 확인 · <b>복수 출처</b> 서로 다른 언론 2곳 이상, 원문에서 날짜 확인 · <b>확인 필요</b> 출처 1곳뿐이거나 원문에서 날짜를 직접 확인하지 못함
            </p>
          </section>

          {(res.conflicts.length > 0 || res.excluded.length > 0) && (
            <section className="rp-sec">
              <h2><span className="no">3</span>검증 메모</h2>
              {res.conflicts.length > 0 && (
                <>
                  <h3>출처 간 차이</h3>
                  <ul className="ev-list">
                    {res.conflicts.map((c, i) => <li key={i}><b>{c.event}</b> — {c.detail} {c.sourceIds.map((sid) => <SrcRef key={sid} sid={sid} />)}</li>)}
                  </ul>
                </>
              )}
              {res.excluded.length > 0 && (
                <>
                  <h3 style={{ marginTop: 10 }}>보고서에서 뺀 항목</h3>
                  <ul className="ev-list">
                    {res.excluded.map((x, i) => <li key={i}>{x.name} — <span className="muted">{x.reason}</span> {x.sourceIds.map((sid) => <SrcRef key={sid} sid={sid} />)}</li>)}
                  </ul>
                </>
              )}
            </section>
          )}

          {res.related.length > 0 && (
            <section className="rp-sec">
              <h2><span className="no">4</span>참고 기사</h2>
              <ul className="ev-list">
                {res.related.map((x) => {
                  const s = srcMap.get(x.sourceId);
                  if (!s) return null;
                  return (
                    <li key={x.sourceId}>
                      <a href={s.url} target="_blank" rel="noreferrer"><b>{s.title}</b></a> <span className="hint">{s.publisher} {s.date}</span>
                      <div className="hint">{x.why}</div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section className="rp-sec">
            <h2><span className="no">5</span>담당자 메모</h2>
            <div className="no-print">
              <textarea value={memo} onChange={(e) => { setMemo(e.target.value); setMemoDirty(true); }} placeholder="보고서에 덧붙일 의견, 홍보 활용 계획 등을 적으세요." style={{ minHeight: 120 }} />
              <div className="btn-row" style={{ marginTop: 8 }}>
                <button className="primary" onClick={saveMemo} disabled={!memoDirty}>메모 저장</button>
              </div>
            </div>
            <div className="print-only opinion-print">{memo || '(메모 없음)'}</div>
          </section>

          <section className="rp-sec">
            <h2>
              <span className="no">6</span>출처 목록
              <button className="no-print" style={{ marginLeft: 'auto' }} onClick={() => setShowAllSrc((v) => !v)}>{showAllSrc ? '근거로 쓴 출처만' : `수집한 자료 전체 ${r.sources.length}건 보기`}</button>
            </h2>
            <ol className="src-list">
              {srcList.map((s) => (
                <li key={s.id} id={`src-${s.id}`}>
                  <span className={`src-ref k-${s.kind}`}>{s.id}</span>
                  <span className="badge">{KIND_LABEL[s.kind]}</span>{' '}
                  <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>{' '}
                  <span className="hint">{s.publisher}{s.date ? ` · ${s.date}` : ''}</span>
                  <div className="src-snip">{s.snippet}</div>
                  <div className="print-only hint" style={{ wordBreak: 'break-all' }}>{s.url}</div>
                </li>
              ))}
            </ol>
            <p className="hint">AI가 정리한 내용은 출처 원문과 다를 수 있습니다. 홍보물에 쓰기 전에 원문(특히 공식 확인이 아닌 항목)을 꼭 확인하세요.</p>
          </section>
        </>
      )}
    </div>
  );
}
