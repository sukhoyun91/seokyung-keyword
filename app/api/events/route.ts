import { query } from '@/lib/db';
import { requireUser, errorResponse, HttpError } from '@/lib/auth';
import { ensureEventsSchema } from '@/lib/events/schema';
import { BASE_KEYWORDS } from '@/lib/events/types';
import { findSido } from '@/lib/events/regions';

const isDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const clean = (a: unknown, max = 20) =>
  [...new Set((Array.isArray(a) ? a : []).map((x) => String(x).replace(/,/g, ' ').trim()).filter(Boolean))].slice(0, max);

/** 보고서 목록 */
export async function GET() {
  try {
    await requireUser();
    await ensureEventsSchema();
    const rows = await query(
      `SELECT r.id, r.title, to_char(r.period_start,'YYYY-MM-DD') AS period_start, to_char(r.period_end,'YYYY-MM-DD') AS period_end,
              r.regions, r.keywords, r.status, r.created_at, r.created_by, COALESCE(u.name,'') AS created_by_name,
              COALESCE(jsonb_array_length(r.result->'events'), 0) AS event_count, jsonb_array_length(r.sources) AS source_count
         FROM event_reports r LEFT JOIN users u ON u.id = r.created_by
        ORDER BY r.created_at DESC LIMIT 200`,
    );
    return Response.json({ reports: rows });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 새 보고서 만들기 (수집은 화면에서 단계별로 실행) */
export async function POST(req: Request) {
  try {
    const me = await requireUser();
    await ensureEventsSchema();
    const b = await req.json();
    if (!isDate(b.start) || !isDate(b.end)) throw new HttpError(400, '검색 기간을 입력하세요.');
    if (b.start > b.end) throw new HttpError(400, '검색 시작일이 종료일보다 늦습니다.');
    const days = (new Date(b.end).getTime() - new Date(b.start).getTime()) / 86400000;
    if (days > 92) throw new HttpError(400, '검색 기간은 최대 3개월까지 가능합니다.');
    const sido = findSido(String(b.sido ?? ''));
    if (!sido) throw new HttpError(400, '시·도를 선택하세요.');
    const regions = clean(b.regions, 40).filter((r) => sido.regions.includes(r)); // 경기도 31곳까지 모두 허용
    if (!regions.length) throw new HttpError(400, '시·군·구를 하나 이상 선택하세요.');
    const keywords = clean([...(b.useBase === false ? [] : BASE_KEYWORDS), ...clean(b.keywords)]);
    if (!keywords.length) throw new HttpError(400, '검색어를 하나 이상 입력하세요.');
    if (b.news !== false && regions.length * keywords.length > 160) {
      throw new HttpError(400, `뉴스 검색 조합이 너무 많습니다 (지역 ${regions.length} × 검색어 ${keywords.length}). 지역이나 검색어를 줄이세요 (160개 이하).`);
    }
    const options = { tour: b.tour !== false, std: b.std !== false, news: b.news !== false, gov: b.gov !== false, extra: String(b.extra ?? '').slice(0, 500), sido: sido.name };
    if (!options.tour && !options.std && !options.news && !options.gov) throw new HttpError(400, '수집 출처를 하나 이상 선택하세요.');
    const title = String(b.title ?? '').trim().slice(0, 200) || `${b.start} ~ ${b.end} ${sido.short} ${regions.length === sido.regions.length ? '전체' : regions.length > 3 ? `${regions.slice(0, 3).join('·')} 외 ${regions.length - 3}곳` : regions.join('·')} 축제·행사 정보`;
    const steps: Record<string, unknown> = {
      tour: { status: options.tour ? 'pending' : 'skipped' },
      std: { status: options.std ? 'pending' : 'skipped' },
      news: { status: options.news ? 'pending' : 'skipped' },
      gov: { status: options.gov ? 'pending' : 'skipped' },
      summarize: { status: 'pending' },
    };
    const r = await query<{ id: number }>(
      `INSERT INTO event_reports (title, period_start, period_end, regions, keywords, options, steps, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8) RETURNING id`,
      [title, b.start, b.end, regions.join(','), keywords.join(','), JSON.stringify(options), JSON.stringify(steps), me.id],
    );
    return Response.json({ ok: true, id: r[0].id });
  } catch (e) {
    return errorResponse(e);
  }
}
