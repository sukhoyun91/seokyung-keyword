import { query } from '@/lib/db';
import { requireUser, errorResponse, HttpError } from '@/lib/auth';
import { ensureAdsSchema } from '@/lib/ads/schema';

/** 관계사 목록 */
export async function GET() {
  try {
    await requireUser();
    await ensureAdsSchema();
    const companies = await query<{ id: number; name: string; logo: string; memo: string }>(
      'SELECT id, name, logo, memo FROM ad_companies ORDER BY name',
    );
    return Response.json({ companies });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 관계사 추가 { name, memo } */
export async function POST(req: Request) {
  try {
    await requireUser();
    await ensureAdsSchema();
    const b = await req.json();
    const name = String(b.name || '').trim().slice(0, 100);
    if (!name) throw new HttpError(400, '관계사 이름을 입력하세요.');
    const dup = await query('SELECT 1 FROM ad_companies WHERE name = $1', [name]);
    if (dup.length) throw new HttpError(400, '이미 등록된 관계사입니다.');
    const rows = await query<{ id: number }>('INSERT INTO ad_companies (name, memo) VALUES ($1, $2) RETURNING id', [name, String(b.memo || '')]);
    return Response.json({ ok: true, id: rows[0].id });
  } catch (e) {
    return errorResponse(e);
  }
}
