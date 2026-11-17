import { createHmac } from 'node:crypto';

/**
 * 네이버 검색광고 API - 키워드 도구(/keywordstool)
 * 키워드별 월간 검색량(PC·모바일)과 경쟁 정도, 연관 키워드를 조회합니다.
 * 문서: https://naver.github.io/searchad-apidoc/
 */
const BASE = 'https://api.searchad.naver.com';
const PATH = '/keywordstool';

export interface NaverCreds {
  customerId: string;
  accessLicense: string;
  secretKey: string;
}

export interface KeywordStat {
  keyword: string; // 네이버가 돌려준 표기 (띄어쓰기 없음)
  pc: number;
  mobile: number;
  total: number;
  pcLabel: string; // "< 10" 같은 원본 표시
  mobileLabel: string;
  comp: string; // 높음/중간/낮음
}

/** "< 10" → 5 로 환산 (정렬용), 숫자는 그대로 */
function toNum(v: unknown): { n: number; label: string } {
  if (typeof v === 'number') return { n: v, label: v.toLocaleString('ko-KR') };
  const s = String(v ?? '').trim();
  if (s.startsWith('<')) return { n: 5, label: '10 미만' };
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? { n, label: n.toLocaleString('ko-KR') } : { n: 0, label: '-' };
}

/** 네이버 키워드 도구 조회용 정규화: 띄어쓰기·특수문자 제거, 영문 대문자 */
export function normalizeKeyword(k: string): string {
  return k.replace(/[^0-9a-zA-Z가-힣]/g, '').toUpperCase();
}

function sign(timestamp: string, secret: string) {
  return createHmac('sha256', secret).update(`${timestamp}.GET.${PATH}`).digest('base64');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callOnce(hints: string[], creds: NaverCreds, attempt = 0): Promise<any[]> {
  const ts = String(Date.now());
  const url = `${BASE}${PATH}?hintKeywords=${encodeURIComponent(hints.join(','))}&showDetail=1`;
  const res = await fetch(url, {
    headers: {
      'X-Timestamp': ts,
      'X-API-KEY': creds.accessLicense,
      'X-Customer': creds.customerId,
      'X-Signature': sign(ts, creds.secretKey),
    },
    cache: 'no-store',
  });
  if (res.status === 429 && attempt < 3) {
    await sleep(1500 * (attempt + 1));
    return callOnce(hints, creds, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`네이버 검색광고 API 오류 (${res.status}): ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return json.keywordList ?? [];
}

/**
 * 키워드 목록의 검색량 조회.
 * @returns stats: 정규화 키 → 통계 (요청 키워드 + 네이버 연관 키워드 모두 포함)
 */
export async function fetchKeywordStats(keywords: string[], creds: NaverCreds) {
  const hints = [...new Set(keywords.map(normalizeKeyword).filter((k) => k.length > 0))];
  const stats = new Map<string, KeywordStat>();
  const failed: string[] = [];
  const addList = (list: any[]) => {
    for (const item of list) {
      const key = normalizeKeyword(String(item.relKeyword ?? ''));
      if (!key || stats.has(key)) continue;
      const pc = toNum(item.monthlyPcQcCnt);
      const mo = toNum(item.monthlyMobileQcCnt);
      stats.set(key, {
        keyword: String(item.relKeyword), pc: pc.n, mobile: mo.n, total: pc.n + mo.n,
        pcLabel: pc.label, mobileLabel: mo.label, comp: String(item.compIdx ?? '-'),
      });
    }
  };

  for (let i = 0; i < hints.length; i += 5) {
    const batch = hints.slice(i, i + 5);
    try {
      addList(await callOnce(batch, creds));
    } catch (e) {
      // 한 묶음이 실패하면 1개씩 재시도 (잘못된 키워드 하나 때문에 전체가 실패하는 경우 대비)
      if (batch.length > 1) {
        for (const single of batch) {
          try {
            addList(await callOnce([single], creds));
          } catch {
            failed.push(single);
          }
          await sleep(200);
        }
      } else {
        failed.push(...batch);
        if (i === 0 && hints.length <= 5) throw e;
      }
    }
    await sleep(250);
  }
  return { stats, failed, hintKeys: hints };
}
