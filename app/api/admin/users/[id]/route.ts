import bcrypt from 'bcryptjs';
import { query } from '@/lib/db';
import { requireAdmin, errorResponse } from '@/lib/auth';

type Ctx = { params: Promise<{ id: string }> };

async function adminCount() {
  const r = await query<{ n: number }>("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND active");
  return r[0]?.n ?? 0;
}

/** 이름·권한·사용여부 변경, 비밀번호 초기화 */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const me = await requireAdmin();
    const id = Number((await params).id);
    const body = await req.json();
    const target = (await query<{ role: string; active: boolean }>('SELECT role, active FROM users WHERE id = $1', [id]))[0];
    if (!target) return Response.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });

    const demoting =
      target.role === 'admin' && target.active && (body.role === 'user' || body.active === false);
    if (demoting && (await adminCount()) <= 1) {
      return Response.json({ error: '마지막 관리자 계정은 권한 해제·중지할 수 없습니다.' }, { status: 400 });
    }
    if (id === me.id && body.active === false) {
      return Response.json({ error: '자기 자신은 사용 중지할 수 없습니다.' }, { status: 400 });
    }

    if (typeof body.name === 'string' && body.name.trim()) await query('UPDATE users SET name = $1 WHERE id = $2', [body.name.trim(), id]);
    if (body.role === 'admin' || body.role === 'user') await query('UPDATE users SET role = $1 WHERE id = $2', [body.role, id]);
    if (typeof body.active === 'boolean') await query('UPDATE users SET active = $1 WHERE id = $2', [body.active, id]);
    if (body.password) {
      if (String(body.password).length < 8) return Response.json({ error: '비밀번호는 8자 이상이어야 합니다.' }, { status: 400 });
      await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(String(body.password), 10), id]);
    }
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const me = await requireAdmin();
    const id = Number((await params).id);
    if (id === me.id) return Response.json({ error: '자기 자신은 삭제할 수 없습니다.' }, { status: 400 });
    const target = (await query<{ role: string }>('SELECT role FROM users WHERE id = $1', [id]))[0];
    if (target?.role === 'admin' && (await adminCount()) <= 1) {
      return Response.json({ error: '마지막 관리자 계정은 삭제할 수 없습니다.' }, { status: 400 });
    }
    await query('DELETE FROM users WHERE id = $1', [id]);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
