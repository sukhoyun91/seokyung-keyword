/**
 * 서경방송 노출 순위 조회 — NAVER API HUB 검색 API (네이버 클라우드 플랫폼)
 * 키워드로 블로그·웹문서·카페 검색 결과 상위 100개를 받아,
 * 등록한 서경방송 주소(도메인·블로그 주소 등)가 몇 번째에 나오는지 찾습니다.
 *
 * ※ 기존 developers.naver.com(openapi.naver.com) 검색 API는 API HUB로 이관 중이라
 *    처음부터 API HUB 방식으로 구현했습니다.
 * 문서: https://api.ncloud-docs.com/docs/naver-api-hub-overview
 */
const BASE = 'https://naverapihub.apigw.ntruss.com/search/v1';
const DEPTH = 100; // 상위 100위까지 확인 (API 1회 호출)

export const EXPOSURE_AREAS = {
  blog: '블로그',
  webkr: '웹문서',
  cafearticle: '카페',
} as const;
export type ExposureArea = keyof typeof EXPOSURE_AREAS;

export interface HubCreds {
  clientId: string;
  clientSecret: string;
}

/** "https://www.iscs.co.kr/www/" → "iscs.co.kr/www" */
export function normalizeTarget(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^(www|m)\./, '')
    .replace(/\/+$/, '');
}

function matches(link: string, targets: string[]): boolean {
  if (!link) return false;
  const n = normalizeTarget(link);
  const host = n.split('/')[0];
  return targets.some((t) => {
    if (!t) return false;
    if (t.includes('/')) return n.startsWith(t); // blog.naver.com/아이디 같은 경로 지정
    return host === t || host.endsWith(`.${t}`); // 도메인 지정 (하위 도메인 포함)
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function searchOnce(area: ExposureArea, query: string, creds: HubCreds, attempt = 0): Promise<any[]> {
  const url = `${BASE}/${area}?query=${encodeURIComponent(query)}&display=${DEPTH}&start=1`;
  const res = await fetch(url, {
    headers: {
      'X-NCP-APIGW-API-KEY-ID': creds.clientId,
      'X-NCP-APIGW-API-KEY': creds.clientSecret,
    },
    cache: 'no-store',
  });
  if (res.status === 429 && attempt < 3) {
    await sleep(1000 * (attempt + 1));
    return searchOnce(area, query, creds, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`네이버 검색 API 오류 (${res.status}): ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return json.items ?? [];
}

/** 한 키워드·한 영역의 노출 순위 (없으면 null) */
export async function findRank(area: ExposureArea, query: string, targets: string[], creds: HubCreds): Promise<number | null> {
  const items = await searchOnce(area, query, creds);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const links = [it.link, it.bloggerlink, it.cafeurl].filter(Boolean).map(String);
    if (links.some((l) => matches(l, targets))) return i + 1;
  }
  return null;
}

export type ExposureResult = Partial<Record<ExposureArea, number | null | 'error'>>;

/** 여러 키워드 × 영역 동시 조회 (동시 4건) */
export async function checkExposure(keywords: string[], areas: ExposureArea[], targetsRaw: string[], creds: HubCreds) {
  const targets = targetsRaw.map(normalizeTarget).filter(Boolean);
  const out = new Map<string, ExposureResult>();
  const jobs: { kw: string; area: ExposureArea }[] = [];
  for (const kw of keywords) {
    out.set(kw, {});
    for (const area of areas) jobs.push({ kw, area });
  }
  let errors = 0;
  let idx = 0;
  async function worker() {
    while (idx < jobs.length) {
      const { kw, area } = jobs[idx++];
      try {
        out.get(kw)![area] = await findRank(area, kw, targets, creds);
      } catch {
        out.get(kw)![area] = 'error';
        errors++;
      }
      await sleep(100);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  return { ranks: out, errors };
}

export function parseAreas(s: string): ExposureArea[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter((x): x is ExposureArea => x in EXPOSURE_AREAS);
}
