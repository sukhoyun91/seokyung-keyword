/**
 * AI가 정리한 행사 목록의 정합성 검증 (AI를 믿지 않고 프로그램이 다시 확인)
 * 1. 존재하지 않는 출처 번호 제거 → 근거가 하나도 없으면 제외
 * 2. 관광공사(공식) 출처가 있으면 공식 기간과 대조, 다르면 공식 기간으로 고치고 메모
 * 3. 근거 원문(제목·본문)에 날짜가 실제로 들어 있는지 확인
 * 4. 검색 기간과 겹치지 않으면 제외
 * 5. 같은 행사 중복 합치기
 * 6. 신뢰도: 공식 확인(관광공사·지자체) / 복수 출처(서로 다른 언론 2곳 이상) / 확인 필요
 */
import type { EvItem, EvResult, EvSource, Trust } from './types';
import { overlaps } from './sources';

export interface RawEvent {
  name?: string;
  start_date?: string;
  end_date?: string;
  date_text?: string;
  region?: string;
  venue?: string;
  organizer?: string;
  category?: string;
  summary?: string;
  source_ids?: string[];
  note?: string;
}

export interface RawResult {
  overview?: string;
  events?: RawEvent[];
  conflicts?: { event?: string; detail?: string; source_ids?: string[] }[];
  related?: { source_id?: string; why?: string }[];
}

