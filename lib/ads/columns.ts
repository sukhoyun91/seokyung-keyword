/** 조회 화면·엑셀 다운로드 공용: 자료 종류별 열 (네이버 다차원 보고서와 같은 순서) */
import type { AdLevel } from './parse';

export interface DataRow {
  month: string;
  campaign_type: string;
  campaign: string;
  ad_group: string;
  dim: string;
  search_type: string;
  impressions: number;
  clicks: number;
  cost: number;
  avg_rank: number | null;
}

type TextKey = 'campaign_type' | 'campaign' | 'ad_group' | 'dim' | 'search_type';

export const LEVEL_TEXT_COLS: Record<AdLevel, { key: TextKey; label: string }[]> = {
  account: [],
  campaign: [{ key: 'campaign_type', label: '캠페인유형' }, { key: 'campaign', label: '캠페인' }],
  adgroup: [{ key: 'campaign', label: '캠페인' }, { key: 'ad_group', label: '광고그룹' }],
  media: [{ key: 'ad_group', label: '광고그룹' }, { key: 'dim', label: '검색/콘텐츠 매체' }],
  keyword: [{ key: 'ad_group', label: '광고그룹' }, { key: 'dim', label: '키워드' }],
  searchterm: [{ key: 'ad_group', label: '광고그룹' }, { key: 'dim', label: '검색어' }, { key: 'search_type', label: '검색 유형' }],
};

/** 계정·캠페인 보고서에는 평균노출순위가 없음 */
export const HAS_RANK: Record<AdLevel, boolean> = { account: false, campaign: false, adgroup: true, media: true, keyword: true, searchterm: false };

export const ctrOf = (r: { impressions: number; clicks: number }) => (r.impressions ? (r.clicks / r.impressions) * 100 : 0);
export const cpcOf = (r: { clicks: number; cost: number }) => (r.clicks ? r.cost / r.clicks : 0);
