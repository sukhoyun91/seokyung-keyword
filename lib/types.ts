export interface ResultRow {
  rank: number;
  keyword: string;
  type: string;
  source: 'AI 생성' | '네이버 연관';
  pc: number;
  mobile: number;
  total: number;
  pcLabel: string;
  mobileLabel: string;
  comp: string;
  hasData: boolean;
  /** 영역별 서경방송 노출 순위: 숫자=순위, null=100위 밖, 'error'=조회 실패 */
  exposure?: Partial<Record<string, number | null | 'error'>>;
}

export interface AnalyzeResponse {
  meta: { source: string; analyzedAt: string; analyst: string; requested: number; candidates: number; naver: boolean; exposureAreas: { key: string; label: string }[] };
  ai: { subject: string; summary: string; detectedText: string[]; englishKeywords: string[]; hashtags: string[]; uncertain: string[] };
  rows: ResultRow[];
  warnings: string[];
}
