import { query } from '@/lib/db';
import { requireUser, errorResponse, HttpError } from '@/lib/auth';
import { ensureAdsSchema } from '@/lib/ads/schema';

/**
 * 보고서 표 비고
 * GET ?account= → { notes: [{scope,row_key,month,note}] }
 * PUT { accountId, scope: 'ctype'|'group', key, month, note } (빈 note 면 삭제)
 */
export async function GET(req: Request) {
  try {
    await requireUser();
    await ensureAdsSchema();
    const id = Number(new URL(req.url).searchParams.get('account'));
    const notes = await query('SELECT scope, row_key, month, note FROM ad_row_notes WHERE account_id = $1', [id]);
    return Response.json({ notes });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: Request) {
  try {
    const me = await requireUser();
    await ensureAdsSchema();
    const b = await req.json();
    const id = Number(b.accountId);
    const scope = String(b.scope ?? '');
    const key = String(b.key ?? '').slice(0, 300);
    const month = String(b.month ?? '');
    const note = String(b.note ?? '').trim().slice(0, 1000);
    if (!['ctype', 'group'].includes(scope) || !key || !/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, '비고 저장 값이 올바르지 않습니다.');
    if (!(await query('SELECT 1 FROM ad_accounts WHERE id = $1', [id])).length) throw new HttpError(404, '광고주를 찾을 수 없습니다.');
    if (!note) await query('DELETE FROM ad_row_notes WHERE account_id = $1 AND scope = $2 AND row_key = $3 AND month = $4', [id, scope, key, month]);
    else
      await query(
        `INSERT INTO ad_row_notes (account_id, scope, row_key, month, note, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT (account_id, scope, row_key, month) DO UPDATE SET note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [id, scope, key, month, note, me.id],
      );
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
