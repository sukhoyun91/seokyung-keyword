/**
 * 서경엔카 검색광고 보고서 엑셀(누적본)을 다음 달로 갱신
 *  - 지난달 엑셀을 틀로 받아, 이번 달 네이버 CSV 6종 값을 채워 넣습니다.
 *  - 차트·피벗·슬라이서·메모·서식은 그대로 두고 셀 XML만 고칩니다.
 */
import { Workbook } from './workbook';
import type { Sheet } from './sheet';
import { colToNum, translateFormula } from './refs';
import { CSV_KIND_LABEL, getNum, getStr, type CsvKind, type RawCsv } from './naverCsv';

// ---------- 날짜 표기 ----------
const ym = (m: string) => m.split('-').map(Number) as [number, number];
export function addMonth(m: string, d: number) {
  const [y, mo] = ym(m);
  const t = new Date(Date.UTC(y, mo - 1 + d, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}
const fullLabel = (m: string) => `${ym(m)[0]}년 ${String(ym(m)[1]).padStart(2, '0')}월`; // 2026년 11월
const coverLabel = (m: string) => `${String(ym(m)[0]).slice(2)}년 ${ym(m)[1]}월`; // 26년 11월
const dotLabel = (m: string) => `${ym(m)[0]}.${String(ym(m)[1]).padStart(2, '0')}.`; // 2026.11.
function parseFullLabel(s: string): string | null {
  const m = s.replace(/\s/g, '').match(/^(20\d{2})년(\d{1,2})월$/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}` : null;
}

/** 광고그룹 이름 비교 (시트엔 '지역_렌터카', 데이터엔 '지역_렌트카') */
export const groupKey = (g: string) => g.replace(/\s/g, '').replace(/렌터카/g, '렌트카');

const C = colToNum;
const isNum = (v: unknown) => typeof v === 'number';
const r1 = (n: number) => Math.round(n * 10) / 10;

// ---------- 시트 찾기 ----------
const SHEETS = {
  cover: /^보고서$/,
  monthly: /^1\)/,
  campaign: /^2\)/,
  group: /^3\)/,
  media: /^4\)/,
  keyword: /^5\)/,
  keywordAll: /^6\)/,
  searchterm: /^8\)/,
};
type SheetKey = keyof typeof SHEETS;

const SHEET_LABEL: Record<SheetKey, string> = {
  cover: '보고서',
  monthly: '1)월별 실적 통계',
  campaign: '2)캠페인 유형별',
  group: '3)파워링크 그룹별',
  media: '4)광고그룹별-매체',
  keyword: '5)키워드(월)',
  keywordAll: '6)키워드 누적',
  searchterm: '8)광고그룹별-검색어',
};

function sheetName(wb: Workbook, key: SheetKey) {
  const n = wb.findSheet(SHEETS[key]);
  if (!n) throw new Error(`엑셀에서 '${SHEET_LABEL[key]}' 시트를 찾지 못했습니다. 서경엔카 검색광고 보고서 엑셀이 맞는지 확인하세요.`);
  return n;
}

function findRow(sh: Sheet, col: string, pred: (s: string, r: number) => boolean, from = 1, to = sh.maxRow) {
  for (const row of sh.rows) {
    if (row.r < from || row.r > to) continue;
    if (pred(sh.str(row.r, col), row.r)) return row.r;
  }
  return 0;
}

// ---------- 틀(지난달 엑셀) 정보 ----------
export interface TemplateInfo {
  month: string; // 엑셀에 들어 있는 마지막 달
  nextMonth: string;
  groups: { name: string; budget: number | null; region: string }[]; // 3) 상단 표
  remark8: string; // 8) 특이사항
  note1: string; // 1) 지난달 비고
}

/** 2) 캠페인 유형별 파워링크 표에서 값이 있는 마지막 달 */
function lastFilledMonth(sh: Sheet): string {
  const title = findRow(sh, 'B', (s) => /^1\)\s*파워링크/.test(s));
  const inc = findRow(sh, 'B', (s) => s.startsWith('전월대비 증감분'), title + 1);
  let last: string | null = null;
  for (const row of sh.rows) {
    if (row.r <= title || row.r >= inc) continue;
    const m = parseFullLabel(sh.str(row.r, 'B'));
    if (m && isNum(sh.value(row.r, 'C')) && (sh.value(row.r, 'C') as number) > 0) last = m;
  }
  if (!last) throw new Error("'2)캠페인 유형별' 시트에서 마지막 달을 찾지 못했습니다.");
  return last;
}

function groupTop(sh: Sheet) {
  const head = findRow(sh, 'B', (s) => s.replace(/\s/g, '') === '캠페인유형');
  const out: { row: number; name: string }[] = [];
  for (let r = head + 1; r < head + 40; r++) {
    const name = sh.str(r, 'C');
    if (!name) break;
    out.push({ row: r, name });
  }
  return out;
}

export async function inspectTemplate(data: ArrayBuffer | Uint8Array): Promise<TemplateInfo> {
  const wb = await Workbook.open(data);
  const month = lastFilledMonth(await wb.sheet(sheetName(wb, 'campaign')));
  const g = await wb.sheet(sheetName(wb, 'group'));
  const groups = groupTop(g).map(({ row, name }) => {
    const b = g.value(row, 'J');
    return { name, budget: isNum(b) ? (b as number) : null, region: g.str(row, 'K') };
  });
  const st = await wb.sheet(sheetName(wb, 'searchterm'));
  const remarkRow = findRow(st, 'K', (s) => s.includes('특이사항'), 1, 21);
  const m1 = await wb.sheet(sheetName(wb, 'monthly'));
  const mr = findRow(m1, 'B', (s) => parseFullLabel(s) === month);
  return {
    month,
    nextMonth: addMonth(month, 1),
    groups,
    remark8: remarkRow ? String(st.value(remarkRow, 'K')) : '',
    note1: mr ? m1.str(mr, 'J') : '',
  };
}

// ---------- 갱신 ----------
export interface MonthlyInputs {
  taxInvoice: number | null; // 1) 세금계산서
  note1: string; // 1) 비고
  groups: Record<string, { budget: number | null; region: string }>; // 3) 하루예산·지역타겟 (그룹 이름 그대로)
  remark8: string | null; // 8) 특이사항 (null = 그대로)
}

export interface BuildResult {
  data: Uint8Array;
  fileName: string;
  month: string;
  fromMonth: string;
  warnings: string[];
  done: string[];
}

interface MonthRows {
  title: number;
  inc: number; // 전월대비 증감분
  rate: number; // 전월대비 증감률
}

/** 행 서식을 한 칸씩 내려 보냄: 새 달 ← 당월, 당월 ← 전월, 전월 ← 전전월 (당월 강조 서식 유지) */
function rotateStyles(sh: Sheet, rows: (number | 0)[]) {
  const [pp, p, c, nw] = rows;
  const snap = (r: number) => {
    const row = sh.getRow(r);
    if (!row) return null;
    return { attrs: row.attrs, cells: row.cells.map((x) => ({ col: x.col, s: sh.style(r, x.col) })) };
  };
  const sPP = pp ? snap(pp) : null;
  const sP = p ? snap(p) : null;
  const sC = c ? snap(c) : null;
  const apply = (r: number, s: ReturnType<typeof snap>) => {
    if (!r || !s) return;
    const row = sh.ensureRow(r);
    const hidden = /\bhidden="1"/.test(row.attrs);
    row.attrs = s.attrs.replace(/\s*\bhidden="[^"]*"/, '').trim() + (hidden ? ' hidden="1"' : '');
    for (const x of s.cells) sh.setStyle(r, x.col, x.s);
  };
  apply(nw, sC);
  apply(c, sP);
  apply(p, sPP);
}

function labelRowsIn(sh: Sheet, from: number, to: number, col = 'B') {
  const out: { r: number; m: string }[] = [];
  for (const row of sh.rows) {
    if (row.r <= from || row.r >= to) continue;
    const m = parseFullLabel(sh.str(row.r, col));
    if (m) out.push({ r: row.r, m });
  }
  return out;
}

/** 당월 행의 수식을 새 행으로 복사 (새 행에 이미 값이 있는 칸은 수식이 있을 때만 덮어씀) */
function copyFormulas(sh: Sheet, from: number, to: number) {
  const src = sh.getRow(from);
  if (!src) return;
  for (const c of src.cells) {
    const f = sh.formula(from, c.col);
    if (f != null) sh.setFormula(to, c.col, translateFormula(f, to - from, 0));
  }
}

/**
 * 1)·2) 처럼 미리 만든 달 행이 있는 표: 새 달 행 번호를 돌려줌. 없으면(새해) 12행을 끼워 넣음
 */
async function prebuiltRow(wb: Workbook, name: string, findBlock: (sh: Sheet) => MonthRows, cur: string, next: string): Promise<number> {
  let sh = await wb.sheet(name);
  let b = findBlock(sh);
  const rows = labelRowsIn(sh, b.title, b.inc);
  const hit = rows.find((x) => x.m === next);
  if (hit) return hit.r;
  const last = rows[rows.length - 1];
  if (!last || last.m !== cur || !next.endsWith('-01')) {
    throw new Error(`'${name}' 시트에 ${fullLabel(next)} 행이 없고, 자동으로 만들 수 있는 위치도 아닙니다.`);
  }
  // 새해: 12행 추가 (1월만 보이고 나머지는 숨김)
  const [y] = ym(next);
  await wb.insertRows(name, b.inc, 12, { extendChartRanges: true });
  sh = await wb.sheet(name);
  const prevNormal = rows.length >= 2 ? rows[rows.length - 2].r : last.r;
  for (let k = 0; k < 12; k++) {
    const r = b.inc + k;
    sh.cloneRow(last.r, r);
    const row = sh.getRow(r)!;
    for (const c of row.cells) if (sh.formula(r, c.col) == null && c.col !== C('B')) sh.clear(r, c.col);
    sh.setString(r, 'B', fullLabel(`${y}-${String(k + 1).padStart(2, '0')}`));
    sh.copyRowStyle(prevNormal, r, false);
    sh.setRowHidden(r, k > 0);
  }
  return b.inc;
}

export async function buildMonthly(data: ArrayBuffer | Uint8Array, csvs: RawCsv[], inputs: MonthlyInputs): Promise<BuildResult> {
  const warnings: string[] = [];
  const done: string[] = [];

  // ----- CSV 확인 -----
  const by = new Map<CsvKind, RawCsv>();
  for (const c of csvs) {
    if (by.has(c.kind)) throw new Error(`${CSV_KIND_LABEL[c.kind]}가 두 개입니다: ${by.get(c.kind)!.fileName}, ${c.fileName}`);
    by.set(c.kind, c);
  }
  const need: CsvKind[] = ['campaign', 'adgroup', 'media', 'keyword', 'searchterm'];
  const missing = need.filter((k) => !by.has(k));
  if (missing.length) throw new Error(`빠진 파일: ${missing.map((k) => CSV_KIND_LABEL[k]).join(', ')}`);
  const months = [...new Set(csvs.map((c) => c.month))];
  if (months.length > 1) throw new Error(`CSV 파일들의 기간이 서로 다릅니다: ${csvs.map((c) => `${c.fileName}(${c.month})`).join(', ')}`);
  const N = months[0];
  const ids = [...new Set(csvs.map((c) => c.customerId).filter(Boolean))];
  if (ids.length > 1) throw new Error(`서로 다른 광고 계정의 파일이 섞여 있습니다: ${ids.join(', ')}`);

  const camp = by.get('campaign')!;
  const adg = by.get('adgroup')!;
  const media = by.get('media')!;
  const kw = by.get('keyword')!;
  const stCsv = by.get('searchterm')!;

  // ----- 틀 확인 -----
  const wb = await Workbook.open(data);
  const nm = {} as Record<SheetKey, string>;
  for (const k of Object.keys(SHEETS) as SheetKey[]) nm[k] = sheetName(wb, k);
  const T = lastFilledMonth(await wb.sheet(nm.campaign));
  if (addMonth(T, 1) !== N) {
    if (T === N) throw new Error(`올린 엑셀에 이미 ${fullLabel(N)} 자료가 들어 있습니다. ${fullLabel(addMonth(N, -1))}판 엑셀을 올려 주세요.`);
    throw new Error(`엑셀은 ${fullLabel(T)}까지 들어 있는데 CSV는 ${fullLabel(N)}입니다. ${fullLabel(addMonth(N, -1))}판 엑셀이 필요합니다.`);
  }
  const P = addMonth(T, -1);

  // ----- 집계 -----
  const campRow = (type: string) => camp.rows.find((r) => getStr(camp, r, '캠페인유형') === type);
  const pl = campRow('파워링크');
  const place = campRow('플레이스');
  if (!pl) warnings.push('캠페인 보고서에 파워링크 행이 없습니다.');
  const isPlaceGroup = (r: (string | number)[]) => /플레이스/.test(getStr(adg, r, '캠페인')) || getStr(adg, r, '광고그룹') === '플레이스';
  const wRank = (rows: (string | number)[][]) => {
    let w = 0;
    let i = 0;
    for (const r of rows) {
      const rk = getNum(adg, r, '평균노출순위');
      const im = getNum(adg, r, '노출수');
      if (rk > 0) {
        w += rk * im;
        i += im;
      }
    }
    return i ? r1(w / i) : null;
  };
  const campVals = {
    파워링크: pl && { imp: getNum(camp, pl, '노출수'), clk: getNum(camp, pl, '클릭수'), cost: getNum(camp, pl, '총비용'), rank: wRank(adg.rows.filter((r) => !isPlaceGroup(r))) },
    플레이스: place && { imp: getNum(camp, place, '노출수'), clk: getNum(camp, place, '클릭수'), cost: getNum(camp, place, '총비용'), rank: wRank(adg.rows.filter(isPlaceGroup)) },
  };
  const acc = by.get('account');
  if (acc?.rows[0]) {
    const tot = getNum(acc, acc.rows[0], '총비용');
    const sum = camp.rows.reduce((s, r) => s + getNum(camp, r, '총비용'), 0);
    if (Math.abs(tot - sum) > 2) warnings.push(`계정 보고서 총비용(${tot.toLocaleString()}원)과 캠페인 합계(${sum.toLocaleString()}원)가 다릅니다.`);
  }

  // ===== 2) 캠페인 유형별 =====
  {
    const name = nm.campaign;
    const sh = await wb.sheet(name);
    // 상단 당월 요약
    const end = findRow(sh, 'B', (s) => s.startsWith('■ 캠페인 유형별 운영'));
    for (const type of ['파워링크', '플레이스'] as const) {
      const r = findRow(sh, 'B', (s) => s === type, 1, end || 12);
      const v = campVals[type];
      if (!r || !v) continue;
      sh.setNumber(r, 'C', v.imp);
      sh.setNumber(r, 'D', v.clk);
      sh.setNumber(r, 'G', v.cost);
      sh.setNumber(r, 'H', v.rank);
    }
    // 1) 파워링크 → 2) 플레이스 순서 (위 표에 행을 끼우면 아래 표 위치가 바뀌므로 매번 다시 찾음)
    for (const [i, type] of [[1, '파워링크'], [2, '플레이스']] as const) {
      const block = (s: Sheet): MonthRows => {
        const title = findRow(s, 'B', (x) => new RegExp(`^${i}\\)\\s*${type}`).test(x));
        const inc = findRow(s, 'B', (x) => x.startsWith('전월대비 증감분'), title + 1);
        if (!title || !inc) throw new Error(`'${name}' 시트에서 ${type} 표를 찾지 못했습니다.`);
        return { title, inc, rate: inc + 1 };
      };
      const nr = await prebuiltRow(wb, name, block, T, N);
      const s2 = await wb.sheet(name);
      const b = block(s2);
      const cr = findRow(s2, 'B', (x) => parseFullLabel(x) === T, b.title, b.inc);
      const pr = findRow(s2, 'B', (x) => parseFullLabel(x) === P, b.title, b.inc);
      const ppr = findRow(s2, 'B', (x) => parseFullLabel(x) === addMonth(P, -1), b.title, b.inc);
      const v = campVals[type];
      copyFormulas(s2, cr, nr);
      s2.setNumber(nr, 'C', v ? v.imp : 0);
      s2.setNumber(nr, 'D', v ? v.clk : 0);
      s2.setNumber(nr, 'G', v ? v.cost : 0);
      s2.setNumber(nr, 'H', v ? v.rank : null);
      s2.setRowHidden(nr, false);
      rotateStyles(s2, [ppr, pr, cr, nr]);
      s2.remapFormulaRows(b.inc, { [cr]: nr, [pr]: cr });
      s2.remapFormulaRows(b.rate, { [cr]: nr, [pr]: cr });
    }
    done.push(`2) 캠페인 유형별: ${fullLabel(N)} 파워링크·플레이스 입력`);
  }

  // ===== 1) 월별 실적 통계 =====
  {
    const name = nm.monthly;
    const block = (s: Sheet): MonthRows => {
      const title = findRow(s, 'B', (x) => x.replace(/\s/g, '') === '기간');
      const inc = findRow(s, 'B', (x) => x.startsWith('전월대비 증감분'), title + 1);
      if (!title || !inc) throw new Error(`'${name}' 시트에서 월별 표를 찾지 못했습니다.`);
      return { title, inc, rate: inc + 1 };
    };
    const nr = await prebuiltRow(wb, name, block, T, N);
    const sh = await wb.sheet(name);
    const b = block(sh);
    const cr = findRow(sh, 'B', (x) => parseFullLabel(x) === T, b.title, b.inc);
    const pr = findRow(sh, 'B', (x) => parseFullLabel(x) === P, b.title, b.inc);
    const ppr = findRow(sh, 'B', (x) => parseFullLabel(x) === addMonth(P, -1), b.title, b.inc);
    // 당월 행이 수식(2) 시트 참조)이면 같은 모양으로 복사
    copyFormulas(sh, cr, nr);
    if (inputs.taxInvoice != null) sh.setNumber(nr, 'H', inputs.taxInvoice);
    else warnings.push(`1) 월별 실적: ${fullLabel(N)} 세금계산서 금액이 비어 있습니다. (나중에 엑셀에서 직접 입력)`);
    if (inputs.note1.trim()) sh.setString(nr, 'J', inputs.note1.trim());
    sh.setRowHidden(nr, false);
    rotateStyles(sh, [ppr, pr, cr, nr]);
    sh.remapFormulaRows(b.inc, { [cr]: nr, [pr]: cr });
    sh.remapFormulaRows(b.rate, { [cr]: nr, [pr]: cr });
    done.push(`1) 월별 실적 통계: ${fullLabel(N)} 행 연결${inputs.taxInvoice != null ? ', 세금계산서 입력' : ''}`);
    // 차트: 월 표 첫 행~마지막 달 행까지 (일부 계열이 예전 달에서 멈춰 있던 것도 함께 맞춤)
    const labels = labelRowsIn(sh, b.title, b.inc);
    if (labels.length) {
      const fixed = await wb.alignChartRanges(name, labels[0].r, labels[labels.length - 1].r);
      if (fixed) done.push(`차트: 데이터 범위 ${fixed}곳을 ${fullLabel(labels[labels.length - 1].m)} 행까지 맞춤`);
    }
  }

  // ===== 보고서(표지) =====
  {
    const sh = await wb.sheet(nm.cover);
    const rows = sh.rows.filter((r) => sh.str(r.r, 'C') === '검색광고').map((r) => r.r);
    if (rows.length >= 2) {
      const [pRow, cRow] = rows;
      for (const k of [0, 1]) for (const col of ['D', 'E', 'H']) sh.setAuto(pRow + k, C(col), sh.value(cRow + k, col));
      sh.setString(pRow, 'B', coverLabel(T));
      sh.setString(cRow, 'B', coverLabel(N));
      const vals = [campVals.파워링크, campVals.플레이스];
      vals.forEach((v, k) => {
        sh.setNumber(cRow + k, 'D', v ? v.imp : 0);
        sh.setNumber(cRow + k, 'E', v ? v.clk : 0);
        sh.setNumber(cRow + k, 'H', v ? v.cost : 0);
      });
      done.push(`보고서(표지): 전월 ${coverLabel(T)} / 당월 ${coverLabel(N)}`);
    } else warnings.push("'보고서' 시트에서 전월·당월 표를 찾지 못해 건너뛰었습니다.");
  }

  // ===== 3) 파워링크 그룹별 =====
  const groupRows = adg.rows.filter((r) => !isPlaceGroup(r));
  {
    const name = nm.group;
    let sh = await wb.sheet(name);
    const top = groupTop(sh);
    const seen = new Set<string>();
    for (const t of top) {
      const d = groupRows.find((r) => groupKey(getStr(adg, r, '광고그룹')) === groupKey(t.name));
      const set = inputs.groups[t.name];
      if (d) {
        seen.add(groupKey(t.name));
        sh.setNumber(t.row, 'D', getNum(adg, d, '노출수'));
        sh.setNumber(t.row, 'E', getNum(adg, d, '클릭수'));
        sh.setNumber(t.row, 'F', getNum(adg, d, '클릭률(%)') / 100);
        sh.setNumber(t.row, 'G', getNum(adg, d, '평균 CPC'));
        sh.setNumber(t.row, 'H', getNum(adg, d, '총비용'));
        sh.setNumber(t.row, 'I', getNum(adg, d, '평균노출순위') || null);
      } else {
        for (const col of ['D', 'E', 'F', 'G', 'H']) sh.setNumber(t.row, col, 0);
        sh.setNumber(t.row, 'I', null);
        warnings.push(`3) 파워링크 그룹별: '${t.name}' 그룹은 이번 달 데이터가 없어 0으로 넣었습니다.`);
      }
      if (set) {
        sh.setNumber(t.row, 'J', set.budget);
        sh.setString(t.row, 'K', set.region);
      }
    }
    for (const r of groupRows) {
      const g = getStr(adg, r, '광고그룹');
      if (!seen.has(groupKey(g))) warnings.push(`3) 파워링크 그룹별: 새 광고그룹 '${g}'이(가) 있습니다. 상단 표와 그룹별 표에 행을 직접 추가해 주세요.`);
    }

    // 그룹별 월 표: 당월 행 다음에 한 행 삽입
    for (const d of groupRows) {
      const g = getStr(adg, d, '광고그룹');
      sh = await wb.sheet(name);
      const cr = findRow(sh, 'B', (s, r) => parseFullLabel(s) === T && groupKey(sh.str(r, 'C')) === groupKey(g) && sh.str(r + 1, 'B').startsWith('전월대비 증감분'));
      if (!cr) {
        if (seen.has(groupKey(g))) warnings.push(`3) 파워링크 그룹별: '${g}' 그룹의 ${fullLabel(T)} 행을 찾지 못해 월 표는 건너뛰었습니다.`);
        continue;
      }
      const pr = cr - 1;
      const ppr = cr - 2;
      const nr = cr + 1;
      await wb.insertRows(name, nr, 1);
      sh = await wb.sheet(name);
      sh.cloneRow(cr, nr);
      sh.setString(nr, 'B', fullLabel(N));
      sh.setNumber(nr, 'D', getNum(adg, d, '노출수'));
      sh.setNumber(nr, 'E', getNum(adg, d, '클릭수'));
      if (sh.formula(nr, 'F') == null) sh.setNumber(nr, 'F', getNum(adg, d, '클릭률(%)') / 100);
      if (sh.formula(nr, 'G') == null) sh.setNumber(nr, 'G', getNum(adg, d, '평균 CPC'));
      sh.setNumber(nr, 'H', getNum(adg, d, '총비용'));
      sh.setNumber(nr, 'I', getNum(adg, d, '평균노출순위') || null);
      for (const col of ['J', 'K', 'L']) sh.clear(nr, C(col));
      const isLabel = (r: number) => !!parseFullLabel(sh.str(r, 'B'));
      rotateStyles(sh, [isLabel(ppr) ? ppr : 0, isLabel(pr) ? pr : 0, cr, nr]);
      sh.remapFormulaRows(nr + 1, { [cr]: nr, [pr]: cr });
      sh.remapFormulaRows(nr + 2, { [cr]: nr, [pr]: cr });
    }
    done.push(`3) 파워링크 그룹별: 상단 표 + 그룹 ${groupRows.length}개 월 행 추가`);
  }

  // ===== 4) 광고그룹별-매체 =====
  {
    const name = nm.media;
    let sh = await wb.sheet(name);
    const mrow = (g: string, kind: string) => media.rows.find((r) => groupKey(getStr(media, r, '광고그룹')) === groupKey(g) && getStr(media, r, '검색/콘텐츠 매체') === kind);
    const fill = (r: number, cols: string[], d: (string | number)[] | undefined) => {
      const [imp, clk, ctr, cpc, cost, rank] = cols;
      if (!d) {
        for (const c of cols) sh.clear(r, C(c));
        return;
      }
      sh.setNumber(r, imp, getNum(media, d, '노출수'));
      sh.setNumber(r, clk, getNum(media, d, '클릭수'));
      sh.setNumber(r, ctr, getNum(media, d, '클릭률(%)'));
      sh.setNumber(r, cpc, getNum(media, d, '평균 CPC'));
      sh.setNumber(r, cost, getNum(media, d, '총비용'));
      sh.setNumber(r, rank, getNum(media, d, '평균노출순위') || null);
    };
    const L = ['E', 'F', 'G', 'H', 'I', 'J'];
    const R = ['O', 'P', 'Q', 'R', 'S', 'T'];
    // 상단 당월 표
    const head = findRow(sh, 'B', (s) => s.replace(/\s/g, '') === '캠페인유형');
    for (let r = head + 1; r < head + 30; r++) {
      const g = sh.str(r, 'C');
      if (!g) {
        if (!sh.str(r, 'D')) break;
        continue;
      }
      if (sh.str(r, 'D') === '검색') fill(r, L, mrow(g, '검색'));
      if (sh.str(r + 1, 'D') === '콘텐츠') fill(r + 1, L, mrow(g, '콘텐츠'));
    }
    // 그룹별 월 표
    const groups = [...new Set(media.rows.map((r) => getStr(media, r, '광고그룹')))].filter((g) => g !== '플레이스');
    let added = 0;
    for (const g of groups) {
      sh = await wb.sheet(name);
      const cr = findRow(sh, 'B', (s, r) => parseFullLabel(s) === T && groupKey(sh.str(r, 'C')) === groupKey(g) && sh.str(r + 1, 'B').startsWith('전월대비 증감분'));
      if (!cr) {
        warnings.push(`4) 광고그룹별-매체: '${g}' 그룹의 ${fullLabel(T)} 행을 찾지 못해 건너뛰었습니다.`);
        continue;
      }
      const nr = cr + 1;
      await wb.insertRows(name, nr, 1);
      sh = await wb.sheet(name);
      sh.cloneRow(cr, nr);
      sh.setString(nr, 'B', fullLabel(N));
      if (sh.str(nr, 'L')) sh.setString(nr, 'L', fullLabel(N));
      fill(nr, L, mrow(g, '검색'));
      fill(nr, R, mrow(g, '콘텐츠'));
      for (let c = C('U'); c <= C('Z'); c++) sh.clear(nr, c);
      const isLabel = (r: number) => !!parseFullLabel(sh.str(r, 'B'));
      rotateStyles(sh, [isLabel(cr - 2) ? cr - 2 : 0, isLabel(cr - 1) ? cr - 1 : 0, cr, nr]);
      sh.remapFormulaRows(nr + 1, { [cr]: nr, [cr - 1]: cr });
      sh.remapFormulaRows(nr + 2, { [cr]: nr, [cr - 1]: cr });
      added++;
    }
    done.push(`4) 광고그룹별-매체: 상단 표 + 그룹 ${added}개 월 행 추가`);
  }

  // ===== 원본 붙여넣기 공통 =====
  const pasteRows = (sh: Sheet, headerRow: number, csv: RawCsv, startRow: number, styleRow: number, applyFilter: boolean) => {
    // 시트 머리글 → CSV 열
    const map: { col: number; idx: number }[] = [];
    const hdr = sh.getRow(headerRow)!;
    for (const c of hdr.cells) {
      const h = sh.str(headerRow, c.col);
      if (!h) continue;
      const idx = csv.headers.findIndex((x) => x.replace(/\s/g, '') === h.replace(/\s/g, ''));
      if (idx >= 0) map.push({ col: c.col, idx });
    }
    if (map.length < csv.headers.length) {
      const miss = csv.headers.filter((_h, i) => !map.some((m) => m.idx === i));
      if (miss.length) warnings.push(`'${sh.name}' 시트에 없는 CSV 열은 넣지 않았습니다: ${miss.join(', ')}`);
    }
    const tmpl = sh.getRow(styleRow);
    const styles = new Map(map.map((m) => [m.col, sh.style(styleRow, m.col)]));
    const rowAttrs = (tmpl?.attrs ?? '').replace(/\s*\bhidden="[^"]*"/, '').trim();
    const filter = applyFilter ? sh.autoFilterConditions() : null;
    let r = startRow;
    let hiddenCount = 0;
    for (const d of csv.rows) {
      const row = sh.ensureRow(r);
      row.attrs = rowAttrs;
      for (const m of map) {
        sh.setAuto(r, m.col, d[m.idx] ?? '');
        sh.setStyle(r, m.col, styles.get(m.col));
      }
      if (filter?.conds.size) {
        let ok = true;
        for (const [col, vals] of filter.conds) {
          const m = map.find((x) => x.col === col);
          if (m && !vals.has(String(d[m.idx] ?? ''))) ok = false;
        }
        if (!ok) {
          sh.setRowHidden(r, true);
          hiddenCount++;
        }
      }
      r++;
    }
    return { last: r - 1, hiddenCount };
  };

  // ===== 5) 키워드(당월) =====
  {
    const name = nm.keyword;
    const sh = await wb.sheet(name);
    const hr = findRow(sh, 'A', (s) => s === '광고그룹');
    if (!hr) throw new Error(`'${name}' 시트에서 머리글(광고그룹)을 찾지 못했습니다.`);
    const oldLast = sh.lastRowWithValue(C('A'));
    // 첫 데이터 행 서식을 임시 행(0)에 보관한 뒤 A~I 비우기 (오른쪽 다른 칸은 보존)
    sh.cloneRow(hr + 1, 0);
    for (let r = hr + 1; r <= oldLast; r++) for (let c = 1; c <= C('I'); c++) sh.removeCell(r, c);
    const { last } = pasteRows(sh, hr, kw, hr + 1, 0, false);
    sh.removeRow(0);
    sh.setAutoFilterEnd(last);
    await wb.setDefinedNameEnd(name, '_xlnm._FilterDatabase', last);
    const newName = `5)키워드(${ym(N)[1]}월)`;
    await wb.renameSheet(name, newName);
    done.push(`5) 키워드: ${kw.rows.length}행으로 교체, 시트 이름 '${newName}'`);
  }

  // ===== 6) 키워드 누적 =====
  {
    const name = nm.keywordAll;
    const sh = await wb.sheet(name);
    const hr = findRow(sh, 'A', (s) => s === '광고그룹');
    const last0 = sh.lastRowWithValue(C('A'));
    if (findRow(sh, 'C', (s) => s === dotLabel(N), hr + 1)) throw new Error(`'${name}' 시트에 이미 ${dotLabel(N)} 키워드가 있습니다.`);
    const { last, hiddenCount } = pasteRows(sh, hr, kw, last0 + 1, last0, true);
    sh.setAutoFilterEnd(last);
    await wb.setDefinedNameEnd(name, '_xlnm._FilterDatabase', last);
    await wb.setPivotSourceEnd(name, last);
    done.push(`6) 키워드 누적: ${kw.rows.length}행 추가 (${last0 + 1}~${last}행${hiddenCount ? `, 현재 필터 조건에 맞지 않는 ${hiddenCount}행은 숨김` : ''}), 피벗은 엑셀에서 열 때 새로 고침`);
  }

  // ===== 8) 광고그룹별-검색어 =====
  {
    const name = nm.searchterm;
    const sh = await wb.sheet(name);
    const hr = findRow(sh, 'A', (s) => s === '광고그룹', 15);
    if (!hr) throw new Error(`'${name}' 시트에서 검색어 표 머리글을 찾지 못했습니다.`);
    // 상단 요약: 그룹 × 검색유형 (전월 ← 당월, 당월 ← 새 달)
    const sums = new Map<string, { imp: number; clk: number }>();
    const add = (k: string, imp: number, clk: number) => {
      const v = sums.get(k) ?? { imp: 0, clk: 0 };
      v.imp += imp;
      v.clk += clk;
      sums.set(k, v);
    };
    for (const r of stCsv.rows) {
      const g = groupKey(getStr(stCsv, r, '광고그룹'));
      const t = getStr(stCsv, r, '검색 유형');
      const imp = getNum(stCsv, r, '노출수');
      const clk = getNum(stCsv, r, '클릭수');
      add(g, imp, clk);
      add(`${g}\u0001${t}`, imp, clk);
    }
    const sub = findRow(sh, 'B', (s) => /^\d{4}\.\d{2}\.$/.test(s), 1, hr);
    if (sub) {
      sh.setString(sub, 'B', sh.str(sub, 'C'));
      sh.setString(sub, 'D', sh.str(sub, 'E'));
      sh.setString(sub, 'C', dotLabel(N));
      sh.setString(sub, 'E', dotLabel(N));
      let group = '';
      const types = new Set(['일치', '일치(유사검색어)', '확장']);
      for (let r = sub + 1; r < hr - 1; r++) {
        const a = sh.str(r, 'A');
        if (!a) continue;
        const key = types.has(a) ? `${group}\u0001${a}` : ((group = groupKey(a)), group);
        const v = sums.get(key) ?? { imp: 0, clk: 0 };
        sh.setAuto(r, C('B'), sh.value(r, 'C'));
        sh.setAuto(r, C('D'), sh.value(r, 'E'));
        sh.setNumber(r, 'C', v.imp);
        sh.setNumber(r, 'E', v.clk);
      }
      // 제목의 기간 (04~10월) → (04~11월)
      const tr = findRow(sh, 'A', (s) => /~\s*\d{1,2}월\)/.test(s), 1, sub);
      if (tr) sh.setString(tr, 'A', sh.str(tr, 'A').replace(/~\s*\d{1,2}월\)/, `~${String(ym(N)[1]).padStart(2, '0')}월)`));
    } else warnings.push(`'${name}' 상단 요약 표를 찾지 못해 건너뛰었습니다.`);
    if (inputs.remark8 != null) {
      const kr = findRow(sh, 'K', (s) => s.includes('특이사항'), 1, hr);
      if (kr) sh.setString(kr, 'K', inputs.remark8);
    }
    // 원본 이어 붙이기
    const last0 = sh.lastRowWithValue(C('A'));
    if (sh.str(last0, 'D') === dotLabel(N)) throw new Error(`'${name}' 시트에 이미 ${dotLabel(N)} 검색어가 있습니다.`);
    const { last, hiddenCount } = pasteRows(sh, hr, stCsv, last0 + 1, last0, true);
    sh.setAutoFilterEnd(last);
    await wb.setDefinedNameEnd(name, '_xlnm._FilterDatabase', last);
    done.push(`8) 광고그룹별-검색어: 상단 요약 갱신, 검색어 ${stCsv.rows.length.toLocaleString()}행 추가${hiddenCount ? ` (필터에 맞지 않는 ${hiddenCount.toLocaleString()}행 숨김)` : ''}`);
  }

  const out = await wb.save();
  const [y, m] = ym(N);
  return {
    data: out,
    fileName: `서경엔카 검색광고 보고서(${y}년 ${m}월).xlsx`,
    month: N,
    fromMonth: T,
    warnings,
    done,
  };
}
