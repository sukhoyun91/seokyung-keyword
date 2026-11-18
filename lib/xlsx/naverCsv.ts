/** 네이버 다차원 보고서 CSV → 원본 그대로의 표 (엑셀 붙여넣기용, 열 순서·반올림 값 유지) */
import { parseCsv, toMonth } from '../ads/parse';

export type CsvKind = 'account' | 'campaign' | 'adgroup' | 'media' | 'keyword' | 'searchterm';

export const CSV_KIND_LABEL: Record<CsvKind, string> = {
  account: '계정 보고서',
  campaign: '캠페인 보고서',
  adgroup: '광고그룹 보고서',
  media: '매체 보고서',
  keyword: '키워드 보고서',
  searchterm: '검색어 보고서',
};

export interface RawCsv {
  fileName: string;
  kind: CsvKind;
  title: string;
  customerId: string;
  month: string; // YYYY-MM
  headers: string[];
  rows: (string | number)[][];
}

const norm = (s: string) => s.replace(/[\s ]/g, '');

const NUMERIC = ['노출수', '클릭수', '클릭률(%)', '평균CPC', '총비용', '평균노출순위', '평균클릭비용'];

function kindOf(title: string, headers: string[]): CsvKind | null {
  const t = norm(title);
  const hs = headers.map(norm);
  if (t.includes('검색어') || hs.includes('검색어')) return 'searchterm';
  if (t.includes('키워드') || hs.includes('키워드')) return 'keyword';
  if (t.includes('매체') || hs.some((h) => h.includes('매체'))) return 'media';
  if (t.includes('광고그룹') || hs.includes('광고그룹')) return 'adgroup';
  if (t.includes('캠페인') || hs.includes('캠페인유형')) return 'campaign';
  if (t.includes('계정')) return 'account';
  return null;
}

export function decodeCsv(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (!utf8.includes('�')) return utf8;
  try {
    return new TextDecoder('euc-kr').decode(buf);
  } catch {
    return utf8;
  }
}

export function readRawCsv(text: string, fileName: string): RawCsv {
  const table = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''));
  const hi = table.findIndex((r) => r.some((c) => norm(c) === '노출수'));
  if (hi < 0) throw new Error(`${fileName}: '노출수' 열이 없습니다. 네이버 다차원 보고서 CSV인지 확인하세요.`);
  const titleLine = table.slice(0, hi).map((r) => r.filter(Boolean).join(',')).find((l) => l.includes('보고서')) ?? '';
  const title = titleLine.split('(')[0].trim();
  const customerId = titleLine.match(/,\s*(\d{4,})\s*$/)?.[1] ?? '';
  const period = titleLine.match(/\(([^)]*)\)/)?.[1] ?? '';
  const headers = table[hi].map((h) => h.trim());
  const kind = kindOf(title, headers);
  if (!kind) throw new Error(`${fileName}: 어떤 보고서인지 알 수 없습니다.`);

  const start = toMonth(period);
  const end = toMonth(period.split('~')[1] ?? '');
  if (!start) throw new Error(`${fileName}: 첫 줄에서 보고서 기간을 찾지 못했습니다.`);
  if (end && end !== start) throw new Error(`${fileName}: 기간(${period})이 한 달이 아닙니다. 한 달씩 받아 주세요.`);

  const numCols = headers.map((h) => NUMERIC.includes(norm(h)));
  const rows = table.slice(hi + 1).map((r) =>
    headers.map((_h, i) => {
      const v = (r[i] ?? '').trim();
      if (numCols[i]) {
        const n = Number(v.replace(/,/g, ''));
        if (v !== '' && v !== '-' && Number.isFinite(n)) return n;
      }
      return v;
    }),
  );
  return { fileName, kind, title, customerId, month: start, headers, rows };
}

/** 열 이름으로 값 꺼내기 */
export function col(csv: RawCsv, name: string): number {
  const i = csv.headers.findIndex((h) => norm(h) === norm(name));
  return i;
}
export function getNum(csv: RawCsv, row: (string | number)[], name: string): number {
  const i = col(csv, name);
  const v = i >= 0 ? row[i] : 0;
  return typeof v === 'number' ? v : Number(String(v).replace(/,/g, '')) || 0;
}
export function getStr(csv: RawCsv, row: (string | number)[], name: string): string {
  const i = col(csv, name);
  return i >= 0 ? String(row[i] ?? '').trim() : '';
}
