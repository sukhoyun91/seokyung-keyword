'use client';
import { useEffect, useState } from 'react';
import { api } from '../ads/fmt';
import { BASE_KEYWORDS } from '@/lib/events/types';

interface Row {
  id: number;
  title: string;
  period_start: string;
  period_end: string;
  regions: string;
  keywords: string;
  status: string;
  created_at: string;
  created_by: number;
  created_by_name: string;
  event_count: number;
  source_count: number;
}

const kst = () => new Date(Date.now() + 9 * 3600_000);
const iso = (d: Date) => d.toISOString().slice(0, 10);
function monthRange(offset: number) {
  const t = kst();
  const s = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + offset, 1));
  const e = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + offset + 1, 0));
  return { start: iso(s), end: iso(e), label: `${s.getUTCMonth() + 1}월` };
}

export default function EventsHome({ regions, ready, isAdmin, meId }: { regions: string[]; ready: { tour: boolean; std: boolean; news: boolean; gov: boolean; ai: boolean }; isAdmin: boolean; meId: number }) {
  const next = monthRange(1);
  const [title, setTitle] = useState('');
  const [start, setStart] = useState(next.start);
  const [end, setEnd] = useState(next.end);
  const [sel, setSel] = useState<string[]>(regions);
  const [useBase, setUseBase] = useState(true);
  const [kw, setKw] = useState<string[]>([]);
  const [kwInput, setKwInput] = useState('');
  const [src, setSrc] = useState({ tour: ready.tour, std: ready.std, news: ready.news, gov: ready.gov });
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [rows, setRows] = useState<Row[]>([]);

  async function load() {
    try {
      setRows((await api<{ reports: Row[] }>('/api/events')).reports);
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
  }
  useEffect(() => { load(); }, []);

  function addKw() {
    const parts = kwInput.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
    if (parts.length) setKw((k) => [...new Set([...k, ...parts])].slice(0, 10));
    setKwInput('');
  }

  async function create() {
    setBusy(true);
    setMsg(null);
    try {
      const pending = kwInput.trim() ? [...kw, ...kwInput.split(',').map((x) => x.trim()).filter(Boolean)] : kw;
      const j = await api<{ id: number }>('/api/events', 'POST', { title, start, end, regions: sel, useBase, keywords: pending, ...src, extra });
      window.location.href = `/events/report?id=${j.id}&run=1`;
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
      setBusy(false);
    }
  }

  async function remove(r: Row) {
    if (!confirm(`'${r.title}' 보고서를 삭제할까요?`)) return;
    try {
      await api(`/api/events/${r.id}`, 'DELETE');
      load();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
  }

  const keywordsPreview = [...(useBase ? BASE_KEYWORDS : []), ...kw];
  const queries = sel.length * keywordsPreview.length;
  const anySource = src.tour || src.std || src.news || src.gov;

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h1>지역 축제·행사 정보 수집</h1>
        <span className="hint">관광공사 공식 정보, 지자체 웹사이트, 뉴스를 모아 AI가 정리하고, 근거와 신뢰도를 함께 보여 줍니다.</span>
      </div>
      {msg && <div className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}

      <div className="ads-layout" style={{ gridTemplateColumns: '420px 1fr' }}>
        <div className="panel">
          <h2>수집 조건</h2>
          <label>보고서 제목 <span className="hint">(비우면 자동)</span></label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 12월 서부경남 축제·행사 정보" />

          <label>검색 기간 <span className="hint">행사가 열리는 기간 · 작성일과 별개 · 최대 3개월</span></label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 6, alignItems: 'center' }}>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            <span className="muted">~</span>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <div className="btn-row" style={{ marginTop: 6 }}>
            {[0, 1, 2].map((o) => {
              const m = monthRange(o);
              return <button key={o} className="chip-btn" onClick={() => { setStart(m.start); setEnd(m.end); }}>{o === 0 ? '이번 달' : o === 1 ? '다음 달' : m.label}</button>;
            })}
          </div>

          <label>지역</label>
          <div className="chip-check">
            {regions.map((r) => (
              <label key={r} className={sel.includes(r) ? 'on' : ''}>
                <input type="checkbox" checked={sel.includes(r)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, r] : s.filter((x) => x !== r)))} />
                {r}
              </label>
            ))}
          </div>
          <div className="btn-row" style={{ marginTop: 6 }}>
            <button className="chip-btn" onClick={() => setSel(regions)}>전체</button>
            <button className="chip-btn" onClick={() => setSel(regions.filter((r) => ['진주', '사천'].includes(r)))}>진주·사천</button>
            <button className="chip-btn" onClick={() => setSel([])}>모두 해제</button>
          </div>

          <label>검색어</label>
          <label className="check"><input type="checkbox" checked={useBase} onChange={(e) => setUseBase(e.target.checked)} /> 기본 검색어 ({BASE_KEYWORDS.join(', ')})</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="text" value={kwInput} onChange={(e) => setKwInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKw(); } }} placeholder="추가 검색어 (예: 공연, 전시, 마라톤)" />
            <button onClick={addKw}>추가</button>
          </div>
          {kw.length > 0 && (
            <div className="chips" style={{ marginTop: 6 }}>
              {kw.map((k) => <span key={k} className="chip">{k} <button className="x" onClick={() => setKw((a) => a.filter((x) => x !== k))} aria-label={`${k} 삭제`}>×</button></span>)}
            </div>
          )}

          <label>수집 출처</label>
          {([
            ['tour', '관광공사 공식 축제 정보 (TourAPI)', ready.tour],
            ['std', '전국문화축제 표준데이터 (지자체 등록)', ready.std],
            ['gov', '지자체 웹사이트 (AI 웹 검색)', ready.gov],
            ['news', '네이버 뉴스 기사', ready.news],
          ] as const).map(([k, label, ok]) => (
            <label key={k} className="check">
              <input type="checkbox" checked={src[k]} disabled={!ok} onChange={(e) => setSrc({ ...src, [k]: e.target.checked })} /> {label}
              {!ok && <span className="hint"> · {isAdmin ? <a href="/admin">관리자 설정 필요</a> : '관리자 설정 필요'}</span>}
            </label>
          ))}

          <label>추가 요청 <span className="hint">(선택)</span></label>
          <input type="text" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="예: 가족 단위 행사 위주로, 무료 행사 표시" />

          <p className="hint" style={{ marginTop: 10 }}>
            검색 조합 {queries}개 (지역 {sel.length} × 검색어 {keywordsPreview.length}) · 수집과 정리에 1~2분 걸립니다.
          </p>
          <button className="primary block" onClick={create} disabled={busy || !sel.length || !keywordsPreview.length || !anySource || !ready.ai || !start || !end}>
            {busy ? '준비 중…' : '수집 시작'}
          </button>
          {!ready.ai && <div className="msg warn">Claude API 키가 없어 AI 정리를 할 수 없습니다.</div>}
        </div>

        <div className="panel">
          <h2>보고서 목록</h2>
          {rows.length === 0 ? (
            <div className="empty" style={{ padding: 30 }}>아직 만든 보고서가 없습니다.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>제목</th><th>검색 기간</th><th className="num">행사</th><th className="num">자료</th><th>작성</th><th></th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <a href={`/events/report?id=${r.id}`}><b>{r.title}</b></a>
                        <div className="hint">{r.regions.split(',').join(' · ')} | {r.keywords.split(',').join(', ')}</div>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{r.period_start.slice(2).replace(/-/g, '.')} ~ {r.period_end.slice(2).replace(/-/g, '.')}</td>
                      <td className="num">{r.status === 'done' ? r.event_count : <span className={`badge ${r.status === 'error' ? 'high' : 'mid'}`}>{r.status === 'error' ? '오류' : '수집 중'}</span>}</td>
                      <td className="num">{r.source_count}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {new Date(r.created_at).toLocaleDateString('ko-KR')}
                        <div className="hint">{r.created_by_name}</div>
                      </td>
                      <td>
                        <div className="btn-row" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                          <a href={`/events/report?id=${r.id}`}><button className="primary">보기</button></a>
                          {(isAdmin || r.created_by === meId) && <button className="danger" onClick={() => remove(r)}>삭제</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
