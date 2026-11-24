import { requireUser, errorResponse, HttpError } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { aiLayout, type AiLayoutInput } from '@/lib/resize/ai';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** 이미지 리사이징: 개체 묶기 + 사이즈별 배치 계획 (이미지는 저장하지 않음) */
export async function POST(req: Request) {
  try {
    await requireUser();
    const s = await getSettings();
    if (!s.anthropic_api_key) throw new HttpError(400, 'Claude API 키가 설정되지 않았습니다. 관리자 설정에서 입력하세요.');
    const b = await req.json();
    const objects = (Array.isArray(b.objects) ? b.objects : []).slice(0, 150).map((o: any) => ({ id: Number(o.id), x: Math.round(o.x), y: Math.round(o.y), w: Math.round(o.w), h: Math.round(o.h) }));
    const sizes = (Array.isArray(b.sizes) ? b.sizes : []).slice(0, 20).map((z: any) => ({ key: String(z.key).slice(0, 40), w: Number(z.w), h: Number(z.h) })).filter((z: any) => z.w > 0 && z.h > 0);
    if (!objects.length) throw new HttpError(400, '찾은 개체가 없습니다.');
    if (!sizes.length) throw new HttpError(400, '사이즈를 하나 이상 고르세요.');
    if (typeof b.clean !== 'string' || typeof b.marked !== 'string' || b.clean.length > 3_000_000 || b.marked.length > 3_000_000) throw new HttpError(400, '이미지 형식이 올바르지 않습니다.');
    const inp: AiLayoutInput = { clean: b.clean, marked: b.marked, srcW: Number(b.srcW), srcH: Number(b.srcH), objects, sizes };
    const out = await aiLayout(inp, { apiKey: s.anthropic_api_key, model: s.claude_model || 'claude-haiku-5-5' });
    return Response.json(out);
  } catch (e) {
    return errorResponse(e);
  }
}
