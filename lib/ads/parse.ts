/**
 * 네이버 검색광고 다차원 보고서(csv/xlsx) → 정리된 행 데이터
 * 브라우저·서버 공용 (DOM 의존 없음)
 *
 * 파일 예:
 *   키워드 보고서(2026.10.01.~2026.10.31.),1855304
 *   광고그룹,키워드,월별,노출수,클릭수,클릭률(%),평균 CPC,총비용,평균노출순위
 *   지역_렌트카,거제렌트카,2026.10.,641,23,3.59,598,13743,4
 */

export type AdLevel = 'account' | 'campaign' | 'adgroup' | 'media' | 'keyword' | 'searchterm';

export const LEVEL_LABEL: Record<AdLevel, string> = {
  account: '계정',
  campaign: '캠페인',
  adgroup: '광고그룹',
  media: '매체',
  keyword: '키워드',
  searchterm: '검색어',
};
export const LEVELS: AdLevel[] = ['account', 'campaign', 'adgroup', 'media', 'keyword', 'searchterm'];

export interface AdRow {
  month: string; // YYYY-MM
  campaign_type: string;
  campaign: string;
  ad_group: string;
  dim: string; // 매체 / 키워드 / 검색어
  search_type: string;
  impressions: number;
  clicks: number;
  cost: number;
  avg_rank: number | null;
}

export interface ParsedFile {
  fileName: string;
  level: AdLevel;
  title: string;
  customerId: string; // 네이버 계정 번호 (파일 첫 줄)
  period: string;
  months: string[];
  rows: AdRow[];
  warnings: string[];
}

const norm = (s: unknown) => String(s ?? '').replace(/[\s ]/g, '').replace(/\(VAT포함,?원\)/g, '');

type Field = keyof Omit<AdRow, 'avg_rank' | 'month'> | 'avg_rank' | 'month' | 'day' | 'skip';

/** 열 이름 → 필드 (공백 제거 후 비교) */
function fieldOf(header: string): Field | null {
  const h = norm(header);
  if (!h) return null;
  if (h === '캠페인유형') return 'campaign_type';
  if (h === '캠페인' || h === '캠페인명') return 'campaign';
  if (h === '광고그룹' || h === '광고그룹명') return 'ad_group';
  if (h.includes('매체')) return 'dim';
  if (h === '키워드') return 'dim';
  if (h === '검색어') return 'dim';
  if (h === '검색유형') return 'search_type';
  if (h === '월별' || h === '월') return 'month';
  if (h === '일별' || h === '일자' || h === '날짜') return 'day';
  if (h === '노출수') return 'impressions';
  if (h === '클릭수') return 'clicks';
  if (h === '총비용' || h === '비용' || h === '광고비') return 'cost';
  if (h.startsWith('평균노출순위')) return 'avg_rank';
  if (h.startsWith('클릭률') || h.startsWith('평균CPC') || h.startsWith('평균클릭비용')) return 'skip'; // 계산값이라 다시 계산
  return 'skip';
}

function levelFromTitle(title: string): AdLevel | null {
  const t = norm(title);
  if (t.includes('검색어')) return 'searchterm';
  if (t.includes('키워드')) return 'keyword';
  if (t.includes('매체')) return 'media';
  if (t.includes('광고그룹')) return 'adgroup';
  if (t.includes('캠페인')) return 'campaign';
  if (t.includes('계정')) return 'account';
  return null;
}

function levelFromHeaders(fields: (Field | null)[], headers: string[]): AdLevel {
  const hs = headers.map(norm);
  if (hs.includes('검색어')) return 'searchterm';
  if (hs.includes('키워드')) return 'keyword';
  if (hs.some((h) => h.includes('매체'))) return 'media';
  if (fields.includes('ad_group')) return 'adgroup';
  if (fields.includes('campaign')) return 'campaign';
  return 'account';
}

