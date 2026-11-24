/** 집계 지표 (클릭률·CPC는 화면에서 계산) */
export interface M {
  imp: number;
  clk: number;
  cost: number;
  rank: number | null;
}

export interface MonthTotal extends M {
  month: string;
  tax_invoice: number | null;
  coupon: number | null;
  note: string;
}

export interface AdReport {
  account: { id: number; name: string; customer_id: string; company: string | null; logo: string | null };
  month: string;
  prevMonth: string;
  months: string[];
  coverage: Record<string, boolean>;
  totals: MonthTotal[];
  campaignTypes: { types: string[]; series: (M & { type: string; month: string })[] };
  adGroups: {
    groups: { type: string; campaign: string; ad_group: string }[];
    series: (M & { ad_group: string; month: string })[];
    settings: { ad_group: string; daily_budget: number | null; region_target: string; fromMonth: string }[];
  };
  media: (M & { ad_group: string; media: string; month: string })[];
  keywords: (M & { ad_group: string; keyword: string; prevImp: number; prevClk: number; prevCost: number })[];
  searchTerms: {
    typeSummary: { ad_group: string; search_type: string; prevImp: number; curImp: number; prevClk: number; curClk: number }[];
    top: (M & { ad_group: string; term: string; search_type: string; prevClk: number })[];
    risers: { ad_group: string; term: string; search_type: string; prevClk: number; curClk: number; curImp: number }[];
  };
  notes: { tax_invoice: number | null; coupon: number | null; note: string; opinion: string; updated_at: string | null; opinion_by: string };
}

export const ctr = (m: { imp: number; clk: number }) => (m.imp ? (m.clk / m.imp) * 100 : 0);
export const cpc = (m: { clk: number; cost: number }) => (m.clk ? m.cost / m.clk : 0);

export function prevMonthOf(month: string) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(month: string, short = false) {
  const [y, m] = month.split('-');
  return short ? `${y.slice(2)}년 ${Number(m)}월` : `${y}년 ${m}월`;
}
