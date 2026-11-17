import bcrypt from 'bcryptjs';
import { query } from '@/lib/db';
import { requireAdmin, errorResponse } from '@/lib/auth';

export async function GET() {
  try {
    await requireAdmin();
    const users = await query(
      `SELECT u.id, u.username, u.name, u.role, u.active, u.created_at, u.last_login_at,
              COALESCE(d.count, 0) AS today_count
         FROM users u
         LEFT JOIN usage_daily d ON d.user_id = u.id AND d.day = (NOW() AT TIME ZONE 'Asia/Seoul')::date
        ORDER BY u.role, u.username`,
    );
    return Response.json({ users });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    await requireAdmin();
    const { username, name, password, role } = await req.json();
    if (!/^[a-zA-Z0-9._-]{3,50}$/.test(username || '')) {
      return Response.json({ error: '아이디는 영문·숫자·._- 조합 3~50자로 입력하세요.' }, { status: 400 });
    }
    if (!name) return Response.json({ error: '이름을 입력하세요.' }, { status: 400 });
    if (!password || String(password).length < 8) return Response.json({ error: '비밀번호는 8자 이상이어야 합니다.' }, { status: 400 });
    const exists = await query('SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    if (exists.length) return Response.json({ error: '이미 사용 중인 아이디입니다.' }, { status: 400 });
    await query('INSERT INTO users (username, name, password_hash, role) VALUES ($1, $2, $3, $4)', [
      username,
      name,
      await bcrypt.hash(String(password), 10),
      role === 'admin' ? 'admin' : 'user',
    ]);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
