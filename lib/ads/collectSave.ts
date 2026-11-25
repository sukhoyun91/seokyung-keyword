import { transaction } from '@/lib/db';
import { API_LEVELS, type CollectResult } from './collect';
import { saveQueries } from './save';

/** 저장: 계정·캠페인·광고그룹·키워드 4종을 그 달만 교체 + 하루예산 */
export async function saveCollected(accountId: number, r: CollectResult, userId: number | null) {
  const q: { text: string; params: unknown[] }[] = [];
  for (const l of API_LEVELS) {
    q.push(...saveQueries(accountId, l, r.rows[l], [r.month], { months: [r.month], rowCount: r.rows[l].length, fileName: `네이버 API 수집 (${r.since}~${r.until})`, userId }));
  }
  for (const b of r.budgets) {
    q.push({
      text: `INSERT INTO ad_group_settings (account_id, month, ad_group, daily_budget, region_target) VALUES ($1, $2, $3, $4, '')
             ON CONFLICT (account_id, month, ad_group) DO UPDATE SET daily_budget = EXCLUDED.daily_budget`,
      params: [accountId, `${r.month}-01`, b.ad_group.slice(0, 200), b.daily_budget],
    });
  }
  await transaction(q);
}

