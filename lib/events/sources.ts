import Anthropic from '@anthropic-ai/sdk';
import type { EvSource } from './types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stripTags = (s: string) =>
  String(s ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const ymd = (s: string) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '');
const compact = (d: string) => d.replace(/-/g, '');

/** 기간 겹침 여부 (YYYY-MM-DD 문자열 비교) */
export const overlaps = (s: string, e: string, ps: string, pe: string) => Boolean(s) && s <= pe && (e || s) >= ps;

/** "진주" → ["진주시", "진주"], 시군 판별용 */
export function regionNames(region: string) {
  const r = region.replace(/(시|군)$/, '');
  return [r];
}

// ─────────────────────────────────────────────
// 1) 한국관광공사 TourAPI (KorService2 / searchFestival2)
// ─────────────────────────────────────────────
export interface TourDiag {
  strategy: string; // 사용한 조회 방식
  total: number; // API가 알려 준 전체 건수
  fetched: number; // 실제로 받은 건수
  gyeongnam: number; // 경남
  region: number; // 선택 지역
  inPeriod: number; // 검색 기간과 겹침
  sampleAddrs: string[]; // 경남 자료 주소 예시 (지역 판별 확인용)
  sampleOther: string[]; // 받은 자료 예시 (경남이 0건일 때 확인용)
}

/** 항목의 필드 이름을 소문자로 통일 (버전마다 eventstartdate / eventStartDate 등 표기가 다름) */
function lowerKeys(o: any): Record<string, any> {
  const r: Record<string, any> = {};
  for (const [k, v] of Object.entries(o ?? {})) r[k.toLowerCase()] = v;
  return r;
}

function addDaysYmd(d: string, n: number) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

async function tourPage(key: string, params: string, page: number, rows: number) {
  const url =
    `https://apis.data.go.kr/B551011/KorService2/searchFestival2?serviceKey=${key}` +
    `&MobileOS=WEB&MobileApp=SKBMarketing&_type=json&arrange=A&numOfRows=${rows}&pageNo=${page}${params}`;
  const res = await fetch(url, { cache: 'no-store' });
  const text = await res.text();
  if (!res.ok || text.trim().startsWith('<')) {
    if (/SERVICE_KEY|SERVICE KEY|인증|등록되지/.test(text)) throw new Error('TourAPI 인증키 오류입니다. 공공데이터포털의 일반 인증키(Decoding)를 넣었는지, 활용 신청이 승인됐는지 확인하세요.');
    throw new Error(`TourAPI 응답 오류 (${res.status}): ${stripTags(text).slice(0, 150)}`);
  }
  const j = JSON.parse(text);
  const header = j?.response?.header;
  if (header?.resultCode && header.resultCode !== '0000') throw new Error(`TourAPI 오류: ${header.resultMsg} (${header.resultCode})`);
  const body = j?.response?.body;
  let items = body?.items?.item ?? body?.items ?? [];
  if (!Array.isArray(items)) items = items && typeof items === 'object' ? [items] : [];
  return { items: items.map(lowerKeys), total: Number(body?.totalCount ?? 0) };
}

const isGyeongnam = (it: Record<string, any>, addr: string) =>
  String(it.ldongregncd ?? '').startsWith('48') || String(it.areacode ?? '') === '36' || /경상남도|경남/.test(addr);

