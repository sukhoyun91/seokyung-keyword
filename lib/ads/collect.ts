/**
 * 네이버 API → 월 자료 (계정·캠페인·광고그룹·키워드). 매체·검색어는 파일 업로드로 받음
 * 행 모양은 CSV 업로드와 같게 맞춤 → 검색광고 보고서·조회·엑셀 다운로드가 그대로 동작
 */
import type { AdRow } from './parse';
import { listAdgroups, listCampaigns, listKeywords, statsFor, type AdsCreds, type Stat } from './naverAds';

export const API_LEVELS = ['account', 'campaign', 'adgroup', 'keyword'] as const;
export type ApiLevel = (typeof API_LEVELS)[number];

const TYPE_LABEL: Record<string, string> = {
  WEB_SITE: '파워링크',
  SHOPPING: '쇼핑검색',
  POWER_CONTENTS: '파워컨텐츠',
  BRAND_SEARCH: '브랜드검색',
  PLACE: '플레이스',
};

export interface CollectResult {
  month: string;
  since: string;
  until: string;
  rows: Record<ApiLevel, AdRow[]>;
  budgets: { ad_group: string; daily_budget: number }[];
  counts: { campaigns: number; adgroups: number; keywords: number; calls: number };
  warnings: string[];
}

const blank = { campaign_type: '', campaign: '', ad_group: '', dim: '', search_type: '' };
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

/** 그 달의 1일 ~ 말일 (이번 달이면 어제까지) — KST */
export function monthRange(month: string): { since: string; until: string } | null {
  const [y, m] = month.split('-').map(Number);
  const since = `${month}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let until = `${month}-${String(last).padStart(2, '0')}`;
  const nowKst = new Date(Date.now() + 9 * 3600_000);
  const yesterday = new Date(nowKst.getTime() - 86400_000).toISOString().slice(0, 10);
  if (until > yesterday) until = yesterday;
  if (until < since) return null;
  return { since, until };
}

export async function collectMonth(creds: AdsCreds, month: string): Promise<CollectResult> {
  const range = monthRange(month);
  if (!range) throw new Error(`${month}은(는) 아직 집계된 날이 없습니다. (오늘 자료는 다음 날부터 조회)`);
  const warnings: string[] = [];
  let calls = 0;

  const campaigns = await listCampaigns(creds);
  calls++;
  const adgroups = await listAdgroups(creds, campaigns);
  calls++;
  const campById = new Map(campaigns.map((c) => [c.nccCampaignId, c]));

  // 키워드 목록 (그룹별, 4개씩 동시에)
  const keywords: { kw: string; id: string; groupId: string }[] = [];
  for (let i = 0; i < adgroups.length; i += 4) {
    const part = await Promise.all(adgroups.slice(i, i + 4).map((g) => listKeywords(creds, g.nccAdgroupId)));
    calls += part.length;
    part.forEach((list, k) => list.forEach((x) => keywords.push({ kw: x.keyword, id: x.nccKeywordId, groupId: adgroups[i + k].nccAdgroupId })));
  }

  const ids = [...campaigns.map((c) => c.nccCampaignId), ...adgroups.map((g) => g.nccAdgroupId), ...keywords.map((k) => k.id)];
  const { stats, calls: statCalls } = await statsFor(creds, ids, range.since, range.until);
  calls += statCalls;
  const st = (id: string): Stat => stats.get(id) ?? { id };
  const has = (s: Stat) => num(s.impCnt) > 0 || num(s.clkCnt) > 0 || num(s.salesAmt) > 0;
  const rank = (s: Stat) => (num(s.avgRnk) > 0 ? Math.round(num(s.avgRnk) * 100) / 100 : null);

  const campaign: AdRow[] = [];
  for (const c of campaigns) {
    const s = st(c.nccCampaignId);
    if (!has(s)) continue;
    if (!TYPE_LABEL[c.campaignTp]) warnings.push(`캠페인 '${c.name}'의 유형(${c.campaignTp})은 이름표가 없어 그대로 저장했습니다.`);
    campaign.push({ ...blank, month, campaign_type: TYPE_LABEL[c.campaignTp] ?? c.campaignTp, campaign: c.name, impressions: num(s.impCnt), clicks: num(s.clkCnt), cost: Math.round(num(s.salesAmt)), avg_rank: rank(s) });
  }
  const account: AdRow[] = campaign.length
    ? [{ ...blank, month, impressions: campaign.reduce((a, r) => a + r.impressions, 0), clicks: campaign.reduce((a, r) => a + r.clicks, 0), cost: campaign.reduce((a, r) => a + r.cost, 0), avg_rank: null }]
    : [];

  const adgroup: AdRow[] = [];
  const keyword: AdRow[] = [];
  const budgets: CollectResult['budgets'] = [];
  const kwByGroup = new Map<string, typeof keywords>();
  for (const k of keywords) kwByGroup.set(k.groupId, [...(kwByGroup.get(k.groupId) ?? []), k]);
  for (const g of adgroups) {
    const s = st(g.nccAdgroupId);
    if (g.useDailyBudget !== false && num(g.dailyBudget) > 0) budgets.push({ ad_group: g.name, daily_budget: num(g.dailyBudget) });
    if (!has(s)) continue;
    const camp = campById.get(g.nccCampaignId);
    adgroup.push({ ...blank, month, campaign: camp?.name ?? '', ad_group: g.name, impressions: num(s.impCnt), clicks: num(s.clkCnt), cost: Math.round(num(s.salesAmt)), avg_rank: rank(s) });
    // 키워드별
    let si = 0, sc = 0, sco = 0;
    for (const k of kwByGroup.get(g.nccAdgroupId) ?? []) {
      const ks = st(k.id);
      if (!has(ks)) continue;
      si += num(ks.impCnt);
      sc += num(ks.clkCnt);
      sco += num(ks.salesAmt);
      keyword.push({ ...blank, month, ad_group: g.name, dim: k.kw, impressions: num(ks.impCnt), clicks: num(ks.clkCnt), cost: Math.round(num(ks.salesAmt)), avg_rank: rank(ks) });
    }
    // 등록 키워드 밖 성과(확장검색·플레이스 등) = 그룹 합계 − 키워드 합계 → CSV 의 '-' 줄과 같은 모양
    const ri = num(s.impCnt) - si, rc = num(s.clkCnt) - sc, rco = Math.round(num(s.salesAmt) - sco);
    if (ri > 0 || rc > 0 || rco > 0) keyword.push({ ...blank, month, ad_group: g.name, dim: '-', impressions: Math.max(0, ri), clicks: Math.max(0, rc), cost: Math.max(0, rco), avg_rank: null });
  }

  return {
    month,
    since: range.since,
    until: range.until,
    rows: { account, campaign, adgroup, keyword },
    budgets,
    counts: { campaigns: campaigns.length, adgroups: adgroups.length, keywords: keywords.length, calls },
    warnings,
  };
}
