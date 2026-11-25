import { query } from '../db';
import { ensureAdsSchema } from './schema';
import { HttpError } from '../auth';
import { prevMonthOf, ctr, cpc, type AdReport, type M, type MonthTotal } from './types';

/** 노출수 가중 평균노출순위 포함 집계 SQL 조각 */
const AGG = `SUM(impressions)::float8 AS imp, SUM(clicks)::float8 AS clk, SUM(cost)::float8 AS cost,
  (SUM(avg_rank * GREATEST(impressions,1)) FILTER (WHERE avg_rank IS NOT NULL)
    / NULLIF(SUM(GREATEST(impressions,1)) FILTER (WHERE avg_rank IS NOT NULL), 0))::float8 AS rank`;
const MON = `to_char(month, 'YYYY-MM') AS month`;

const toM = (r: any): M => ({ imp: Number(r.imp) || 0, clk: Number(r.clk) || 0, cost: Number(r.cost) || 0, rank: r.rank == null ? null : Math.round(Number(r.rank) * 10) / 10 });

export async function buildReport(accountId: number, month: string): Promise<AdReport> {
  await ensureAdsSchema();
  if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, '월 형식이 올바르지 않습니다.');
  const acc = (
    await query<{ id: number; name: string; customer_id: string; company: string | null; logo: string | null }>(
      `SELECT a.id, a.name, a.customer_id, c.name AS company, c.logo
         FROM ad_accounts a LEFT JOIN ad_companies c ON c.id = a.company_id WHERE a.id = $1`,
      [accountId],
    )
  )[0];
  if (!acc) throw new HttpError(404, '광고주를 찾을 수 없습니다.');
  const prev = prevMonthOf(month);
  const until = `${month}-01`;
  const P = [accountId, until];

  const [lvRows, coverRows, campRows, campTypeMap, grpRows, mediaRows, kwRows, stTypeRows, stTopRows, stRiserRows, noteRows, settingRows] = await Promise.all([
    query(`SELECT ${MON}, level, ${AGG} FROM ad_stats WHERE account_id = $1 AND month <= $2 AND level IN ('account','campaign') GROUP BY month, level ORDER BY month`, P),
    query<{ level: string }>(`SELECT DISTINCT level FROM ad_stats WHERE account_id = $1 AND month = $2`, P),
    query(`SELECT ${MON}, COALESCE(NULLIF(campaign_type,''), campaign) AS type, ${AGG} FROM ad_stats WHERE account_id = $1 AND month <= $2 AND level = 'campaign' GROUP BY month, 2 ORDER BY month`, P),
    query<{ campaign: string; type: string }>(`SELECT DISTINCT ON (campaign) campaign, campaign_type AS type FROM ad_stats WHERE account_id = $1 AND level = 'campaign' AND campaign_type <> '' AND campaign <> '' ORDER BY campaign, month DESC`, [accountId]),
    query(`SELECT ${MON}, campaign, ad_group, ${AGG} FROM ad_stats WHERE account_id = $1 AND month <= $2 AND level = 'adgroup' GROUP BY month, campaign, ad_group ORDER BY month`, P),
    query(`SELECT ${MON}, ad_group, dim AS media, ${AGG} FROM ad_stats WHERE account_id = $1 AND month <= $2 AND level = 'media' GROUP BY month, ad_group, dim ORDER BY month`, P),
    query(
      `SELECT ad_group, dim AS keyword,
              SUM(impressions) FILTER (WHERE month = $2)::float8 AS imp, SUM(clicks) FILTER (WHERE month = $2)::float8 AS clk,
              SUM(cost) FILTER (WHERE month = $2)::float8 AS cost,
              (SUM(avg_rank * GREATEST(impressions,1)) FILTER (WHERE month = $2 AND avg_rank IS NOT NULL)
                / NULLIF(SUM(GREATEST(impressions,1)) FILTER (WHERE month = $2 AND avg_rank IS NOT NULL),0))::float8 AS rank,
              COALESCE(SUM(impressions) FILTER (WHERE month = $3),0)::float8 AS prev_imp,
              COALESCE(SUM(clicks) FILTER (WHERE month = $3),0)::float8 AS prev_clk,
              COALESCE(SUM(cost) FILTER (WHERE month = $3),0)::float8 AS prev_cost
         FROM ad_stats WHERE account_id = $1 AND level = 'keyword' AND month IN ($2::date, $3::date)
        GROUP BY ad_group, dim HAVING SUM(impressions) FILTER (WHERE month = $2) IS NOT NULL`,
      [accountId, until, `${prev}-01`],
    ),
    query(
      `SELECT ad_group, search_type,
              COALESCE(SUM(impressions) FILTER (WHERE month = $3),0)::float8 AS prev_imp, COALESCE(SUM(impressions) FILTER (WHERE month = $2),0)::float8 AS cur_imp,
              COALESCE(SUM(clicks) FILTER (WHERE month = $3),0)::float8 AS prev_clk, COALESCE(SUM(clicks) FILTER (WHERE month = $2),0)::float8 AS cur_clk
         FROM ad_stats WHERE account_id = $1 AND level = 'searchterm' AND month IN ($2::date, $3::date)
        GROUP BY ad_group, search_type ORDER BY ad_group, search_type`,
      [accountId, until, `${prev}-01`],
    ),
    query(
      `SELECT c.ad_group, c.dim AS term, c.search_type, c.impressions::float8 AS imp, c.clicks::float8 AS clk, c.cost::float8 AS cost, c.avg_rank::float8 AS rank,
              COALESCE(p.clicks,0)::float8 AS prev_clk
         FROM ad_stats c
         LEFT JOIN ad_stats p ON p.account_id = c.account_id AND p.level = 'searchterm' AND p.month = $3
              AND p.ad_group = c.ad_group AND p.dim = c.dim AND p.search_type = c.search_type
        WHERE c.account_id = $1 AND c.level = 'searchterm' AND c.month = $2
        ORDER BY c.clicks DESC, c.impressions DESC LIMIT 100`,
      [accountId, until, `${prev}-01`],
    ),
    query(
      `SELECT ad_group, dim AS term, search_type,
              COALESCE(SUM(clicks) FILTER (WHERE month = $3),0)::float8 AS prev_clk,
              COALESCE(SUM(clicks) FILTER (WHERE month = $2),0)::float8 AS cur_clk,
              COALESCE(SUM(impressions) FILTER (WHERE month = $2),0)::float8 AS cur_imp
         FROM ad_stats WHERE account_id = $1 AND level = 'searchterm' AND month IN ($2::date, $3::date)
        GROUP BY ad_group, dim, search_type
       HAVING COALESCE(SUM(clicks) FILTER (WHERE month = $2),0) - COALESCE(SUM(clicks) FILTER (WHERE month = $3),0) > 0
        ORDER BY COALESCE(SUM(clicks) FILTER (WHERE month = $2),0) - COALESCE(SUM(clicks) FILTER (WHERE month = $3),0) DESC LIMIT 10`,
      [accountId, until, `${prev}-01`],
    ),
    query(
      `SELECT to_char(n.month, 'YYYY-MM') AS month, n.tax_invoice::float8 AS tax_invoice, n.coupon::float8 AS coupon, n.note, n.opinion, n.updated_at, COALESCE(u.name,'') AS opinion_by
         FROM ad_monthly_notes n LEFT JOIN users u ON u.id = n.opinion_by WHERE n.account_id = $1 AND n.month <= $2`,
      P,
    ),
    // 해당 월 설정이 없으면 가장 최근 월 설정을 사용
    query(
      `SELECT DISTINCT ON (ad_group) ad_group, daily_budget::float8 AS daily_budget, region_target, ${MON}
         FROM ad_group_settings WHERE account_id = $1 AND month <= $2 ORDER BY ad_group, month DESC`,
      P,
    ),
  ]);

  // ── 월별 합계: 계정 보고서 우선, 없으면 캠페인 합계
  const byMonth = new Map<string, { account?: M; campaign?: M }>();
  for (const r of lvRows as any[]) {
    const e = byMonth.get(r.month) ?? {};
    e[r.level as 'account' | 'campaign'] = toM(r);
    byMonth.set(r.month, e);
  }
  const noteMap = new Map((noteRows as any[]).map((n) => [n.month, n]));
  const totals: MonthTotal[] = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m, e]) => {
      const n = noteMap.get(m);
      return {
        month: m,
        ...(e.account ?? e.campaign!),
        tax_invoice: n?.tax_invoice ?? null,
        coupon: n?.coupon ?? null,
        note: n?.note ?? '',
      };
    });

  const typeOf = new Map(campTypeMap.filter((c) => c.campaign).map((c) => [c.campaign, c.type]));
  const campSeries = (campRows as any[]).map((r) => ({ type: r.type, month: r.month, ...toM(r) }));
  const types = [...new Set(campSeries.filter((s) => s.month === month).map((s) => s.type))];
  for (const t of campSeries.map((s) => s.type)) if (!types.includes(t)) types.push(t);

  const groupsMap = new Map<string, { type: string; campaign: string; ad_group: string }>();
  for (const r of grpRows as any[]) {
    if (!groupsMap.has(r.ad_group) || r.month === month) {
      groupsMap.set(r.ad_group, { type: (r.campaign && typeOf.get(r.campaign)) || '', campaign: r.campaign, ad_group: r.ad_group });
    }
  }
  const grpSeries = (grpRows as any[]).map((r) => ({ ad_group: r.ad_group, month: r.month, ...toM(r) }));
  // 그룹 정렬: 당월 비용 큰 순
  const curCost = new Map(grpSeries.filter((g) => g.month === month).map((g) => [g.ad_group, g.cost]));
  const groups = [...groupsMap.values()].sort((a, b) => (curCost.get(b.ad_group) ?? -1) - (curCost.get(a.ad_group) ?? -1));

  const cur = noteMap.get(month);
  return {
    account: acc,
    month,
    prevMonth: prev,
    months: totals.map((t) => t.month),
    coverage: Object.fromEntries(coverRows.map((c) => [c.level, true])),
    totals,
    campaignTypes: { types, series: campSeries },
    adGroups: {
      groups,
      series: grpSeries,
      settings: (settingRows as any[]).map((s) => ({ ad_group: s.ad_group, daily_budget: s.daily_budget, region_target: s.region_target, fromMonth: s.month })),
    },
    media: (mediaRows as any[]).map((r) => ({ ad_group: r.ad_group, media: r.media, month: r.month, ...toM(r) })),
    keywords: (kwRows as any[])
      .map((r) => ({ ad_group: r.ad_group, keyword: r.keyword, ...toM(r), prevImp: r.prev_imp, prevClk: r.prev_clk, prevCost: r.prev_cost }))
      .sort((a, b) => b.clk - a.clk || b.imp - a.imp),
    searchTerms: {
      typeSummary: (stTypeRows as any[]).map((r) => ({ ad_group: r.ad_group, search_type: r.search_type || '-', prevImp: r.prev_imp, curImp: r.cur_imp, prevClk: r.prev_clk, curClk: r.cur_clk })),
      top: (stTopRows as any[]).map((r) => ({ ad_group: r.ad_group, term: r.term, search_type: r.search_type, ...toM(r), prevClk: r.prev_clk })),
      risers: (stRiserRows as any[]).map((r) => ({ ad_group: r.ad_group, term: r.term, search_type: r.search_type, prevClk: r.prev_clk, curClk: r.cur_clk, curImp: r.cur_imp })),
    },
    notes: {
      tax_invoice: cur?.tax_invoice ?? null,
      coupon: cur?.coupon ?? null,
      note: cur?.note ?? '',
      opinion: cur?.opinion ?? '',
      updated_at: cur?.updated_at ?? null,
      opinion_by: cur?.opinion_by ?? '',
    },
  };
}

