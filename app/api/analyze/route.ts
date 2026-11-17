import { query } from '@/lib/db';
import { requireUser, errorResponse, HttpError } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { generateKeywords, type SourceInput } from '@/lib/claude';
import { fetchKeywordStats, normalizeKeyword } from '@/lib/naver';
import { fetchSite } from '@/lib/site';
import type { ResultRow } from '@/lib/types';
import { checkExposure, parseAreas, EXPOSURE_AREAS } from '@/lib/exposure';

export const runtime = 'nodejs';
export const maxDuration = 60;

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;


export async function POST(req: Request) {
  try {
    const me = await requireUser();
    const body = await req.json();
    const s = await getSettings();

    // ── 입력 검증
    const maxKeywords = Math.max(5, Number(s.max_keywords) || 50);
    const count = Math.min(Math.max(Number(body.count) || 20, 5), maxKeywords);
    const mode = String(body.mode);
    let source: SourceInput;
    let sourceLabel = '';

    if (mode === 'image') {
      if (!IMAGE_TYPES.includes(body.mediaType)) throw new HttpError(400, 'JPG, PNG, WEBP, GIF 이미지만 지원합니다.');
      if (!body.data) throw new HttpError(400, '이미지를 선택하세요.');
      source = { kind: 'image', mediaType: body.mediaType, base64: body.data, name: String(body.name || '') };
      sourceLabel = `이미지: ${body.name || ''}`;
    } else if (mode === 'pdf') {
      if (!body.data) throw new HttpError(400, 'PDF를 선택하세요.');
      source = { kind: 'pdf', base64: body.data, name: String(body.name || '') };
      sourceLabel = `PDF: ${body.name || ''}`;
    } else if (mode === 'site') {
      if (!body.url) throw new HttpError(400, '사이트 주소를 입력하세요.');
      const site = await fetchSite(String(body.url));
      if (site.text.length < 30 && !site.title) {
        throw new HttpError(400, '사이트에서 읽을 수 있는 글자가 거의 없습니다. 화면을 캡처해 이미지로 분석해 주세요.');
      }
      source = { kind: 'site', ...site };
      sourceLabel = `사이트: ${site.url}`;
    } else if (mode === 'text') {
      const text = String(body.text || '').trim();
      if (text.length < 2) throw new HttpError(400, '분석할 텍스트를 입력하세요.');
      source = { kind: 'text', text };
      sourceLabel = '직접 입력 텍스트';
    } else {
      throw new HttpError(400, '입력 방식이 올바르지 않습니다.');
    }

    if (!s.anthropic_api_key) throw new HttpError(400, 'Claude API 키가 설정되지 않았습니다. 관리자에게 문의하세요.');
    const naverReady = Boolean(s.naver_customer_id && s.naver_access_license && s.naver_secret_key);

    // ── 일일 사용 한도 확인
    const limit = Number(s.daily_limit) || 50;
    const used = await query<{ count: number }>(
      "SELECT count FROM usage_daily WHERE user_id = $1 AND day = (NOW() AT TIME ZONE 'Asia/Seoul')::date",
      [me.id],
    );
    if ((used[0]?.count ?? 0) >= limit && me.role !== 'admin') {
      throw new HttpError(429, `오늘 분석 한도(${limit}회)를 모두 사용했습니다.`);
    }

    // ── 1) AI 키워드 후보 생성 (요청 개수의 약 2.5배)
    const candidates = Math.min(Math.ceil(count * 2.5), 100);
    const regions = s.region_list.split(',').map((r) => r.trim()).filter(Boolean);
    const ai = await generateKeywords(source, {
      apiKey: s.anthropic_api_key,
      model: s.claude_model || 'claude-haiku-5-5',
      candidates,
      brandContext: s.brand_context,
      regions,
      useRegion: body.useRegion !== false,
      extra: String(body.extra || '').slice(0, 500),
    });

    await query(
      `INSERT INTO usage_daily (user_id, day, count) VALUES ($1, (NOW() AT TIME ZONE 'Asia/Seoul')::date, 1)
       ON CONFLICT (user_id, day) DO UPDATE SET count = usage_daily.count + 1`,
      [me.id],
    );

    // ── 2) 네이버 검색량 조회 & 정렬
    let rows: ResultRow[] = [];
    const warnings: string[] = [];

    if (!naverReady) {
      warnings.push('네이버 검색광고 API가 설정되지 않아 검색량 없이 AI 키워드만 표시합니다.');
      rows = ai.keywords.slice(0, count).map((k, i) => ({
        rank: i + 1, keyword: k.keyword, type: k.type, source: 'AI 생성', pc: 0, mobile: 0, total: 0,
        pcLabel: '-', mobileLabel: '-', comp: '-', hasData: false,
      }));
    } else {
      const { stats, failed } = await fetchKeywordStats(
        ai.keywords.map((k) => k.keyword),
        { customerId: s.naver_customer_id, accessLicense: s.naver_access_license, secretKey: s.naver_secret_key },
      );
      if (failed.length) warnings.push(`네이버 조회에 실패한 키워드 ${failed.length}개는 검색량 0으로 처리했습니다.`);

      const aiKeys = new Set<string>();
      const all: ResultRow[] = [];
      for (const k of ai.keywords) {
        const key = normalizeKeyword(k.keyword);
        if (!key || aiKeys.has(key)) continue;
        aiKeys.add(key);
        const st = stats.get(key);
        all.push({
          rank: 0, keyword: k.keyword, type: k.type, source: 'AI 생성',
          pc: st?.pc ?? 0, mobile: st?.mobile ?? 0, total: st?.total ?? 0,
          pcLabel: st?.pcLabel ?? '-', mobileLabel: st?.mobileLabel ?? '-', comp: st?.comp ?? '-', hasData: Boolean(st),
        });
      }
      if (body.includeRelated !== false) {
        const related = [...stats.entries()]
          .filter(([key, st]) => !aiKeys.has(key) && st.total >= 10)
          .sort((a, b) => b[1].total - a[1].total)
          .slice(0, count);
        for (const [, st] of related) {
          all.push({
            rank: 0, keyword: st.keyword, type: '네이버 연관', source: '네이버 연관',
            pc: st.pc, mobile: st.mobile, total: st.total, pcLabel: st.pcLabel, mobileLabel: st.mobileLabel, comp: st.comp, hasData: true,
          });
        }
      }
      all.sort((a, b) => b.total - a.total || (a.source === 'AI 생성' ? -1 : 1));
      rows = all.slice(0, count).map((r, i) => ({ ...r, rank: i + 1 }));
      const zero = rows.filter((r) => r.total === 0).length;
      if (zero) warnings.push(`검색량이 확인되지 않은 키워드 ${zero}개가 포함되어 있습니다 (신조어·너무 긴 표현 등).`);
    }

    // ── 3) 서경방송 노출 순위 (선택)
    let exposureAreas: { key: string; label: string }[] = [];
    if (body.checkExposure) {
      const areas = parseAreas(s.exposure_areas);
      const targets = s.exposure_targets.split(',').map((t) => t.trim()).filter(Boolean);
      if (!s.naver_hub_client_id || !s.naver_hub_client_secret) {
        warnings.push('네이버 검색 API(API HUB)가 설정되지 않아 노출 순위를 조회하지 않았습니다.');
      } else if (!areas.length || !targets.length) {
        warnings.push('관리자 설정에 서경방송 주소 목록과 확인 영역을 입력해야 노출 순위를 조회할 수 있습니다.');
      } else {
        const { ranks, errors } = await checkExposure(
          rows.map((r) => r.keyword),
          areas,
          targets,
          { clientId: s.naver_hub_client_id, clientSecret: s.naver_hub_client_secret },
        );
        rows = rows.map((r) => ({ ...r, exposure: ranks.get(r.keyword) ?? {} }));
        exposureAreas = areas.map((a) => ({ key: a, label: EXPOSURE_AREAS[a] }));
        if (errors) warnings.push(`노출 순위 조회 ${errors}건이 실패했습니다 (표에 '오류'로 표시).`);
      }
    }

    return Response.json({
      meta: {
        source: sourceLabel,
        analyzedAt: new Date().toISOString(),
        analyst: me.name,
        requested: count,
        candidates: ai.keywords.length,
        naver: naverReady,
        exposureAreas,
      },
      ai: {
        subject: ai.subject,
        summary: ai.summary,
        detectedText: ai.detectedText,
        englishKeywords: ai.englishKeywords,
        hashtags: ai.hashtags,
        uncertain: ai.uncertain,
      },
      rows,
      warnings,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
