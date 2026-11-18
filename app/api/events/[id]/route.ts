import { query } from '@/lib/db';
import { requireUser, errorResponse, HttpError } from '@/lib/auth';
import { loadReport, saveFields } from '@/lib/events/store';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireUser();
    return Response.json(await loadReport(Number((await params).id)));
  } catch (e) {
    return errorResponse(e);
  }
}

/** 제목·담당자 메모 수정, 행사 항목 삭제(hideEvent) */
export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireUser();
    const id = Number((await params).id);
    const b = await req.json();
    const r = await loadReport(id);
    const f: Record<string, unknown> = {};
    if (typeof b.title === 'string' && b.title.trim()) f.title = b.title.trim().slice(0, 200);
    if (typeof b.memo === 'string') f.memo = b.memo.slice(0, 20000);
    if (typeof b.removeEvent === 'number' && r.result) {
      const ev = r.result.events[b.removeEvent];
      if (ev) {
        r.result.events.splice(b.removeEvent, 1);
        r.result.excluded.push({ name: ev.name, reason: '담당자가 보고서에서 제외', sourceIds: ev.sourceIds });
        f.result = r.result;
      }
    }
    await saveFields(id, f);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 작성자 본인 또는 관리자만 삭제 */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const me = await requireUser();
    const id = Number((await params).id);
    const row = (await query<{ created_by: number }>('SELECT created_by FROM event_reports WHERE id = $1', [id]))[0];
    if (!row) throw new HttpError(404, '보고서를 찾을 수 없습니다.');
    if (me.role !== 'admin' && row.created_by !== me.id) throw new HttpError(403, '작성자 또는 관리자만 삭제할 수 있습니다.');
    await query('DELETE FROM event_reports WHERE id = $1', [id]);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
