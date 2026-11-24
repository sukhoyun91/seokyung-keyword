import { query } from '@/lib/db';
import { requireUser, requireAdmin, errorResponse, HttpError } from '@/lib/auth';
import { ensureAdsSchema } from '@/lib/ads/schema';

type Ctx = { params: Promise<{ id: string }> };

/** 관계사 수정 { name?, memo?, logo? (data:image/… 300KB 이하, '' = 삭제) } */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    await requireUser();
    await ensureAdsSchema();
    const id = Number((await params).id);
    const b = await req.json();
    if (typeof b.name === 'string') {
      const name = b.name.trim().slice(0, 100);
      if (!name) throw new HttpError(400, '이름을 입력하세요.');
      const dup = await query('SELECT 1 FROM ad_companies WHERE name = $1 AND id <> $2', [name, id]);
      if (dup.length) throw new HttpError(400, '같은 이름의 관계사가 있습니다.');
      await query('UPDATE ad_companies SET name = $1 WHERE id = $2', [name, id]);
    }
    if (typeof b.memo === 'string') await query('UPDATE ad_companies SET memo = $1 WHERE id = $2', [b.memo.slice(0, 1000), id]);
    if (typeof b.logo === 'string') {
      if (b.logo && !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(b.logo)) throw new HttpError(400, '로고는 이미지 파일만 가능합니다.');
      if (b.logo.length > 400_000) throw new HttpError(400, '로고 이미지가 너무 큽니다. (300KB 이하)');
      await query('UPDATE ad_companies SET logo = $1 WHERE id = $2', [b.logo, id]);
    }
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 관계사 삭제 — 관리자만, 광고 계정이 없을 때만 */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireAdmin();
    await ensureAdsSchema();
    const id = Number((await params).id);
    const used = await query('SELECT 1 FROM ad_accounts WHERE company_id = $1 LIMIT 1', [id]);
    if (used.length) throw new HttpError(400, '이 관계사에 광고 계정이 있습니다. 계정을 먼저 삭제하거나 다른 관계사로 옮겨 주세요.');
    await query('DELETE FROM ad_companies WHERE id = $1', [id]);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
