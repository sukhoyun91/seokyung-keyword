import { query } from '../db';
import { HttpError } from '../auth';
import { ensureEventsSchema } from './schema';
import type { EvReport } from './types';

export async function loadReport(id: number): Promise<EvReport> {
  await ensureEventsSchema();
  const r = (
    await query<any>(
      `SELECT r.id, r.title, to_char(r.period_start,'YYYY-MM-DD') AS period_start, to_char(r.period_end,'YYYY-MM-DD') AS period_end,
              r.regions, r.keywords, r.options, r.status, r.steps, r.sources, r.result, r.memo,
              COALESCE(u.name,'') AS created_by_name, r.created_by, r.created_at, r.updated_at
         FROM event_reports r LEFT JOIN users u ON u.id = r.created_by WHERE r.id = $1`,
      [id],
    )
  )[0];
  if (!r) throw new HttpError(404, '보고서를 찾을 수 없습니다.');
  const parse = (v: any, d: any) => (typeof v === 'string' ? JSON.parse(v) : v ?? d);
  return {
    ...r,
    regions: r.regions ? String(r.regions).split(',').filter(Boolean) : [],
    keywords: r.keywords ? String(r.keywords).split(',').filter(Boolean) : [],
    options: parse(r.options, {}),
    steps: parse(r.steps, {}),
    sources: parse(r.sources, []),
    result: parse(r.result, null),
  };
}

export async function saveFields(id: number, fields: Record<string, unknown>) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}${['steps', 'sources', 'result', 'options'].includes(k) ? '::jsonb' : ''}`);
  const vals = keys.map((k) => (['steps', 'sources', 'result', 'options'].includes(k) ? JSON.stringify(fields[k]) : fields[k]));
  await query(`UPDATE event_reports SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`, [id, ...vals]);
}
