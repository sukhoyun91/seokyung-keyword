/** 수집 출처 종류: 관광공사 공식 / 지자체 웹사이트 / 뉴스 */
export type SourceKind = 'tour' | 'std' | 'gov' | 'sns' | 'news';

export const KIND_LABEL: Record<SourceKind, string> = {
  tour: '관광공사 TourAPI',
  std: '문화축제 표준데이터',
  gov: '지자체 웹사이트',
  sns: '지자체 인스타그램',
  news: '뉴스',
};

export interface EvSource {
  id: string; // S1, S2 ...
  kind: SourceKind;
  title: string;
  url: string;
  publisher: string; // 도메인 또는 언론사
  date: string; // 게시일 (YYYY-MM-DD, 모르면 '')
  snippet: string; // 근거 원문 (요약·인용)
  region?: string;
  query?: string;
  organizer?: string;
  homepage?: string;
  lastYear?: boolean; // 표준데이터에 작년 일정만 있음
  // TourAPI·표준데이터 공식 정보
  eventStart?: string; // YYYY-MM-DD
  eventEnd?: string;
  addr?: string;
  tel?: string;
}

export type Trust = 'official' | 'cross' | 'check';
export const TRUST_LABEL: Record<Trust, string> = {
  official: '공식 확인',
  cross: '복수 출처',
  check: '확인 필요',
};

export interface EvItem {
  name: string;
  start: string; // YYYY-MM-DD 또는 ''
  end: string;
  dateText: string; // 원문 표기 (예: 12월 첫째 주말)
  region: string;
  venue: string;
  organizer: string;
  category: string;
  summary: string;
  sourceIds: string[];
  trust: Trust;
  dateVerified: boolean; // 근거 원문에서 날짜 확인 여부
  notes: string[]; // 검증 메모 (불일치 등)
}

export interface EvResult {
  overview: string;
  events: EvItem[];
  excluded: { name: string; reason: string; sourceIds: string[] }[];
  conflicts: { event: string; detail: string; sourceIds: string[] }[];
  related: { sourceId: string; why: string }[];
  model: string;
  generatedAt: string;
}

export type StepKey = 'tour' | 'std' | 'news' | 'gov' | 'sns' | 'summarize';
export const STEP_LABEL: Record<StepKey, string> = {
  tour: '관광공사 공식 축제 정보',
  std: '전국문화축제 표준데이터 (지자체 등록)',
  news: '네이버 뉴스 기사',
  gov: '지자체 웹사이트 (AI 웹 검색)',
  sns: '지자체 인스타그램',
  summarize: 'AI 정리 및 검증',
};

export interface StepState {
  status: 'pending' | 'running' | 'done' | 'skipped' | 'error';
  count?: number;
  message?: string;
  at?: string;
  debug?: any; // 진단 기록 (지자체 검색 과정)
}

export interface EvReport {
  id: number;
  title: string;
  period_start: string;
  period_end: string;
  regions: string[];
  keywords: string[];
  options: { tour: boolean; std?: boolean; news: boolean; gov: boolean; sns?: boolean; extra: string; sido?: string };
  status: 'collecting' | 'done' | 'error';
  steps: Partial<Record<StepKey, StepState>>;
  sources: EvSource[];
  result: EvResult | null;
  memo: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export const BASE_KEYWORDS = ['축제', '행사'];
