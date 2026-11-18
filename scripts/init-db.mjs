// DB 테이블 생성 + 최초 관리자 계정 생성
// 사용법: npm run db:init -- <관리자아이디> <비밀번호> [이름]
// 예)    npm run db:init -- admin MyStrongPw!23 마케팅팀관리자
import { readFileSync, existsSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';

// .env.local 간단 로더 (dotenv 없이)
for (const f of ['.env.local', '.env']) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const [username, password, name = '관리자'] = process.argv.slice(2);
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL 이 설정되지 않았습니다. .env.local 을 확인하세요.');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
for (const stmt of schema.split(';').map((s) => s.replace(/--.*$/gm, '').trim()).filter(Boolean)) {
  await sql.query(stmt);
}
const adsSchema = readFileSync(new URL('../db/schema-ads.sql', import.meta.url), 'utf8');
for (const stmt of adsSchema.split(';').map((s) => s.replace(/--.*$/gm, '').trim()).filter(Boolean)) {
  await sql.query(stmt);
}
const evSchema = readFileSync(new URL('../db/schema-events.sql', import.meta.url), 'utf8');
for (const stmt of evSchema.split(';').map((s) => s.replace(/--.*$/gm, '').trim()).filter(Boolean)) {
  await sql.query(stmt);
}
console.log('✔ 테이블 생성 완료 (키워드 분석 + 검색광고 보고서 + 지역 행사 정보)');

if (username && password) {
  if (password.length < 8) {
    console.error('비밀번호는 8자 이상이어야 합니다.');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 10);
  await sql.query(
    `INSERT INTO users (username, name, password_hash, role)
     VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin', active = TRUE`,
    [username, name, hash],
  );
  console.log(`✔ 관리자 계정 준비 완료: ${username}`);
} else {
  console.log('관리자 계정을 만들려면: npm run db:init -- <아이디> <비밀번호> [이름]');
}