export async function collectTour(opts: { serviceKey: string; start: string; end: string; regions: string[] }): Promise<{ sources: Omit<EvSource, 'id'>[]; diag: TourDiag }> {
  const key = opts.serviceKey.includes('%') ? opts.serviceKey : encodeURIComponent(opts.serviceKey.trim());
  // 이미 시작해 진행 중인 축제도 잡기 위해 시작일을 넉넉히 앞당기고, 기간 판단은 아래에서 직접 함
  const from = compact(addDaysYmd(opts.start, -120));
  const ROWS = 100;
  const diag: TourDiag = { strategy: '', total: 0, fetched: 0, gyeongnam: 0, region: 0, inPeriod: 0, sampleAddrs: [], sampleOther: [] };

  // 1차: 경남(법정동 시도코드 48)만 조회 → 0건이면 2차: 전국 조회 후 주소로 거름
  const strategies = [
    { name: '경남 지역코드 조회', params: `&eventStartDate=${from}&lDongRegnCd=48`, maxPages: 10 },
    { name: '전국 조회 후 주소로 거름', params: `&eventStartDate=${from}`, maxPages: 25 },
  ];
  let all: Record<string, any>[] = [];
  for (const st of strategies) {
    all = [];
    let total = 0;
    try {
      for (let page = 1; page <= st.maxPages; page++) {
        const r = await tourPage(key, st.params, page, ROWS);
        total = r.total;
        all.push(...r.items);
        if (page * ROWS >= total || !r.items.length) break;
      }
    } catch (e: any) {
      if (/인증키/.test(e?.message ?? '')) throw e;
      if (st === strategies[strategies.length - 1]) throw e;
      continue; // 1차 방식이 지원되지 않으면 2차로
    }
    diag.strategy = st.name;
    diag.total = total;
    if (all.some((it) => isGyeongnam(it, `${it.addr1 ?? ''} ${it.addr2 ?? ''}`))) break;
  }
  diag.fetched = all.length;

  const out: Omit<EvSource, 'id'>[] = [];
  const seen = new Set<string>();
  for (const it of all) {
    const addr = `${it.addr1 ?? ''} ${it.addr2 ?? ''}`.trim();
    if (diag.sampleOther.length < 5) diag.sampleOther.push(`${stripTags(it.title)} | ${addr || '(주소 없음)'} | 지역코드 ${it.ldongregncd ?? it.areacode ?? '-'}`);
    if (!isGyeongnam(it, addr)) continue;
    diag.gyeongnam++;
    if (diag.sampleAddrs.length < 8) diag.sampleAddrs.push(addr || stripTags(it.title));
    const title = stripTags(it.title);
    const region = opts.regions.find((r) => regionNames(r).some((n) => addr.includes(n) || title.includes(n)));
    if (!region) continue;
    diag.region++;
    const s = ymd(String(it.eventstartdate ?? ''));
    const e = ymd(String(it.eventenddate ?? '')) || s;
    if (!overlaps(s, e, opts.start, opts.end)) continue;
    diag.inPeriod++;
    const id = String(it.contentid ?? title);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      kind: 'tour',
      title,
      url: `https://korean.visitkorea.or.kr/search/search_list.do?keyword=${encodeURIComponent(title)}`,
      publisher: '한국관광공사',
      date: ymd(String(it.modifiedtime ?? '').slice(0, 8)),
      snippet: `${title} / 기간 ${s} ~ ${e} / 장소 ${addr}${it.tel ? ` / 문의 ${stripTags(it.tel)}` : ''}`,
      region,
      eventStart: s,
      eventEnd: e,
      addr,
      tel: stripTags(it.tel ?? ''),
    });
  }
  return { sources: out, diag };
}

/** 진단 정보를 한 줄로 */
export const tourDiagText = (d: TourDiag) =>
  `${d.strategy}: 받은 자료 ${d.fetched}건(전체 ${d.total}) → 경남 ${d.gyeongnam} → 선택 지역 ${d.region} → 기간 내 ${d.inPeriod}`;

// ─────────────────────────────────────────────
// 1-2) 전국문화축제표준데이터 (공공데이터포털, 지자체 등록)
// ─────────────────────────────────────────────
export interface StdDiag {
  total: number;
  fetched: number;
  gyeongnam: number;
  region: number;
  inPeriod: number;
  lastYear: number;
  sample: string[];
}

