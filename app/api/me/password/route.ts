import bcrypt from 'bcryptjs';
import { query } from '@/lib/db';
import { requireUser, errorResponse } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const me = await requireUser();
    const { current, next } = await req.json();
    if (!next || String(next).length < 8) return Response.json({ error: '새 비밀번호는 8자 이상이어야 합니다.' }, { status: 400 });
    const rows = await query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [me.id]);
    if (!rows[0] || !(await bcrypt.compare(String(current || ''), rows[0].password_hash))) {
      return Response.json({ error: '현재 비밀번호가 올바르지 않습니다.' }, { status: 400 });
    }
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(String(next), 10), me.id]);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
