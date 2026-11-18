import { requireUser, errorResponse, HttpError } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { loadReport, saveFields } from '@/lib/events/store';
import { collectTour, collectStd, collectNews, collectGov, domainsFor, tourDiagText, stdDiagText, govDiagText } from '@/lib/events/sources';
import { fetchSite } from '@/lib/site';
import { summarizeEvents } from '@/lib/events/summarize';
import type { EvSource, StepKey } from '@/lib/events/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** 출처 번호 다시 매기기 (공식 → 지자체 → 뉴스 순) */
function renumber(list: Omit<EvSource, 'id'>[]): EvSource[] {
  const order = { tour: 0, std: 1, gov: 2, news: 3 } as const;
  return [...list].sort((a, b) => order[a.kind] - order[b.kind]).map((s, i) => ({ ...s, id: `S${i + 1}` }));
}

/**
 * POST { step: 'tour' | 'std' | 'news' | 'gov' | 'summarize' }
 * 한 단계씩 실행해 결과를 저장 (서버 실행 시간 제한을 피하기 위해 화면이 순서대로 호출)
 */
export async function POST(req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  let step: StepKey | null = null;
  try {
    await requireUser();
    step = (await req.json()).step as StepKey;
    if (!['tour', 'std', 'news', 'gov', 'summarize'].includes(step)) throw new HttpError(400, '단계가 올바르지 않습니다.');
    const r = await loadReport(id);
    const s = await getSettings();
    const steps = { ...r.steps, [step]: { status: 'running', at: new Date().toISOString() } };
    await saveFields(id, { steps, status: 'collecting' });

    const keep = (kind: EvSource['kind']) => r.sources.filter((x) => x.kind !== kind).map(({ id: _id, ...x }) => x);
    let message = '';
    let count = 0;

    if (step === 'tour') {
      if (!s.tour_api_key) throw new HttpError(400, 'TourAPI 인증키가 설정되지 않았습니다. 관리자 설정에서 입력하거나 이 출처를 끄세요.');
      const { sources: found, diag } = await collectTour({ serviceKey: s.tour_api_key, start: r.period_start, end: r.period_end, regions: r.regions });
      const sources = renumber([...keep('tour'), ...found]);
      count = found.length;
      message = tourDiagText(diag);
      await saveFields(id, { sources, steps: { ...steps, tour: { status: 'done', count, message, at: new Date().toISOString() } } });
    } else if (step === 'std') {
      if (!s.tour_api_key) throw new HttpError(400, '공공데이터포털 인증키가 설정되지 않았습니다. 관리자 설정에서 입력하거나 이 출처를 끄세요.');
      const { sources: found, diag } = await collectStd({ serviceKey: s.tour_api_key, start: r.period_start, end: r.period_end, regions: r.regions });
      const sources = renumber([...keep('std'), ...found]);
      count = found.length;
      message = stdDiagText(diag);
      await saveFields(id, { sources, steps: { ...steps, std: { status: 'done', count, message, at: new Date().toISOString() } } });
    } else if (step === 'news') {
      if (!s.naver_hub_client_id || !s.naver_hub_client_secret) throw new HttpError(400, '네이버 검색 API(API HUB) 키가 설정되지 않았습니다. 관리자 설정에서 입력하거나 이 출처를 끄세요.');
      const { sources: found, failed } = await collectNews({
        clientId: s.naver_hub_client_id,
        clientSecret: s.naver_hub_client_secret,
        start: r.period_start,
        end: r.period_end,
        regions: r.regions,
        keywords: r.keywords,
      });
      const sources = renumber([...keep('news'), ...found]);
      count = found.length;
      if (failed) message = `검색 ${failed}건 실패`;
      await saveFields(id, { sources, steps: { ...steps, news: { status: 'done', count, message, at: new Date().toISOString() } } });
    } else if (step === 'gov') {
      if (!s.anthropic_api_key) throw new HttpError(400, 'Claude API 키가 설정되지 않았습니다.');
      const domains = domainsFor(s.gov_domains, r.regions);
      if (!domains.length) throw new HttpError(400, '선택한 지역의 지자체 도메인이 관리자 설정에 없습니다.');
      const { sources: found, diag } = await collectGov({
        apiKey: s.anthropic_api_key,
        model: s.claude_model || 'claude-haiku-5-5',
        start: r.period_start,
        end: r.period_end,
        regions: r.regions,
        keywords: r.keywords,
        domains,
        maxUses: Math.min(20, Math.max(1, Number(s.event_web_search_max) || 8)),
        fetchPage: async (url) => {
          const p = await fetchSite(url);
          return `${p.title} ${p.headings.join(' ')} ${p.text}`;
        },
        timeBudgetMs: 48_000,
      });
      const sources = renumber([...keep('gov'), ...found]);
      count = found.length;
      message = govDiagText(diag);
      await saveFields(id, { sources, steps: { ...steps, gov: { status: 'done', count, message, debug: diag, at: new Date().toISOString() } } });
    } else {
      if (!s.anthropic_api_key) throw new HttpError(400, 'Claude API 키가 설정되지 않았습니다.');
      const result = await summarizeEvents({
        apiKey: s.anthropic_api_key,
        model: s.claude_model || 'claude-haiku-5-5',
        sources: r.sources,
        start: r.period_start,
        end: r.period_end,
        regions: r.regions,
        keywords: r.keywords,
        extra: r.options?.extra ?? '',
      });
      count = result.events.length;
      await saveFields(id, { result, status: 'done', steps: { ...steps, summarize: { status: 'done', count, at: new Date().toISOString() } } });
    }
    return Response.json({ ok: true, count, message });
  } catch (e: any) {
    if (step) {
      try {
        const r = await loadReport(id);
        await saveFields(id, { steps: { ...r.steps, [step]: { status: 'error', message: e?.message ?? String(e), at: new Date().toISOString() } } });
      } catch {}
    }
    return errorResponse(e);
  }
}
