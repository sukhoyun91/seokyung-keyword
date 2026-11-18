import { query } from '../db';
import { ADS_SCHEMA_SQL } from './schema-sql';

let ready: Promise<void> | null = null;

/** 광고 보고서 테이블이 없으면 생성 (서버 인스턴스당 1회) */
export function ensureAdsSchema() {
  if (!ready) {
    ready = (async () => {
      for (const stmt of ADS_SCHEMA_SQL.split(';').map((s) => s.replace(/--.*$/gm, '').trim()).filter(Boolean)) {
        await query(stmt);
      }
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}
