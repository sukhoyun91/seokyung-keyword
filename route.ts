import Anthropic from '@anthropic-ai/sdk';
import { requireUser, errorResponse, HttpError } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { buildReport, summarizeForAI } from '@/lib/ads/report';

export const runtime = 'nodejs';
export const maxDuration = 60;

const STYLE = `[작성 형식 예시 — 구성과 문체만 참고. ○ 표시 자리는 실제 데이터로 채움]
[검색광고]
1) 운영성과
광고비는 유지하면서도, 노출수(+○%) 클릭수(+○%) 동반 상승을 기록. 평균클릭비용은 하락하여 전체 효율 개선됨.
- 특히 [광고그룹A] 광고그룹이 노출수(+○%)와 클릭수(+○%) 대폭 증가하며 전체 성과 견인.
- [광고그룹B] 광고그룹은 노출수와 클릭수가 다소 줄었으나, 효율이 낮은 '콘텐츠 매체' 비중을 줄이고 '검색 매체'에 집중한 결과임.

2) 주요 검색어 클릭수 상승
[광고그룹A] 광고그룹의 검색 매체 클릭수 전월 대비 ○건 상승
검색어1 : ○건 -> ○건 (+○건)

[플레이스광고]
전월 대비 노출·클릭은 소폭 감소(보합세)했으나, 평균 노출순위 ○위, 클릭률(CTR) ○%의 높은 효율을 유지함.`;

/** 담당자 의견 초안 생성 (저장은 화면에서 수정 후 '저장'을 눌러야 됨) */
export async function POST(req: Request) {
  try {
    await requireUser();
    const { accountId, month } = await req.json();
    const s = await getSettings();
    if (!s.anthropic_api_key) throw new HttpError(400, 'Claude API 키가 설정되지 않았습니다. 관리자 설정을 확인하세요.');
    const report = await buildReport(Number(accountId), String(month));
    if (!report.totals.find((t) => t.month === report.month)) throw new HttpError(400, '해당 월 데이터가 없습니다. 원천 파일을 먼저 올려 주세요.');

    const prompt = `당신은 지역 기업 마케팅팀의 검색광고 담당자입니다. 아래 데이터로 사내 전자결재 보고서에 붙일 "담당자 의견"을 작성하세요.

규칙:
- 한국어 보고서 문체(~함, ~됨, ~임)로, 간결한 개조식으로 씁니다.
- 숫자는 [이번 달 데이터]에 있는 값만 쓰고, 없는 수치를 지어내지 않습니다. 증감률은 데이터에 적힌 값을 그대로 씁니다.
- 구성: [검색광고] 1) 운영성과 2) 주요 검색어(또는 키워드) 클릭수 변화 → 플레이스 등 다른 캠페인 유형이 있으면 별도 단락 → 마지막에 "3) 향후 운영 방향" 1~2줄.
- 성과가 나빠진 부분도 숨기지 말고, 데이터로 설명 가능한 원인(매체 비중 변화, 예산·비고 등)이 있을 때만 원인을 씁니다. 추측은 "~로 보임"으로 표시합니다.
- 모든 성과 문장은 반드시 전월(비교 월)과 비교해서 씁니다 (예: "노출수 전월 대비 +○%", "○건 -> ○건"). 전월 데이터가 없으면 첫 줄에 "전월 데이터가 없어 당월 실적만 기술함"이라고 밝힙니다.
- 전체 12~20줄. 제목이나 인사말 없이 본문만 씁니다.

${STYLE}

[이번 달 데이터]
${summarizeForAI(report)}`;

    const client = new Anthropic({ apiKey: s.anthropic_api_key, timeout: 55_000, maxRetries: 0 });
    const model = s.claude_model || 'claude-haiku-5-5';
    const call = (noThinking: boolean) =>
      client.messages.create({
        model,
        max_tokens: 4000,
        ...(noThinking ? { thinking: { type: 'disabled' as const } } : {}),
        messages: [{ role: 'user', content: prompt }],
      });
    let msg;
    try {
      try {
        msg = await call(true);
      } catch (e: any) {
        // 모델이 thinking 설정을 받지 않으면 설정 없이 다시 시도
        if (e?.status === 400 && /thinking/i.test(String(e?.message))) msg = await call(false);
        else throw e;
      }
    } catch (e: any) {
      if (e?.status === 401) throw new HttpError(400, 'Claude API 키가 올바르지 않습니다. 관리자 설정을 확인하세요.');
      if (e?.status === 404) throw new HttpError(400, `Claude 모델 이름(${model})을 찾을 수 없습니다. 관리자 설정의 모델을 확인하세요.`);
      if (e?.status === 429 || e?.status === 529) throw new HttpError(503, 'Claude API가 혼잡합니다. 잠시 후 다시 눌러 주세요.');
      if (e?.name === 'APIConnectionTimeoutError') throw new HttpError(504, 'Claude 응답이 늦어 시간이 초과됐습니다. 다시 눌러 주세요.');
      throw new HttpError(502, `Claude API 오류: ${e?.message ?? e}`);
    }
    const text = msg.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('').trim();
    if (!text) {
      throw new HttpError(502, `AI가 빈 답을 보냈습니다 (모델 ${model}, 종료 사유 ${msg.stop_reason}). 다시 눌러 주시고, 계속되면 관리자 설정에서 모델을 바꿔 보세요.`);
    }
    return Response.json({ opinion: text });
  } catch (e) {
    return errorResponse(e);
  }
}
