/**
 * xlsx 파일을 압축 안의 XML 그대로 고쳐 쓰는 작업대.
 * 차트·피벗·슬라이서·메모 등 손대지 않는 부분은 원본 바이트 그대로 보존됩니다.
 */
import JSZip from 'jszip';
import { escXml, mapRefs, quoteSheet, shiftFormulaRows, shiftSqref, unescXml } from './refs';
import { Sheet, parseSharedStrings } from './sheet';

interface SheetInfo {
  name: string;
  path: string; // xl/worksheets/sheetN.xml
  rid: string;
}

const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/') + 1);
function resolve(base: string, target: string) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = (dirOf(base) + target).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.') out.push(p);
  }
  return out.join('/');
}
const relsPathOf = (p: string) => `${dirOf(p)}_rels/${p.slice(p.lastIndexOf('/') + 1)}.rels`;

export class Workbook {
  zip: JSZip;
  sheets: SheetInfo[] = [];
  sst: string[] = [];
  private texts = new Map<string, string>(); // 고친 XML (경로 → 내용)
  private loaded = new Map<string, Sheet>(); // 시트 이름 → 모델

  private constructor(zip: JSZip) {
    this.zip = zip;
  }

  static async open(data: ArrayBuffer | Uint8Array): Promise<Workbook> {
    const zip = await JSZip.loadAsync(data);
    const wb = new Workbook(zip);
    await wb.init();
    return wb;
  }

  async text(path: string): Promise<string | null> {
    if (this.texts.has(path)) return this.texts.get(path)!;
    const f = this.zip.file(path);
    if (!f) return null;
    const t = await f.async('string');
    this.texts.set(path, t);
    return t;
  }
  setText(path: string, xml: string) {
    this.texts.set(path, xml);
    this.dirty.add(path);
  }
  private dirty = new Set<string>();

