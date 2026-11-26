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
  if (level === 'campaign') queries.push(fillCampaignTypes(accountId));
  if (log) {
    queries.push({
      text: 'INSERT INTO ad_uploads (account_id, level, months, file_name, row_count, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6)',
      params: [accountId, level, log.months.join(','), clip(log.fileName, 300), log.rowCount, log.userId],
    });
  }
  return queries;
}

/**
 * 캠페인유형 열이 없는 파일(보고서 설정에 따라 빠짐)로 올린 달은 유형이 비어 있어
 * 보고서에서 캠페인 이름(예: "1. 서경방송")이 유형처럼 따로 표시됨.
 * 같은 광고주의 다른 달에 같은 캠페인의 유형이 있으면 그것으로 채움 (양방향: 새로 올린 달·예전 달 모두)
 */
export function fillCampaignTypes(accountId: number) {
  return {
    text: `UPDATE ad_stats s SET campaign_type = m.type
             FROM (SELECT DISTINCT ON (campaign) campaign, campaign_type AS type FROM ad_stats
                    WHERE account_id = $1 AND level = 'campaign' AND campaign_type <> '' AND campaign <> ''
                    ORDER BY campaign, month DESC) m
            WHERE s.account_id = $1 AND s.level = 'campaign' AND s.campaign_type = '' AND s.campaign = m.campaign`,
    params: [accountId] as unknown[],
  };
}
