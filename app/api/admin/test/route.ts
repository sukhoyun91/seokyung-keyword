import { requireAdmin, errorResponse } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { pingClaude } from '@/lib/claude';
import { fetchKeywordStats } from '@/lib/naver';
import { findRank, parseAreas, EXPOSURE_AREAS, normalizeTarget } from '@/lib/exposure';
import { collectTour, tourDiagText, collectStd, stdDiagText, collectGov, govDiagText, domainsFor } from '@/lib/events/sources';
import { fetchSite } from '@/lib/site';

export const runtime = 'nodejs';

/** body: { target: 'claude' | 'naver' | 'hub' } — 저장된 키로 연결 테스트 */
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const { target } = await req.json();
    const s = await getSettings();
    if (target === 'claude') {
      if (!s.anthropic_api_key) return Response.json({ ok: false, message: 'Claude API 키가 저장되어 있지 않습니다.' });
      try {
        const model = await pingClaude(s.anthropic_api_key, s.claude_model);
        return Response.json({ ok: true, message: `연결 성공 (모델: ${model})` });
      } catch (e: any) {
        return Response.json({ ok: false, message: `연결 실패: ${e?.message ?? e}` });
      }
    }
    if (target === 'naver') {
      if (!s.naver_customer_id || !s.naver_access_license || !s.naver_secret_key) {
        return Response.json({ ok: false, message: '네이버 고객 ID·액세스 라이선스·비밀키를 모두 저장하세요.' });
      }
      try {
        const { stats } = await fetchKeywordStats(['인터넷가입'], {
          customerId: s.naver_customer_id, accessLicense: s.naver_access_license, secretKey: s.naver_secret_key,
        });
        const st = stats.get('인터넷가입');
        return Response.json({
          ok: true,
          message: `연결 성공 — '인터넷가입' 월간 검색량 PC ${st?.pcLabel ?? '-'} / 모바일 ${st?.mobileLabel ?? '-'} (연관 키워드 ${stats.size}개)`,
        });
      } catch (e: any) {
        return Response.json({ ok: false, message: `연결 실패: ${e?.message ?? e}` });
      }
    }
    if (target === 'hub') {
      if (!s.naver_hub_client_id || !s.naver_hub_client_secret) {
        return Response.json({ ok: false, message: 'API HUB Client ID와 Client Secret을 모두 저장하세요.' });
      }
      const targets = s.exposure_targets.split(',').map(normalizeTarget).filter(Boolean);
      const areas = parseAreas(s.exposure_areas);
      try {
        const parts: string[] = [];
        for (const a of areas.length ? areas : (['blog'] as const)) {
          const r = await findRank(a, '서경방송', targets, { clientId: s.naver_hub_client_id, clientSecret: s.naver_hub_client_secret });
          parts.push(`${EXPOSURE_AREAS[a]} ${r ? `${r}위` : '100위 밖'}`);
        }
        return Response.json({ ok: true, message: `연결 성공 — '서경방송' 검색 시 노출: ${parts.join(' · ')}` });
      } catch (e: any) {
        return Response.json({ ok: false, message: `연결 실패: ${e?.message ?? e}` });
      }
    }
    if (target === 'tour') {
      if (!s.tour_api_key) return Response.json({ ok: false, message: 'TourAPI 인증키를 저장하세요.' });
      try {
        const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
        const end = new Date(Date.now() + (9 * 3600 + 60 * 86400) * 1000).toISOString().slice(0, 10);
        const sido = s.event_default_sido || '경상남도';
        const regions = s.event_default_regions.split(',').map((x) => x.trim()).filter(Boolean);
        const { sources: found, diag } = await collectTour({ serviceKey: s.tour_api_key, start: today, end, regions, sido });
        let stdLine = '';
        try {
          const st = await collectStd({ serviceKey: s.tour_api_key, start: today, end, regions, sido });
          stdLine = `[문화축제 표준데이터] ${st.sources.length}건 — ${stdDiagText(st.diag)}${st.diag.sample[0] ? ` / 예: ${st.diag.sample[0]}` : ''}`;
        } catch (e: any) {
          stdLine = `[문화축제 표준데이터] 실패: ${e?.message ?? e}`;
        }
        const lines = [
          `[TourAPI] 연결 성공 — 앞으로 60일간 설정 지역 축제 ${found.length}건${found[0] ? ` (예: ${found[0].title})` : ''}`,
          tourDiagText(diag),
          stdLine,
          diag.inSido ? `${diag.sido} 자료 주소 예시: ${diag.sampleAddrs.slice(0, 5).join(' / ')}` : `받은 자료 예시: ${diag.sampleOther.join(' / ') || '없음'}`,
        ];
        return Response.json({ ok: true, message: lines.join('\n') });
      } catch (e: any) {
        return Response.json({ ok: false, message: `연결 실패: ${e?.message ?? e}` });
      }
    }
    if (target === 'gov') {
      if (!s.anthropic_api_key) return Response.json({ ok: false, message: 'Claude API 키를 먼저 저장하세요.' });
      const sido = s.event_default_sido || '경상남도';
      const region = s.event_default_regions.split(',').map((x) => x.trim()).filter(Boolean)[0] || '진주시';
      const domains = domainsFor(s.gov_domains, [region], sido);
      const now = new Date(Date.now() + 9 * 3600_000);
      const ms = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      const me = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0));
      const start = ms.toISOString().slice(0, 10), end = me.toISOString().slice(0, 10);
      try {
        const { diag } = await collectGov({
          apiKey: s.anthropic_api_key, model: s.claude_model || 'claude-haiku-5-5', start, end, regions: [region], sido, keywords: ['축제', '행사'],
          domains, maxUses: 3, timeBudgetMs: 45_000,
          fetchPage: async (url) => { const p = await fetchSite(url); return `${p.title} ${p.headings.join(' ')} ${p.text}`; },
        });
        const lines = [
          `${region} · ${start}~${end} · 검색 도메인: ${domains.map((d) => d.domain).join(', ')}`,
          govDiagText(diag),
          `검색어: ${diag.queries.map((q) => `"${q.q}"→${q.error ? `오류 ${q.error}` : `${q.results}건`}`).join(', ') || '검색 안 함'}`,
          ...diag.urls.slice(0, 6).map((u) => `· ${u.title} [${u.fetched}${u.note ? `: ${u.note}` : ''}] ${u.url}`),
          `AI 답변: ${diag.aiText.replace(/\s+/g, ' ').slice(0, 300)}`,
        ];
        return Response.json({ ok: diag.urls.length > 0, message: lines.join('\n') });
      } catch (e: any) {
        return Response.json({ ok: false, message: `실패: ${e?.message ?? e}` });
      }
    }
    return Response.json({ ok: false, message: '알 수 없는 대상' }, { status: 400 });
  } catch (e) {
    return errorResponse(e);
  }
}
