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
    let license = String(b.license || '').replace(/\s/g, '');
    let secret = String(b.secret || '').replace(/\s/g, '');
    if (!license || !secret) throw new HttpError(400, '액세스 라이선스와 비밀키를 모두 입력하세요.');
    // 액세스 라이선스는 보통 0100000000… 로 시작하는 긴 16진수, 비밀키는 AQAA… 로 시작해 == 로 끝나는 문자열
    const looksLicense = (v: string) => /^[0-9a-f]{40,}$/i.test(v);
    const looksSecret = (v: string) => /[+/=]|^AQAA/.test(v) && !looksLicense(v);
    let swapped = false;
    if (looksSecret(license) && looksLicense(secret)) {
      [license, secret] = [secret, license];
      swapped = true;
    }
    await query('UPDATE ad_accounts SET api_license = $1, api_secret = $2 WHERE id = $3', [encrypt(license), encrypt(secret), id]);
    return Response.json({ ok: true, swapped, warn: looksLicense(license) ? '' : '액세스 라이선스 모양이 보통과 다릅니다 (0100000000… 로 시작하는 긴 숫자·영문). 다시 확인하세요.' });
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
