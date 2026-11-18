import { query, transaction } from '@/lib/db';
import { requireUser, errorResponse, HttpError } from '@/lib/auth';
import { ensureAdsSchema } from '@/lib/ads/schema';

const numOrNull = (v: unknown) => {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/[,\s원]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
};

/**
 * 월별 수기 입력값·담당자 의견·그룹 설정 저장
 * body: { accountId, month, tax_invoice?, coupon?, note?, opinion?, groups?: [{ad_group, daily_budget, region_target}] }
 * 보낸 항목만 바꿉니다.
 */
export async function PUT(req: Request) {
  try {
    const me = await requireUser();
    await ensureAdsSchema();
    const b = await req.json();
    const accountId = Number(b.accountId);
    const month = String(b.month || '');
    if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, '월 형식이 올바르지 않습니다.');
    const acc = await query('SELECT 1 FROM ad_accounts WHERE id = $1', [accountId]);
    if (!acc.length) throw new HttpError(404, '광고주를 찾을 수 없습니다.');
    const d = `${month}-01`;

    const q: { text: string; params: unknown[] }[] = [
      { text: 'INSERT INTO ad_monthly_notes (account_id, month) VALUES ($1, $2) ON CONFLICT DO NOTHING', params: [accountId, d] },
    ];
    const set = (col: string, val: unknown) =>
      q.push({ text: `UPDATE ad_monthly_notes SET ${col} = $3, updated_at = NOW() WHERE account_id = $1 AND month = $2`, params: [accountId, d, val] });
    if ('tax_invoice' in b) set('tax_invoice', numOrNull(b.tax_invoice));
    if ('coupon' in b) set('coupon', numOrNull(b.coupon));
    if ('note' in b) set('note', String(b.note ?? '').slice(0, 2000));
    if ('opinion' in b) {
      set('opinion', String(b.opinion ?? '').slice(0, 20000));
      set('opinion_by', me.id);
    }
    if (Array.isArray(b.groups)) {
      for (const g of b.groups) {
        if (!g?.ad_group) continue;
        if (numOrNull(g.daily_budget) == null && !String(g.region_target ?? '').trim()) {
          q.push({ text: 'DELETE FROM ad_group_settings WHERE account_id = $1 AND month = $2 AND ad_group = $3', params: [accountId, d, String(g.ad_group).slice(0, 200)] });
          continue;
        }
        q.push({
          text: `INSERT INTO ad_group_settings (account_id, month, ad_group, daily_budget, region_target) VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (account_id, month, ad_group) DO UPDATE SET daily_budget = EXCLUDED.daily_budget, region_target = EXCLUDED.region_target`,
          params: [accountId, d, String(g.ad_group).slice(0, 200), numOrNull(g.daily_budget), String(g.region_target ?? '').slice(0, 200)],
        });
      }
    }
    await transaction(q);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
