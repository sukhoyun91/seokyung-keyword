import { query } from '@/lib/db';
import { requireUser, errorResponse, HttpError } from '@/lib/auth';
import { ensureAdsSchema } from '@/lib/ads/schema';
import { getSettings } from '@/lib/settings';

/** 광고주 목록 + 레벨별 보유 월 */
export async function GET() {
  try {
    await requireUser();
    await ensureAdsSchema();
    const accounts = await query<{ id: number; name: string; customer_id: string; memo: string; active: boolean; company_id: number | null; own_key: boolean }>(
      "SELECT id, name, customer_id, memo, active, company_id, (api_license <> '' AND api_secret <> '') AS own_key FROM ad_accounts ORDER BY active DESC, name",
    );
    const s = await getSettings();
    const adminCid = s.naver_access_license && s.naver_secret_key ? s.naver_customer_id?.trim() : '';
    const cover = await query<{ account_id: number; level: string; month: string; rows: number }>(
      `SELECT account_id, level, to_char(month, 'YYYY-MM') AS month, COUNT(*)::int AS rows
         FROM ad_stats GROUP BY account_id, level, month ORDER BY month`,
    );
    const lastUploads = await query<{ account_id: number; uploaded_at: string; name: string }>(
      `SELECT DISTINCT ON (u.account_id) u.account_id, u.uploaded_at, COALESCE(us.name, '') AS name
         FROM ad_uploads u LEFT JOIN users us ON us.id = u.uploaded_by
        ORDER BY u.account_id, u.uploaded_at DESC`,
    );
    return Response.json({
      accounts: accounts.map(({ own_key, ...a }) => ({
        ...a,
        api: own_key ? 'account' : adminCid && adminCid === a.customer_id ? 'admin' : null,
        coverage: cover.filter((c) => c.account_id === a.id).map(({ level, month, rows }) => ({ level, month, rows })),
        lastUpload: lastUploads.find((l) => l.account_id === a.id) ?? null,
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    await requireUser();
    await ensureAdsSchema();
    const { name, customer_id, memo, company_id } = await req.json();
    const companyId = Number(company_id) || null;
    if (!companyId) throw new HttpError(400, '관계사를 먼저 선택하세요.');
    const cid = String(customer_id || '').trim();
    if (!String(name || '').trim()) throw new HttpError(400, '광고 계정 이름을 입력하세요.');
    if (!/^\d{3,}$/.test(cid)) throw new HttpError(400, '네이버 계정 번호(숫자)를 입력하세요. 보고서 파일 첫 줄 끝의 숫자입니다.');
    const dup = await query('SELECT 1 FROM ad_accounts WHERE customer_id = $1', [cid]);
    if (dup.length) throw new HttpError(400, '이미 등록된 계정 번호입니다.');
    const rows = await query<{ id: number }>(
      'INSERT INTO ad_accounts (name, customer_id, memo, company_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [String(name).trim(), cid, String(memo || ''), companyId],
    );
    return Response.json({ ok: true, id: rows[0].id });
  } catch (e) {
    return errorResponse(e);
  }
}
