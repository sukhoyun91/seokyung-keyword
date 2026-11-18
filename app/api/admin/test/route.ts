import { requireAdmin, errorResponse } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { pingClaude } from '@/lib/claude';
import { fetchKeywordStats } from '@/lib/naver';
import { findRank, parseAreas, EXPOSURE_AREAS, normalizeTarget } from '@/lib/exposure';
import { collectTour } from '@/lib/events/sources';

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
        const regions = s.region_list.split(',').map((x) => x.trim()).filter(Boolean);
        const found = await collectTour({ serviceKey: s.tour_api_key, start: today, end, regions });
        return Response.json({ ok: true, message: `연결 성공 — 앞으로 60일간 설정 지역 축제 ${found.length}건${found[0] ? ` (예: ${found[0].title})` : ''}` });
      } catch (e: any) {
        return Response.json({ ok: false, message: `연결 실패: ${e?.message ?? e}` });
      }
    }
    return Response.json({ ok: false, message: '알 수 없는 대상' }, { status: 400 });
  } catch (e) {
    return errorResponse(e);
  }
}