// ── AI 담당자 의견용 요약 ───────────────────────────────
const pct = (a: number, b: number) => (b ? `${a >= b ? '+' : ''}${(((a - b) / b) * 100).toFixed(1)}%` : '전월 없음');
const n0 = (v: number) => Math.round(v).toLocaleString('ko-KR');
function line(label: string, c: M | undefined, p: M | undefined) {
  if (!c) return `${label}: 당월 데이터 없음`;
  const base = `${label}: 노출 ${n0(c.imp)}, 클릭 ${n0(c.clk)}, 클릭률 ${ctr(c).toFixed(2)}%, 평균클릭비용 ${n0(cpc(c))}원, 광고비 ${n0(c.cost)}원${c.rank != null ? `, 평균노출순위 ${c.rank}` : ''}`;
  if (!p) return `${base} (전월 데이터 없음)`;
  return `${base} | 전월 대비 노출 ${pct(c.imp, p.imp)}, 클릭 ${pct(c.clk, p.clk)}, 평균클릭비용 ${pct(cpc(c), cpc(p))}, 광고비 ${pct(c.cost, p.cost)}`;
}

export function summarizeForAI(r: AdReport): string {
  const L: string[] = [];
  const t = (m: string) => r.totals.find((x) => x.month === m);
  L.push(`[광고주] ${r.account.name} / 보고 월: ${r.month} / 비교 월: ${r.prevMonth}`);
  L.push(line('[전체]', t(r.month), t(r.prevMonth)));
  const cs = (type: string, m: string) => r.campaignTypes.series.find((s) => s.type === type && s.month === m);
  for (const type of r.campaignTypes.types) L.push(line(`[캠페인 유형 ${type}]`, cs(type, r.month), cs(type, r.prevMonth)));
  const gs = (g: string, m: string) => r.adGroups.series.find((s) => s.ad_group === g && s.month === m);
  for (const g of r.adGroups.groups) L.push(line(`[광고그룹 ${g.ad_group}${g.type ? ` (${g.type})` : ''}]`, gs(g.ad_group, r.month), gs(g.ad_group, r.prevMonth)));
  const medias = [...new Set(r.media.filter((m) => m.month === r.month).map((m) => `${m.ad_group}\u0001${m.media}`))];
  for (const k of medias) {
    const [g, md] = k.split('\u0001');
    const f = (m: string) => r.media.find((x) => x.ad_group === g && x.media === md && x.month === m);
    L.push(line(`[매체 ${g} - ${md}]`, f(r.month), f(r.prevMonth)));
  }
  const hasPrev = Boolean(t(r.prevMonth));
  const kwd = (k: AdReport['keywords'][number]) => k.clk - k.prevClk;
  const up = [...r.keywords].filter((k) => kwd(k) > 0).sort((a, b) => kwd(b) - kwd(a)).slice(0, 8);
  const down = [...r.keywords].filter((k) => kwd(k) < 0).sort((a, b) => kwd(a) - kwd(b)).slice(0, 5);
  if (up.length) L.push('[키워드 클릭 증가 상위] ' + up.map((k) => `${k.keyword}(${k.ad_group}) ${n0(k.prevClk)}→${n0(k.clk)}건`).join(', '));
  if (down.length) L.push('[키워드 클릭 감소 상위] ' + down.map((k) => `${k.keyword}(${k.ad_group}) ${n0(k.prevClk)}→${n0(k.clk)}건`).join(', '));
  if (hasPrev) {
    const has = (g: string, m: string) => Boolean(gs(g, m));
    const newG = r.adGroups.groups.filter((g) => has(g.ad_group, r.month) && !has(g.ad_group, r.prevMonth)).map((g) => g.ad_group);
    const stopG = r.adGroups.groups.filter((g) => !has(g.ad_group, r.month) && has(g.ad_group, r.prevMonth)).map((g) => g.ad_group);
    if (newG.length) L.push(`[당월 신규 광고그룹] ${newG.join(', ')}`);
    if (stopG.length) L.push(`[당월 미운영(전월만 있음) 광고그룹] ${stopG.join(', ')}`);
  }
  if (r.searchTerms.risers.length) {
    L.push('[검색어 클릭 증가 상위] ' + r.searchTerms.risers.map((s) => `${s.term}(${s.ad_group}, ${s.search_type}) ${n0(s.prevClk)}→${n0(s.curClk)}건`).join(', '));
  }
  if (r.notes.note) L.push(`[당월 비고] ${r.notes.note}`);
  const prevNote = t(r.prevMonth)?.note;
  if (prevNote) L.push(`[전월 비고] ${prevNote}`);
  for (const s of r.adGroups.settings) {
    if (s.daily_budget || s.region_target) L.push(`[그룹 설정 ${s.ad_group}] 하루예산 ${s.daily_budget ? n0(s.daily_budget) + '원' : '-'}, 지역타겟 ${s.region_target || '-'}`);
  }
  return L.join('\n');
}
