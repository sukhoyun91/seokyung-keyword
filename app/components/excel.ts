import type { AnalyzeResponse } from '@/lib/types';

const BRAND = 'FF0B5CAD';

/** 분석 결과를 엑셀(.xlsx)로 내려받기 — 브라우저에서 생성 (서버 저장 없음) */
export async function downloadExcel(result: AnalyzeResponse, thumbDataUrl: string | null) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = '서경방송 키워드 분석';
  wb.created = new Date();

  const when = new Date(result.meta.analyzedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  // ── 시트 1: 요약
  const s1 = wb.addWorksheet('요약');
  s1.columns = [{ width: 18 }, { width: 70 }];
  s1.addRow(['서경방송 검색 키워드 분석 결과']).font = { bold: true, size: 15 };
  s1.addRow([]);
  const info: [string, string][] = [
    ['분석 자료', result.meta.source],
    ['인식 대상', result.ai.subject],
    ['자료 요약', result.ai.summary],
    ['판독 문구', result.ai.detectedText.join(' / ')],
    ['분석 일시', when],
    ['분석자', result.meta.analyst],
    ['키워드 수', `${result.rows.length}개 (AI 후보 ${result.meta.candidates}개 중 검색량 순 선별)`],
    ['노출 순위', result.meta.exposureAreas.length ? `네이버 ${result.meta.exposureAreas.map((a) => a.label).join('·')} 검색 상위 100위 내 서경방송 순위` : '미조회'],
    ['검색량 기준', result.meta.naver ? '네이버 검색광고 키워드도구 월간 검색량(최근 30일, PC+모바일)' : '검색량 미조회'],
  ];
  for (const [k, v] of info) {
    const r = s1.addRow([k, v]);
    r.getCell(1).font = { bold: true };
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    r.getCell(1).alignment = { vertical: 'top' };
  }
  if (result.ai.uncertain.length) {
    const r = s1.addRow(['확인 필요', result.ai.uncertain.join(' / ')]);
    r.getCell(1).font = { bold: true, color: { argb: 'FFC0392B' } };
    r.getCell(2).alignment = { wrapText: true };
  }
  if (thumbDataUrl) {
    const m = thumbDataUrl.match(/^data:image\/(png|jpeg|jpg|gif);base64,(.+)$/);
    if (m) {
      const id = wb.addImage({ base64: m[2], extension: (m[1] === 'jpg' ? 'jpeg' : m[1]) as 'png' | 'jpeg' | 'gif' });
      const top = s1.rowCount + 1;
      s1.addRow(['원본 이미지']).getCell(1).font = { bold: true };
      s1.addImage(id, { tl: { col: 1, row: top - 1 }, ext: { width: 320, height: 320 } });
      for (let i = 0; i < 16; i++) s1.addRow([]);
    }
  }

  // ── 시트 2: 키워드 순위
  const s2 = wb.addWorksheet('키워드 순위', { views: [{ state: 'frozen', ySplit: 1 }] });
  s2.columns = [
    { header: '순위', key: 'rank', width: 7 },
    { header: '키워드', key: 'keyword', width: 30 },
    { header: '유형', key: 'type', width: 11 },
    { header: '출처', key: 'source', width: 12 },
    { header: 'PC 월간 검색량', key: 'pc', width: 15 },
    { header: '모바일 월간 검색량', key: 'mobile', width: 17 },
    { header: '합계', key: 'total', width: 12 },
    { header: '경쟁 정도', key: 'comp', width: 10 },
    ...result.meta.exposureAreas.map((a) => ({ header: `서경방송 ${a.label} 노출`, key: `ex_${a.key}`, width: 16 })),
  ];
  for (const r of result.rows) {
    s2.addRow({
      rank: r.rank, keyword: r.keyword, type: r.type, source: r.source,
      pc: r.pcLabel === '10 미만' ? '10 미만' : r.hasData ? r.pc : '-',
      mobile: r.mobileLabel === '10 미만' ? '10 미만' : r.hasData ? r.mobile : '-',
      total: r.hasData ? r.total : 0, comp: r.comp,
      ...Object.fromEntries(
        result.meta.exposureAreas.map((a) => {
          const v = r.exposure?.[a.key];
          return [`ex_${a.key}`, typeof v === 'number' ? `${v}위` : v === 'error' ? '조회 오류' : v === null ? '100위 밖' : '-'];
        }),
      ),
    });
  }
  const head = s2.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
  head.alignment = { vertical: 'middle', horizontal: 'center' };
  for (const c of ['pc', 'mobile', 'total']) s2.getColumn(c).numFmt = '#,##0';
  s2.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s2.columns.length } };
  s2.addRow([]);
  s2.addRow(['※ "10 미만"은 네이버가 정확한 수치를 제공하지 않는 검색량입니다. 합계 정렬 시 5로 환산했습니다.']).font = { italic: true, color: { argb: 'FF64708A' } };

  // ── 시트 3: 해시태그·영문
  const s3 = wb.addWorksheet('해시태그·영문');
  s3.columns = [{ header: 'SNS 해시태그', key: 'h', width: 30 }, { header: '영문 키워드(참고)', key: 'e', width: 34 }];
  const n = Math.max(result.ai.hashtags.length, result.ai.englishKeywords.length);
  for (let i = 0; i < n; i++) s3.addRow({ h: result.ai.hashtags[i] ?? '', e: result.ai.englishKeywords[i] ?? '' });
  s3.getRow(1).font = { bold: true };
  s3.addRow([]);
  s3.addRow([result.ai.hashtags.join(' ')]).getCell(1).alignment = { wrapText: true };

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const subject = (result.ai.subject || '키워드').replace(/[\\/:*?"<>|]/g, '').slice(0, 30);
  a.href = URL.createObjectURL(blob);
  a.download = `키워드분석_${subject}_${stamp}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
