import { query } from '@/lib/db';
import { requireUser, errorResponse, HttpError } from '@/lib/auth';
import { ensureAdsSchema } from '@/lib/ads/schema';

/** 보고서 화면 배치 (광고주별) — GET ?account= / PUT { accountId, layout } (layout 이 null 이면 기본 배치로) */
export async function GET(req: Request) {
  try {
    await requireUser();
    await ensureAdsSchema();
    const id = Number(new URL(req.url).searchParams.get('account'));
    const r = await query<{ layout: any }>('SELECT layout FROM ad_report_layouts WHERE account_id = $1', [id]);
    const l = r[0]?.layout;
    return Response.json({ layout: typeof l === 'string' ? JSON.parse(l) : l ?? {} });
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
    if (!(await query('SELECT 1 FROM ad_accounts WHERE id = $1', [id])).length) throw new HttpError(404, '광고주를 찾을 수 없습니다.');
    if (b.layout == null) {
      await query('DELETE FROM ad_report_layouts WHERE account_id = $1', [id]);
      return Response.json({ ok: true });
    }
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(b.layout ?? {})) {
      if (typeof k !== 'string' || k.length > 300 || !v || typeof v !== 'object') continue;
      const s = v as any;
      const o: any = {};
      if (Number.isFinite(s.order)) o.order = Math.round(s.order);
      if (Number.isFinite(s.w)) o.w = Math.min(100, Math.max(10, Math.round(s.w)));
      if (Number.isFinite(s.h)) o.h = Math.min(5000, Math.max(40, Math.round(s.h)));
      if (s.hidden === true) o.hidden = true;
      if (Object.keys(o).length) clean[k] = o;
    }
    const json = JSON.stringify(clean);
    if (json.length > 200_000) throw new HttpError(400, '배치 정보가 너무 큽니다.');
    await query(
      `INSERT INTO ad_report_layouts (account_id, layout, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (account_id) DO UPDATE SET layout = EXCLUDED.layout, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [id, json, me.id],
    );
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
