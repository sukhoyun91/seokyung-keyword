'use client';
import { useRef, useState } from 'react';
import { readAdFile } from '@/lib/ads/readFile';
import { LEVELS, LEVEL_LABEL, type ParsedFile } from '@/lib/ads/parse';
import { monthLabel } from '@/lib/ads/types';
import { api, n0 } from '../ads/fmt';
import type { Directory } from '../ads/directory';

type Pending = ParsedFile & {
  targetId: number | null;
  error?: string;
  status?: 'wait' | 'saving' | 'done' | 'fail';
  progress?: string;
  /** 보고서 엑셀 전체 업로드: 세금계산서·비고·그룹 설정 (첫 항목에만) */
  extra?: import('@/lib/xlsx/importWorkbook').WorkbookNotes;
};

const CHUNK = 5000;

export default function UploadTab({ dir, isAdmin, onMsg, onUnknownCid }: { dir: Directory; isAdmin: boolean; onMsg: (ok: boolean, t: string) => void; onUnknownCid: (cid: string) => void }) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const sel = dir.account;

  async function pickFiles(list: FileList | null) {
    if (!list?.length) return;
    setReading(true);
    const out: Pending[] = [];
    for (const f of Array.from(list)) {
      try {
        // 서경엔카형 누적 보고서 엑셀이면 시트별로 나눠 읽기 (과거 자료 한 번에 올리기)
        if (/\.xlsx$/i.test(f.name)) {
          const { readReportWorkbook } = await import('@/lib/xlsx/importWorkbook');
          const wbk = await readReportWorkbook(await f.arrayBuffer(), f.name);
          if (wbk) {
            wbk.files.forEach((p, k) => {
              if (k === 0) {
                p.warnings.push(`누적 보고서 엑셀: ${wbk.lastMonth}까지. 엑셀에는 계정 번호가 없어 선택한 계정으로 저장합니다. 들어 있는 달은 기존 자료를 덮어씁니다.`);
                if (wbk.notes.months.length) p.warnings.push(`세금계산서·비고 ${wbk.notes.months.length}개월, 하루예산·지역타겟도 함께 저장합니다.`);
              }
              out.push({ ...p, targetId: dir.accountId, status: 'wait', extra: k === 0 ? wbk.notes : undefined });
            });
            continue;
          }
        }
        const p = await readAdFile(f);
        const matched = p.customerId ? dir.byCid.get(p.customerId) : undefined;
        out.push({ ...p, targetId: matched?.id ?? (p.customerId ? null : dir.accountId), status: 'wait' });
      } catch (e: any) {
        out.push({ fileName: f.name, level: 'account', title: '', customerId: '', period: '', months: [], rows: [], warnings: [], targetId: null, error: e.message, status: 'fail' });
      }
    }
    const unknown = out.find((p) => p.customerId && !dir.byCid.get(p.customerId));
    if (unknown) onUnknownCid(unknown.customerId);
    setPending((prev) => [...prev.filter((p) => p.status !== 'done'), ...out]);
    setReading(false);
  }

  // 계정이 새로 등록되면 대기 중 파일의 계정 번호로 자동 연결
  const resolved = pending.map((p) => (p.status === 'wait' && !p.targetId && p.customerId && dir.byCid.get(p.customerId) ? { ...p, targetId: dir.byCid.get(p.customerId)!.id } : p));

  async function saveAll() {
    setSaving(true);
    setPending(resolved);
    let ok = 0;
    let last: number | null = null;
    for (let i = 0; i < resolved.length; i++) {
      const p = resolved[i];
      if (p.status !== 'wait' || !p.targetId || !p.rows.length) continue;
      const set = (patch: Partial<Pending>) => setPending((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : x)));
      set({ status: 'saving' });
      try {
        const byMonth = new Map<string, typeof p.rows>();
        for (const r of p.rows) {
          const arr = byMonth.get(r.month);
          if (arr) arr.push(r);
          else byMonth.set(r.month, [r]);
        }
        const parts: { rows: typeof p.rows; replace: string[] }[] = [];
        for (const [m, rows] of byMonth) for (let k = 0; k < rows.length; k += CHUNK) parts.push({ rows: rows.slice(k, k + CHUNK), replace: k === 0 ? [m] : [] });
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
        if (p.extra) {
          set({ progress: '세금계산서·비고' });
          await api('/api/ads/notes', 'POST', { accountId: p.targetId, months: p.extra.months, groups: p.extra.groups });
        }
        set({ status: 'done', progress: undefined });
        last = p.targetId;
        ok++;
      } catch (e: any) {
        set({ status: 'fail', error: e.message, progress: undefined });
      }
    }
    setSaving(false);
    if (ok) onMsg(true, `${ok}개 파일을 DB에 저장했습니다.`);
    await dir.reload({ accountId: last ?? dir.accountId });
  }

  async function deleteMonth(month: string) {
    if (!sel || !confirm(`${sel.name} ${monthLabel(month)} 자료를 모두 삭제할까요?`)) return;
    try {
      await api(`/api/ads/accounts/${sel.id}?month=${month}`, 'DELETE');
      onMsg(true, '삭제했습니다.');
      dir.reload({ accountId: sel.id });
    } catch (e: any) {
      onMsg(false, e.message);
    }
  }

  const months = sel ? [...new Set(sel.coverage.map((c) => c.month))].sort().reverse() : [];
  const cov = (m: string, l: string) => sel?.coverage.find((c) => c.month === m && c.level === l);
  const waiting = resolved.filter((p) => p.status === 'wait');
  const canSave = !saving && waiting.length > 0 && waiting.every((p) => p.targetId);
  const accName = (id: number | null) => {
    const a = dir.accounts.find((x) => x.id === id);
    return a ? `${dir.companyOf(a)?.name ?? ''} › ${a.name}` : '';
  };

  return (
    <>
      <div className="panel">
        <h2>원천 파일 올리기 → DB 저장</h2>
        <div
          className={`drop ${over ? 'over' : ''}`}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); pickFiles(e.dataTransfer.files); }}
        >
          {reading ? '파일을 읽는 중…' : <><b>파일 여러 개를 한 번에</b> 끌어 놓거나 클릭해서 선택 (csv, xlsx)</>}
          <div className="hint" style={{ marginTop: 4 }}>
            <b>이번 달 자료</b>: 네이버 다차원 보고서 6종(계정·캠페인·광고그룹·매체·키워드·검색어). 어느 계정인지는 파일 첫 줄의 계정 번호로 자동 판별합니다.
            <br /><b>이전 자료</b>: '월별'로 여러 달을 받은 CSV, 또는 누적 보고서 엑셀(서경엔카 양식)을 올리면 과거 달까지 한 번에 들어갑니다.
            <br />같은 달·같은 종류를 다시 올리면 그 달 자료만 새것으로 바뀝니다.
          </div>
        </div>
        <input ref={fileInput} type="file" hidden multiple accept=".csv,.xlsx,.txt" onChange={(e) => { pickFiles(e.target.files); e.target.value = ''; }} />

        {resolved.length > 0 && (
          <>
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr><th>파일</th><th>종류</th><th>월</th><th className="num">행</th><th>저장할 계정</th><th>상태</th></tr>
                </thead>
                <tbody>
                  {resolved.map((p, i) => (
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
                            onChange={(e) => setPending(resolved.map((x, j) => (j === i ? { ...x, targetId: Number(e.target.value) || null } : x)))}
                            style={{ padding: '4px 8px', maxWidth: 240 }}
                          >
                            <option value="">선택</option>
                            {dir.companies.map((co) => (
                              <optgroup key={co.id} label={co.name}>
                                {dir.accounts.filter((a) => a.company_id === co.id).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.customer_id})</option>)}
                              </optgroup>
                            ))}
                            {dir.orphans.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.customer_id})</option>)}
                          </select>
                        )}
                        {p.customerId && !dir.byCid.get(p.customerId) && !p.error && (
                          <div className="hint" style={{ color: 'var(--warn)' }}>계정 {p.customerId} 미등록 → 왼쪽에서 관계사를 고르고 계정을 추가하세요</div>
                        )}
                        {p.customerId && p.targetId && dir.byCid.get(p.customerId) && dir.byCid.get(p.customerId)!.id !== p.targetId && (
                          <div className="hint" style={{ color: 'var(--err)' }}>파일 계정 번호와 다른 계정입니다</div>
                        )}
                        {p.status !== 'wait' && p.targetId && <div className="hint">{accName(p.targetId)}</div>}
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
              <button className="primary" onClick={saveAll} disabled={!canSave}>{saving ? '저장 중…' : `${waiting.length}개 파일 DB에 저장`}</button>
              <button onClick={() => setPending([])} disabled={saving}>목록 비우기</button>
              {waiting.some((p) => !p.targetId) && <span className="hint" style={{ alignSelf: 'center' }}>저장할 계정을 선택하거나 계정을 먼저 등록하세요.</span>}
            </div>
          </>
        )}
      </div>

      {sel && (
        <div className="panel">
          <h2>DB 저장 현황 <span className="hint">{dir.company?.name} › {sel.name} ({sel.customer_id})</span></h2>
          {sel.lastUpload && <div className="hint" style={{ marginBottom: 8 }}>마지막 업로드 {new Date(sel.lastUpload.uploaded_at).toLocaleString('ko-KR')} {sel.lastUpload.name}</div>}
          {months.length === 0 ? (
            <div className="empty" style={{ padding: 30 }}>아직 저장된 자료가 없습니다.</div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 520 }}>
              <table>
                <thead>
                  <tr><th>월</th>{LEVELS.map((l) => <th key={l} className="num">{LEVEL_LABEL[l]}</th>)}<th></th></tr>
                </thead>
                <tbody>
                  {months.map((m) => (
                    <tr key={m}>
                      <td><b>{monthLabel(m)}</b></td>
                      {LEVELS.map((l) => {
                        const c = cov(m, l);
                        return <td key={l} className="num">{c ? <>✓ <span className="hint">{n0(c.rows)}</span></> : <span className="muted">-</span>}</td>;
                      })}
                      <td>
                        <div className="btn-row" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                          <a href={`/ads/report?account=${sel.id}&month=${m}`}><button>보고서</button></a>
                          {isAdmin && <button className="danger" onClick={() => deleteMonth(m)}>삭제</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