  private async init() {
    const wbXml = (await this.text('xl/workbook.xml'))!;
    const rels = (await this.text('xl/_rels/workbook.xml.rels'))!;
    const relMap = new Map<string, string>();
    for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const id = m[1].match(/\bId="([^"]+)"/)?.[1];
      const t = m[1].match(/\bTarget="([^"]+)"/)?.[1];
      if (id && t) relMap.set(id, resolve('xl/workbook.xml', t));
    }
    for (const m of wbXml.matchAll(/<sheet\b([^>]*)\/>/g)) {
      const name = unescXml(m[1].match(/\bname="([^"]*)"/)![1]);
      const rid = m[1].match(/\br:id="([^"]+)"/)![1];
      this.sheets.push({ name, rid, path: relMap.get(rid)! });
    }
    this.sst = parseSharedStrings(await this.text('xl/sharedStrings.xml'));
  }

  info(name: string) {
    const s = this.sheets.find((x) => x.name === name);
    if (!s) throw new Error(`엑셀에 '${name}' 시트가 없습니다.`);
    return s;
  }
  /** 이름이 패턴에 맞는 첫 시트 */
  findSheet(re: RegExp) {
    return this.sheets.find((s) => re.test(s.name))?.name ?? null;
  }

  async sheet(name: string): Promise<Sheet> {
    const cached = this.loaded.get(name);
    if (cached) return cached;
    const info = this.info(name);
    const xml = (await this.text(info.path))!;
    const sh = new Sheet(xml, name, this.sst);
    this.loaded.set(name, sh);
    return sh;
  }

  /** 시트의 관계 파일 (drawing, comments, vmlDrawing 등) */
  private async sheetRels(name: string): Promise<{ type: string; path: string }[]> {
    const info = this.info(name);
    const rels = await this.text(relsPathOf(info.path));
    if (!rels) return [];
    return [...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)]
      .map((m) => ({
        type: m[1].match(/\bType="([^"]+)"/)?.[1] ?? '',
        path: resolve(info.path, m[1].match(/\bTarget="([^"]+)"/)?.[1] ?? ''),
        external: /TargetMode="External"/.test(m[1]),
      }))
      .filter((r) => !r.external);
  }

  /**
   * 시트 name 의 at 행 위에 n 행 삽입. 이 시트를 가리키는 다른 시트 수식, 이름 정의, 차트 범위,
   * 피벗 원본, 그림·메모 위치까지 함께 보정합니다.
   * extendChartRanges: 차트 범위가 at-1 행에서 끝나면 늘려서 새 행까지 포함
   */
  async insertRows(name: string, at: number, n: number, opts: { extendChartRanges?: boolean } = {}) {
    const sh = await this.sheet(name);
    sh.insertRows(at, n);

    // 다른 시트의 수식
    const quoted = quoteSheet(name);
    for (const s of this.sheets) {
      if (s.name === name) continue;
      const loaded = this.loaded.get(s.name);
      if (!loaded) {
        const xml = await this.text(s.path);
        if (!xml || !xml.includes(escXml(quoted) + '!')) continue;
      }
      const other = await this.sheet(s.name);
      for (const row of other.rows)
        for (const c of row.cells) {
          const fm = c.inner.match(/<f\b([^>]*)>([\s\S]*?)<\/f>/);
          if (!fm) continue;
          const f0 = unescXml(fm[2]);
          const f = shiftFormulaRows(f0, s.name, name, at, n);
          if (f !== f0) c.inner = `<f${fm[1]}>${escXml(f)}</f>`; // 계산 결과 제거
        }
    }

    // 이름 정의
    let wbXml = (await this.text('xl/workbook.xml'))!;
    wbXml = wbXml.replace(/(<definedName\b[^>]*>)([^<]*)(<\/definedName>)/g, (_w, a, body, b) => {
      const f = shiftFormulaRows(unescXml(body), '\u0000', name, at, n);
      return a + escXml(f) + b;
    });
    this.setText('xl/workbook.xml', wbXml);

    // 차트
    for (const path of Object.keys(this.zip.files).filter((p) => /^xl\/charts\/chart\d+\.xml$/.test(p))) {
      const xml = (await this.text(path))!;
      let changed = false;
      const out = xml.replace(/(<c:f>)([^<]*)(<\/c:f>)/g, (_w, a, body, b) => {
        const f0 = unescXml(body);
        const f = mapRefs(f0, (s, c, part) => {
          if (s !== name) return c;
          if (c.row >= at) return { col: c.col, row: c.row + n };
          if (opts.extendChartRanges && part === 'end' && c.row === at - 1) return { col: c.col, row: c.row + n };
          return c;
        });
        if (f !== f0) changed = true;
        return a + escXml(f) + b;
      });
      if (changed) this.setText(path, out);
    }

    // 피벗 원본
    for (const path of Object.keys(this.zip.files).filter((p) => /^xl\/pivotCache\/pivotCacheDefinition\d+\.xml$/.test(p))) {
      const xml = (await this.text(path))!;
      const out = xml.replace(/<worksheetSource ref="([^"]+)" sheet="([^"]+)"/, (w, ref, sheet) =>
        unescXml(sheet) === name ? `<worksheetSource ref="${shiftSqref(ref, at, n)}" sheet="${sheet}"` : w,
      );
      if (out !== xml) this.setText(path, out);
    }

    // 그림·메모 위치
    for (const rel of await this.sheetRels(name)) {
      const xml = await this.text(rel.path);
      if (!xml) continue;
      let out = xml;
      if (/\/drawing$/.test(rel.type)) {
        out = xml.replace(/(<xdr:(?:from|to)>[\s\S]*?<xdr:row>)(\d+)(<\/xdr:row>)/g, (_w, a, r, b) =>
          a + (Number(r) + 1 >= at ? Number(r) + n : Number(r)) + b,
        );
      } else if (/\/comments$/.test(rel.type) || /threadedComment/.test(rel.type)) {
        out = xml.replace(/(\bref=")([A-Z]+\d+)"/g, (_w, a, ref) => `${a}${shiftSqref(ref, at, n)}"`);
      } else if (/vmlDrawing$/.test(rel.type)) {
        out = xml.replace(/(<x:Row>)(\d+)(<\/x:Row>)/g, (_w, a, r, b) => a + (Number(r) + 1 >= at ? Number(r) + n : Number(r)) + b);
      }
      if (out !== xml) this.setText(rel.path, out);
    }
  }

  /**
   * 차트 데이터 범위 맞추기: sheetName 의 firstRow 에서 시작해 lastRow 보다 앞에서 끝나는 범위를 lastRow 까지 늘림.
   * 숨긴 행은 차트에 그려지지 않으므로(plotVisOnly) 미리 만든 빈 달 행까지 포함해도 됩니다.
   * 늘린 범위 개수를 돌려줌
   */
  async alignChartRanges(sheetName: string, firstRow: number, lastRow: number): Promise<number> {
    let count = 0;
    for (const path of Object.keys(this.zip.files).filter((p) => /^xl\/charts\/chart\d+\.xml$/.test(p))) {
      const xml = (await this.text(path))!;
      const out = xml.replace(/(<c:f>)([^<]*)(<\/c:f>)/g, (w, a, body, b) => {
        const f0 = unescXml(body);
        let start = 0;
        const f = mapRefs(f0, (s, c, part) => {
          if (s !== sheetName) return c;
          if (part === 'start') start = c.row;
          if (part === 'end' && start === firstRow && c.row < lastRow) return { col: c.col, row: lastRow };
          return c;
        });
        if (f === f0) return w;
        count++;
        return a + escXml(f) + b;
      });
      if (out !== xml) this.setText(path, out);
    }
    return count;
  }

  /** 시트 이름 변경 (이름 정의·문서 속성 포함) */
  async renameSheet(oldName: string, newName: string) {
    if (oldName === newName) return;
    if (this.sheets.some((s) => s.name === newName)) throw new Error(`'${newName}' 시트가 이미 있습니다.`);
    const info = this.info(oldName);
    const sh = this.loaded.get(oldName);
    let wbXml = (await this.text('xl/workbook.xml'))!;
    wbXml = wbXml.replace(`<sheet name="${escXml(oldName)}"`, `<sheet name="${escXml(newName)}"`);
    wbXml = wbXml.split(escXml(quoteSheet(oldName)) + '!').join(escXml(quoteSheet(newName)) + '!');
    this.setText('xl/workbook.xml', wbXml);
    const app = await this.text('docProps/app.xml');
    if (app) this.setText('docProps/app.xml', app.split(`<vt:lpstr>${escXml(oldName)}</vt:lpstr>`).join(`<vt:lpstr>${escXml(newName)}</vt:lpstr>`));
    info.name = newName;
    if (sh) {
      this.loaded.delete(oldName);
      (sh as any).name = newName;
      this.loaded.set(newName, sh);
    }
    // 다른 시트·차트 수식 안의 시트 이름
    for (const s of this.sheets) {
      const xml = this.loaded.has(s.name) ? null : await this.text(s.path);
      if (xml && !xml.includes(escXml(quoteSheet(oldName)) + '!')) continue;
      const other = await this.sheet(s.name);
      for (const row of other.rows)
        for (const c of row.cells) c.inner = c.inner.split(escXml(quoteSheet(oldName)) + '!').join(escXml(quoteSheet(newName)) + '!');
    }
  }

  /** 정의된 이름(_FilterDatabase 등) 범위 끝 행 변경 */
  async setDefinedNameEnd(sheetName: string, defName: string, lastRow: number) {
    const wbXml = (await this.text('xl/workbook.xml'))!;
    const q = escXml(quoteSheet(sheetName));
    const re = new RegExp(`(<definedName name="${defName}"[^>]*>${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}!\\$[A-Z]+\\$\\d+:\\$[A-Z]+\\$)(\\d+)(</definedName>)`);
    this.setText('xl/workbook.xml', wbXml.replace(re, (_w, a, _r, b) => `${a}${lastRow}${b}`));
  }

  /** 피벗 원본 범위 끝 행 + 열 때 새로 고침 */
  async setPivotSourceEnd(sheetName: string, lastRow: number) {
    for (const path of Object.keys(this.zip.files).filter((p) => /^xl\/pivotCache\/pivotCacheDefinition\d+\.xml$/.test(p))) {
      const xml = (await this.text(path))!;
      let hit = false;
      let out = xml.replace(/<worksheetSource ref="([A-Z]+\d+:[A-Z]+)(\d+)" sheet="([^"]+)"/, (w, a, _r, sheet) => {
        if (unescXml(sheet) !== sheetName) return w;
        hit = true;
        return `<worksheetSource ref="${a}${lastRow}" sheet="${sheet}"`;
      });
      if (!hit) continue;
      if (!/refreshOnLoad="1"/.test(out)) out = out.replace(/<pivotCacheDefinition\b/, '<pivotCacheDefinition refreshOnLoad="1"');
      this.setText(path, out);
    }
  }

  /** 계산 체인 삭제 + 열 때 전체 다시 계산 */
  private async forceRecalc() {
    let wbXml = (await this.text('xl/workbook.xml'))!;
    if (/<calcPr\b/.test(wbXml)) {
      wbXml = wbXml.replace(/<calcPr\b([^>]*?)\/>/, (_w, a) => `<calcPr${a.replace(/\s*fullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"/>`);
    } else wbXml = wbXml.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');
    this.setText('xl/workbook.xml', wbXml);
    if (this.zip.file('xl/calcChain.xml')) {
      this.zip.remove('xl/calcChain.xml');
      const rels = (await this.text('xl/_rels/workbook.xml.rels'))!;
      this.setText('xl/_rels/workbook.xml.rels', rels.replace(/<Relationship\b[^>]*calcChain\.xml"[^>]*\/>/, ''));
      const ct = (await this.text('[Content_Types].xml'))!;
      this.setText('[Content_Types].xml', ct.replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ''));
    }
  }

  async save(): Promise<Uint8Array> {
    for (const [name, sh] of this.loaded) this.setText(this.info(name).path, sh.toXml());
    await this.forceRecalc();
    for (const path of this.dirty) this.zip.file(path, this.texts.get(path)!);
    return this.zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  }
}