const isDate = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(`${s}T00:00:00Z`).getTime()));
const normName = (s: string) => s.replace(/[\s·・()\[\]「」『』"'<>제0-9회]/g, '').toLowerCase();

/** 근거 텍스트에 해당 날짜(월·일)가 나오는지 */
export function dateInText(date: string, text: string) {
  if (!isDate(date)) return false;
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  const t = text.replace(/\s+/g, ' ');
  const pats = [
    new RegExp(`(^|[^0-9])${m}\\s*월\\s*${d}\\s*일`),
    new RegExp(`(^|[^0-9])0?${m}\\s*[./]\\s*0?${d}(?![0-9])`),
    new RegExp(`${date.slice(0, 4)}\\s*[-./년]\\s*0?${m}\\s*[-./월]\\s*0?${d}`),
  ];
  return pats.some((p) => p.test(t));
}

export function validateResult(raw: RawResult, sources: EvSource[], period: { start: string; end: string }, model: string): EvResult {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const excluded: EvResult['excluded'] = [];
  const merged = new Map<string, EvItem>();

  for (const e of raw.events ?? []) {
    const name = String(e.name ?? '').trim();
    if (!name) continue;
    const askedIds = (e.source_ids ?? []).map((x) => String(x).trim().toUpperCase());
    const ids = [...new Set(askedIds.filter((x) => byId.has(x)))];
    if (!ids.length) {
      excluded.push({ name, reason: askedIds.length ? '존재하지 않는 출처를 근거로 들어 제외' : '근거 출처가 없어 제외', sourceIds: [] });
      continue;
    }
    const srcs = ids.map((x) => byId.get(x)!);
    const notes: string[] = [];
    let start = isDate(e.start_date) ? e.start_date! : '';
    let end = isDate(e.end_date) ? e.end_date! : start;
    if (end && start && end < start) [start, end] = [end, start];

    // 공식(관광공사·표준데이터) 기간과 대조. 둘 다 있고 서로 다르면 메모
    const offs = srcs.filter((s) => (s.kind === 'tour' || s.kind === 'std') && s.eventStart);
    const tour = offs.find((s) => s.kind === 'tour') ?? offs[0];
    const other = offs.find((s) => s !== tour);
    if (tour && other && (other.eventStart !== tour.eventStart || (other.eventEnd || other.eventStart) !== (tour.eventEnd || tour.eventStart))) {
      notes.push(`공식 출처끼리 기간이 다름: 관광공사 ${tour.eventStart}~${tour.eventEnd} / 표준데이터 ${other.eventStart}~${other.eventEnd}`);
    }
    if (srcs.some((s) => s.kind === 'std' && s.lastYear) && !tour) notes.push('표준데이터에는 작년 일정만 있음 — 올해 일정 확인 필요');
    if (tour) {
      if (start !== tour.eventStart || end !== (tour.eventEnd || tour.eventStart)) {
        if (start) notes.push(`AI 정리 기간(${start}~${end})이 ${tour.kind === 'tour' ? '관광공사' : '표준데이터'} 공식 기간과 달라 공식 기간으로 수정`);
        start = tour.eventStart!;
        end = tour.eventEnd || tour.eventStart!;
      }
    }

    // 근거 원문에 날짜가 있는지
    // 지자체 출처는 AI 요약을 빼고 원문 인용만 근거로 사용
    const evidenceText = srcs.map((s) => `${s.title} ${s.kind === 'gov' ? s.snippet.split('\nAI 요약')[0] : s.snippet}`).join(' ');
    const dateVerified = Boolean(tour) || (start ? dateInText(start, evidenceText) : false);
    if (start && !dateVerified) notes.push('근거 원문에서 날짜를 직접 확인하지 못함');
    if (!start) notes.push('정확한 날짜 미확인');

    // 기간 확인
    if (start && !overlaps(start, end, period.start, period.end)) {
      excluded.push({ name, reason: `검색 기간 밖 (${start}~${end})`, sourceIds: ids });
      continue;
    }

    // 신뢰도
    const govSrc = srcs.some((s) => (s.kind === 'gov' && /\.go\.kr$/.test(s.publisher)) || s.kind === 'sns'); // 지자체 공식 인스타그램도 공식 출처
    const newsPublishers = new Set(srcs.filter((s) => s.kind === 'news').map((s) => s.publisher));
    let trust: Trust = 'check';
    if (tour) trust = 'official';
    else if (start && dateVerified && govSrc) trust = 'official';
    else if (start && dateVerified && newsPublishers.size >= 2) trust = 'cross';
    if (e.note) notes.push(String(e.note));

    const item: EvItem = {
      name,
      start,
      end,
      dateText: String(e.date_text ?? ''),
      region: String(e.region ?? tour?.region ?? srcs.find((s) => s.region)?.region ?? ''),
      venue: String(e.venue ?? (tour?.addr || '')),
      organizer: String(e.organizer || tour?.organizer || ''),
      category: String(e.category ?? '기타'),
      summary: String(e.summary ?? ''),
      sourceIds: ids,
      trust,
      dateVerified,
      notes,
    };

    // 중복 합치기 (이름이 같고 기간이 같거나 비어 있으면)
    const key = `${normName(name)}|${item.region}`;
    const prev = merged.get(key);
    if (prev && (!prev.start || !item.start || prev.start === item.start)) {
      prev.sourceIds = [...new Set([...prev.sourceIds, ...item.sourceIds])];
      prev.notes = [...new Set([...prev.notes, ...item.notes])];
      const rank = { official: 3, cross: 2, check: 1 } as const;
      if (rank[item.trust] > rank[prev.trust]) prev.trust = item.trust;
      prev.dateVerified = prev.dateVerified || item.dateVerified;
      if (!prev.start && item.start) Object.assign(prev, { start: item.start, end: item.end });
      if (!prev.summary && item.summary) prev.summary = item.summary;
    } else {
      merged.set(prev ? `${key}#${merged.size}` : key, item);
    }
  }

  const events = [...merged.values()].sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999') || a.region.localeCompare(b.region) || a.name.localeCompare(b.name));

  // 공식 출처(관광공사·표준데이터) 축제 중 AI가 빠뜨린 항목은 자동으로 추가 (이름이 같은 행사가 이미 있으면 출처만 합침)
  const usedTour = new Set(events.flatMap((e) => e.sourceIds));
  for (const s of sources) {
    if ((s.kind !== 'tour' && s.kind !== 'std') || usedTour.has(s.id) || !s.eventStart) continue;
    const same = events.find((e) => normName(e.name) === normName(s.title) && (!e.start || e.start === s.eventStart));
    if (same) {
      same.sourceIds.push(s.id);
      if (!same.start) {
        same.start = s.eventStart;
        same.end = s.eventEnd || s.eventStart;
        same.notes = same.notes.filter((n) => n !== '정확한 날짜 미확인');
        same.notes.push(`날짜를 ${s.kind === 'tour' ? '관광공사' : '표준데이터'} 공식 정보로 보완`);
      }
      same.trust = 'official';
      same.dateVerified = true;
      continue;
    }
    if (!overlaps(s.eventStart, s.eventEnd || s.eventStart, period.start, period.end)) continue;
    events.push({
      name: s.title,
      start: s.eventStart,
      end: s.eventEnd || s.eventStart,
      dateText: '',
      region: s.region ?? '',
      venue: s.addr ?? '',
      organizer: s.organizer ?? '',
      category: '축제',
      summary: '',
      sourceIds: [s.id],
      trust: 'official',
      dateVerified: true,
      notes: [`AI 정리에서 빠져 ${s.kind === 'tour' ? '관광공사' : '문화축제 표준데이터'} 공식 목록에서 자동 추가`],
    });
  }
  events.sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999') || a.region.localeCompare(b.region));

  return {
    overview: String(raw.overview ?? ''),
    events,
    excluded,
    conflicts: (raw.conflicts ?? [])
      .map((c) => ({ event: String(c.event ?? ''), detail: String(c.detail ?? ''), sourceIds: (c.source_ids ?? []).map((x) => String(x).toUpperCase()).filter((x) => byId.has(x)) }))
      .filter((c) => c.detail),
    related: (raw.related ?? [])
      .map((r) => ({ sourceId: String(r.source_id ?? '').toUpperCase(), why: String(r.why ?? '') }))
      .filter((r) => byId.has(r.sourceId)),
    model,
    generatedAt: new Date().toISOString(),
  };
}
