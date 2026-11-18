/**
 * 워크시트 XML 을 행·셀 단위로 다루는 가벼운 모델.
 * 서식·병합·차트 등 모르는 부분은 원문 그대로 둡니다. (라이브러리로 다시 저장하면 슬라이서·피벗이 사라지므로 직접 편집)
 */
import { cellRef, colToNum, escXml, mapRefs, shiftFormulaRows, shiftSqref, splitRef, translateFormula, unescXml } from './refs';

export interface Cell {
  col: number;
  /** r 을 뺀 나머지 속성 원문 (s="…" t="…" 등) */
  attrs: string;
  /** <c> 안쪽 원문 (<f>…</f><v>…</v> 등). 빈 셀이면 '' */
  inner: string;
}

export interface Row {
  r: number;
  attrs: string; // r·spans 를 뺀 속성 원문
  cells: Cell[];
}

const getAttr = (attrs: string, name: string) => attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const setAttr = (attrs: string, name: string, value: string | null) => {
  const re = new RegExp(`\\s*\\b${name}="[^"]*"`);
  const cleaned = attrs.replace(re, '');
  return value == null ? cleaned : `${cleaned} ${name}="${value}"`;
};

export class Sheet {
  head: string;
  tail: string;
  rows: Row[];
  readonly name: string;

