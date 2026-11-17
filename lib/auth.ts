import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { query } from './db';

export const SESSION_COOKIE = 'skw_session';
const SESSION_HOURS = 10;

export type Role = 'admin' | 'user';
export interface SessionUser {
  id: number;
  username: string;
  name: string;
  role: Role;
}

export function secretKey() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET 은 32자 이상이어야 합니다.');
  return new TextEncoder().encode(s);
}

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({ uid: user.id, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secretKey());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function destroySession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** 쿠키의 세션을 검증하고, DB에서 계정이 아직 활성 상태인지 확인 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    const rows = await query<SessionUser & { active: boolean }>(
      'SELECT id, username, name, role, active FROM users WHERE id = $1',
      [payload.uid],
    );
    const u = rows[0];
    if (!u || !u.active) return null;
    return { id: u.id, username: u.username, name: u.name, role: u.role };
  } catch {
    return null;
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) throw new HttpError(401, '로그인이 필요합니다.');
  return u;
}

export async function requireAdmin(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.role !== 'admin') throw new HttpError(403, '관리자만 사용할 수 있습니다.');
  return u;
}

/** API 라우트 공통 오류 응답 */
export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  const msg = e instanceof Error ? e.message : '알 수 없는 오류';
  return Response.json({ error: msg }, { status: 500 });
}
