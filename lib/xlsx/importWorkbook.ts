/**
 * 서경엔카 검색광고 보고서 엑셀(누적본) → 검색광고 보고서 DB 형식
 *  2) 캠페인 유형별 → 캠페인·계정(합계)·플레이스 광고그룹
 *  3) 파워링크 그룹별 → 광고그룹,  4) 광고그룹별-매체 → 매체
 *  6) 키워드 누적 → 키워드,  8) 광고그룹별-검색어 → 검색어
 *  1) 월별 실적 → 세금계산서·쿠폰·비고,  3) 상단 → 하루예산·지역타겟
 */
import { Workbook } from './workbook';
import type { Sheet } from './sheet';
import { toMonth, type AdLevel, type AdRow, type ParsedFile } from '../ads/parse';

export interface WorkbookNotes {
  months: { month: string; tax_invoice: number | null; coupon: number | null; note: string }[];
  groups: { month: string; list: { ad_group: string; daily_budget: number | null; region_target: string }[] } | null;
}

export interface WorkbookImport {
  files: ParsedFile[];
  notes: WorkbookNotes;
  lastMonth: string;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const labelMonth = (s: string) => {
  const m = s.replace(/\s/g, '').match(/^(20\d{2})년(\d{1,2})월$/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}` : null;
};
const blank = (): Omit<AdRow, 'month'> => ({ campaign_type: '', campaign: '', ad_group: '', dim: '', search_type: '', impressions: 0, clicks: 0, cost: 0, avg_rank: null });

/** 같은 키는 합산 (순위는 노출 가중) */
class Acc {
  private map = new Map<string, AdRow & { w: number; wi: number }>();
  add(r: AdRow) {
    const key = [r.month, r.campaign_type, r.campaign, r.ad_group, r.dim, r.search_type].join('\u0001');
    const p = this.map.get(key);
    const w = r.avg_rank != null ? r.avg_rank * Math.max(r.impressions, 1) : 0;
    const wi = r.avg_rank != null ? Math.max(r.impressions, 1) : 0;
    if (p) {
      p.impressions += r.impressions;
      p.clicks += r.clicks;
      p.cost += r.cost;
      p.w += w;
      p.wi += wi;
    } else this.map.set(key, { ...r, w, wi });
  }
  rows(): AdRow[] {
    return [...this.map.values()].map(({ w, wi, ...r }) => ({ ...r, cost: Math.round(r.cost), avg_rank: wi ? Math.round((w / wi) * 100) / 100 : null }));
  }
}

function headerMap(sh: Sheet, headerRow: number) {
  const m = new Map<string, number>();
  for (const c of sh.getRow(headerRow)?.cells ?? []) {
    const h = sh.str(headerRow, c.col).replace(/\s/g, '');
    if (h && !m.has(h)) m.set(h, c.col);
  }
  return m;
}

function findRow(sh: Sheet, col: string, pred: (s: string) => boolean, from = 1, to = 1e9) {
  for (const row of sh.rows) if (row.r >= from && row.r <= to && pred(sh.str(row.r, col))) return row.r;
  return 0;
}

/** 서경엔카형 보고서 엑셀이면 읽고, 아니면 null */
export async function readReportWorkbook(data: ArrayBuffer, fileName: string): Promise<WorkbookImport | null> {
  let wb: Workbook;
  try {
    wb = await Workbook.open(data);
  } catch {
    return null;
  }
  const need = [/^1\)/, /^2\)/, /^3\)/].map((re) => wb.findSheet(re));
  if (need.some((n) => !n) || !wb.findSheet(/^2\)캠페인/)) return null;

  const warn = (f: ParsedFile, w: string) => f.warnings.push(w);
  const mk = (level: AdLevel, title: string, rows: AdRow[]): ParsedFile => ({
    fileName: `${fileName} › ${title}`,
    level,
    title,
    customerId: '',
    period: '',
    months: [...new Set(rows.map((r) => r.month))].sort(),
    rows,
    warnings: [],
  });

  // ----- 2) 캠페인 유형별 -----
  const camp = new Acc();
  const placeGroup = new Acc();
  const placeMedia: AdRow[] = [];
  {
    const sh = await wb.sheet(wb.findSheet(/^2\)/)!);
    for (const [i, type] of [[1, '파워링크'], [2, '플레이스']] as const) {
      const title = findRow(sh, 'B', (s) => new RegExp(`^${i}\\)\\s*${type}`).test(s));
      if (!title) continue;
      const inc = findRow(sh, 'B', (s) => s.startsWith('전월대비'), title + 1) || title + 200;
      for (const row of sh.rows) {
        if (row.r <= title || row.r >= inc) continue;
        const month = labelMonth(sh.str(row.r, 'B'));
        const imp = num(sh.value(row.r, 'C'));
        if (!month || imp == null) continue;
        const r: AdRow = { ...blank(), month, campaign_type: type, impressions: imp, clicks: num(sh.value(row.r, 'D')) ?? 0, cost: num(sh.value(row.r, 'G')) ?? 0, avg_rank: num(sh.value(row.r, 'H')) };
        camp.add(r);
        if (type === '플레이스') {
          placeGroup.add({ ...r, campaign_type: '', ad_group: '플레이스' });
          placeMedia.push({ ...r, campaign_type: '', ad_group: '플레이스', dim: '검색' });
        }
      }
    }
  }
  const campRows = camp.rows();
  const account = new Acc();
  for (const r of campRows) account.add({ ...r, campaign_type: '', avg_rank: null });

  // ----- 3) 파워링크 그룹별 -----
  const groups = new Acc();
  let groupSettings: WorkbookNotes['groups'] = null;
  {
    const sh = await wb.sheet(wb.findSheet(/^3\)/)!);
    const top = findRow(sh, 'B', (s) => s.replace(/\s/g, '') === '캠페인유형');
    const first = findRow(sh, 'B', (s) => s.startsWith('■ 그룹별'), top + 1) || top + 1;
    for (const row of sh.rows) {
      if (row.r <= first) continue;
      const month = labelMonth(sh.str(row.r, 'B'));
      const g = sh.str(row.r, 'C');
      const imp = num(sh.value(row.r, 'D'));
      if (!month || !g || imp == null) continue;
      groups.add({ ...blank(), month, ad_group: g, impressions: imp, clicks: num(sh.value(row.r, 'E')) ?? 0, cost: num(sh.value(row.r, 'H')) ?? 0, avg_rank: num(sh.value(row.r, 'I')) });
    }
    // 상단 표 하루예산·지역타겟 → 가장 최근 달 설정
    const last = campRows.map((r) => r.month).sort().at(-1);
    if (top && last) {
      const list: { ad_group: string; daily_budget: number | null; region_target: string }[] = [];
      for (let r = top + 1; r < top + 40; r++) {
        const g = sh.str(r, 'C');
        if (!g) break;
        const b = num(sh.value(r, 'J'));
        const k = sh.str(r, 'K');
        if (b != null || k) list.push({ ad_group: g, daily_budget: b, region_target: k });
      }
      if (list.length) groupSettings = { month: last, list };
    }
  }
  for (const r of placeGroup.rows()) groups.add(r);

  // ----- 4) 광고그룹별-매체 -----
  const media = new Acc();
  const name4 = wb.findSheet(/^4\)/);
  if (name4) {
    const sh = await wb.sheet(name4);
    const first = findRow(sh, 'B', (s) => s.startsWith('■ 매체별')) || 13;
    const sides = [
      { label: 'B', g: 'C', d: 'D', imp: 'E', clk: 'F', cost: 'I', rank: 'J' },
      { label: 'L', g: 'M', d: 'N', imp: 'O', clk: 'P', cost: 'S', rank: 'T' },
    ];
    for (const row of sh.rows) {
      if (row.r <= first) continue;
      for (const s of sides) {
        const month = labelMonth(sh.str(row.r, s.label));
        const g = sh.str(row.r, s.g);
        const imp = num(sh.value(row.r, s.imp));
        if (!month || !g || imp == null) continue;
        media.add({ ...blank(), month, ad_group: g, dim: sh.str(row.r, s.d) || (s.label === 'B' ? '검색' : '콘텐츠'), impressions: imp, clicks: num(sh.value(row.r, s.clk)) ?? 0, cost: num(sh.value(row.r, s.cost)) ?? 0, avg_rank: num(sh.value(row.r, s.rank)) });
      }
    }
  }
  const mediaMonths = new Set(media.rows().map((r) => r.month));
  for (const r of placeMedia) if (mediaMonths.has(r.month)) media.add(r);

  // ----- 6) 키워드 누적 / 8) 검색어 -----
  const rawTable = async (re: RegExp, level: 'keyword' | 'searchterm') => {
    const n = wb.findSheet(re);
    if (!n) return null;
    const sh = await wb.sheet(n);
    const hr = findRow(sh, 'A', (s) => s === '광고그룹', level === 'searchterm' ? 15 : 1);
    if (!hr) return null;
    const h = headerMap(sh, hr);
    const col = (k: string) => h.get(k) ?? 0;
    const cDim = col(level === 'keyword' ? '키워드' : '검색어');
    const acc = new Acc();
    let skipped = 0;
    for (const row of sh.rows) {
      if (row.r <= hr) continue;
      const g = sh.str(row.r, 'A');
      const month = toMonth(sh.value(row.r, col('월별')));
      const imp = num(sh.value(row.r, col('노출수')));
      if (!g || !month || imp == null) {
        if (g) skipped++;
        continue;
      }
      acc.add({
        ...blank(),
        month,
        ad_group: g,
        dim: String(sh.value(row.r, cDim) ?? '').trim(),
        search_type: level === 'searchterm' ? sh.str(row.r, col('검색유형')) : '',
        impressions: imp,
        clicks: num(sh.value(row.r, col('클릭수'))) ?? 0,
        cost: num(sh.value(row.r, col('총비용'))) ?? 0,
        avg_rank: level === 'keyword' ? num(sh.value(row.r, col('평균노출순위'))) : null,
      });
    }
    return { rows: acc.rows(), skipped, sheet: n };
  };
  const kw = await rawTable(/^6\)/, 'keyword');
  const st = await rawTable(/^8\)/, 'searchterm');

  // ----- 1) 월별 실적: 세금계산서·비고 -----
  const notes: WorkbookNotes['months'] = [];
  {
    const sh = await wb.sheet(wb.findSheet(/^1\)/)!);
    const costBy = new Map(account.rows().map((r) => [r.month, r.cost]));
    for (const row of sh.rows) {
      const month = labelMonth(sh.str(row.r, 'B'));
      if (!month || !costBy.has(month)) continue;
      const tax = num(sh.value(row.r, 'H'));
      const note = sh.str(row.r, 'J');
      if (tax == null && !note) continue;
      notes.push({ month, tax_invoice: tax, coupon: tax != null ? Math.round(costBy.get(month)! - tax) : null, note });
    }
  }

  const files: ParsedFile[] = [
    mk('account', '계정(캠페인 합계)', account.rows()),
    mk('campaign', '2)캠페인 유형별', campRows),
    mk('adgroup', '3)파워링크 그룹별 + 플레이스', groups.rows()),
  ];
  if (name4) files.push(mk('media', '4)광고그룹별-매체', media.rows()));
  if (kw) {
    const f = mk('keyword', kw.sheet, kw.rows);
    if (kw.skipped) warn(f, `숫자가 없는 ${kw.skipped}행은 제외했습니다.`);
    files.push(f);
  }
  if (st) {
    const f = mk('searchterm', st.sheet, st.rows);
    if (st.skipped) warn(f, `숫자가 없는 ${st.skipped}행은 제외했습니다.`);
    files.push(f);
  }
  const nonEmpty = files.filter((f) => f.rows.length);
  if (!nonEmpty.length) throw new Error(`${fileName}: 엑셀에서 읽을 자료가 없습니다.`);
  return { files: nonEmpty, notes: { months: notes, groups: groupSettings }, lastMonth: campRows.map((r) => r.month).sort().at(-1) ?? '' };
}