/** "2026.10." / "2026-10" / "2026.10.01." / 엑셀 날짜 → "2026-10" */
export function toMonth(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}`;
  }
  const s = String(v ?? '').trim();
  const m = s.match(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  return null;
}

/** "1,234" / "-" / "" → 숫자 */
function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v ?? '').replace(/[,\s원%]/g, '');
  if (!s || s === '-') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function rankOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  const s = String(v ?? '').replace(/[,\s]/g, '');
  if (!s || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const cellStr = (v: unknown) => (v == null ? '' : v instanceof Date ? v.toISOString() : String(v).trim());

/** 2차원 표 → 정리된 행 */
export function parseTable(table: unknown[][], fileName: string): ParsedFile {
  const warnings: string[] = [];
  const rows = table.filter((r) => Array.isArray(r) && r.some((c) => cellStr(c) !== ''));

  // 제목 줄(…보고서(기간),계정번호)과 머리글 줄(노출수 포함) 찾기
  const headerIdx = rows.findIndex((r) => r.some((c) => norm(c) === '노출수'));
  if (headerIdx < 0) throw new Error(`${fileName}: '노출수' 열을 찾지 못했습니다. 네이버 다차원 보고서 파일인지 확인하세요.`);

  let title = '';
  let customerId = '';
  for (let i = 0; i < headerIdx; i++) {
    const line = rows[i].map(cellStr).filter(Boolean).join(',');
    if (line.includes('보고서')) {
      title = line;
      const id = line.match(/,\s*(\d{4,})\s*$/) || line.match(/(\d{5,})\s*$/);
      if (id) customerId = id[1];
    }
  }
  const titleName = title.split('(')[0].trim();
  const period = title.match(/\(([^)]*)\)/)?.[1] ?? '';
  const periodMonth = toMonth(period);
  const periodEnd = toMonth(period.split('~')[1] ?? '');

  const headers = rows[headerIdx].map(cellStr);
  const fields = headers.map(fieldOf);
  const level = levelFromTitle(titleName) ?? levelFromHeaders(fields, headers);

  const hasMonth = fields.includes('month') || fields.includes('day');
  if (!hasMonth && periodMonth && periodEnd && periodMonth !== periodEnd) {
    throw new Error(
      `${fileName}: 기간(${period})이 여러 달인데 '월별' 열이 없습니다. 네이버에서 기간 구분을 '월별'로 선택해 다시 받아 주세요.`,
    );
  }
  if (!hasMonth && !periodMonth) throw new Error(`${fileName}: 보고서 기간을 찾지 못했습니다.`);

  // 같은 키는 합산 (일별 파일 등)
  const map = new Map<string, AdRow & { rankWeight: number; rankImp: number }>();
  let skipped = 0;
  for (const r of rows.slice(headerIdx + 1)) {
    const rec: Record<string, unknown> = {};
    fields.forEach((f, i) => {
      if (f && f !== 'skip') rec[f] = r[i];
    });
    const first = cellStr(r[0]);
    if (/^(합계|총계|전체|total)$/i.test(first)) continue;

    const month = toMonth(rec.month ?? rec.day) ?? periodMonth;
    if (!month) {
      skipped++;
      continue;
    }
    const row: AdRow = {
      month,
      campaign_type: cellStr(rec.campaign_type),
      campaign: cellStr(rec.campaign),
      ad_group: cellStr(rec.ad_group),
      dim: cellStr(rec.dim),
      search_type: cellStr(rec.search_type),
      impressions: num(rec.impressions),
      clicks: num(rec.clicks),
      cost: Math.round(num(rec.cost)),
      avg_rank: rankOf(rec.avg_rank),
    };
    const key = [row.month, row.campaign_type, row.campaign, row.ad_group, row.dim, row.search_type].join('\u0001');
    const prev = map.get(key);
    const rw = row.avg_rank != null ? row.avg_rank * Math.max(row.impressions, 1) : 0;
    const ri = row.avg_rank != null ? Math.max(row.impressions, 1) : 0;
    if (prev) {
      prev.impressions += row.impressions;
      prev.clicks += row.clicks;
      prev.cost += row.cost;
      prev.rankWeight += rw;
      prev.rankImp += ri;
    } else {
      map.set(key, { ...row, rankWeight: rw, rankImp: ri });
    }
  }
  if (skipped) warnings.push(`월을 알 수 없는 ${skipped}행은 제외했습니다.`);

  const out: AdRow[] = [...map.values()].map(({ rankWeight, rankImp, ...r }) => ({
    ...r,
    avg_rank: rankImp ? Math.round((rankWeight / rankImp) * 100) / 100 : null,
  }));
  if (!out.length) warnings.push('데이터 행이 없습니다.');
  if (!customerId) warnings.push('파일 첫 줄에서 계정 번호를 찾지 못했습니다. 광고주를 직접 선택하세요.');

  return {
    fileName,
    level,
    title: titleName || fileName,
    customerId,
    period,
    months: [...new Set(out.map((r) => r.month))].sort(),
    rows: out,
    warnings,
  };
}

/** 따옴표 처리를 지원하는 CSV 파서 (쉼표·탭 자동 판별) */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const firstLines = t.split(/\r?\n/).slice(0, 5).join('\n');
  const delim = (firstLines.match(/\t/g)?.length ?? 0) > (firstLines.match(/,/g)?.length ?? 0) ? '\t' : ',';
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out;
}
