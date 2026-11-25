import { query } from '@/lib/db';
import { requireUser, errorResponse, HttpError } from '@/lib/auth';
import { ensureAdsSchema } from '@/lib/ads/schema';
import { credsForAccount } from '@/lib/ads/naverAds';
import { API_LEVELS, collectMonth, type CollectResult } from '@/lib/ads/collect';
import { saveCollected } from '@/lib/ads/collectSave';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Tot = { rows: number; imp: number; clk: number; cost: number };
const tot = (rows: { impressions: number; clicks: number; cost: number }[]): Tot => ({
  rows: rows.length,
  imp: rows.reduce((s, r) => s + r.impressions, 0),
  clk: rows.reduce((s, r) => s + r.clicks, 0),
  cost: rows.reduce((s, r) => s + r.cost, 0),
});

/** 같은 달 DB 자료와 나란히 비교 */
async function compare(accountId: number, r: CollectResult) {
  const m = `${r.month}-01`;
  const db = await query<{ level: string; key: string; rows: number; imp: number; clk: number; cost: number }>(
    `SELECT level,
            CASE level WHEN 'campaign' THEN COALESCE(NULLIF(campaign_type,''), campaign) WHEN 'adgroup' THEN ad_group ELSE '' END AS key,
            COUNT(*)::int AS rows, SUM(impressions)::float8 AS imp, SUM(clicks)::float8 AS clk, SUM(cost)::float8 AS cost
       FROM ad_stats WHERE account_id = $1 AND month = $2 AND level = ANY($3::text[])
      GROUP BY level, 2`,
    [accountId, m, [...API_LEVELS]],
  );
  const levels = API_LEVELS.map((l) => {
    const d = db.filter((x) => x.level === l);
    return {
      level: l,
      api: tot(r.rows[l]),
      db: d.length ? { rows: d.reduce((s, x) => s + x.rows, 0), imp: d.reduce((s, x) => s + x.imp, 0), clk: d.reduce((s, x) => s + x.clk, 0), cost: d.reduce((s, x) => s + x.cost, 0) } : null,
    };
  });
  const by = (level: 'campaign' | 'adgroup', keyOf: (x: any) => string) => {
    const keys = new Set([...r.rows[level].map(keyOf), ...db.filter((x) => x.level === level).map((x) => x.key)]);
    return [...keys].map((k) => {
      const d = db.find((x) => x.level === level && x.key === k);
      return { key: k, api: tot(r.rows[level].filter((x) => keyOf(x) === k)), db: d ? { rows: d.rows, imp: d.imp, clk: d.clk, cost: d.cost } : null };
    });
  };
  return { levels, campaignTypes: by('campaign', (x) => x.campaign_type || x.campaign), adgroups: by('adgroup', (x) => x.ad_group) };
}

/** body: { accountId, month: 'YYYY-MM', save: boolean } */
export async function POST(req: Request) {
  try {
    const me = await requireUser();
    await ensureAdsSchema();
    const b = await req.json();
    const accountId = Number(b.accountId);
    const month = String(b.month || '');
    if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, '월을 선택하세요.');
    const creds = await credsForAccount(accountId);
    if (!creds) throw new HttpError(400, '이 광고 계정에 네이버 API 키가 없습니다. 왼쪽 계정 설정에서 액세스 라이선스·비밀키를 등록하세요.');
    const r = await collectMonth(creds, month);
    const cmp = await compare(accountId, r); // 저장 전 DB 상태와 비교
    if (b.save) await saveCollected(accountId, r, me.id);
    return Response.json({
      month: r.month,
      since: r.since,
      until: r.until,
      counts: r.counts,
      warnings: r.warnings,
      budgets: r.budgets,
      compare: cmp,
      saved: !!b.save,
      keySource: creds.source,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
