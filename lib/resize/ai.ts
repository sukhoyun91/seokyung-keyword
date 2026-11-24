import Anthropic from '@anthropic-ai/sdk';
import type { DecorPos, Role } from './layout';

export interface AiLayoutInput {
  clean: string; // jpeg base64 (축소본)
  marked: string; // 번호 상자 표시본
  srcW: number;
  srcH: number;
  objects: { id: number; x: number; y: number; w: number; h: number }[];
  sizes: { key: string; w: number; h: number }[];
}
export interface AiLayoutOutput {
  groups: { id: string; label: string; role: Role; objectIds: number[] }[];
  plans: Record<string, { rows: string[][]; decor: { groupId: string; position: DecorPos; row?: number }[] }>;
}

const ROLES: Role[] = ['title', 'text', 'card', 'product', 'info', 'logo', 'decoration', 'other'];
const POS: DecorPos[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'left', 'right', 'hide'];

const TOOL: Anthropic.Messages.Tool = {
  name: 'submit_layout',
  description: '원본 이미지의 개체를 의미 단위로 묶고, 사이즈별 재배치 계획을 제출합니다.',
  input_schema: {
    type: 'object',
    properties: {
      groups: {
        type: 'array',
        description: '의미 단위 묶음. 모든 개체 번호는 정확히 한 묶음에만 들어가야 함',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'g1, g2 … 처럼 짧게' },
            label: { type: 'string', description: '사람이 알아볼 짧은 이름 (예: 제목, 기가 인터넷 카드, 이벤트 안내, 눈사람 장식)' },
            role: { type: 'string', enum: ROLES },
            object_ids: { type: 'array', items: { type: 'integer' } },
          },
          required: ['id', 'label', 'role', 'object_ids'],
        },
      },
      layouts: {
        type: 'array',
        description: '요청한 사이즈마다 하나',
        items: {
          type: 'object',
          properties: {
            size_key: { type: 'string' },
            rows: {
              type: 'array',
              description: '장식이 아닌 묶음의 줄 배치. 위→아래, 각 줄은 왼→오른 묶음 id 목록',
              items: { type: 'array', items: { type: 'string' } },
            },
            decorations: {
              type: 'array',
              description: 'role=decoration 묶음의 위치',
              items: {
                type: 'object',
                properties: {
                  group_id: { type: 'string' },
                  position: { type: 'string', enum: POS },
                  row: { type: 'integer', description: 'left/right 일 때 옆에 둘 줄 번호 (0부터)' },
                },
                required: ['group_id', 'position'],
              },
            },
          },
          required: ['size_key', 'rows', 'decorations'],
        },
      },
    },
    required: ['groups', 'layouts'],
  },
};

function prompt(inp: AiLayoutInput) {
  const objs = inp.objects.map((o) => `#${o.id}: x=${o.x}, y=${o.y}, w=${o.w}, h=${o.h}`).join('\n');
  const sizes = inp.sizes.map((s) => `- ${s.key}: ${s.w}×${s.h} (가로:세로 = ${(s.w / s.h).toFixed(2)})`).join('\n');
  return `당신은 광고 이미지 편집 디자이너입니다. 첫 번째 그림은 원본(${inp.srcW}×${inp.srcH}, 가로:세로 ${(inp.srcW / inp.srcH).toFixed(2)}), 두 번째 그림은 같은 이미지에 자동으로 찾은 개체 번호를 분홍 상자로 표시한 것입니다.

[개체 목록 (원본 좌표)]
${objs}

[할 일 1: 묶기]
- 함께 움직여야 하는 개체를 한 묶음으로 만드세요. 예: 한 줄 제목의 글자 조각들, 카드 하나(상자+리본+사진+글), 표처럼 줄이 맞아야 하는 안내문 전체(라벨+내용+주석)는 한 묶음.
- 서로 다른 카드·상품은 각각 다른 묶음 (재배치할 수 있도록).
- 제목 위의 작은 라벨·소제목과 그 옆 장식 그림은, 디자인상 한 덩어리면 한 묶음으로 둬도 됩니다.
- 눈송이·캐릭터 등 떨어져 있는 꾸밈 그림은 각각 role=decoration.
- 모든 개체 번호가 정확히 한 묶음에 들어가야 합니다.

[할 일 2: 사이즈별 줄 배치]
${sizes}
- rows: 장식이 아닌 묶음을 위→아래 줄로 배치. 읽는 순서(제목 → 핵심 내용 → 안내)는 원본과 같게.
- 세로로 긴 화면은 원본에서 한 줄에 나란히 있던 카드를 2+1, 또는 한 줄에 1개씩 나눠 크게 보이게 하세요.
- 가로로 긴 화면은 위아래 줄을 옆으로 합쳐(예: 제목 묶음과 카드 줄을 한 줄에) 세로 높이를 줄이세요.
- 줄 크기·간격은 프로그램이 자동으로 계산하니 순서와 묶는 방식만 정하면 됩니다.
- decorations: 장식은 빈 곳 모서리(top-left 등)나 특정 줄 옆(left/right + row)에. 화면이 좁아 자리가 없으면 hide.

submit_layout 도구로 제출하세요.`;
}

