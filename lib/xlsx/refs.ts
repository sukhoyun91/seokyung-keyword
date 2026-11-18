/** 엑셀 셀 주소·수식 참조 처리 (브라우저·서버 공용) */

export function colToNum(col: string): number {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function numToCol(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function splitRef(ref: string): { col: number; row: number } {
  const m = ref.match(/^\$?([A-Z]{1,3})\$?(\d+)$/);
  if (!m) throw new Error(`잘못된 셀 주소: ${ref}`);
  return { col: colToNum(m[1]), row: Number(m[2]) };
}

export const cellRef = (col: number, row: number) => `${numToCol(col)}${row}`;

/** 시트 이름 비교용: 'a''b' → a'b */
export function unquoteSheet(s: string): string {
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

export function quoteSheet(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

/**
 * 수식 안의 셀 참조를 하나씩 바꿉니다. 문자열 리터럴("...")은 건드리지 않습니다.
 * fn(sheet|null, colAbs, col, rowAbs, row) → 새 [col,row] (그대로면 같은 값)
 */
type RefFn = (sheet: string | null, c: { col: number; row: number; colAbs: boolean; rowAbs: boolean }, part: 'single' | 'start' | 'end') => { col: number; row: number };

const REF_RE =
  /((?:'(?:[^']|'')+'|[A-Za-z0-9_.\u3131-\uD79D]+)!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?/g;

export function mapRefs(formula: string, fn: RefFn): string {
  // 문자열 리터럴("...")은 건드리지 않음
  const parts = formula.split(/("(?:[^"]|"")*")/);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part.replace(REF_RE, (whole, sheetPart, ca, c, ra, r, ca2, c2, ra2, r2, offset: number, str: string) => {
        const before = str[offset - 1] ?? '';
        const after = str[offset + whole.length] ?? '';
        if (!sheetPart && /[A-Za-z0-9_.\u3131-\uD79D]/.test(before)) return whole; // 이름의 일부
        if (/[A-Za-z0-9_(!]/.test(after)) return whole; // 함수 이름(LOG10( 등)
        const sheet = sheetPart ? unquoteSheet(sheetPart.slice(0, -1)) : null;
        return build(sheetPart ?? '', sheet, ca, c, ra, r, ca2, c2, ra2, r2, fn);
      });
    })
    .join('');
}

function build(prefix: string, sheet: string | null, ca: string, c: string, ra: string, r: string, ca2: string | undefined, c2: string | undefined, ra2: string | undefined, r2: string | undefined, fn: RefFn) {
  const a = { col: colToNum(c), row: Number(r), colAbs: ca === '$', rowAbs: ra === '$' };
  if (c2 === undefined) {
    const n = fn(sheet, a, 'single');
    return `${prefix}${ca}${numToCol(n.col)}${ra}${n.row}`;
  }
  const b = { col: colToNum(c2), row: Number(r2), colAbs: ca2 === '$', rowAbs: ra2 === '$' };
  const n1 = fn(sheet, a, 'start');
  const n2 = fn(sheet, b, 'end');
  return `${prefix}${ca}${numToCol(n1.col)}${ra}${n1.row}:${ca2}${numToCol(n2.col)}${ra2}${n2.row}`;
}

/** 수식을 dr행·dc열 옮긴 위치로 복사 (상대 참조만 이동) */
export function translateFormula(formula: string, dr: number, dc: number): string {
  if (!dr && !dc) return formula;
  return mapRefs(formula, (_s, c) => ({ col: c.colAbs ? c.col : c.col + dc, row: c.rowAbs ? c.row : c.row + dr }));
}

/**
 * 시트 sheetName 의 at행 위에 n행을 끼워 넣었을 때 수식 참조 보정
 * ownSheet: 수식이 들어 있는 시트 이름 (시트 이름 없는 참조의 기준)
 */
export function shiftFormulaRows(formula: string, ownSheet: string, sheetName: string, at: number, n: number): string {
  return mapRefs(formula, (s, c) => {
    const target = s ?? ownSheet;
    if (target !== sheetName) return c;
    return { col: c.col, row: c.row >= at ? c.row + n : c.row };
  });
}

/** "A1:B5 C3" 같은 sqref 의 행 보정 */
export function shiftSqref(sqref: string, at: number, n: number): string {
  return sqref
    .split(/\s+/)
    .filter(Boolean)
    .map((part) =>
      part.replace(/(\$?[A-Z]{1,3}\$?)(\d+)/g, (_w, c, r) => `${c}${Number(r) >= at ? Number(r) + n : Number(r)}`),
    )
    .join(' ');
}

export const escXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const unescXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_w, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_w, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
