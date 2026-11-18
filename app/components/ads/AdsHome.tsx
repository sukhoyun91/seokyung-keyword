'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { readAdFile } from '@/lib/ads/readFile';
import { LEVELS, LEVEL_LABEL, type ParsedFile } from '@/lib/ads/parse';
import { monthLabel } from '@/lib/ads/types';
import { api, n0 } from './fmt';

interface Account {
  id: number;
  name: string;
  customer_id: string;
  memo: string;
  active: boolean;
  coverage: { level: string; month: string; rows: number }[];
  lastUpload: { uploaded_at: string; name: string } | null;
}

type Pending = ParsedFile & { targetId: number | null; error?: string; status?: 'wait' | 'saving' | 'done' | 'fail'; progress?: string };

const CHUNK = 5000;

export default function AdsHome({ isAdmin }: { isAdmin: boolean }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selId, setSelId] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [na, setNa] = useState({ name: '', customer_id: '' });
  const [showAdd, setShowAdd] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function load(keep?: number | null) {
    try {
      const j = await api<{ accounts: Account[] }>('/api/ads/accounts');
      setAccounts(j.accounts);
      const want = keep ?? selId;
      if (want && j.accounts.some((a) => a.id === want)) setSelId(want);
      else setSelId(j.accounts[0]?.id ?? null);
      if (!j.accounts.length) setShowAdd(true);
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
  }
  useEffect(() => {
    let saved: number | null = null;
    try { saved = Number(localStorage.getItem('ads_account')) || null; } catch {}
    load(saved);
  }, []);
  useEffect(() => {
    try { if (selId) localStorage.setItem('ads_account', String(selId)); } catch {}
  }, [selId]);

  const sel = accounts.find((a) => a.id === selId) ?? null;
  const byCid = useMemo(() => new Map(accounts.map((a) => [a.customer_id, a])), [accounts]);

  function flash(ok: boolean, text: string) {
    setMsg({ ok, text });
    if (ok) setTimeout(() => setMsg(null), 5000);
  }

  async function addAccount() {
    try {
      const j = await api<{ id: number }>('/api/ads/accounts', 'POST', na);
      setNa({ name: '', customer_id: '' });
      setShowAdd(false);
      flash(true, '광고주를 등록했습니다.');
      await load(j.id);
      // 대기 중인 파일 중 이 계정 번호가 있으면 연결
      setPending((p) => p.map((f) => (f.customerId === na.customer_id ? { ...f, targetId: j.id } : f)));
    } catch (e: any) {
      flash(false, e.message);
    }
  }

  async function pickFiles(list: FileList | null) {
    if (!list?.length) return;
    setReading(true);
    setMsg(null);
    const out: Pending[] = [];
    for (const f of Array.from(list)) {
      try {
        const p = await readAdFile(f);
        const matched = p.customerId ? byCid.get(p.customerId) : undefined;
        out.push({ ...p, targetId: matched?.id ?? (p.customerId ? null : selId), status: 'wait' });
      } catch (e: any) {
        out.push({ fileName: f.name, level: 'account', title: '', customerId: '', period: '', months: [], rows: [], warnings: [], targetId: null, error: e.message, status: 'fail' });
      }
    }
    // 첫 등록 편의: 모르는 계정 번호가 있으면 추가 양식에 미리 채움
    const unknown = out.find((p) => p.customerId && !byCid.get(p.customerId));
    if (unknown) {
      setShowAdd(true);
      setNa((n) => ({ ...n, customer_id: unknown.customerId }));
    }
    setPending((prev) => [...prev.filter((p) => p.status !== 'done'), ...out]);
    setReading(false);
  }

  async function saveAll() {
    setSaving(true);
    let ok = 0;
    const touched = new Set<number>();
    for (let i = 0; i < pending.length; i++) {
      const p = pending[i];
      if (p.status !== 'wait' || !p.targetId || !p.rows.length) continue;
      const set = (patch: Partial<Pending>) => setPending((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : x)));
      set({ status: 'saving' });
      try {
        // 월별로 나누고, 큰 달은 다시 묶음으로 나눠 전송 (첫 묶음에서 그 달 기존 데이터 교체)
        const byMonth = new Map<string, typeof p.rows>();
        for (const r of p.rows) {
          const arr = byMonth.get(r.month);
          if (arr) arr.push(r);
          else byMonth.set(r.month, [r]);
        }
        const parts: { rows: typeof p.rows; replace: string[] }[] = [];
        for (const [m, rows] of byMonth) {
          for (let k = 0; k < rows.length; k += CHUNK) parts.push({ rows: rows.slice(k, k + CHUNK), replace: k === 0 ? [m] : [] });
        }
        for (let k = 0; k < parts.length; k++) {
          set({ progress: `${k + 1}/${parts.length}` });
          await api('/api/ads/upload', 'POST', {
            accountId: p.targetId,
            level: p.level,
            fileName: p.fileName,
            rows: parts[k].rows,
            replaceMonths: parts[k].replace,
            log: k === parts.length - 1 ? { months: p.months, rowCount: p.rows.length } : undefined,
          });
        }
        set({ status: 'done', progress: undefined });
        touched.add(p.targetId);
        ok++;
      } catch (e: any) {
        set({ status: 'fail', error: e.message, progress: undefined });
      }
    }
    setSaving(false);
    if (ok) flash(true, `${ok}개 파일을 저장했습니다.`);
    await load(touched.size === 1 ? [...touched][0] : selId);
  }

  async function deleteMonth(month: string) {
    if (!sel || !confirm(`${sel.name} ${monthLabel(month)} 데이터를 모두 삭제할까요?`)) return;
    try {
      await api(`/api/ads/accounts/${sel.id}?month=${month}`, 'DELETE');
      flash(true, '삭제했습니다.');
      load(sel.id);
    } catch (e: any) {
      flash(false, e.message);
    }
  }

  async function renameAccount() {
    if (!sel) return;
    const name = prompt('광고주 이름', sel.name);
    if (!name) return;
    try {
      await api(`/api/ads/accounts/${sel.id}`, 'PATCH', { name });
      load(sel.id);
    } catch (e: any) {
      flash(false, e.message);
    }
  }

  async function deleteAccount() {
    if (!sel || !confirm(`${sel.name} 광고주와 누적 데이터를 모두 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try {
      await api(`/api/ads/accounts/${sel.id}`, 'DELETE');
      flash(true, '삭제했습니다.');
      load(null);
    } catch (e: any) {
      flash(false, e.message);
    }
  }

  // 월 × 레벨 현황
  const months = useMemo(() => {
    if (!sel) return [];
    return [...new Set(sel.coverage.map((c) => c.month))].sort().reverse();
  }, [sel]);
  const cov = (m: string, l: string) => sel?.coverage.find((c) => c.month === m && c.level === l);
  const waiting = pending.filter((p) => p.status === 'wait');
  const canSave = !saving && waiting.length > 0 && waiting.every((p) => p.targetId);

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h1>검색광고 월간 보고서</h1>
        <span className="hint">네이버 검색광고 → 보고서 → 다차원 보고서에서 받은 파일을 매월 올리면 누적되어 보고서가 만들어집니다.</span>
      </div>
      {msg && <div className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}

      <div className="ads-layout">
        {/* ── 광고주 */}
        <div className="panel">
          <h2>광고주</h2>
          {accounts.length === 0 && <p className="hint">등록된 광고주가 없습니다. 파일을 올리면 계정 번호가 자동으로 채워집니다.</p>}
          <div className="acc-list">
            {accounts.map((a) => (
              <button key={a.id} className={`acc ${a.id === selId ? 'on' : ''}`} onClick={() => setSelId(a.id)}>
                <b>{a.name}</b>
                <span className="hint">계정 {a.customer_id} · {new Set(a.coverage.map((c) => c.month)).size}개월</span>
              </button>
            ))}
          </div>
          {showAdd ? (
            <div style={{ marginTop: 12 }}>
              <label>광고주 이름</label>
              <input type="text" value={na.name} onChange={(e) => setNa({ ...na, name: e.target.value })} placeholder="예: 서경엔카" />
              <label>네이버 계정 번호 <span className="hint">(보고서 파일 첫 줄 끝 숫자)</span></label>
              <input type="text" value={na.customer_id} onChange={(e) => setNa({ ...na, customer_id: e.target.value.replace(/\D/g, '') })} placeholder="예: 1855304" />
              <div className="btn-row" style={{ marginTop: 10 }}>
                <button className="primary" onClick={addAccount} disabled={!na.name || !na.customer_id}>등록</button>
                {accounts.length > 0 && <button onClick={() => setShowAdd(false)}>취소</button>}
              </div>
            </div>
          ) : (
            <button style={{ marginTop: 12 }} onClick={() => setShowAdd(true)}>+ 광고주 추가</button>
          )}
        </div>

        <div>
          {/* ── 업로드 */}
          <div className="panel">
            <h2>원천 파일 올리기</h2>
            <div
              className={`drop ${over ? 'over' : ''}`}
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); pickFiles(e.dataTransfer.files); }}
            >
              {reading ? '파일을 읽는 중…' : <><b>파일 여러 개를 한 번에</b> 끌어 놓거나 클릭해서 선택 (csv, xlsx)</>}
              <div className="hint" style={{ marginTop: 4 }}>
                계정·캠페인·광고그룹·매체·키워드·검색어 보고서. 종류와 광고주는 파일 내용으로 자동 판별합니다. 같은 달을 다시 올리면 그 달 자료만 바뀝니다.
              </div>
            </div>
            <input ref={fileInput} type="file" hidden multiple accept=".csv,.xlsx,.txt" onChange={(e) => { pickFiles(e.target.files); e.target.value = ''; }} />

            {pending.length > 0 && (
              <>
                <div className="table-wrap" style={{ marginTop: 12 }}>
                  <table>
                    <thead>
                      <tr><th>파일</th><th>종류</th><th>월</th><th className="num">행</th><th>저장할 광고주</th><th>상태</th></tr>
                    </thead>
                    <tbody>
                      {pending.map((p, i) => (
                        <tr key={i}>
                          <td style={{ maxWidth: 220, wordBreak: 'break-all' }}>
                            {p.fileName}
                            {p.warnings.map((w) => <div key={w} className="hint" style={{ color: 'var(--warn)' }}>{w}</div>)}
                          </td>
                          <td>{p.error ? '-' : <span className="badge ai">{LEVEL_LABEL[p.level]}</span>}</td>
                          <td>{p.months.length > 2 ? `${p.months[0]} ~ ${p.months.at(-1)} (${p.months.length}개월)` : p.months.join(', ') || '-'}</td>
                          <td className="num">{n0(p.rows.length)}</td>
                          <td>
                            {p.error ? '-' : (
                              <select
                                value={p.targetId ?? ''}
                                disabled={p.status !== 'wait'}
                                onChange={(e) => setPending((all) => all.map((x, j) => (j === i ? { ...x, targetId: Number(e.target.value) || null } : x)))}
                                style={{ padding: '4px 8px' }}
                              >
                                <option value="">선택</option>
                                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.customer_id})</option>)}
                              </select>
                            )}
                            {p.customerId && !byCid.get(p.customerId) && !p.error && (
                              <div className="hint" style={{ color: 'var(--warn)' }}>계정 {p.customerId} 미등록</div>
                            )}
                            {p.customerId && p.targetId && byCid.get(p.customerId) && byCid.get(p.customerId)!.id !== p.targetId && (
                              <div className="hint" style={{ color: 'var(--err)' }}>파일 계정 번호와 다른 광고주입니다</div>
                            )}
                          </td>
                          <td>
                            {p.error && <span className="badge high" title={p.error}>오류</span>}
                            {p.error && <div className="hint" style={{ color: 'var(--err)', maxWidth: 260 }}>{p.error}</div>}
                            {p.status === 'wait' && !p.error && <span className="badge">대기</span>}
                            {p.status === 'saving' && <span className="badge mid">저장 중 {p.progress}</span>}
                            {p.status === 'done' && <span className="badge low">완료</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="btn-row" style={{ marginTop: 12 }}>
                  <button className="primary" onClick={saveAll} disabled={!canSave}>{saving ? '저장 중…' : `${waiting.length}개 파일 저장`}</button>
                  <button onClick={() => setPending([])} disabled={saving}>목록 비우기</button>
                  {waiting.some((p) => !p.targetId) && <span className="hint" style={{ alignSelf: 'center' }}>저장할 광고주를 선택하거나 광고주를 먼저 등록하세요.</span>}
                </div>
              </>
            )}
          </div>

          {/* ── 월별 현황 */}
          {sel && (
            <div className="panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
                <h2>{sel.name} <span className="hint">계정 {sel.customer_id}</span></h2>
                <div className="btn-row">
                  <button onClick={renameAccount}>이름 변경</button>
                  {isAdmin && <button className="danger" onClick={deleteAccount}>광고주 삭제</button>}
                </div>
              </div>
              {sel.lastUpload && (
                <div className="hint" style={{ marginBottom: 8 }}>
                  마지막 업로드 {new Date(sel.lastUpload.uploaded_at).toLocaleString('ko-KR')} {sel.lastUpload.name}
                </div>
              )}
              {months.length === 0 ? (
                <div className="empty" style={{ padding: 30 }}>아직 올린 자료가 없습니다.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>월</th>
                        {LEVELS.map((l) => <th key={l} className="num">{LEVEL_LABEL[l]}</th>)}
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {months.map((m) => (
                        <tr key={m}>
                          <td><b>{monthLabel(m)}</b></td>
                          {LEVELS.map((l) => {
                            const c = cov(m, l);
                            return <td key={l} className="num">{c ? <span title={`${c.rows}행`}>✓ <span className="hint">{n0(c.rows)}</span></span> : <span className="muted">-</span>}</td>;
                          })}
                          <td>
                            <div className="btn-row" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                              <a href={`/ads/report?account=${sel.id}&month=${m}`}><button className="primary">보고서</button></a>
                              {isAdmin && <button className="danger" onClick={() => deleteMonth(m)}>삭제</button>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="hint" style={{ marginTop: 10 }}>
                계정·캠페인 보고서만 있어도 요약과 월별 추이는 나옵니다. 키워드 누적 추이는 키워드 보고서를 '월별'로 받아 과거 기간까지 한 번에 올리면 채워집니다.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
