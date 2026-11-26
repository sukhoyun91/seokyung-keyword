import type { EvSource } from './types';
import { findSido, shortRegion } from './regions';

/**
 * 지자체 인스타그램 수집 — Meta Instagram API (Facebook 로그인 방식)의 Business Discovery
 * 서경방송 인스타그램 비즈니스 계정(페이스북 페이지에 연결)의 토큰으로
 * 다른 비즈니스·크리에이터 계정(예: jinjucity)의 공개 게시물을 읽습니다.
 * 로그인 화면 긁기(스크래핑)는 하지 않습니다.
 */
const BASE = process.env.IG_GRAPH_BASE || 'https://graph.facebook.com/v25.0';

export class IgError extends Error {
  constructor(message: string, public code?: number, public sub?: number) {
    super(message);
  }
}

/** Graph API 오류를 사람이 읽을 수 있는 말로 */
function explain(err: any, ctx = ''): IgError {
  const code = Number(err?.code);
  const sub = Number(err?.error_subcode);
  const raw = String(err?.error_user_msg || err?.message || '알 수 없는 오류');
  let m = raw;
  if (code === 190) m = '인스타그램 토큰이 만료됐거나 올바르지 않습니다. 관리자 설정에서 새 토큰을 넣어 주세요.';
  else if (code === 10 || code === 200) m = `토큰에 필요한 권한이 없습니다 (instagram_basic, pages_show_list, business_management 등). Meta에서 토큰을 다시 발급하세요. (${raw})`;
  else if (code === 4 || code === 17 || code === 32 || code === 613) m = '인스타그램 API 호출 한도를 넘었습니다. 1시간쯤 뒤에 다시 시도하세요.';
  else if (code === 100 && /Object with ID '([^']*)'/.test(raw) && !/business_discovery/i.test(raw))
    m = `서경방송 인스타그램 계정 ID('${/Object with ID '([^']*)'/.exec(raw)![1]}')가 올바르지 않습니다. 관리자 설정의 계정 ID 칸을 비우고 연결 테스트를 누르면 숫자 ID를 자동으로 찾아 넣습니다.`;
  else if (code === 110 || code === 100) m = ctx ? `@${ctx} 계정을 찾을 수 없거나 비즈니스·크리에이터 계정이 아닙니다. (${raw})` : `요청 값이 올바르지 않습니다: ${raw}`;
  return new IgError(m, code, sub);
}