/** "2026-12-01" / "20261201" / "2026.12.01" → "2026-12-01" */
function anyYmd(v: unknown) {
  const m = String(v ?? '').match(/(20\d{2})\s*[-./년]?\s*(\d{1,2})\s*[-./월]?\s*(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
}
const shiftYear = (d: string, n: number) => (d ? `${Number(d.slice(0, 4)) + n}${d.slice(4)}` : d);

export async function collectStd(opts: { serviceKey: string; start: string; end: string; regions: string[] }): Promise<{ sources: Omit<EvSource, 'id'>[]; diag: StdDiag }> {
  const key = opts.serviceKey.includes('%') ? opts.serviceKey : encodeURIComponent(opts.serviceKey.trim());
  const ROWS = 1000;
  const all: Record<string, any>[] = [];
  let total = 0;
  for (let page = 1; page <= 10; page++) {
    const url = `https://api.data.go.kr/openapi/tn_pubr_public_cltur_fstvl_api?serviceKey=${key}&pageNo=${page}&numOfRows=${ROWS}&type=json`;
    const res = await fetch(url, { cache: 'no-store' });
    const text = await res.text();
    if (!res.ok || text.trim().startsWith('<')) {
      if (/SERVICE_KEY|SERVICE KEY|인증|등록되지/.test(text)) throw new Error('문화축제 표준데이터 인증키 오류입니다. 공공데이터포털에서 이 데이터의 활용 신청이 승인됐는지 확인하세요.');
      if (/NODATA|데이터없음/i.test(text)) break;
      throw new Error(`문화축제 표준데이터 응답 오류 (${res.status}): ${stripTags(text).slice(0, 150)}`);
    }
    const j = JSON.parse(text);
    const header = j?.response?.header;
    const code = String(header?.resultCode ?? '00');
    if (code === '03') break; // 데이터 없음
    if (!['00', '0', '0000'].includes(code)) throw new Error(`문화축제 표준데이터 오류: ${header?.resultMsg} (${code})`);
    const body = j?.response?.body;
    let items = body?.items?.item ?? body?.items ?? [];
    if (!Array.isArray(items)) items = items && typeof items === 'object' ? [items] : [];
    total = Number(body?.totalCount ?? 0);
    all.push(...items.map(lowerKeys));
    if (page * ROWS >= total || !items.length) break;
  }
  const diag: StdDiag = { total, fetched: all.length, gyeongnam: 0, region: 0, inPeriod: 0, lastYear: 0, sample: [] };
  const out: Omit<EvSource, 'id'>[] = [];
  const seen = new Set<string>();
  for (const it of all) {
    const addr = `${it.rdnmadr ?? ''} ${it.lnmadr ?? ''}`.trim();
    const where = `${addr} ${it.instt_nm ?? ''} ${it.opar ?? ''}`;
    if (diag.sample.length < 5) diag.sample.push(`${stripTags(it.fstvlnm)} | ${it.instt_nm ?? ''} | ${it.fstvlstartdate ?? ''}`);
    if (!/경상남도|경남/.test(where)) continue;
    diag.gyeongnam++;
    const title = stripTags(it.fstvlnm);
    const region = opts.regions.find((r) => regionNames(r).some((n) => where.includes(n) || title.includes(n)));
    if (!region) continue;
    diag.region++;
    const s = anyYmd(it.fstvlstartdate);
    const e = anyYmd(it.fstvlenddate) || s;
    let lastYear = false;
    if (!overlaps(s, e, opts.start, opts.end)) {
      // 데이터가 아직 올해 일정으로 갱신되지 않은 경우: 작년 같은 시기 축제는 참고로 포함 (공식 날짜로는 쓰지 않음)
      if (overlaps(shiftYear(s, 1), shiftYear(e, 1), opts.start, opts.end)) lastYear = true;
      else continue;
    }
    if (lastYear) diag.lastYear++;
    else diag.inPeriod++;
    const k = `${title}|${s}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const organizer = [it.auspcinsttnm, it.mnnstnm].map((x) => stripTags(x)).filter(Boolean).join(' / ');
    const homepage = String(it.homepageurl ?? '').trim();
    out.push({
      kind: 'std',
      title,
      url: /^https?:\/\//.test(homepage) ? homepage : `https://www.data.go.kr/data/15013104/standard.do`,
      publisher: stripTags(it.instt_nm) || '전국문화축제표준데이터',
      date: anyYmd(it.referencedate),
      snippet: [
        `${title} / 기간 ${s} ~ ${e}${lastYear ? ` (※ 데이터에는 작년 일정만 있음. 올해 일정 미확인)` : ''}`,
        `장소 ${stripTags(it.opar)}${addr ? ` (${addr})` : ''}`,
        organizer ? `주최·주관 ${organizer}` : '',
        it.fstvlco ? `내용 ${stripTags(it.fstvlco).slice(0, 400)}` : '',
        it.phonenumber ? `문의 ${stripTags(it.phonenumber)}` : '',
      ].filter(Boolean).join(' / '),
      region,
      eventStart: lastYear ? undefined : s,
      eventEnd: lastYear ? undefined : e,
      addr: addr || stripTags(it.opar),
      tel: stripTags(it.phonenumber ?? ''),
      organizer,
      homepage,
      lastYear,
    });
  }
  return { sources: out, diag };
}

