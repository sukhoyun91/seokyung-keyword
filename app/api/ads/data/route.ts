import { query } from '@/lib/db';
import { requireUser, errorResponse, HttpError } from '@/lib/auth';
import { ensureAdsSchema } from '@/lib/ads/schema';
import { LEVELS } from '@/lib/ads/parse';

export const runtime = 'nodejs';

/**
 * 저장된 원천자료 조회 (조회 화면·엑셀 다운로드 공용)
 * GET /api/ads/data?account=1&level=keyword&from=2026-01&to=2026-10&q=진주&offset=0&limit=200&sort=cost
 */
export async function GET(req: Request) {
  try {
    await requireUser();
    await ensureAdsSchema();
    const u = new URL(req.url).searchParams;
    const account = Number(u.get('account'));
    const level = String(u.get('level') || '');
    if (!account) throw new HttpError(400, '광고 계정을 선택하세요.');
    if (u.get('kind') === 'summary') return Response.json(await summary(account, u.get('from'), u.get('to')));
    if (!(LEVELS as readonly string[]).includes(level)) throw new HttpError(400, '자료 종류가 올바르지 않습니다.');
    const from = /^\d{4}-\d{2}$/.test(u.get('from') || '') ? `${u.get('from')}-01` : '1900-01-01';
    const to = /^\d{4}-\d{2}$/.test(u.get('to') || '') ? `${u.get('to')}-01` : '2999-12-01';
    const q = String(u.get('q') || '').trim().slice(0, 100);
    const limit = Math.min(Math.max(Number(u.get('limit')) || 200, 1), 5000);
    const offset = Math.max(Number(u.get('offset')) || 0, 0);
    const sort = u.get('sort') === 'cost' ? 'cost DESC, impressions DESC' : u.get('sort') === 'imp' ? 'impressions DESC' : 'month, campaign_type, campaign, ad_group, dim, search_type';

    const where = ['account_id = $1', 'level = $2', 'month BETWEEN $3 AND $4'];
    const params: unknown[] = [account, level, from, to];
    if (q) {
      params.push(`%${q}%`);
      where.push(`(campaign_type ILIKE $5 OR campaign ILIKE $5 OR ad_group ILIKE $5 OR dim ILIKE $5 OR search_type ILIKE $5)`);
    }
    const W = where.join(' AND ');
    const [rows, agg] = await Promise.all([
      query(
        `SELECT to_char(month, 'YYYY-MM') AS month, campaign_type, campaign, ad_group, dim, search_type,
                impressions::float8 AS impressions, clicks::float8 AS clicks, cost::float8 AS cost, avg_rank::float8 AS avg_rank
           FROM ad_stats WHERE ${W} ORDER BY ${sort}, id LIMIT ${limit} OFFSET ${offset}`,
        params,
      ),
      query<{ n: number; imp: number; clk: number; cost: number }>(
        `SELECT COUNT(*)::int AS n, COALESCE(SUM(impressions),0)::float8 AS imp, COALESCE(SUM(clicks),0)::float8 AS clk, COALESCE(SUM(cost),0)::float8 AS cost
           FROM ad_stats WHERE ${W}`,
        params,
      ),
    ]);
    return Response.json({ rows, total: agg[0].n, sum: { imp: agg[0].imp, clk: agg[0].clk, cost: agg[0].cost } });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 월별 요약: 계정 보고서 합계(없으면 캠페인 합계) + 세금계산서·쿠폰·비고 */
async function summary(account: number, f: string | null, t: string | null) {
  const from = /^\d{4}-\d{2}$/.test(f || '') ? `${f}-01` : '1900-01-01';
  const to = /^\d{4}-\d{2}$/.test(t || '') ? `${t}-01` : '2999-12-01';
  const [tot, notes] = await Promise.all([
    query<{ month: string; level: string; imp: number; clk: number; cost: number }>(
      `SELECT to_char(month, 'YYYY-MM') AS month, level, SUM(impressions)::float8 AS imp, SUM(clicks)::float8 AS clk, SUM(cost)::float8 AS cost
         FROM ad_stats WHERE account_id = $1 AND month BETWEEN $2 AND $3 AND level IN ('account','campaign')
        GROUP BY month, level ORDER BY month`,
      [account, from, to],
    ),
    query<{ month: string; tax_invoice: number | null; coupon: number | null; note: string }>(
      `SELECT to_char(month, 'YYYY-MM') AS month, tax_invoice::float8 AS tax_invoice, coupon::float8 AS coupon, note
         FROM ad_monthly_notes WHERE account_id = $1 AND month BETWEEN $2 AND $3`,
      [account, from, to],
    ),
  ]);
  const months = [...new Set(tot.map((r) => r.month))].sort();
  return {
    months: months.map((m) => {
      const r = tot.find((x) => x.month === m && x.level === 'account') ?? tot.find((x) => x.month === m && x.level === 'campaign')!;
      const n = notes.find((x) => x.month === m);
      return { month: m, imp: r.imp, clk: r.clk, cost: r.cost, tax_invoice: n?.tax_invoice ?? null, coupon: n?.coupon ?? null, note: n?.note ?? '' };
    }),
  };
}
