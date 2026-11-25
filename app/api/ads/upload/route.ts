import { query, transaction } from '@/lib/db';
import { requireUser, errorResponse, HttpError } from '@/lib/auth';
import { ensureAdsSchema } from '@/lib/ads/schema';
import { LEVELS, type AdLevel, type AdRow } from '@/lib/ads/parse';
import { saveQueries } from '@/lib/ads/save';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_ROWS = 10_000; // 요청 1건당 (브라우저가 나눠 보냄)

/**
 * body: { accountId, level, fileName, rows: AdRow[], replaceMonths: string[], log?: { months, rowCount } }
 * replaceMonths 에 있는 월의 해당 레벨 데이터를 먼저 지우고 rows 를 저장합니다. (같은 달을 다시 올리면 덮어쓰기)
 * 큰 파일은 브라우저가 월·묶음 단위로 나눠 여러 번 보냅니다. (첫 묶음만 replaceMonths 지정)
 */
export async function POST(req: Request) {
  try {
    const me = await requireUser();
    await ensureAdsSchema();
    const { accountId, level, fileName, rows, replaceMonths = [], log } = (await req.json()) as {
      accountId: number;
      level: AdLevel;
      fileName: string;
      rows: AdRow[];
      replaceMonths?: string[];
      log?: { months: string[]; rowCount: number };
    };
    if (!LEVELS.includes(level)) throw new HttpError(400, '보고서 종류가 올바르지 않습니다.');
    if (!Array.isArray(rows) || !rows.length) throw new HttpError(400, '저장할 데이터가 없습니다.');
    if (rows.length > MAX_ROWS) throw new HttpError(400, `한 파일에 ${MAX_ROWS.toLocaleString()}행까지 저장할 수 있습니다.`);
    const acc = await query('SELECT 1 FROM ad_accounts WHERE id = $1', [accountId]);
    if (!acc.length) throw new HttpError(400, '광고주를 선택하세요.');

    const months = [...new Set(rows.map((r) => r.month))].filter((m) => /^\d{4}-\d{2}$/.test(m)).sort();
    if (!months.length) throw new HttpError(400, '월 정보가 없습니다.');

    const queries = saveQueries(accountId, level, rows, replaceMonths || [], log ? { months: log.months || months, rowCount: Number(log.rowCount) || rows.length, fileName, userId: me.id } : undefined);
    await transaction(queries);
    return Response.json({ ok: true, months, rows: rows.length });
  } catch (e) {
    return errorResponse(e);
  }
}
