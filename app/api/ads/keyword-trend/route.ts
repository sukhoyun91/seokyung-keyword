import { query } from '@/lib/db';
import { requireUser, errorResponse, HttpError } from '@/lib/auth';
import { ensureAdsSchema } from '@/lib/ads/schema';

export const runtime = 'nodejs';

/**
 * 키워드 추이 (엑셀 피벗테이블 대체)
 * GET /api/ads/keyword-trend?account=1&month=2026-10&group=지역_렌트카
 * → 해당 광고그룹 키워드 × 월 (보고 월까지 전체)
 */
export async function GET(req: Request) {
  try {
    await requireUser();
    await ensureAdsSchema();
    const u = new URL(req.url);
    const accountId = Number(u.searchParams.get('account'));
    const month = String(u.searchParams.get('month') || '');
    const group = u.searchParams.get('group');
    if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, '월 형식이 올바르지 않습니다.');

    const groups = await query<{ ad_group: string; n: number }>(
      `SELECT ad_group, COUNT(DISTINCT dim)::int AS n FROM ad_stats
        WHERE account_id = $1 AND level = 'keyword' AND month <= $2 GROUP BY ad_group ORDER BY SUM(impressions) DESC`,
      [accountId, `${month}-01`],
    );
    const g = group ?? groups[0]?.ad_group;
    if (!g) return Response.json({ groups: [], group: null, rows: [] });
    const rows = await query(
      `SELECT dim AS keyword, to_char(month, 'YYYY-MM') AS month, SUM(impressions)::float8 AS imp, SUM(clicks)::float8 AS clk, SUM(cost)::float8 AS cost,
              (SUM(avg_rank * GREATEST(impressions,1)) FILTER (WHERE avg_rank IS NOT NULL)
                / NULLIF(SUM(GREATEST(impressions,1)) FILTER (WHERE avg_rank IS NOT NULL),0))::float8 AS rank
         FROM ad_stats WHERE account_id = $1 AND level = 'keyword' AND month <= $2 AND ad_group = $3
        GROUP BY dim, month ORDER BY dim, month`,
      [accountId, `${month}-01`, g],
    );
    return Response.json({ groups, group: g, rows });
  } catch (e) {
    return errorResponse(e);
  }
}
