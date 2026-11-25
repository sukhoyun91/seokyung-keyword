/** ad_stats 저장 쿼리 (파일 업로드·API 수집 공용) */
import type { AdLevel, AdRow } from './parse';

const BATCH = 1000;
const clip = (s: unknown, n: number) => String(s ?? '').slice(0, n);

export function saveQueries(
  accountId: number,
  level: AdLevel,
  rows: AdRow[],
  replaceMonths: string[],
  log?: { months: string[]; rowCount: number; fileName: string; userId: number | null },
) {
  const queries: { text: string; params: unknown[] }[] = [];
  const replace = replaceMonths.filter((m) => /^\d{4}-\d{2}$/.test(m));
  if (replace.length) {
    queries.push({
      text: "DELETE FROM ad_stats WHERE account_id = $1 AND level = $2 AND month = ANY(SELECT (m || '-01')::date FROM unnest($3::text[]) AS m)",
      params: [accountId, level, replace],
    });
  }
  for (let i = 0; i < rows.length; i += BATCH) {
    const b = rows.slice(i, i + BATCH).filter((r) => /^\d{4}-\d{2}$/.test(r.month));
    if (!b.length) continue;
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
      params: [accountId, level, log.months.join(','), clip(log.fileName, 300), log.rowCount, log.userId],
    });
  }
  return queries;
}
