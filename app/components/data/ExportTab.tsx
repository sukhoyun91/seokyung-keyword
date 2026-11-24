'use client';
import { useEffect, useMemo, useState } from 'react';
import { LEVELS, LEVEL_LABEL, type AdLevel } from '@/lib/ads/parse';
import { monthLabel } from '@/lib/ads/types';
import { HAS_RANK, LEVEL_TEXT_COLS, type DataRow } from '@/lib/ads/columns';
import { api, n0 } from '../ads/fmt';
import type { Account, Directory } from '../ads/directory';

const BRAND = 'FF0B5CAD';
const PAGE = 5000;

interface SummaryRow { month: string; imp: number; clk: number; cost: number; tax_invoice: number | null; coupon: number | null; note: string }

/** DB 자료 → 원천자료 형식 엑셀 (시트: 월별 요약 + 자료 종류별) */
export default function ExportTab({ dir }: { dir: Directory }) {
  const [scope, setScope] = useState<'account' | 'company'>('account');
  const accs: Account[] = useMemo(
    () => (scope === 'account' ? (dir.account ? [dir.account] : []) : dir.companyAccounts),
    [scope, dir.account, dir.companyAccounts],
  );
  const months = useMemo(() => [...new Set(accs.flatMap((a) => a.coverage.map((c) => c.month)))].sort(), [accs]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [levels, setLevels] = useState<Set<AdLevel>>(new Set(LEVELS));
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    // 기본: 최근 13개월
    const last = months.at(-1) ?? '';
    setTo(last);
    setFrom(months[Math.max(0, months.length - 13)] ?? '');
  }, [months.join(',')]);

  const rowsIn = (l: AdLevel) => accs.reduce((s, a) => s + a.coverage.filter((c) => c.level === l && c.month >= from && c.month <= to).reduce((x, c) => x + c.rows, 0), 0);
  const total = [...levels].reduce((s, l) => s + rowsIn(l), 0);

  async function run() {
    setMsg(null);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = '서경방송 마케팅 도구';
      wb.created = new Date();
      const multi = accs.length > 1;
      const company = dir.company?.name ?? '';

      const head = (ws: any, labels: string[], widths: number[]) => {
        ws.columns = widths.map((w) => ({ width: w }));
        const r = ws.addRow(labels);
        r.eachCell((c: any) => {
          c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
          c.alignment = { horizontal: 'center', vertical: 'middle' };
        });
        ws.views = [{ state: 'frozen', ySplit: 1 }];
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: labels.length } };
      };
      const fmtNums = (ws: any, startCol: number, fmts: string[]) => {
        fmts.forEach((f, i) => (ws.getColumn(startCol + i).numFmt = f));
      };

      // ── 월별 요약
      setBusy('월별 요약…');
      const sws = wb.addWorksheet('월별요약');
      const sLabels = [...(multi ? ['계정'] : []), '월', '노출수', '클릭수', '클릭률(%)', '평균CPC', '총비용(VAT포함)', '세금계산서', '쿠폰사용', '비고'];
      head(sws, sLabels, [...(multi ? [18] : []), 10, 14, 10, 10, 10, 16, 14, 12, 40]);
      for (const a of accs) {
        const j = await api<{ months: SummaryRow[] }>(`/api/ads/data?kind=summary&account=${a.id}&level=account&from=${from}&to=${to}`);
        for (const m of j.months) {
          sws.addRow([
            ...(multi ? [a.name] : []),
            m.month,
            m.imp,
            m.clk,
            m.imp ? Math.round((m.clk / m.imp) * 10000) / 100 : 0,
            m.clk ? Math.round(m.cost / m.clk) : 0,
            m.cost,
            m.tax_invoice,
            m.coupon,
            m.note,
          ]);
        }
      }
      fmtNums(sws, multi ? 3 : 2, ['#,##0', '#,##0', '0.00', '#,##0', '#,##0', '#,##0', '#,##0']);

      // ── 종류별 시트
      for (const l of LEVELS) {
        if (!levels.has(l)) continue;
        const cols = LEVEL_TEXT_COLS[l];
        const rank = HAS_RANK[l];
        const ws = wb.addWorksheet(LEVEL_LABEL[l]);
        const labels = [...(multi ? ['계정'] : []), '월', ...cols.map((c) => c.label), '노출수', '클릭수', '클릭률(%)', '평균CPC', '총비용', ...(rank ? ['평균노출순위'] : [])];
        head(ws, labels, [...(multi ? [18] : []), 10, ...cols.map((c) => (c.key === 'dim' ? 28 : 18)), 12, 10, 10, 10, 12, ...(rank ? [12] : [])]);
        let n = 0;
        for (const a of accs) {
          for (let offset = 0; ; offset += PAGE) {
            setBusy(`${LEVEL_LABEL[l]} ${n0(n)}행…`);
            const qs = new URLSearchParams({ account: String(a.id), level: l, from, to, offset: String(offset), limit: String(PAGE) });
            const j = await api<{ rows: DataRow[]; total: number }>(`/api/ads/data?${qs}`);
            for (const r of j.rows) {
              ws.addRow([
                ...(multi ? [a.name] : []),
                r.month,
                ...cols.map((c) => r[c.key]),
                r.impressions,
                r.clicks,
                r.impressions ? Math.round((r.clicks / r.impressions) * 10000) / 100 : 0,
                r.clicks ? Math.round(r.cost / r.clicks) : 0,
                r.cost,
                ...(rank ? [r.avg_rank] : []),
              ]);
            }
            n += j.rows.length;
            if (j.rows.length < PAGE) break;
          }
        }
        const numStart = (multi ? 2 : 1) + 1 + cols.length;
        fmtNums(ws, numStart, ['#,##0', '#,##0', '0.00', '#,##0', '#,##0', ...(rank ? ['0.0'] : [])]);
      }

      setBusy('파일 만드는 중…');
      const buf = await wb.xlsx.writeBuffer();
      const name = `${company || accs[0]?.name || '검색광고'}${scope === 'account' && accs[0] && accs[0].name !== company ? `_${accs[0].name}` : ''}_원천자료_${from}~${to}.xlsx`.replace(/[\\/:*?"<>|]/g, '_');
      const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const el = document.createElement('a');
      el.href = url;
      el.download = name;
      document.body.appendChild(el);
      el.click();
      el.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setMsg({ ok: true, text: `${name} 을(를) 내려받았습니다.` });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
    setBusy('');
  }

  if (!dir.company) return <div className="panel"><div className="empty">왼쪽에서 관계사와 광고 계정을 선택하세요.</div></div>;

  return (
    <div className="panel">
      <h2>DB → 엑셀 다운로드 <span className="hint">원천자료 형식 · 수작업 보고서용</span></h2>
      <p className="hint" style={{ marginTop: 0 }}>
        시트: <b>월별요약</b>(노출·클릭·비용·세금계산서·쿠폰·비고) + 고른 자료 종류별 시트. 열은 네이버 다차원 보고서와 같고, 머리글 필터·틀 고정이 걸려 있습니다.
      </p>

      <label>범위</label>
      <div className="seg">
        <button className={scope === 'account' ? 'on' : ''} onClick={() => setScope('account')} disabled={!dir.account}>
          선택한 계정 {dir.account ? `(${dir.account.name})` : ''}
        </button>
        <button className={scope === 'company' ? 'on' : ''} onClick={() => setScope('company')}>
          {dir.company.name} 전체 계정 ({dir.companyAccounts.length})
        </button>
      </div>

      {months.length === 0 ? (
        <div className="empty" style={{ padding: 30 }}>저장된 자료가 없습니다.</div>
      ) : (
        <>
          <label style={{ marginTop: 12 }}>기간</label>
          <div className="filters">
            <select value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }}>
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
            <span>~</span>
            <select value={to} onChange={(e) => { setTo(e.target.value); if (e.target.value < from) setFrom(e.target.value); }}>
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
            <button onClick={() => { setFrom(to); }}>한 달만</button>
            <button onClick={() => { setFrom(months[0]); setTo(months.at(-1)!); }}>전체 기간</button>
          </div>

          <label style={{ marginTop: 12 }}>시트</label>
          <div className="chk-row">
            {LEVELS.map((l) => (
              <label key={l} className="chk">
                <input
                  type="checkbox"
                  checked={levels.has(l)}
                  onChange={(e) => {
                    const s = new Set(levels);
                    if (e.target.checked) s.add(l);
                    else s.delete(l);
                    setLevels(s);
                  }}
                />
                {LEVEL_LABEL[l]} <span className="hint">{n0(rowsIn(l))}행</span>
              </label>
            ))}
          </div>

          <div className="btn-row" style={{ marginTop: 14, alignItems: 'center' }}>
            <button className="primary" onClick={run} disabled={!!busy || !from || !to}>엑셀 내려받기</button>
            <span className="hint">{busy || `약 ${n0(total)}행${total > 60000 ? ' · 행이 많아 1분 정도 걸릴 수 있습니다' : ''}`}</span>
          </div>
          {msg && <div className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
        </>
      )}
    </div>
  );
}