async function igGet(path: string, params: Record<string, string>, token: string, ctx = '') {
  const u = new URL(`${BASE}/${path.replace(/^\//, '')}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('access_token', token);
  let res: Response;
  try {
    res = await fetch(u, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  } catch (e: any) {
    throw new IgError(`인스타그램 API에 연결하지 못했습니다: ${e?.message ?? e}`);
  }
  const text = await res.text();
  let j: any = null;
  try {
    j = JSON.parse(text);
  } catch {
    throw new IgError(`인스타그램 API 응답을 읽지 못했습니다 (${res.status})`);
  }
  if (!res.ok || j?.error) throw explain(j?.error, ctx);
  return j;
}

/** 토큰 상태 + 연결된 인스타그램 비즈니스 계정 찾기 (관리자 연결 테스트용) */
export async function inspectToken(token: string) {
  const me = await igGet('me', { fields: 'id,name' }, token);
  let expiresAt: number | null = null;
  try {
    const d = await igGet('debug_token', { input_token: token }, token);
    const e = Number(d?.data?.expires_at ?? d?.data?.data_access_expires_at ?? 0);
    expiresAt = e > 0 ? e * 1000 : 0; // 0 = 만료 없음
  } catch {
    /* 만료일을 못 읽어도 수집에는 지장 없음 */
  }
  const accounts: { id: string; username: string; page: string }[] = [];
  try {
    const pages = await igGet('me/accounts', { fields: 'name,instagram_business_account{id,username}', limit: '50' }, token);
    for (const p of pages?.data ?? []) {
      const ig = p?.instagram_business_account;
      if (ig?.id) accounts.push({ id: String(ig.id), username: String(ig.username ?? ''), page: String(p.name ?? '') });
    }
  } catch {
    /* 페이지 목록 권한이 없으면 건너뜀 */
  }
  return { me: { id: String(me.id), name: String(me.name ?? '') }, expiresAt, accounts };
}

/** 숫자 ID인지 (이메일·아이디를 잘못 넣은 경우 걸러냄) */
export const isIgId = (v: string) => /^\d{6,25}$/.test(v.trim());

/** 7일 안에 만료되는 토큰 */
export const expiresSoon = (ms: number | null) => ms != null && ms > 0 && ms - Date.now() < 7 * 86400000;

export const expiryText = (ms: number | null) => {
  if (ms == null) return '만료일 확인 불가';
  if (ms === 0) return '만료 없음';
  const left = ms - Date.now();
  const d = new Date(ms + 9 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
  if (left <= 0) return `${d} 만료됨`;
  if (left < 86400000) return `${d} 만료 (${Math.max(1, Math.round(left / 3600000))}시간 남음)`;
  return `${d.slice(0, 10)} 만료 (${Math.floor(left / 86400000)}일 남음)`;
};

/** 설정 "지역:인스타그램아이디" 줄 → 선택한 지역에 해당하는 계정 */
export function igAccountsFor(setting: string, regions: string[], sidoName?: string) {
  const sido = findSido(sidoName || '경상남도');
  const norm = (x: string) => shortRegion(x.trim());
  const out: { username: string; region: string }[] = [];
  for (const line of setting.split(/\r?\n|,/)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    const username = line
      .slice(i + 1)
      .trim()
      .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
      .replace(/^@/, '')
      .replace(/[/?#].*$/, '');
    if (!key || !/^[A-Za-z0-9._]{1,30}$/.test(username)) continue;
    const region = regions.find((r) => norm(r) === norm(key));
    if (region) out.push({ username, region });
    else if (key === '공통' || key === '전국' || (sido && (key === sido.short || key === sido.name))) out.push({ username, region: '' });
  }
  return out.filter((x, i) => out.findIndex((y) => y.username.toLowerCase() === x.username.toLowerCase()) === i);
}

type Media = { id: string; caption?: string; timestamp?: string; permalink?: string; media_type?: string };

/** 한 계정의 게시물을 최신순으로, since(ms) 이전 게시물이 나오면 멈춤 (최대 4쪽 × 50개) */
async function fetchMedia(token: string, igUserId: string, username: string, since: number) {
  const fields = 'caption,timestamp,permalink,media_type';
  const all: Media[] = [];
  let name = '';
  let after = '';
  for (let page = 0; page < 4; page++) {
    const media = `media${after ? `.after(${after})` : ''}.limit(50){${fields}}`;
    const j = await igGet(igUserId, { fields: `business_discovery.username(${username}){username,name,${media}}` }, token, username);
    const bd = j?.business_discovery;
    name = name || String(bd?.name ?? '');
    const list: Media[] = bd?.media?.data ?? [];
    all.push(...list);
    const oldest = list.length ? Date.parse(list[list.length - 1].timestamp ?? '') : 0;
    after = bd?.media?.paging?.cursors?.after ?? '';
    if (!after || !list.length || (oldest && oldest < since)) break;
  }
  return { name, media: all };
}

const EVENT_WORDS = /축제|행사|공연|전시|박람회|페스티벌|콘서트|대회|체험|개최|개막|열립니다|열린다|진행|모집|참가|접수|프로그램|마켓|장터|불꽃|퍼레이드|기념식/;

/**
 * 지자체 인스타그램 게시물 수집
 * - 게시일: 기간 시작 60일 전 ~ 기간 끝 (행사는 미리 홍보하므로)
 * - 본문에 행사 관련 말이나 기간의 '○월'이 들어 있는 게시물만
 */
export async function collectInstagram(opts: {
  token: string;
  igUserId: string;
  accounts: { username: string; region: string }[];
  start: string;
  end: string;
  keywords: string[];
}): Promise<{ sources: Omit<EvSource, 'id'>[]; diag: IgDiag }> {
  const since = Date.parse(`${opts.start}T00:00:00+09:00`) - 60 * 86400000;
  const until = Date.parse(`${opts.end}T23:59:59+09:00`);
  const months = monthsIn(opts.start, opts.end);
  const monthRe = new RegExp(`(^|[^0-9])(${months.join('|')})\\s*월`);
  const kwRe = opts.keywords.length ? new RegExp(opts.keywords.map(esc).join('|')) : null;
  const sources: Omit<EvSource, 'id'>[] = [];
  const diag: IgDiag = { accounts: [] };
  for (const a of opts.accounts) {
    try {
      const { name, media } = await fetchMedia(opts.token, opts.igUserId, a.username, since);
      const inWindow = media.filter((m) => {
        const t = Date.parse(m.timestamp ?? '');
        return t >= since && t <= until && (m.caption ?? '').trim();
      });
      const hits = inWindow.filter((m) => {
        const c = m.caption ?? '';
        return EVENT_WORDS.test(c) || monthRe.test(c) || (kwRe?.test(c) ?? false);
      });
      for (const m of hits) {
        const cap = (m.caption ?? '').replace(/\r/g, '').trim();
        const first = cap.split('\n').map((x) => x.trim()).find((x) => x.replace(/[#\s\p{Emoji_Presentation}]/gu, '').length > 3) ?? cap;
        sources.push({
          kind: 'sns',
          title: first.replace(/^[^\p{L}\p{N}]+/u, '').replace(/\s+/g, ' ').slice(0, 90),
          url: m.permalink ?? `https://www.instagram.com/${a.username}/`,
          publisher: `instagram @${a.username}${name ? ` (${name})` : ''}`,
          date: m.timestamp ? new Date(Date.parse(m.timestamp) + 9 * 3600_000).toISOString().slice(0, 10) : '',
          snippet: cap.slice(0, 1500),
          region: a.region,
        });
      }
      diag.accounts.push({ username: a.username, region: a.region, read: media.length, inWindow: inWindow.length, kept: hits.length });
    } catch (e: any) {
      diag.accounts.push({ username: a.username, region: a.region, read: 0, inWindow: 0, kept: 0, error: e?.message ?? String(e) });
      if (e instanceof IgError && (e.code === 190 || e.code === 4 || e.code === 17 || e.code === 32 || e.code === 613)) throw e; // 토큰·한도 오류는 다른 계정도 같으므로 중단
    }
  }
  return { sources, diag };
}

export interface IgDiag {
  accounts: { username: string; region: string; read: number; inWindow: number; kept: number; error?: string }[];
}

export const igDiagText = (d: IgDiag) =>
  d.accounts
    .map((a) => (a.error ? `@${a.username} 실패: ${a.error}` : `@${a.username} 게시물 ${a.read}개 중 기간 내 ${a.inWindow}개 · 행사 관련 ${a.kept}개`))
    .join(' / ');

function monthsIn(start: string, end: string) {
  const out: number[] = [];
  const d = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
  const e = new Date(`${end.slice(0, 7)}-01T00:00:00Z`);
  while (d <= e && out.length < 13) {
    out.push(d.getUTCMonth() + 1);
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
