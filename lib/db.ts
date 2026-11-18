import { neon } from '@neondatabase/serverless';

let client: ReturnType<typeof neon> | null = null;

export function getClient() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL 환경변수가 설정되지 않았습니다.');
    client = neon(url);
  }
  return client;
}

/** 파라미터 바인딩 쿼리 실행 ($1, $2 ...) */
export async function query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const rows = await getClient().query(text, params);
  return rows as T[];
}

/** 여러 쿼리를 하나의 트랜잭션으로 실행 (전부 성공 또는 전부 취소) */
export async function transaction(queries: { text: string; params: unknown[] }[]) {
  const sql = getClient();
  return sql.transaction(queries.map((q) => sql.query(q.text, q.params)));
}
