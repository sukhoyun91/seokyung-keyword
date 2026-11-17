import Anthropic from '@anthropic-ai/sdk';

export type SourceInput =
  | { kind: 'image'; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; base64: string; name: string }
  | { kind: 'pdf'; base64: string; name: string }
  | { kind: 'site'; url: string; title: string; description: string; keywords: string; headings: string[]; text: string }
  | { kind: 'text'; text: string };

export interface AiKeyword {
  keyword: string;
  type: string; // 핵심 | 연관 | 지역 | 롱테일 | 브랜드
}

export interface AiResult {
  subject: string; // 인식 대상 한 줄
  summary: string; // 자료 요약
  detectedText: string[]; // 이미지 속 글자
  keywords: AiKeyword[];
  englishKeywords: string[];
  hashtags: string[];
  uncertain: string[]; // 판독이 불확실한 항목
}

function buildPrompt(opts: { candidates: number; brandContext: string; regions: string[]; useRegion: boolean; extra: string }) {
  return `당신은 지역 케이블방송·통신사 마케팅팀을 돕는 네이버 검색 키워드 전문가입니다.

[회사 정보]
${opts.brandContext}

[작업]
첨부된 자료(이미지·PDF·사이트·텍스트)를 판독하고, 실제 사람들이 네이버 검색창에 입력할 만한 한국어 검색 키워드 후보를 ${opts.candidates}개 만드세요.

[규칙]
1. 자료에 실제로 나타난 서비스·상품·혜택·요금·이벤트·프로그램을 중심으로 만듭니다. 자료와 무관한 키워드는 만들지 않습니다.
2. 실제 검색어처럼 짧게(대부분 2~4단어) 씁니다. 광고 문구나 문장은 키워드가 아닙니다.
3. 유형을 섞습니다: 핵심(자료의 주제), 연관(같은 수요를 가진 다른 표현·비교 검색), 롱테일(구체적 의도: 가입, 요금, 비교, 후기, 설치, 해지 등), 브랜드(회사·상품명 포함).
${opts.useRegion && opts.regions.length ? `4. 지역 유형도 포함합니다: 다음 지역명과 서비스를 조합 (${opts.regions.join(', ')}). 자료와 관련성이 높은 지역 위주로 만듭니다.` : '4. 지역명 조합 키워드는 만들지 않습니다.'}
5. 중복·띄어쓰기만 다른 표현은 하나만 씁니다.
6. 이미지가 흐리거나 판독이 확실하지 않은 글자·대상은 uncertain 목록에 적습니다.
${opts.extra ? `7. 담당자 추가 요청: ${opts.extra}` : ''}

[출력] 결과는 반드시 submit_keywords 도구로 제출하세요.
- subject: 자료의 인식 대상 한 줄 (예: 결합상품 요금 할인 이벤트 포스터)
- summary: 자료 내용 요약 2~3문장
- detected_text: 자료에서 읽은 주요 문구
- keywords: 키워드 후보 ${opts.candidates}개 (keyword, type)
- english_keywords: 영문 키워드 5~10개
- hashtags: SNS용 해시태그 10~15개
- uncertain: 판독이 불확실한 항목 (없으면 빈 목록)`;
}

const KEYWORD_TOOL: Anthropic.Messages.Tool = {
  name: 'submit_keywords',
  description: '자료 판독 결과와 검색 키워드 후보를 제출합니다.',
  input_schema: {
    type: 'object',
    properties: {
      subject: { type: 'string' },
      summary: { type: 'string' },
      detected_text: { type: 'array', items: { type: 'string' } },
      keywords: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            keyword: { type: 'string' },
            type: { type: 'string', enum: ['핵심', '연관', '롱테일', '지역', '브랜드'] },
          },
          required: ['keyword', 'type'],
        },
      },
      english_keywords: { type: 'array', items: { type: 'string' } },
      hashtags: { type: 'array', items: { type: 'string' } },
      uncertain: { type: 'array', items: { type: 'string' } },
    },
    required: ['subject', 'summary', 'keywords', 'hashtags'],
  },
};