export async function aiLayout(inp: AiLayoutInput, opts: { apiKey: string; model: string }): Promise<AiLayoutOutput> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  let msg;
  try {
    msg = await client.messages.create({
      model: opts.model,
      max_tokens: 6000,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: inp.clean } },
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: inp.marked } },
            { type: 'text', text: prompt(inp) },
          ],
        },
      ],
    });
  } catch (e: any) {
    if (e?.status === 401) throw new Error('Claude API 키가 올바르지 않습니다. 관리자 설정을 확인하세요.');
    if (e?.status === 429) throw new Error('Claude API 사용량 한도에 걸렸습니다. 잠시 후 다시 시도하세요.');
    throw new Error(`Claude API 오류: ${e?.message ?? e}`);
  }
  const tu = msg.content.find((c) => c.type === 'tool_use') as Anthropic.Messages.ToolUseBlock | undefined;
  if (!tu) throw new Error('AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.');
  const raw = tu.input as any;

  // 묶음 정리: 없는 번호 제거, 중복 제거, 빠진 개체는 장식으로
  const valid = new Set(inp.objects.map((o) => o.id));
  const used = new Set<number>();
  const groups: AiLayoutOutput['groups'] = [];
  for (const g of Array.isArray(raw.groups) ? raw.groups : []) {
    const ids = (Array.isArray(g.object_ids) ? g.object_ids : []).map(Number).filter((n: number) => valid.has(n) && !used.has(n));
    ids.forEach((n: number) => used.add(n));
    if (!ids.length) continue;
    const id = String(g.id || `g${groups.length + 1}`).slice(0, 20);
    groups.push({ id: groups.some((x) => x.id === id) ? `${id}_${groups.length}` : id, label: String(g.label || id).slice(0, 40), role: ROLES.includes(g.role) ? g.role : 'other', objectIds: ids });
  }
  for (const o of inp.objects) if (!used.has(o.id)) groups.push({ id: `x${o.id}`, label: `개체 ${o.id}`, role: 'decoration', objectIds: [o.id] });

  const plans: AiLayoutOutput['plans'] = {};
  for (const l of Array.isArray(raw.layouts) ? raw.layouts : []) {
    const key = String(l.size_key);
    if (!inp.sizes.some((s) => s.key === key)) continue;
    plans[key] = {
      rows: (Array.isArray(l.rows) ? l.rows : []).map((r: any) => (Array.isArray(r) ? r.map(String) : [])),
      decor: (Array.isArray(l.decorations) ? l.decorations : []).map((d: any) => ({ groupId: String(d.group_id), position: POS.includes(d.position) ? d.position : 'top-left', row: Number.isInteger(d.row) ? d.row : undefined })),
    };
  }
  return { groups, plans };
}