  constructor(xml: string, name: string, private sst: string[]) {
    this.name = name;
    let i = xml.indexOf('<sheetData');
    if (i < 0) throw new Error(`${name}: sheetData 없음`);
    const selfClose = xml.slice(i).match(/^<sheetData\s*\/>/);
    if (selfClose) {
      this.head = xml.slice(0, i);
      this.tail = xml.slice(i + selfClose[0].length);
      this.rows = [];
      return;
    }
    const open = xml.indexOf('>', i) + 1;
    const close = xml.indexOf('</sheetData>', open);
    this.head = xml.slice(0, i);
    this.tail = xml.slice(close + '</sheetData>'.length);
    this.rows = [];
    const body = xml.slice(open, close);
    const rowRe = /<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g;
    const cellRe = /<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(body))) {
      const ra = m[1];
      const r = Number(getAttr(ra, 'r'));
      const cells: Cell[] = [];
      if (m[3]) {
        let cm: RegExpExecArray | null;
        cellRe.lastIndex = 0;
        while ((cm = cellRe.exec(m[3]))) {
          const ref = getAttr(cm[1], 'r')!;
          cells.push({ col: splitRef(ref).col, attrs: setAttr(cm[1], 'r', null).trim(), inner: cm[3] ?? '' });
        }
      }
      this.rows.push({ r, attrs: setAttr(setAttr(ra, 'r', null), 'spans', null).trim(), cells });
    }
    this.expandShared();
  }

  /** 공유 수식(t="shared")을 셀마다 풀어 둡니다. 행 삽입·복사를 안전하게 하기 위함 */
  private expandShared() {
    const masters = new Map<string, { f: string; row: number; col: number }>();
    for (const row of this.rows)
      for (const c of row.cells) {
        const m = c.inner.match(/<f\b([^>]*)>([\s\S]*?)<\/f>/);
        if (m && /t="shared"/.test(m[1])) {
          const si = getAttr(m[1], 'si')!;
          masters.set(si, { f: unescXml(m[2]), row: row.r, col: c.col });
        }
      }
    if (!masters.size) return;
    for (const row of this.rows)
      for (const c of row.cells) {
        const m = c.inner.match(/<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/);
        if (!m || !/t="shared"/.test(m[1])) continue;
        const ms = masters.get(getAttr(m[1], 'si')!);
        if (!ms) continue;
        const f = translateFormula(ms.f, row.r - ms.row, c.col - ms.col);
        c.inner = c.inner.replace(m[0], `<f>${escXml(f)}</f>`);
      }
  }

  // ---------- 조회 ----------
  private idx: Map<number, Row> | null = null;
  private index() {
    if (!this.idx) this.idx = new Map(this.rows.map((x) => [x.r, x]));
    return this.idx;
  }
  rowIndex(r: number) {
    return this.rows.findIndex((x) => x.r === r);
  }
  getRow(r: number): Row | undefined {
    return this.index().get(r);
  }
  private placeRow(row: Row) {
    const last = this.rows[this.rows.length - 1];
    if (!last || last.r < row.r) this.rows.push(row);
    else {
      const old = this.rowIndex(row.r);
      if (old >= 0) this.rows[old] = row;
      else this.rows.splice(this.rows.findIndex((x) => x.r > row.r), 0, row);
    }
    this.index().set(row.r, row);
  }
  ensureRow(r: number): Row {
    let row = this.getRow(r);
    if (!row) {
      row = { r, attrs: '', cells: [] };
      this.placeRow(row);
    }
    return row;
  }
  getCell(r: number, col: number): Cell | undefined {
    return this.getRow(r)?.cells.find((c) => c.col === col);
  }
  ensureCell(r: number, col: number): Cell {
    const row = this.ensureRow(r);
    let c = row.cells.find((x) => x.col === col);
    if (!c) {
      c = { col, attrs: '', inner: '' };
      const idx = row.cells.findIndex((x) => x.col > col);
      if (idx < 0) row.cells.push(c);
      else row.cells.splice(idx, 0, c);
    }
    return c;
  }
  get maxRow() {
    return this.rows.length ? this.rows[this.rows.length - 1].r : 0;
  }
  /** 값이 있는 마지막 행 (지정 열 기준) */
  lastRowWithValue(col: number) {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const c = this.rows[i].cells.find((x) => x.col === col);
      if (c && this.value(this.rows[i].r, col) !== '') return this.rows[i].r;
    }
    return 0;
  }

  /** 셀 값 (공유 문자열·인라인 문자열·숫자). 수식은 계산 결과(<v>)가 있으면 그 값 */
  value(r: number, col: number | string): string | number {
    const cn = typeof col === 'string' ? colToNum(col) : col;
    const c = this.getCell(r, cn);
    if (!c) return '';
    return cellValue(c, this.sst);
  }
  str(r: number, col: number | string) {
    return String(this.value(r, col)).trim();
  }
  formula(r: number, col: number | string): string | null {
    const cn = typeof col === 'string' ? colToNum(col) : col;
    const c = this.getCell(r, cn);
    const m = c?.inner.match(/<f\b[^>]*>([\s\S]*?)<\/f>/);
    return m ? unescXml(m[1]) : null;
  }
  style(r: number, col: number): string | undefined {
    return getAttr(this.getCell(r, col)?.attrs ?? '', 's');
  }

  // ---------- 쓰기 ----------
  setNumber(r: number, col: number | string, v: number | null) {
    const c = this.ensureCell(r, typeof col === 'string' ? colToNum(col) : col);
    c.attrs = setAttr(c.attrs, 't', null).trim();
    c.inner = v == null || !Number.isFinite(v) ? '' : `<v>${v}</v>`;
  }
  setString(r: number, col: number | string, v: string) {
    const c = this.ensureCell(r, typeof col === 'string' ? colToNum(col) : col);
    if (v === '') {
      c.attrs = setAttr(c.attrs, 't', null).trim();
      c.inner = '';
      return;
    }
    c.attrs = setAttr(c.attrs, 't', 'inlineStr').trim();
    const sp = /^\s|\s$|\n/.test(v) ? ' xml:space="preserve"' : '';
    c.inner = `<is><t${sp}>${escXml(v)}</t></is>`;
  }
  /** 숫자처럼 보이면 숫자로, 아니면 문자열로 */
  setAuto(r: number, col: number, v: string | number | null) {
    if (v == null || v === '') return this.setString(r, col, '');
    if (typeof v === 'number') return this.setNumber(r, col, v);
    this.setString(r, col, v);
  }
  setFormula(r: number, col: number | string, f: string) {
    const c = this.ensureCell(r, typeof col === 'string' ? colToNum(col) : col);
    c.attrs = setAttr(c.attrs, 't', null).trim();
    c.inner = `<f>${escXml(f)}</f>`; // 계산 결과는 비움 → 엑셀이 열 때 다시 계산
  }
  clear(r: number, col: number) {
    const c = this.getCell(r, col);
    if (c) {
      c.attrs = setAttr(c.attrs, 't', null).trim();
      c.inner = '';
    }
  }
  removeCell(r: number, col: number) {
    const row = this.getRow(r);
    if (row) row.cells = row.cells.filter((c) => c.col !== col);
  }
  removeRow(r: number) {
    const i = this.rowIndex(r);
    if (i >= 0) this.rows.splice(i, 1);
    this.idx = null;
  }
  setStyle(r: number, col: number, s: string | undefined) {
    const c = this.ensureCell(r, col);
    c.attrs = setAttr(c.attrs, 's', s ?? null).trim();
  }
  setRowHidden(r: number, hidden: boolean) {
    const row = this.ensureRow(r);
    row.attrs = setAttr(row.attrs, 'hidden', hidden ? '1' : null).trim();
  }
  isHidden(r: number) {
    return getAttr(this.getRow(r)?.attrs ?? '', 'hidden') === '1';
  }

  /** 행 전체 서식(행 속성 + 각 셀 s) 을 from 행에서 to 행으로 복사. 값은 그대로 */
  copyRowStyle(from: number, to: number, keepHidden = true) {
    const src = this.getRow(from);
    if (!src) return;
    const dst = this.ensureRow(to);
    const hidden = getAttr(dst.attrs, 'hidden');
    dst.attrs = setAttr(src.attrs, 'hidden', keepHidden ? hidden ?? null : getAttr(src.attrs, 'hidden') ?? null).trim();
    for (const sc of src.cells) this.setStyle(to, sc.col, getAttr(sc.attrs, 's'));
  }

  /** 행 복사 (서식·수식 이동, 값 포함). 대상 행은 새로 만듭니다 */
  cloneRow(from: number, to: number) {
    const src = this.getRow(from);
    if (!src) return this.ensureRow(to);
    const row: Row = {
      r: to,
      attrs: src.attrs,
      cells: src.cells.map((c) => {
        let inner = c.inner;
        const fm = inner.match(/<f\b([^>]*)>([\s\S]*?)<\/f>/);
        if (fm) inner = `<f>${escXml(translateFormula(unescXml(fm[2]), to - from, 0))}</f>`;
        return { col: c.col, attrs: c.attrs, inner };
      }),
    };
    this.placeRow(row);
    return row;
  }

  /** 수식 안의 특정 행 번호를 바꿈 (증감 행의 당월·전월 참조 갱신용) */
  remapFormulaRows(r: number, map: Record<number, number>) {
    const row = this.getRow(r);
    if (!row) return;
    for (const c of row.cells) {
      const fm = c.inner.match(/<f\b([^>]*)>([\s\S]*?)<\/f>/);
      if (!fm) continue;
      const f = mapRefs(unescXml(fm[2]), (s, ref) => (s && s !== this.name ? ref : { col: ref.col, row: map[ref.row] ?? ref.row }));
      c.inner = `<f>${escXml(f)}</f>`;
    }
  }

  /** at 행 위에 n 행 삽입 (이 시트 안의 수식·병합·필터 범위 보정). 다른 시트·차트는 Workbook 이 처리 */
  insertRows(at: number, n: number) {
    for (const row of this.rows) if (row.r >= at) row.r += n;
    this.idx = null;
    for (const row of this.rows)
      for (const c of row.cells) {
        const fm = c.inner.match(/<f\b([^>]*)>([\s\S]*?)<\/f>/);
        if (!fm) continue;
        const f = shiftFormulaRows(unescXml(fm[2]), this.name, this.name, at, n);
        c.inner = c.inner.replace(fm[0], `<f${fm[1]}>${escXml(f)}</f>`);
      }
    const shiftAttrRefs = (xml: string) =>
      xml
        .replace(/(<mergeCell ref=")([^"]+)"/g, (_w, p, ref) => `${p}${shiftSqref(ref, at, n)}"`)
        .replace(/(<(?:conditionalFormatting|dataValidation|selection)\b[^>]*\bsqref=")([^"]+)"/g, (_w, p, ref) => `${p}${shiftSqref(ref, at, n)}"`)
        .replace(/(<autoFilter ref=")([^"]+)"/g, (_w, p, ref) => `${p}${shiftSqref(ref, at, n)}"`)
        .replace(/(<(?:sortState|sortCondition)\b[^>]*\bref=")([^"]+)"/g, (_w, p, ref) => `${p}${shiftSqref(ref, at, n)}"`)
        .replace(/(<hyperlink\b[^>]*\bref=")([^"]+)"/g, (_w, p, ref) => `${p}${shiftSqref(ref, at, n)}"`)
        .replace(/(<pane\b[^>]*\btopLeftCell=")([^"]+)"/g, (_w, p, ref) => `${p}${shiftSqref(ref, at, n)}"`)
        .replace(/(<selection\b[^>]*\bactiveCell=")([^"]+)"/g, (_w, p, ref) => `${p}${shiftSqref(ref, at, n)}"`);
    this.head = shiftAttrRefs(this.head);
    this.tail = shiftAttrRefs(this.tail);
  }

  /** 자동 필터 범위의 끝 행 변경 */
  setAutoFilterEnd(lastRow: number) {
    const re = /(<autoFilter ref="[A-Z]+\d+:[A-Z]+)(\d+)"/;
    this.tail = this.tail.replace(re, (_w, p) => `${p}${lastRow}"`);
    this.head = this.head.replace(re, (_w, p) => `${p}${lastRow}"`);
  }

  /** 자동 필터에 걸린 조건 { 열번호: 허용값[] } (간단한 값 목록 필터만) */
  autoFilterConditions(): { firstCol: number; conds: Map<number, Set<string>> } | null {
    const m = (this.head + this.tail).match(/<autoFilter ref="([A-Z]+)\d+:[A-Z]+\d+"[^>]*>([\s\S]*?)<\/autoFilter>/);
    if (!m) return null;
    const firstCol = colToNum(m[1]);
    const conds = new Map<number, Set<string>>();
    const fcRe = /<filterColumn colId="(\d+)"[^>]*>([\s\S]*?)<\/filterColumn>/g;
    let fc: RegExpExecArray | null;
    while ((fc = fcRe.exec(m[2]))) {
      const vals = [...fc[2].matchAll(/<filter val="([^"]*)"/g)].map((x) => unescXml(x[1]));
      if (vals.length) conds.set(firstCol + Number(fc[1]), new Set(vals));
    }
    return { firstCol, conds };
  }

  toXml(): string {
    let maxCol = 1;
    let minCol = 16384;
    const rowsXml = this.rows
      .sort((a, b) => a.r - b.r)
      .map((row) => {
        row.cells.sort((a, b) => a.col - b.col);
        const cells = row.cells
          .map((c) => {
            maxCol = Math.max(maxCol, c.col);
            minCol = Math.min(minCol, c.col);
            if (c.inner.includes('<f')) {
              // 수식의 예전 계산 결과는 지움 → 엑셀·뷰어가 열 때 새로 계산 (지난달 숫자가 남아 보이지 않도록)
              c.inner = c.inner.replace(/<v>[\s\S]*?<\/v>/, '');
              c.attrs = setAttr(c.attrs, 't', null).trim();
            }
            const a = c.attrs ? ` ${c.attrs}` : '';
            return c.inner ? `<c r="${cellRef(c.col, row.r)}"${a}>${c.inner}</c>` : `<c r="${cellRef(c.col, row.r)}"${a}/>`;
          })
          .join('');
        const a = row.attrs ? ` ${row.attrs}` : '';
        return cells ? `<row r="${row.r}"${a}>${cells}</row>` : `<row r="${row.r}"${a}/>`;
      })
      .join('');
    const last = this.maxRow || 1;
    const head = this.head.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="${cellRef(Math.min(minCol, 1), 1)}:${cellRef(maxCol, last)}"/>`);
    return `${head}<sheetData>${rowsXml}</sheetData>${this.tail}`;
  }
}

export function cellValue(c: Cell, sst: string[]): string | number {
  const t = getAttr(c.attrs, 't');
  if (t === 'inlineStr') {
    const ts = [...c.inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescXml(m[1]));
    return ts.join('');
  }
  const v = c.inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
  if (v == null) return '';
  if (t === 's') return sst[Number(v)] ?? '';
  if (t === 'str' || t === 'e') return unescXml(v);
  if (t === 'b') return v === '1' ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : unescXml(v);
}

export function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml))) {
    // 윗주(rPh)는 제외하고 본문 텍스트만
    const body = m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    out.push([...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => unescXml(x[1])).join(''));
  }
  return out;
}
