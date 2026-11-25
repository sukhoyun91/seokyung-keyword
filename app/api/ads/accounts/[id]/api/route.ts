import { query } from '@/lib/db';
import { requireUser, errorResponse, HttpError } from '@/lib/auth';
import { ensureAdsSchema } from '@/lib/ads/schema';
import { encrypt } from '@/lib/crypto';
import { credsForAccount, listCampaigns } from '@/lib/ads/naverAds';

type Ctx = { params: Promise<{ id: string }> };

/** 계정별 네이버 API 키 저장 { license, secret } · 삭제 { clear: true } — 암호화 저장, 다시 보여 주지 않음 */
export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireUser();
    await ensureAdsSchema();
    const id = Number((await params).id);
    const b = await req.json();
    if (b.clear) {
      await query("UPDATE ad_accounts SET api_license = '', api_secret = '' WHERE id = $1", [id]);
      return Response.json({ ok: true });
    }
    const license = String(b.license || '').trim();
    const secret = String(b.secret || '').trim();
    if (!license || !secret) throw new HttpError(400, '액세스 라이선스와 비밀키를 모두 입력하세요.');
    await query('UPDATE ad_accounts SET api_license = $1, api_secret = $2 WHERE id = $3', [encrypt(license), encrypt(secret), id]);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 연결 테스트: 캠페인 목록을 읽어 봄 */
export async function POST(_req: Request, { params }: Ctx) {
  try {
    await requireUser();
    await ensureAdsSchema();
    const id = Number((await params).id);
    const creds = await credsForAccount(id);
    if (!creds) throw new HttpError(400, '등록된 API 키가 없습니다.');
    const list = await listCampaigns(creds);
    return Response.json({ ok: true, source: creds.source, campaigns: list.map((c) => c.name).slice(0, 20), count: list.length });
  } catch (e) {
    return errorResponse(e);
  }
}
