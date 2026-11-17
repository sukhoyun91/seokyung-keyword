import bcrypt from 'bcryptjs';
import { query } from '@/lib/db';
import { createSession, errorResponse } from '@/lib/auth';

// 간단한 로그인 시도 제한 (서버 인스턴스 메모리 기준)
const attempts = new Map<string, { n: number; until: number }>();

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json();
    if (!username || !password) return Response.json({ error: '아이디와 비밀번호를 입력하세요.' }, { status: 400 });

    const key = String(username).toLowerCase();
    const a = attempts.get(key);
    if (a && a.until > Date.now()) {
      return Response.json({ error: '로그인 시도가 많습니다. 5분 후 다시 시도하세요.' }, { status: 429 });
    }

    const rows = await query<{ id: number; username: string; name: string; role: 'admin' | 'user'; password_hash: string; active: boolean }>(
      'SELECT id, username, name, role, password_hash, active FROM users WHERE LOWER(username) = $1',
      [key],
    );
    const u = rows[0];
    const valid = u && u.active && (await bcrypt.compare(String(password), u.password_hash));
    if (!valid) {
      const n = (a?.n ?? 0) + 1;
      attempts.set(key, { n, until: n >= 5 ? Date.now() + 5 * 60_000 : 0 });
      return Response.json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' }, { status: 401 });
    }
    attempts.delete(key);
    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [u.id]);
    await createSession({ id: u.id, username: u.username, name: u.name, role: u.role });
    return Response.json({ ok: true, role: u.role });
  } catch (e) {
    return errorResponse(e);
  }
}
