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
// 3) 지자체 웹사이트 — Claude 웹 검색 (지자체 도메인으로 제한)
// ─────────────────────────────────────────────
export async function collectGov(opts: {
  apiKey: string;
  model: string;
  start: string;
  end: string;
  regions: string[];
  keywords: string[];
  domains: { domain: string; region: string }[];
  maxUses: number;
}): Promise<{ sources: Omit<EvSource, 'id'>[]; searches: number }> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const prompt = `${opts.start} ~ ${opts.end} 기간에 경상남도 ${opts.regions.join(', ')}에서 열리거나 진행 중인 ${opts.keywords.join(', ')} 정보를 지자체(시청·군청·도청) 공식 웹사이트에서 찾으세요.

- 시·군별로 "축제", "행사 일정", "문화행사", "공지사항" 페이지를 검색하세요.
- 찾은 행사마다 한 줄씩: 행사명 | 기간(원문 표기 그대로) | 장소 | 주최 | 한 줄 설명
- 기간이 위 기간과 겹치지 않는 행사는 쓰지 마세요.
- 웹 페이지에서 확인한 내용만 쓰고, 추측하지 마세요. 찾지 못했으면 "찾지 못함"이라고 쓰세요.`;

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
      if (e?.status === 400 && /web search/i.test(e?.message ?? '')) throw new Error('Claude 웹 검색이 꺼져 있습니다. Claude Console의 설정에서 웹 검색을 허용하세요.');
      if (e?.status === 401) throw new Error('Claude API 키가 올바르지 않습니다.');
      throw new Error(`Claude 웹 검색 오류: ${e?.message ?? e}`);
    }
    content.push(...msg.content);
    searches += Number(msg.usage?.server_tool_use?.web_search_requests ?? 0);
    if (msg.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: msg.content });
  }

  // 출처 정리: 인용(cited_text)이 있는 페이지 우선, 검색 결과 페이지도 목록에 포함
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
  const sources = [...byUrl.values()]
    .filter((s) => s.quotes.length || s.claims.length)
    .map(({ quotes, claims, ...s }) => ({
      ...s,
      snippet: [quotes.length ? `원문 인용: ${quotes.join(' … ')}` : '', claims.length ? `AI 요약: ${claims.join(' / ')}` : ''].filter(Boolean).join('\n').slice(0, 1500),
    }));
  return { sources, searches };
}

function pageAgeToYmd(s?: string) {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** 설정의 "지역:도메인" 줄 → 선택 지역의 도메인 목록 (+ 도청) */
export function domainsFor(setting: string, regions: string[]) {
  const map = new Map<string, string>();
  for (const line of setting.split(/\r?\n|,/)) {
    const [k, v] = line.split(':').map((x) => x?.trim());
    if (k && v) map.set(k.replace(/(시|군)$/, ''), v.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, ''));
  }
  const out: { domain: string; region: string }[] = [];
  for (const r of regions) {
    const d = map.get(r.replace(/(시|군)$/, ''));
    if (d) out.push({ domain: d, region: r });
  }
  const dosi = map.get('경남');
  if (dosi) out.push({ domain: dosi, region: '경남' });
  return out.filter((x, i) => out.findIndex((y) => y.domain === x.domain) === i);
}