/** 도구 호출이 없을 때만 쓰는 예비 해석 */
function parseJson(text: string): any {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.');
  return JSON.parse(text.slice(start, end + 1));
}

const strArr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);

export async function generateKeywords(
  source: SourceInput,
  opts: { apiKey: string; model: string; candidates: number; brandContext: string; regions: string[]; useRegion: boolean; extra: string },
): Promise<AiResult> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const content: Anthropic.Messages.ContentBlockParam[] = [];

  if (source.kind === 'image') {
    content.push({ type: 'image', source: { type: 'base64', media_type: source.mediaType, data: source.base64 } });
  } else if (source.kind === 'pdf') {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: source.base64 } });
  } else if (source.kind === 'site') {
    content.push({
      type: 'text',
      text: `[분석할 웹사이트]\n주소: ${source.url}\n제목: ${source.title}\n설명: ${source.description}\n메타 키워드: ${source.keywords}\n주요 제목: ${source.headings.join(' / ')}\n본문:\n${source.text}`,
    });
  } else {
    content.push({ type: 'text', text: `[분석할 텍스트]\n${source.text.slice(0, 12_000)}` });
  }
  content.push({ type: 'text', text: buildPrompt(opts) });

  let msg;
  try {
    msg = await client.messages.create({
      model: opts.model,
      max_tokens: 8000,
      tools: [KEYWORD_TOOL],
      tool_choice: { type: 'tool', name: 'submit_keywords' },
      messages: [{ role: 'user', content }],
    });
  } catch (e: any) {
    const status = e?.status;
    if (status === 401) throw new Error('Claude API 키가 올바르지 않습니다. 관리자 설정을 확인하세요.');
    if (status === 404) throw new Error(`Claude 모델 이름(${opts.model})을 찾을 수 없습니다. 관리자 설정을 확인하세요.`);
    if (status === 429) throw new Error('Claude API 사용량 한도에 걸렸습니다. 잠시 후 다시 시도하세요.');
    throw new Error(`Claude API 오류: ${e?.message ?? e}`);
  }

  if (msg.stop_reason === 'max_tokens') {
    throw new Error('AI 응답이 너무 길어 중간에 끊겼습니다. 키워드 개수를 줄여 다시 시도해 주세요.');
  }
  const toolBlock = msg.content.find((b) => b.type === 'tool_use');
  let j: any;
  if (toolBlock && toolBlock.type === 'tool_use') {
    j = toolBlock.input;
  } else {
    const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    try {
      j = parseJson(text);
    } catch {
      throw new Error('AI 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.');
    }
  }
  const seen = new Set<string>();
  const keywords: AiKeyword[] = [];
  for (const k of Array.isArray(j.keywords) ? j.keywords : []) {
    const kw = String(typeof k === 'string' ? k : k?.keyword ?? '').trim();
    const norm = kw.replace(/\s+/g, '').toLowerCase();
    if (!kw || seen.has(norm)) continue;
    seen.add(norm);
    keywords.push({ keyword: kw, type: String(k?.type ?? '연관') });
  }

  return {
    subject: String(j.subject ?? ''),
    summary: String(j.summary ?? ''),
    detectedText: strArr(j.detected_text),
    keywords,
    englishKeywords: strArr(j.english_keywords),
    hashtags: strArr(j.hashtags).map((h) => (h.startsWith('#') ? h : `#${h}`)),
    uncertain: strArr(j.uncertain),
  };
}

/** 관리자 연결 테스트용 */
export async function pingClaude(apiKey: string, model: string) {
  const client = new Anthropic({ apiKey });
  const r = await client.messages.create({ model, max_tokens: 10, messages: [{ role: 'user', content: '안녕' }] });
  return r.model;
}
