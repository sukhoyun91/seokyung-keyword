'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CSV_KIND_LABEL, decodeCsv, readRawCsv, type CsvKind, type RawCsv } from '@/lib/xlsx/naverCsv';
import type { BuildResult, TemplateInfo } from '@/lib/xlsx/monthly';
import { parseCsv, parseTable } from '@/lib/ads/parse';
import { monthLabel } from '@/lib/ads/types';
import { api, n0 } from '../ads/fmt';

const KINDS: CsvKind[] = ['account', 'campaign', 'adgroup', 'media', 'keyword', 'searchterm'];
const REQUIRED: CsvKind[] = ['campaign', 'adgroup', 'media', 'keyword', 'searchterm'];

type CsvItem = { file: string; text: string; csv?: RawCsv; error?: string };
interface Account { id: number; name: string; customer_id: string }

function download(data: Uint8Array, name: string) {
  const blob = new Blob([data as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export default function BuilderHome({ embedded = false }: { embedded?: boolean }) {
  const [tpl, setTpl] = useState<{ name: string; data: ArrayBuffer; info: TemplateInfo } | null>(null);
  const [tplErr, setTplErr] = useState('');
  const [csvs, setCsvs] = useState<CsvItem[]>([]);
  const [tax, setTax] = useState('');
  const [note1, setNote1] = useState('');
  const [groups, setGroups] = useState<Record<string, { budget: string; region: string }>>({});
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [result, setResult] = useState<BuildResult | null>(null);
  const [over, setOver] = useState<'' | 'tpl' | 'csv'>('');
  const tplInput = useRef<HTMLInputElement>(null);
  const csvInput = useRef<HTMLInputElement>(null);

  // 검색광고 보고서 저장
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accId, setAccId] = useState<number | null>(null);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    api<{ accounts: Account[] }>('/api/ads/accounts').then((j) => setAccounts(j.accounts)).catch(() => {});
  }, []);

  async function pickTemplate(list: FileList | null) {
    const f = list?.[0];
    if (!f) return;
    setTplErr('');
    setResult(null);
    setBusy('엑셀을 읽는 중…');
    try {
      if (!/\.xlsx$/i.test(f.name)) throw new Error('지난달 보고서 엑셀(.xlsx)을 올려 주세요.');
      const data = await f.arrayBuffer();
      const { inspectTemplate } = await import('@/lib/xlsx/monthly');
      const info = await inspectTemplate(data);
      setTpl({ name: f.name, data, info });
      setGroups(Object.fromEntries(info.groups.map((g) => [g.name, { budget: g.budget == null ? '' : String(g.budget), region: g.region }])));
      setRemark(info.remark8);
      setNote1('');
      setTax('');
    } catch (e: any) {
      setTpl(null);
      setTplErr(e.message);
    }
    setBusy('');
  }

  async function pickCsv(list: FileList | null) {
    if (!list?.length) return;
    setResult(null);
    const items: CsvItem[] = [];
    for (const f of Array.from(list)) {
      const text = decodeCsv(await f.arrayBuffer());
      try {
        items.push({ file: f.name, text, csv: readRawCsv(text, f.name) });
      } catch (e: any) {
        items.push({ file: f.name, text, error: e.message });
      }
    }
    // 같은 종류는 새 파일로 교체
    setCsvs((prev) => {
      const next = [...prev];
      for (const it of items) {
        const i = it.csv ? next.findIndex((x) => x.csv?.kind === it.csv!.kind) : -1;
        if (i >= 0) next[i] = it;
        else next.push(it);
      }
      return next;
    });
  }

  const byKind = useMemo(() => new Map(csvs.filter((c) => c.csv).map((c) => [c.csv!.kind, c])), [csvs]);
  const csvMonth = useMemo(() => [...new Set(csvs.filter((c) => c.csv).map((c) => c.csv!.month))], [csvs]);
  const customerId = csvs.find((c) => c.csv?.customerId)?.csv?.customerId ?? '';
  useEffect(() => {
    const a = accounts.find((x) => x.customer_id === customerId);
    if (a) setAccId(a.id);
  }, [accounts, customerId]);

  const problems: string[] = [];
  if (!tpl) problems.push('지난달 엑셀을 올려 주세요.');
  const miss = REQUIRED.filter((k) => !byKind.has(k));
  if (miss.length) problems.push(`빠진 CSV: ${miss.map((k) => CSV_KIND_LABEL[k]).join(', ')}`);
  if (csvMonth.length > 1) problems.push(`CSV 기간이 서로 다릅니다: ${csvMonth.join(', ')}`);
  if (tpl && csvMonth.length === 1 && csvMonth[0] !== tpl.info.nextMonth)
    problems.push(`엑셀은 ${monthLabel(tpl.info.month)}까지, CSV는 ${monthLabel(csvMonth[0])}입니다. ${monthLabel(tpl.info.nextMonth)} CSV가 필요합니다.`);
  if (csvs.some((c) => c.error)) problems.push('읽지 못한 파일이 있습니다. 목록에서 지워 주세요.');

  const taxNum = tax.trim() === '' ? null : Number(tax.replace(/[,\s원]/g, ''));

  async function build() {
    if (!tpl) return;
    setErr('');
    setResult(null);
    setSaveMsg(null);
    setBusy('엑셀을 만드는 중… (10초 정도 걸릴 수 있습니다)');
    try {
      const { buildMonthly } = await import('@/lib/xlsx/monthly');
      const r = await buildMonthly(tpl.data, csvs.filter((c) => c.csv).map((c) => c.csv!), {
        taxInvoice: taxNum != null && Number.isFinite(taxNum) ? taxNum : null,
        note1,
        groups: Object.fromEntries(
          Object.entries(groups).map(([k, v]) => [k, { budget: v.budget.trim() === '' ? null : Number(v.budget.replace(/[,\s원]/g, '')) || null, region: v.region.trim() }]),
        ),
        remark8: remark === tpl.info.remark8 ? null : remark,
      });
      setResult(r);
      download(r.data, r.fileName);
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy('');
  }

  /** 이번 달 CSV를 검색광고 보고서 DB에도 저장 */
  async function saveToReport() {
    if (!accId || !result) return;
    setSaveMsg(null);
    setBusy('검색광고 보고서에 저장하는 중…');
    try {
      let rows = 0;
      for (const k of KINDS) {
        const it = byKind.get(k);
        if (!it) continue;
        const p = parseTable(parseCsv(it.text), it.file);
        for (let i = 0; i < p.rows.length; i += 5000) {
          await api('/api/ads/upload', 'POST', {
            accountId: accId,
            level: p.level,
            fileName: it.file,
            rows: p.rows.slice(i, i + 5000),
            replaceMonths: i === 0 ? p.months : [],
            log: i + 5000 >= p.rows.length ? { months: p.months, rowCount: p.rows.length } : undefined,
          });
        }
        rows += p.rows.length;
      }
      // 세금계산서·쿠폰·비고·그룹 설정
      const camp = byKind.get('campaign')!.csv!;
      const ci = camp.headers.findIndex((h) => h.replace(/\s/g, '') === '총비용');
      const cost = camp.rows.reduce((s, r) => s + (Number(r[ci]) || 0), 0);
      const body: any = {
        accountId: accId,
        month: result.month,
        groups: Object.entries(groups).map(([g, v]) => ({ ad_group: g, daily_budget: v.budget, region_target: v.region })),
      };
      if (taxNum != null && Number.isFinite(taxNum)) {
        body.tax_invoice = taxNum;
        body.coupon = Math.round(cost - taxNum);
      }
      if (note1.trim()) body.note = note1.trim();
      await api('/api/ads/notes', 'PUT', body);
      setSaveMsg({ ok: true, text: `${monthLabel(result.month)} 자료 ${n0(rows)}행을 저장했습니다.` });
    } catch (e: any) {
      setSaveMsg({ ok: false, text: e.message });
    }
    setBusy('');
  }

  const ready = problems.length === 0 && !busy;

  return (
    <div className={embedded ? '' : 'container'}>
      {embedded ? (
        <p className="hint" style={{ margin: '0 0 10px' }}>
          결재 첨부용 <b>서경엔카 양식 엑셀</b>이 필요할 때: 지난달 양식 엑셀 + 이번 달 네이버 CSV → 이번 달 양식 엑셀. (차트·피벗 유지, 파일은 브라우저 안에서만 처리)
        </p>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <h1>결재 양식 엑셀 갱신</h1>
          <span className="hint">지난달 보고서 엑셀 + 이번 달 네이버 CSV → 이번 달 보고서 엑셀. 파일은 이 컴퓨터 브라우저 안에서만 처리됩니다.</span>
        </div>
      )}

      <div className="grid2 builder">
        <div className="input-col">
          {/* 1. 지난달 엑셀 */}
          <div className="panel">
            <h2>1. 지난달 보고서 엑셀</h2>
            <div
              className={`drop ${over === 'tpl' ? 'over' : ''}`}
              onClick={() => tplInput.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setOver('tpl'); }}
              onDragLeave={() => setOver('')}
              onDrop={(e) => { e.preventDefault(); setOver(''); pickTemplate(e.dataTransfer.files); }}
            >
              {tpl ? <><b>{tpl.name}</b><div className="hint">다른 파일로 바꾸려면 클릭</div></> : <>예: <b>서경엔카 검색광고 보고서(2026년 10월).xlsx</b><div className="hint">끌어 놓거나 클릭해서 선택</div></>}
            </div>
            <input ref={tplInput} type="file" hidden accept=".xlsx" onChange={(e) => { pickTemplate(e.target.files); e.target.value = ''; }} />
            {tplErr && <div className="msg err">{tplErr}</div>}
            {tpl && (
              <div className="msg ok">
                엑셀에 <b>{monthLabel(tpl.info.month)}</b>까지 들어 있습니다. → <b>{monthLabel(tpl.info.nextMonth)}판</b>을 만듭니다.
              </div>
            )}
          </div>

          {/* 2. CSV */}
          <div className="panel">
            <h2>2. 이번 달 네이버 CSV</h2>
            <div
              className={`drop ${over === 'csv' ? 'over' : ''}`}
              onClick={() => csvInput.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setOver('csv'); }}
              onDragLeave={() => setOver('')}
              onDrop={(e) => { e.preventDefault(); setOver(''); pickCsv(e.dataTransfer.files); }}
            >
              <b>6개를 한 번에</b> 끌어 놓거나 클릭해서 선택
              <div className="hint">다차원 보고서 → 계정·캠페인·광고그룹·매체·키워드·검색어 (기간: 한 달, 월별)</div>
            </div>
            <input ref={csvInput} type="file" hidden multiple accept=".csv,.txt" onChange={(e) => { pickCsv(e.target.files); e.target.value = ''; }} />
            <table className="kind-table" style={{ marginTop: 10 }}>
              <tbody>
                {KINDS.map((k) => {
                  const it = byKind.get(k);
                  return (
                    <tr key={k}>
                      <td>{it ? '✅' : REQUIRED.includes(k) ? '⬜' : '➖'}</td>
                      <td>{CSV_KIND_LABEL[k]}{!REQUIRED.includes(k) && <span className="hint"> (선택, 합계 확인용)</span>}</td>
                      <td className="hint">{it ? `${monthLabel(it.csv!.month)} · ${n0(it.csv!.rows.length)}행` : ''}</td>
                      <td>{it && <button className="link" onClick={() => setCsvs((a) => a.filter((x) => x !== it))}>빼기</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {csvs.filter((c) => c.error).map((c) => (
              <div key={c.file} className="msg err">
                {c.error} <button className="link" onClick={() => setCsvs((a) => a.filter((x) => x !== c))}>빼기</button>
              </div>
            ))}
          </div>
        </div>

        <div>
          {/* 3. 직접 입력 */}
          <div className="panel">
            <h2>3. 직접 입력하는 값 {tpl && <span className="hint">({monthLabel(tpl.info.nextMonth)})</span>}</h2>
            {!tpl ? (
              <p className="hint">지난달 엑셀을 올리면 지난달 값이 미리 채워집니다.</p>
            ) : (
              <>
                <div className="row2">
                  <div>
                    <label>세금계산서 금액 <span className="hint">(1) 월별 실적 · 쿠폰사용 = 광고비 − 세금계산서)</span></label>
                    <input type="text" inputMode="numeric" value={tax} onChange={(e) => setTax(e.target.value)} placeholder="예: 871,779 (모르면 비워 두고 나중에 엑셀에서 입력)" />
                  </div>
                  <div>
                    <label>비고 <span className="hint">(1) 월별 실적 · 예산·그룹 변경 내역)</span></label>
                    <input type="text" value={note1} onChange={(e) => setNote1(e.target.value)} placeholder="예: 11.08 [지역_렌터카] 하루예산 25,000원→30,000원" />
                  </div>
                </div>

                <label style={{ marginTop: 14 }}>하루예산 · 지역타겟 <span className="hint">(3) 파워링크 그룹별 상단 · 지난달 값)</span></label>
                <table className="kind-table">
                  <thead><tr><th>광고그룹</th><th>하루예산(원)</th><th>지역타겟</th></tr></thead>
                  <tbody>
                    {tpl.info.groups.map((g) => (
                      <tr key={g.name}>
                        <td><b>{g.name}</b></td>
                        <td><input type="text" inputMode="numeric" value={groups[g.name]?.budget ?? ''} onChange={(e) => setGroups({ ...groups, [g.name]: { ...groups[g.name], budget: e.target.value } })} /></td>
                        <td><input type="text" value={groups[g.name]?.region ?? ''} onChange={(e) => setGroups({ ...groups, [g.name]: { ...groups[g.name], region: e.target.value } })} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <label style={{ marginTop: 14 }}>
                  특이사항 <span className="hint">(8) 광고그룹별-검색어 오른쪽 상자 · 지금은 지난달 내용입니다. 이번 달 내용으로 고쳐 주세요)</span>
                </label>
                <textarea rows={7} value={remark} onChange={(e) => setRemark(e.target.value)} />
                {remark === tpl.info.remark8 && remark && <div className="hint" style={{ color: 'var(--warn)' }}>고치지 않으면 지난달 특이사항이 그대로 남습니다.</div>}
              </>
            )}
          </div>

          {/* 4. 만들기 */}
          <div className="panel">
            <h2>4. 엑셀 만들기</h2>
            {problems.length > 0 && (
              <ul className="hint" style={{ margin: '0 0 10px', paddingLeft: 18 }}>
                {problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}
            <div className="btn-row">
              <button className="primary" onClick={build} disabled={!ready}>
                {tpl ? `${monthLabel(tpl.info.nextMonth)}판 엑셀 만들기` : '엑셀 만들기'}
              </button>
              {result && <button onClick={() => download(result.data, result.fileName)}>다시 내려받기</button>}
            </div>
            {busy && <div className="msg">{busy}</div>}
            {err && <div className="msg err">{err}</div>}
            {result && (
              <>
                <div className="msg ok">
                  <b>{result.fileName}</b> ({(result.data.length / 1024 / 1024).toFixed(1)}MB)을 내려받았습니다.
                  <br />엑셀에서 열면 합계·증감·피벗이 새로 계산됩니다. 열린 뒤 한 번 저장해 두면 다른 프로그램에서도 숫자가 보입니다.
                </div>
                <ul className="done-list">
                  {result.done.map((d) => <li key={d}>✓ {d}</li>)}
                </ul>
                {result.warnings.length > 0 && (
                  <div className="msg warn">
                    <b>확인할 것</b>
                    <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                  </div>
                )}

                <div className="save-box">
                  <h3>DB에도 저장</h3>
                  <p className="hint" style={{ marginTop: 0 }}>
                    이번 달 CSV와 위 입력값을 DB에 바로 저장합니다. 검색광고 보고서는 이 DB 자료로 만들어집니다. (같은 달 자료는 덮어씀)
                  </p>
                  <div className="btn-row">
                    <select value={accId ?? ''} onChange={(e) => setAccId(Number(e.target.value) || null)} style={{ padding: '6px 8px' }}>
                      <option value="">광고 계정 선택</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.customer_id})</option>)}
                    </select>
                    <button className="primary" onClick={saveToReport} disabled={!accId || !!busy}>저장</button>
                    {saveMsg?.ok && accId && <a href={`/ads/report?account=${accId}&month=${result.month}`}><button>보고서 보기</button></a>}
                  </div>
                  {!accounts.length && <div className="hint">등록된 광고 계정이 없습니다. '업로드' 탭 왼쪽에서 관계사·계정을 먼저 등록해 주세요.</div>}
                  {saveMsg && <div className={`msg ${saveMsg.ok ? 'ok' : 'err'}`}>{saveMsg.text}</div>}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
