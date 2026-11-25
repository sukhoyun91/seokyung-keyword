/**
 * 네이버 검색광고 관리·통계 API (계정 구조 + /stats)
 * 서명: HMAC-SHA256(secret, "{timestamp}.{METHOD}.{path}") — path 에 쿼리 문자열은 넣지 않음
 */
import { createHmac } from 'node:crypto';
import { query } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { getSettings } from '@/lib/settings';

const BASE = process.env.NAVER_ADS_BASE || 'https://api.searchad.naver.com'; // 시험용으로만 바꿈

export interface AdsCreds {
  customerId: string;
  license: string;
  secret: string;
  source: 'account' | 'admin';
}

/** 계정에 등록된 키 → 없으면 관리자 설정 키(고객 ID가 같을 때) */
export async function credsForAccount(accountId: number): Promise<AdsCreds | null> {
  const a = (await query<{ customer_id: string; api_license: string; api_secret: string }>('SELECT customer_id, api_license, api_secret FROM ad_accounts WHERE id = $1', [accountId]))[0];
  if (!a) return null;
  if (a.api_license && a.api_secret) {
    try {
      return { customerId: a.customer_id, license: decrypt(a.api_license), secret: decrypt(a.api_secret), source: 'account' };
    } catch {
      return null;
    }
  }
  const s = await getSettings();
  if (s.naver_customer_id?.trim() === a.customer_id && s.naver_access_license && s.naver_secret_key) {
    return { customerId: a.customer_id, license: s.naver_access_license, secret: s.naver_secret_key, source: 'admin' };
  }
  return null;
}

export class NaverApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function adsGet<T = any>(creds: AdsCreds, path: string, params: Record<string, string> = {}, attempt = 0): Promise<T> {
  const ts = String(Date.now());
  const sig = createHmac('sha256', creds.secret).update(`${ts}.GET.${path}`).digest('base64');
  const qs = new URLSearchParams(params).toString();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}${qs ? `?${qs}` : ''}`, {
      headers: { 'X-Timestamp': ts, 'X-API-KEY': creds.license, 'X-Customer': creds.customerId, 'X-Signature': sig },
      cache: 'no-store',
      signal: ctrl.signal,
    });
  } catch (e: any) {
    throw new NaverApiError(0, `네이버 API 연결 실패 (${path}): ${e?.name === 'AbortError' ? '응답 시간 초과' : e?.message ?? e}`);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429 && attempt < 3) {
    await sleep(1200 * (attempt + 1));
    return adsGet(creds, path, params, attempt + 1);
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).replace(/[0-9a-f]{24,}/gi, (k) => `${k.slice(0, 4)}…${k.slice(-4)}`);
    if (res.status === 401 || res.status === 403) {
      let detail = '';
      try {
        const j = JSON.parse(body);
        detail = [j.title, j.detail, j.message].filter(Boolean).join(' / ');
      } catch {
        detail = body.slice(0, 200);
      }
      const hint = /signature/i.test(detail)
        ? '비밀키가 틀렸습니다 (서명 불일치). 비밀키를 다시 복사해 넣으세요.'
        : /customer/i.test(detail) || /permission|권한|not allowed|forbidden/i.test(detail)
          ? `이 API 키로는 계정 ${creds.customerId}를 조회할 권한이 없습니다. 키를 발급한 네이버 검색광고 계정의 CUSTOMER_ID가 ${creds.customerId}인지, 다른 계정에서 발급했다면 그 계정에 ${creds.customerId} 광고계정 권한이 있는지 확인하세요.`
          : `계정 번호 ${creds.customerId}·액세스 라이선스·비밀키가 같은 네이버 검색광고 계정에서 발급된 것인지 확인하세요.`;
      throw new NaverApiError(res.status, `네이버 인증 실패 (${res.status}). ${hint}${detail ? ` [네이버 응답: ${detail}]` : ''}`);
    }
    throw new NaverApiError(res.status, `네이버 API 오류 ${res.status} (${path}): ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export interface Campaign { nccCampaignId: string; name: string; campaignTp: string }
export interface Adgroup { nccAdgroupId: string; nccCampaignId: string; name: string; adgroupType?: string; dailyBudget?: number; useDailyBudget?: boolean }
export interface Keyword { nccKeywordId: string; nccAdgroupId: string; keyword: string }
export interface Stat { id: string; impCnt?: number; clkCnt?: number; salesAmt?: number; avgRnk?: number }

export const listCampaigns = (c: AdsCreds) => adsGet<Campaign[]>(c, '/ncc/campaigns');

export async function listAdgroups(c: AdsCreds, campaigns: Campaign[]): Promise<Adgroup[]> {
  try {
    return await adsGet<Adgroup[]>(c, '/ncc/adgroups');
  } catch (e) {
    // 전체 조회가 안 되면 캠페인별로
    const out: Adgroup[] = [];
    for (const cp of campaigns) out.push(...(await adsGet<Adgroup[]>(c, '/ncc/adgroups', { nccCampaignId: cp.nccCampaignId })));
    return out;
  }
}

export async function listKeywords(c: AdsCreds, adgroupId: string): Promise<Keyword[]> {
  try {
    return await adsGet<Keyword[]>(c, '/ncc/keywords', { nccAdgroupId: adgroupId });
  } catch (e) {
    if (e instanceof NaverApiError && (e.status === 404 || e.status === 400)) return []; // 키워드가 없는 그룹(플레이스 등)
    throw e;
  }
}

/**
 * 여러 id 의 기간 합계 성과.
 * 네이버 규칙: 한 요청의 ids 는 모두 같은 종류여야 함 (cmp-… 캠페인 / grp-… 광고그룹 / nkw-… 키워드) → 종류별로 나눠 50개씩
 */
export async function statsFor(c: AdsCreds, ids: string[], since: string, until: string): Promise<{ stats: Map<string, Stat>; calls: number }> {
  const out = new Map<string, Stat>();
  const fields = JSON.stringify(['impCnt', 'clkCnt', 'salesAmt', 'avgRnk']);
  const timeRange = JSON.stringify({ since, until });
  const byType = new Map<string, string[]>();
  for (const id of ids) {
    const t = id.split('-')[0];
    byType.set(t, [...(byType.get(t) ?? []), id]);
  }
  let calls = 0;
  for (const list of byType.values())
    for (let i = 0; i < list.length; i += 50) {
      const j = await adsGet<{ data?: Stat[] }>(c, '/stats', { ids: list.slice(i, i + 50).join(','), fields, timeRange, timeIncrement: 'allDays' });
      calls++;
      for (const s of j.data ?? []) out.set(s.id, s);
    }
  return { stats: out, calls };
}
