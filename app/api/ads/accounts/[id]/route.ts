import { query } from '@/lib/db';
import { requireUser, requireAdmin, errorResponse, HttpError } from '@/lib/auth';
import { ensureAdsSchema } from '@/lib/ads/schema';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    await requireUser();
    await ensureAdsSchema();
    const id = Number((await params).id);
    const body = await req.json();
    if (typeof body.name === 'string') {
      if (!body.name.trim()) throw new HttpError(400, '이름을 입력하세요.');
      await query('UPDATE ad_accounts SET name = $1 WHERE id = $2', [body.name.trim(), id]);
    }
    if (typeof body.memo === 'string') await query('UPDATE ad_accounts SET memo = $1 WHERE id = $2', [body.memo, id]);
    if (body.company_id !== undefined) await query('UPDATE ad_accounts SET company_id = $1 WHERE id = $2', [Number(body.company_id) || null, id]);
    if (typeof body.active === 'boolean') await query('UPDATE ad_accounts SET active = $1 WHERE id = $2', [body.active, id]);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 광고주 삭제 (누적 데이터 전체 삭제) — 관리자만 */
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    await requireAdmin();
    await ensureAdsSchema();
    const id = Number((await params).id);
    const url = new URL(req.url);
    const month = url.searchParams.get('month'); // ?month=2026-10&level=keyword → 해당 월 데이터만 삭제
    const level = url.searchParams.get('level');
    if (month) {
      if (level) await query("DELETE FROM ad_stats WHERE account_id = $1 AND month = ($2 || '-01')::date AND level = $3", [id, month, level]);
      else await query("DELETE FROM ad_stats WHERE account_id = $1 AND month = ($2 || '-01')::date", [id, month]);
      return Response.json({ ok: true });
    }
    await query('DELETE FROM ad_accounts WHERE id = $1', [id]);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
