import { query, transaction } from '@/lib/db';
import { requireUser, errorResponse, HttpError } from '@/lib/auth';
import { ensureAdsSchema } from '@/lib/ads/schema';
import { LEVELS, type AdLevel, type AdRow } from '@/lib/ads/parse';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BATCH = 1000;
const MAX_ROWS = 10_000; // 요청 1건당 (브라우저가 나눠 보냄)
const clip = (s: unknown, n: number) => String(s ?? '').slice(0, n);

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
    const replace = (replaceMonths || []).filter((m) => /^\d{4}-\d{2}$/.test(m));

    const queries: { text: string; params: unknown[] }[] = [];
    if (replace.length) {
      queries.push({
        text: "DELETE FROM ad_stats WHERE account_id = $1 AND level = $2 AND month = ANY(SELECT (m || '-01')::date FROM unnest($3::text[]) AS m)",
        params: [accountId, level, replace],
      });
    }
    for (let i = 0; i < rows.length; i += BATCH) {
      const b = rows.slice(i, i + BATCH).filter((r) => /^\d{4}-\d{2}$/.test(r.month));
      queries.push({
        text: `INSERT INTO ad_stats (account_id, level, month, campaign_type, campaign, ad_group, dim, search_type, impressions, clicks, cost, avg_rank)
               SELECT $1, $2, (t.m || '-01')::date, t.ct, t.c, t.g, t.d, t.st, t.i, t.cl, t.co, t.r
                 FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::bigint[], $10::bigint[], $11::bigint[], $12::numeric[])
                   AS t(m, ct, c, g, d, st, i, cl, co, r)`,
        params: [
          accountId,
          level,
          b.map((r) => r.month),
          b.map((r) => clip(r.campaign_type, 50)),
          b.map((r) => clip(r.campaign, 200)),
          b.map((r) => clip(r.ad_group, 200)),
          b.map((r) => clip(r.dim, 300)),
          b.map((r) => clip(r.search_type, 50)),
          b.map((r) => Math.round(Number(r.impressions) || 0)),
          b.map((r) => Math.round(Number(r.clicks) || 0)),
          b.map((r) => Math.round(Number(r.cost) || 0)),
          b.map((r) => (r.avg_rank == null || !Number.isFinite(Number(r.avg_rank)) ? null : Number(r.avg_rank))),
        ],
      });
    }
    if (log) {
      queries.push({
        text: 'INSERT INTO ad_uploads (account_id, level, months, file_name, row_count, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6)',
        params: [accountId, level, (log.months || months).join(','), clip(fileName, 300), Number(log.rowCount) || rows.length, me.id],
      });
    }
    await transaction(queries);
    return Response.json({ ok: true, months, rows: rows.length });
  } catch (e) {
    return errorResponse(e);
  }
}
