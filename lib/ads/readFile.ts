'use client';
import { parseCsv, parseTable, type ParsedFile } from './parse';

/** UTF-8로 읽고, 한글이 깨지면 EUC-KR로 다시 읽기 */
function decodeText(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (!utf8.includes('�')) return utf8;
  try {
    return new TextDecoder('euc-kr').decode(buf);
  } catch {
    return utf8;
  }
}

function cellValue(v: any): unknown {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v;
    if ('result' in v) return v.result; // 수식
    if ('richText' in v) return v.richText.map((t: any) => t.text).join('');
    if ('text' in v) return v.text; // 하이퍼링크
  }
  return v;
}

/** 브라우저에서 csv/xlsx 파일을 읽어 정리 (서버로는 정리된 행만 전송) */
export async function readAdFile(file: File): Promise<ParsedFile> {
  const buf = await file.arrayBuffer();
  const name = file.name;
  const isXlsx = /\.xlsx$/i.test(name) || new Uint8Array(buf.slice(0, 2)).join(',') === '80,75'; // "PK" (zip)
  if (/\.xls$/i.test(name) && !isXlsx) {
    throw new Error(`${name}: 예전 엑셀 형식(.xls)은 읽을 수 없습니다. xlsx 또는 csv로 저장해 올려 주세요.`);
  }
  if (isXlsx) {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error(`${name}: 시트가 없습니다.`);
    const table: unknown[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values as any[];
      table.push(values.slice(1).map(cellValue));
    });
    return parseTable(table, name);
  }
  return parseTable(parseCsv(decodeText(buf)), name);
}
