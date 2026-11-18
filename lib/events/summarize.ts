import Anthropic from '@anthropic-ai/sdk';
import type { EvResult, EvSource } from './types';
import { validateResult, type RawResult } from './validate';

const TOOL: Anthropic.Messages.Tool = {
  name: 'submit_event_report',
  description: '수집 자료에서 찾은 지역 행사 목록과 검증 메모를 제출합니다.',
  input_schema: {
    type: 'object',
    properties: {
      overview: { type: 'string', description: '검색 기간의 지역 행사 흐름 요약 3~5문장' },
      events: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '행사명 (원문 표기)' },
            start_date: { type: 'string', description: 'YYYY-MM-DD. 출처에 정확한 날짜가 없으면 빈 문자열' },
            end_date: { type: 'string', description: 'YYYY-MM-DD. 하루 행사면 start_date와 같게' },
            date_text: { type: 'string', description: '출처의 날짜 표기 그대로 (예: 12.5.(금)~7.(일))' },
            region: { type: 'string', description: '시·군 이름 (예: 진주)' },
            venue: { type: 'string' },
            organizer: { type: 'string' },
            category: { type: 'string', enum: ['축제', '공연', '전시', '체험', '스포츠', '교육·강좌', '기념·행사', '기타'] },
            summary: { type: 'string', description: '행사 내용 1~2문장' },
            source_ids: { type: 'array', items: { type: 'string' }, description: '근거 출처 번호 (예: S3). 반드시 1개 이상' },
            note: { type: 'string', description: '주의할 점 (출처 간 차이, 변경·취소 소식 등). 없으면 빈 문자열' },
          },
          required: ['name', 'start_date', 'end_date', 'region', 'summary', 'source_ids'],
        },
      },
      conflicts: {
        type: 'array',
        description: '출처끼리 날짜·장소 등이 서로 다른 경우',
        items: { type: 'object', properties: { event: { type: 'string' }, detail: { type: 'string' }, source_ids: { type: 'array', items: { type: 'string' } } }, required: ['event', 'detail'] },
      },
      related: {
        type: 'array',
        description: '행사 목록에는 넣지 않았지만 마케팅에 참고할 만한 기사 (최대 10개)',
        items: { type: 'object', properties: { source_id: { type: 'string' }, why: { type: 'string' } }, required: ['source_id', 'why'] },
      },
    },
    required: ['overview', 'events'],
  },
};

function sourceBlock(s: EvSource) {
  const head = `[${s.id}] (${s.kind === 'tour' ? '관광공사 공식' : s.kind === 'gov' ? `지자체 ${s.publisher}` : `뉴스 ${s.publisher}`}${s.date ? `, 게시 ${s.date}` : ''}) ${s.title}`;
  return `${head}\n${s.snippet}`.slice(0, 900);
}

export async function summarizeEvents(opts: {
  apiKey: string;
  model: string;
  sources: EvSource[];
  start: string;
  end: string;
  regions: string[];
  keywords: string[];
  extra: string;
}): Promise<EvResult> {
  if (!opts.sources.length) {
    return { overview: '수집된 자료가 없습니다. 검색 기간·지역·검색어를 바꾸거나 출처 설정을 확인하세요.', events: [], excluded: [], conflicts: [], related: [], model: opts.model, generatedAt: new Date().toISOString() };
  }
  const prompt = `당신은 경남 서부권 지역 방송사 마케팅팀의 자료 조사 담당입니다. 아래 [수집 자료]만 사용해 지역 축제·행사 정보 보고서를 만드세요.

[조건]
- 검색 기간: ${opts.start} ~ ${opts.end} (이 기간에 열리거나 진행 중인 것만)
- 지역: ${opts.regions.join(', ')}
- 주제: ${opts.keywords.join(', ')}
${opts.extra ? `- 담당자 요청: ${opts.extra}` : ''}

[규칙]
1. 모든 정보는 [수집 자료]에 실제로 적힌 내용만 씁니다. 자료에 없는 날짜·장소·주최를 추측해 채우지 않습니다. 모르면 빈 칸으로 둡니다.
2. 행사마다 근거 출처 번호(source_ids)를 반드시 답니다. 날짜를 확인한 출처를 맨 앞에 둡니다.
3. 같은 행사를 다룬 여러 출처는 하나의 행사로 합치고 출처 번호를 모두 답니다.
4. 관광공사 공식 자료와 기사·지자체 자료의 날짜·장소가 다르면 conflicts에 적습니다. 연기·취소 기사가 있으면 note에 씁니다.
5. 지난 행사 결과 기사(이미 끝난 행사)나 기간 밖 행사는 events에 넣지 않습니다.
6. 행사는 아니지만 홍보에 참고할 기사(지역 관광 동향, 예산, 신규 시설 등)는 related에 최대 10개까지 넣습니다.
7. overview는 이 기간 지역 행사 흐름을 3~5문장으로 요약합니다(보고서 문체: ~임, ~됨).

[수집 자료]
${opts.sources.map(sourceBlock).join('\n\n')}`;

  const client = new Anthropic({ apiKey: opts.apiKey });
  let msg;
  try {
    msg = await client.messages.create({
      model: opts.model,
      max_tokens: 16000,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (e: any) {
    if (e?.status === 401) throw new Error('Claude API 키가 올바르지 않습니다.');
    throw new Error(`Claude API 오류: ${e?.message ?? e}`);
  }
  if (msg.stop_reason === 'max_tokens') throw new Error('AI 정리 결과가 너무 길어 끊겼습니다. 지역이나 검색어 수를 줄여 다시 시도하세요.');
  const block = msg.content.find((b) => b.type === 'tool_use');
  if (!block || block.type !== 'tool_use') throw new Error('AI 정리 결과를 받지 못했습니다. 다시 시도하세요.');
  return validateResult(block.input as RawResult, opts.sources, { start: opts.start, end: opts.end }, msg.model);
}
