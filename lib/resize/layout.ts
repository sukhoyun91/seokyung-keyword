/** 묶음(그룹)·배치 계획 → 보드 좌표 계산 (브라우저·서버 공용, 순수 함수) */
import type { Box, SegObject } from './segment';

export type Role = 'title' | 'text' | 'card' | 'product' | 'info' | 'logo' | 'decoration' | 'other';
export const ROLE_LABEL: Record<Role, string> = {
  title: '제목',
  text: '문구',
  card: '카드',
  product: '상품·사진',
  info: '안내문',
  logo: '로고',
  decoration: '장식',
  other: '기타',
};

export interface Group {
  id: string;
  label: string;
  role: Role;
  objectIds: number[];
  box: Box; // 원본 좌표
  edge: { l: boolean; r: boolean; t: boolean; b: boolean }; // 원본 가장자리에 걸쳐 있는지
}

export type DecorPos = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'left' | 'right' | 'hide';

export interface Plan {
  rows: string[][]; // 위→아래 줄, 줄 안 왼→오른
  decor: { groupId: string; position: DecorPos; row?: number }[];
}

export interface Placement {
  groupId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function unionBox(objs: Box[]): Box {
  const x0 = Math.min(...objs.map((o) => o.x));
  const y0 = Math.min(...objs.map((o) => o.y));
  const x1 = Math.max(...objs.map((o) => o.x + o.w));
  const y1 = Math.max(...objs.map((o) => o.y + o.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function makeGroup(id: string, label: string, role: Role, objs: SegObject[], srcW: number, srcH: number): Group {
  const box = unionBox(objs);
  const tol = 3;
  return {
    id,
    label,
    role,
    objectIds: objs.map((o) => o.id),
    box,
    edge: { l: box.x <= tol, t: box.y <= tol, r: box.x + box.w >= srcW - tol, b: box.y + box.h >= srcH - tol },
  };
}

/** AI 없이: 가장자리에 걸친 작은 덩어리는 장식, 나머지는 세로로 겹치는 것끼리 한 줄 = 한 묶음 */
export function fallbackGroups(objects: SegObject[], srcW: number, srcH: number): Group[] {
  const total = srcW * srcH;
  const groups: Group[] = [];
  const rest: SegObject[] = [];
  for (const o of objects) {
    const g = makeGroup('', '', 'decoration', [o], srcW, srcH);
    const touches = g.edge.l || g.edge.r || g.edge.t || g.edge.b;
    if (touches && o.w * o.h < total * 0.03) groups.push({ ...g, id: `d${o.id}`, label: `장식 ${o.id}` });
    else rest.push(o);
  }
  rest.sort((a, b) => a.y - b.y);
  const rows: SegObject[][] = [];
  for (const o of rest) {
    const row = rows.find((r) => {
      const y0 = Math.min(...r.map((x) => x.y));
      const y1 = Math.max(...r.map((x) => x.y + x.h));
      const ov = Math.min(y1, o.y + o.h) - Math.max(y0, o.y);
      return ov > Math.min(o.h, y1 - y0) * 0.3;
    });
    if (row) row.push(o);
    else rows.push([o]);
  }
  rows.forEach((r, i) => groups.push(makeGroup(`g${i + 1}`, `${i + 1}번째 줄`, 'other', r, srcW, srcH)));
  return groups;
}

/** AI 없이: 원본 순서 그대로 한 줄씩, 장식은 가까운 모서리로 */
export function fallbackPlan(groups: Group[]): Plan {
  const content = groups.filter((g) => g.role !== 'decoration').sort((a, b) => a.box.y - b.box.y);
  const rows: string[][] = [];
  for (const g of content) {
    const last = rows[rows.length - 1];
    const lastG = last && groups.filter((x) => last.includes(x.id));
    const ov = lastG && Math.min(...lastG.map((x) => x.box.y + x.box.h)) - g.box.y;
    if (last && ov != null && ov > g.box.h * 0.5) last.push(g.id);
    else rows.push([g.id]);
  }
  for (const r of rows) r.sort((a, b) => groups.find((g) => g.id === a)!.box.x - groups.find((g) => g.id === b)!.box.x);
  const decor = groups
    .filter((g) => g.role === 'decoration')
    .map((g) => {
      const cy = g.box.y + g.box.h / 2;
      const left = g.edge.l || (!g.edge.r && g.box.x < 300);
      const topHalf = cy < (Math.max(...groups.map((x) => x.box.y + x.box.h)) || 1) / 2;
      const position: DecorPos = g.edge.t || g.box.y < 200 ? (left ? 'top-left' : 'top-right') : g.edge.b ? (left ? 'bottom-left' : 'bottom-right') : left ? 'left' : 'right';
      void topHalf;
      return { groupId: g.id, position };
    });
  return { rows, decor };
}

/**
 * 계획 → 좌표. 각 줄은 가로폭 안에서 최대한 키우되, 전체 높이가 들어가도록 공통 상한(C)을 찾음.
 * 남는 세로 공간은 줄 사이에 고르게 나눔.
 */
export function placePlan(groups: Group[], plan: Plan, W: number, H: number): Placement[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const rows = plan.rows.map((r) => r.map((id) => byId.get(id)!).filter(Boolean)).filter((r) => r.length);
  const unit = Math.min(W, H);
  const m = Math.round(unit * 0.05);
  const gx = Math.round(unit * 0.03);
  const g0 = Math.round(unit * 0.025);
  const availW = W - 2 * m;
  const availH = H - 2 * m;

  const rowW = rows.map((r) => r.reduce((s, g) => s + g.box.w, 0));
  const rowH = rows.map((r) => Math.max(...r.map((g) => g.box.h)));
  const sw = rows.map((r, i) => (availW - gx * (r.length - 1)) / rowW[i]);
  const heightAt = (C: number) => rows.reduce((s, _r, i) => s + rowH[i] * Math.min(sw[i], C), 0) + g0 * Math.max(0, rows.length - 1);
  let lo = 0.02;
  // 줄마다 따로 꽉 채우면 작은 라벨이 제목보다 커지는 등 위계가 깨지므로,
  // 가장 덜 커지는 줄 대비 1.35배까지만 더 키움 (원본의 4배 상한)
  let hi = Math.min(4, Math.min(...sw) * 1.35);
  if (heightAt(hi) <= availH) lo = hi;
  else for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (heightAt(mid) <= availH) lo = mid;
    else hi = mid;
  }
  const C = lo;
  const sc = rows.map((_r, i) => Math.min(sw[i], C));
  const used = heightAt(C);
  const extra = Math.max(0, availH - used);
  const gap = rows.length ? extra / (rows.length + 1) : 0;

  const out: Placement[] = [];
  let y = m + gap;
  const rowCenters: number[] = [];
  rows.forEach((r, i) => {
    const s = sc[i];
    const h = rowH[i] * s;
    const totalW = rowW[i] * s + gx * (r.length - 1);
    let x = (W - totalW) / 2;
    for (const g of r) {
      const gw = g.box.w * s;
      const gh = g.box.h * s;
      out.push({ groupId: g.id, x: Math.round(x), y: Math.round(y + (h - gh) / 2), w: Math.round(gw), h: Math.round(gh) });
      x += gw + gx;
    }
    rowCenters.push(y + h / 2);
    y += h + g0 + gap;
  });

  // 장식
  const median = sc.length ? [...sc].sort((a, b) => a - b)[Math.floor(sc.length / 2)] : W / 1000;
  for (const d of plan.decor) {
    const g = byId.get(d.groupId);
    if (!g || d.position === 'hide') continue;
    const s = Math.min(median, (unit * 0.16) / Math.max(g.box.w, g.box.h)); // 장식은 화면 짧은 변의 16% 이하
    const w = g.box.w * s;
    const h = g.box.h * s;
    const inset = Math.round(m * 0.5);
    const ex = (left: boolean) => (left ? (g.edge.l ? 0 : inset) : g.edge.r ? W - w : W - w - inset);
    let x = 0;
    let yy = 0;
    switch (d.position) {
      case 'top-left': x = ex(true); yy = g.edge.t ? 0 : inset; break;
      case 'top-right': x = ex(false); yy = g.edge.t ? 0 : inset; break;
      case 'bottom-left': x = ex(true); yy = g.edge.b ? H - h : H - h - inset; break;
      case 'bottom-right': x = ex(false); yy = g.edge.b ? H - h : H - h - inset; break;
      case 'left':
      case 'right': {
        const cy = d.row != null && rowCenters[d.row] != null ? rowCenters[d.row] : H / 2;
        x = ex(d.position === 'left');
        yy = cy - h / 2;
        break;
      }
    }
    out.push({ groupId: g.id, x: Math.round(x), y: Math.round(Math.max(0, Math.min(H - h, yy))), w: Math.round(w), h: Math.round(h) });
  }
  return out;
}

/** AI 가 준 계획 정리: 없는 묶음 제거, 빠진 묶음은 끝 줄/장식으로 보충 */
export function sanitizePlan(plan: Plan, groups: Group[]): Plan {
  const ids = new Set(groups.map((g) => g.id));
  const seen = new Set<string>();
  const rows = (plan.rows ?? [])
    .map((r) => (Array.isArray(r) ? r : []).map(String).filter((id) => ids.has(id) && !seen.has(id) && (seen.add(id), true)))
    .filter((r) => r.length);
  const POS: DecorPos[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'left', 'right', 'hide'];
  const decor = (plan.decor ?? [])
    .filter((d) => d && ids.has(String(d.groupId)) && !seen.has(String(d.groupId)) && (seen.add(String(d.groupId)), true))
    .map((d) => ({ groupId: String(d.groupId), position: POS.includes(d.position) ? d.position : 'top-left', row: Number.isInteger(d.row) ? d.row : undefined }));
  for (const g of groups) {
    if (seen.has(g.id)) continue;
    if (g.role === 'decoration') decor.push({ groupId: g.id, position: g.edge.l ? 'left' : 'right', row: undefined });
    else rows.push([g.id]);
  }
  return { rows, decor };
}
