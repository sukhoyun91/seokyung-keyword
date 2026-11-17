import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** 내부망 주소로의 요청 차단 (SSRF 방지) */
function isPrivateAddress(ip: string): boolean {
  if (ip.includes(':')) {
    const v = ip.toLowerCase();
    return v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:127.') || v === '::';
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
  );
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('사이트 주소 형식이 올바르지 않습니다. (https:// 로 시작)');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('http/https 주소만 사용할 수 있습니다.');
  const host = url.hostname;
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new Error('내부망 주소는 조회할 수 없습니다.');
  return url;
}

function decodeEntities(s: string) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function meta(html: string, name: string): string {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  return tag ? decodeEntities(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? '') : '';
}

export interface SiteInfo {
  url: string;
  title: string;
  description: string;
  keywords: string;
  headings: string[];
  text: string;
}

/** 사이트 HTML을 가져와 제목·메타·본문 텍스트를 추출 (최대 약 12,000자) */
export async function fetchSite(raw: string): Promise<SiteInfo> {
  // 광고 추적 파라미터 제거
  const url = await assertPublicUrl(raw.trim());
  for (const k of [...url.searchParams.keys()]) {
    if (/^(utm_|NaPm|fbclid|gclid|n_)/i.test(k)) url.searchParams.delete(k);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SKB-KeywordTool/1.0)', 'Accept-Language': 'ko-KR,ko;q=0.9' },
    });
  } catch {
    throw new Error('사이트에 접속하지 못했습니다. 주소를 확인하거나 화면 캡처 이미지로 분석해 주세요.');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`사이트 응답 오류 (${res.status}). 화면 캡처 이미지로 분석해 주세요.`);

  // 한글 인코딩(EUC-KR) 사이트 대응
  const buf = Buffer.from(await res.arrayBuffer());
  const head = buf.subarray(0, 3000).toString('latin1');
  const charset = (res.headers.get('content-type') || '').match(/charset=([\w-]+)/i)?.[1] || head.match(/charset=["']?([\w-]+)/i)?.[1] || 'utf-8';
  let html: string;
  try {
    html = new TextDecoder(charset.toLowerCase()).decode(buf);
  } catch {
    html = buf.toString('utf8');
  }

  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? '');
  const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()))
    .filter(Boolean)
    .slice(0, 40);
  const body = decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();

  return {
    url: url.toString(),
    title,
    description: meta(html, 'description') || meta(html, 'og:description'),
    keywords: meta(html, 'keywords'),
    headings,
    text: body.slice(0, 12_000),
  };
}