export const stdDiagText = (d: StdDiag) =>
  `받은 자료 ${d.fetched}건(전체 ${d.total}) → 경남 ${d.gyeongnam} → 선택 지역 ${d.region} → 기간 내 ${d.inPeriod}${d.lastYear ? ` (+작년 같은 시기 ${d.lastYear}건, 올해 일정 미확인)` : ''}`;

// ─────────────────────────────────────────────
// 2) 네이버 뉴스 검색 (NAVER API HUB)
// ─────────────────────────────────────────────
function pubToYmd(s: string) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  const k = new Date(d.getTime() + 9 * 3600_000); // KST
  return k.toISOString().slice(0, 10);
}
function addDays(d: string, n: number) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export async function collectNews(opts: {
  clientId: string;
  clientSecret: string;
  start: string;
  end: string;
  regions: string[];
  keywords: string[];
  perQuery?: number;
}): Promise<{ sources: Omit<EvSource, 'id'>[]; failed: number }> {
  const per = opts.perQuery ?? 40;
  // 행사 안내 기사는 보통 행사 1~2달 전에 나오므로 게시일 범위를 넓게 잡음
  const from = addDays(opts.start, -60);
  const to = addDays(opts.end, 7);
  const jobs = opts.regions.flatMap((r) => opts.keywords.map((k) => ({ region: r, q: `${r} ${k}` })));
  const byUrl = new Map<string, Omit<EvSource, 'id'>>();
  let failed = 0;
  let i = 0;
  async function worker() {
    while (i < jobs.length) {
      const job = jobs[i++];
      try {
        const url = `https://naverapihub.apigw.ntruss.com/search/v1/news?query=${encodeURIComponent(job.q)}&display=${per}&start=1&sort=sim`;
        let res = await fetch(url, {
          headers: { 'X-NCP-APIGW-API-KEY-ID': opts.clientId, 'X-NCP-APIGW-API-KEY': opts.clientSecret },
          cache: 'no-store',
        });
        if (res.status === 429) {
          await sleep(1200);
          res = await fetch(url, { headers: { 'X-NCP-APIGW-API-KEY-ID': opts.clientId, 'X-NCP-APIGW-API-KEY': opts.clientSecret }, cache: 'no-store' });
        }
        if (res.status === 401 || res.status === 403) throw Object.assign(new Error('auth'), { auth: true });
        if (!res.ok) throw new Error(String(res.status));
        const j = await res.json();
        for (const it of j.items ?? []) {
          const date = pubToYmd(it.pubDate);
          if (date && (date < from || date > to)) continue;
          const title = stripTags(it.title);
          const snippet = stripTags(it.description);
          const text = `${title} ${snippet}`;
          if (!regionNames(job.region).some((n) => text.includes(n))) continue; // 지역명이 없는 기사 제외
          const link = String(it.originallink || it.link);
          const prev = byUrl.get(link);
          if (prev) continue;
          let publisher = '';
          try {
            publisher = new URL(link).hostname.replace(/^www\./, '');
          } catch {}
          byUrl.set(link, { kind: 'news', title, url: link, publisher, date, snippet, region: job.region, query: job.q });
        }
      } catch (e: any) {
        if (e?.auth) throw new Error('네이버 검색 API(API HUB) 인증에 실패했습니다. 관리자 설정의 Client ID·Secret을 확인하세요.');
        failed++;
      }
      await sleep(120);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  // 최신 기사 우선, 최대 150건
  const sources = [...byUrl.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 150);
  return { sources, failed };
}

// ─────────────────────────────────────────────
// 3) 지자체 웹사이트 — Claude 웹 검색 (지자체 도메인으로 제한) + 결과 페이지 직접 확인
// ─────────────────────────────────────────────
export interface GovDiag {
  searches: number;
  queries: { q: string; results: number; error?: string }[];
  urls: { url: string; title: string; cited: boolean; fetched: 'ok' | 'fail' | 'skip' | 'irrelevant'; note?: string }[];
  aiText: string; // AI 답변 (앞부분)
  kept: number;
}

/** 페이지 본문에서 행사 관련 부분만 뽑기: 검색 기간의 월이 나오는 곳 주변 글자 중 행사 관련 단어가 있는 부분 */
export function relevantExcerpt(text: string, months: number[], keywords: string[], max = 1500) {
  const t = text.replace(/\s+/g, ' ');
  const monthRe = new RegExp(`(^|[^0-9])(${months.join('|')})\\s*(월|[./]\\s*\\d{1,2}(?![0-9]))`, 'g');
  const kwRe = new RegExp([...keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '행사', '축제', '공연', '전시', '개최', '열린다', '운영', '체험', '음악회', '대회'].join('|'));
  const ranges: [number, number][] = [];
  let m: RegExpExecArray | null;
  while ((m = monthRe.exec(t)) && ranges.length < 60) {
    const a = Math.max(0, m.index - 120);
    const b = Math.min(t.length, m.index + 180);
    if (!kwRe.test(t.slice(a, b))) continue;
    const last = ranges[ranges.length - 1];
    if (last && a <= last[1]) last[1] = b;
    else ranges.push([a, b]);
  }
  let out = '';
  for (const [a, b] of ranges) {
    const piece = t.slice(a, b).trim();
    if (out.length + piece.length > max) break;
    out += (out ? ' … ' : '') + piece;
  }
  return out;
}

function monthsBetween(start: string, end: string) {
  const out: number[] = [];
  const d = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
  const e = new Date(`${end.slice(0, 7)}-01T00:00:00Z`);
  while (d <= e && out.length < 12) {
    out.push(d.getUTCMonth() + 1);
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

export async function collectGov(opts: {
  apiKey: string;
  model: string;
  start: string;
  end: string;
  regions: string[];
  keywords: string[];
  domains: { domain: string; region: string }[];
  maxUses: number;
  fetchPage?: (url: string) => Promise<string>; // 페이지 본문 가져오기 (서버에서 주입)
  timeBudgetMs?: number;
}): Promise<{ sources: Omit<EvSource, 'id'>[]; searches: number; diag: GovDiag }> {
  const t0 = Date.now();
  const budget = opts.timeBudgetMs ?? 50_000;
  const client = new Anthropic({ apiKey: opts.apiKey });
  const months = monthsBetween(opts.start, opts.end);
  const monthWords = months.map((m) => `${m}월`).join('·');
  const prompt = `${opts.start} ~ ${opts.end} 기간(${monthWords})에 경상남도 ${opts.regions.join(', ')}에서 열리거나 진행 중인 ${opts.keywords.join(', ')} 정보를 지자체·문화기관 공식 웹사이트에서 찾으세요.

검색 방법
- 시·군마다 따로 검색하세요. 예: "${opts.regions[0]} ${months[0]}월 ${opts.keywords[0]}", "${opts.regions[0]} ${opts.keywords[0]} 일정", "${opts.regions[0]} 문화행사 ${months[0]}월", "${opts.regions[0]} 공연 전시 안내"
- 검색 결과가 없으면 검색어를 짧게 바꿔 다시 검색하세요.

답변 형식
- 찾은 행사마다 한 줄씩: 행사명 | 기간(원문 표기 그대로) | 장소 | 주최 | 한 줄 설명
- 기간이 위 기간과 겹치지 않는 행사는 쓰지 마세요.
- 웹 페이지에서 확인한 내용만 쓰고 추측하지 마세요. 못 찾은 시·군은 "찾지 못함"이라고 쓰세요.`;

  const tools: any[] = [
    {
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: opts.maxUses,
      allowed_domains: opts.domains.map((d) => d.domain),
      user_location: { type: 'approximate', region: 'Gyeongsangnam-do', country: 'KR', timezone: 'Asia/Seoul' },
    },
  ];
  const messages: any[] = [{ role: 'user', content: prompt }];
  const content: any[] = [];
  let searches = 0;
  for (let turn = 0; turn < 3; turn++) {
    let msg: any;
    try {
      msg = await client.messages.create({ model: opts.model, max_tokens: 4000, tools, messages } as any);
    } catch (e: any) {
      const m = String(e?.message ?? e);
      if (e?.status === 400 && /web search|web_search/i.test(m) && /enable|disabled|not allowed/i.test(m)) throw new Error('Claude 웹 검색이 꺼져 있습니다. Claude Console(platform.claude.com) 설정에서 웹 검색을 허용하세요.');
      if (e?.status === 400 && /domain/i.test(m)) throw new Error(`지자체 도메인 설정 오류: ${m}`);
      if (e?.status === 401) throw new Error('Claude API 키가 올바르지 않습니다.');
      throw new Error(`Claude 웹 검색 오류: ${m}`);
    }
    content.push(...msg.content);
    searches += Number(msg.usage?.server_tool_use?.web_search_requests ?? 0);
    if (msg.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: msg.content });
  }

  // ── 검색 기록 정리 (검색어 → 결과 수 / 오류)
  const diag: GovDiag = { searches, queries: [], urls: [], aiText: '', kept: 0 };
  const qById = new Map<string, { q: string; results: number; error?: string }>();
  for (const b of content) {
    if (b.type === 'server_tool_use' && b.name === 'web_search') {
      const q = { q: String(b.input?.query ?? ''), results: 0 };
      qById.set(b.id, q);
      diag.queries.push(q);
    }
    if (b.type === 'web_search_tool_result') {
      const q = qById.get(b.tool_use_id);
      if (Array.isArray(b.content)) {
        if (q) q.results = b.content.filter((r: any) => r.type === 'web_search_result').length;
      } else if (b.content?.error_code && q) q.error = b.content.error_code;
    }
  }
  diag.aiText = content.filter((b) => b.type === 'text').map((b) => b.text).join('').slice(0, 1500);

  // ── 출처 후보: 검색 결과 전체 (인용 여부와 상관없이)
  const byUrl = new Map<string, Omit<EvSource, 'id'> & { quotes: string[]; claims: string[] }>();
  const add = (url: string, title: string, pageAge?: string) => {
    if (!url) return null;
    if (!byUrl.has(url)) {
      let host = '';
      try {
        host = new URL(url).hostname.replace(/^www\./, '');
      } catch {}
      const region = opts.domains.find((d) => host && (host === d.domain || host.endsWith(`.${d.domain}`)))?.region ?? '';
      byUrl.set(url, { kind: 'gov', title: stripTags(title || host), url, publisher: host, date: pageAgeToYmd(pageAge), snippet: '', region, quotes: [], claims: [] });
    }
    return byUrl.get(url)!;
  };
  for (const b of content) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      for (const r of b.content) if (r.type === 'web_search_result') add(r.url, r.title, r.page_age);
    }
    if (b.type === 'text' && Array.isArray(b.citations)) {
      for (const c of b.citations) {
        const s = add(c.url, c.title);
        if (!s) continue;
        if (c.cited_text && !s.quotes.includes(c.cited_text)) s.quotes.push(stripTags(c.cited_text));
        const claim = stripTags(b.text);
        if (claim && !s.claims.includes(claim)) s.claims.push(claim);
      }
    }
  }

  // ── 검색 결과 페이지를 직접 열어 행사 관련 문장 추출 (AI 인용이 없어도 근거 확보)
  const list = [...byUrl.values()];
  const pageText = new Map<string, string>();
  const status = new Map<string, GovDiag['urls'][number]['fetched']>();
  const notes = new Map<string, string>();
  if (opts.fetchPage) {
    const queue = list.slice(0, 15);
    let qi = 0;
    const worker = async () => {
      while (qi < queue.length) {
        const s = queue[qi++];
        if (Date.now() - t0 > budget) {
          status.set(s.url, 'skip');
          notes.set(s.url, '시간 제한으로 건너뜀');
          continue;
        }
        try {
          const text = await opts.fetchPage!(s.url);
          const ex = relevantExcerpt(text, months, opts.keywords);
          if (ex) {
            pageText.set(s.url, ex);
            status.set(s.url, 'ok');
          } else {
            status.set(s.url, 'irrelevant');
            notes.set(s.url, `본문 ${text.length}자 중 ${monthWords} 행사 문장 없음`);
          }
        } catch (e: any) {
          status.set(s.url, 'fail');
          notes.set(s.url, String(e?.message ?? e).slice(0, 80));
        }
      }
    };
    await Promise.all(Array.from({ length: 5 }, worker));
  }

  const sources: Omit<EvSource, 'id'>[] = [];
  for (const { quotes, claims, ...s } of list) {
    const page = pageText.get(s.url) ?? '';
    const cited = quotes.length > 0 || claims.length > 0;
    diag.urls.push({ url: s.url, title: s.title, cited, fetched: status.get(s.url) ?? 'skip', note: notes.get(s.url) });
    if (!page && !cited) continue;
    sources.push({
      ...s,
      snippet: [page ? `원문 발췌: ${page}` : '', quotes.length ? `원문 인용: ${quotes.join(' … ')}` : '', claims.length ? `AI 요약: ${claims.join(' / ')}` : '']
        .filter(Boolean)
        .join('\n')
        .slice(0, 2500),
    });
  }
  diag.kept = sources.length;
  return { sources, searches, diag };
}

/** 지자체 수집 진단 한 줄 */
export const govDiagText = (d: GovDiag) =>
  `웹 검색 ${d.searches}회 · 검색 결과 페이지 ${d.urls.length}건 · 직접 확인 ${d.urls.filter((u) => u.fetched === 'ok').length}건 · 근거로 채택 ${d.kept}건`;

function pageAgeToYmd(s?: string) {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/**
 * 설정의 "지역:도메인" 줄 → 선택 지역의 도메인 목록 (+ 경남 공통)
 * 한 지역에 여러 줄 가능 (예: 진주:jinju.go.kr / 진주:jinjuart.or.kr)
 */
export function domainsFor(setting: string, regions: string[]) {
  const pairs: { key: string; domain: string }[] = [];
  for (const line of setting.split(/\r?\n|,/)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (k && v) pairs.push({ key: k.replace(/(시|군)$/, ''), domain: v.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '') });
  }
  const out: { domain: string; region: string }[] = [];
  for (const r of regions) {
    for (const p of pairs) if (p.key === r.replace(/(시|군)$/, '')) out.push({ domain: p.domain, region: r });
  }
  for (const p of pairs) if (p.key === '경남') out.push({ domain: p.domain, region: '경남' });
  return out.filter((x, i) => out.findIndex((y) => y.domain === x.domain) === i);
}
