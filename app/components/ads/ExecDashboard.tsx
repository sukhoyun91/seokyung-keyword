'use client';
import { useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { ctr, cpc, monthLabel, type AdReport, type M } from '@/lib/ads/types';
import { n0, p2 } from './fmt';

/** 임원 보고용 한눈에 보기 — 외부 라이브러리 없이 SVG.
 *  색: 당월 = 브랜드 파랑, 전월 = 회색, 증가 ▲빨강 / 감소 ▼파랑 (보고서 공통 규칙), 유형 = 고정 순서 범주색 */
const CAT = ['#257de0', '#f47230', '#00b894', '#f2a600'];
const OTHER = '#9aa3b2';
const CUR = '#0b5cad';
const PREV = '#c3cad6';
const UP = '#d23c2a';
const DOWN = '#1e5bd6';

const pct = (c: number, p: number | undefined) => (p ? ((c - p) / p) * 100 : null);
const sgn = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '');
const pctTxt = (v: number | null) => (v == null ? '신규' : `${sgn(v)}${Math.abs(v).toFixed(1)}%`);
const short = (v: number) => (Math.abs(v) >= 1e8 ? `${(v / 1e8).toFixed(1)}억` : Math.abs(v) >= 1e4 ? `${(v / 1e4).toFixed(Math.abs(v) >= 1e6 ? 0 : 1)}만` : n0(v));

type Tip = { x: number; y: number; body: ReactNode } | null;

export default function ExecDashboard({ r, month, shown }: { r: AdReport; month: string; shown: string[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip>(null);
  const show = (e: MouseEvent, body: ReactNode) => {
    const b = box.current?.getBoundingClientRect();
    if (b) setTip({ x: e.clientX - b.left, y: e.clientY - b.top, body });
  };
  const hide = () => setTip(null);

  const tot = (m: string) => r.totals.find((t) => t.month === m);
  const cur = tot(month);
  const prev = tot(r.prevMonth);
  if (!cur) return null;

  const cs = (type: string, m: string) => r.campaignTypes.series.find((s) => s.type === type && s.month === m);
  const gs = (g: string, m: string) => r.adGroups.series.find((s) => s.ad_group === g && s.month === m);
  const types = r.campaignTypes.types.filter((t) => cs(t, month) || cs(t, r.prevMonth));
  // 범주색은 유형에 고정 (당월 비용 순 → 4개 초과는 '기타')
  const colorOf = new Map(types.map((t, i) => [t, i < CAT.length ? CAT[i] : OTHER]));

  // ── 핵심 메시지 (규칙 기반)
  const headline = (() => {
    if (!prev) return `${monthLabel(month)} 광고비 ${n0(cur.cost)}원으로 클릭 ${n0(cur.clk)}건 확보 (전월 자료 없음)`;
    const dc = pct(cur.cost, prev.cost) ?? 0, dk = pct(cur.clk, prev.clk) ?? 0, dp = pct(cpc(cur), cpc(prev)) ?? 0;
    let verdict = '효율 유지';
    if (dk - dc > 3 && dp < 0) verdict = '효율 개선';
    else if (dc - dk > 3 && dp > 0) verdict = '효율 하락 — 점검 필요';
    return `광고비 ${pctTxt(dc)} 대비 클릭 ${pctTxt(dk)}, 클릭당 비용 ${pctTxt(dp)} → ${verdict}`;
  })();

  // ── 1) KPI 타일 + 스파크라인
  const series = shown.map((m) => tot(m)).filter(Boolean) as (M & { month: string })[];
  const tiles: { label: string; unit: string; get: (m: M) => number; fmt: (v: number) => string; invert?: boolean; pp?: boolean; neutral?: boolean }[] = [
    { label: '광고비 (VAT 포함)', unit: '원', get: (m) => m.cost, fmt: n0, neutral: true },
    { label: '노출수', unit: '회', get: (m) => m.imp, fmt: n0 },
    { label: '클릭수', unit: '건', get: (m) => m.clk, fmt: n0 },
    { label: '클릭률', unit: '', get: (m) => ctr(m), fmt: p2, pp: true },
    { label: '평균클릭비용', unit: '원', get: (m) => cpc(m), fmt: n0, invert: true },
  ];

  // ── 4) 광고그룹 클릭 증감 (두 달 모두 있거나 한 달만 있는 그룹)
  const grp = r.adGroups.groups
    .map((g) => ({ name: g.ad_group, c: gs(g.ad_group, month), p: gs(g.ad_group, r.prevMonth) }))
    .filter((x) => x.c || x.p)
    .map((x) => ({ ...x, d: (x.c?.clk ?? 0) - (x.p?.clk ?? 0) }))
    .filter((x) => x.d !== 0)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, 8)
    .sort((a, b) => b.d - a.d);

  // ── 5) 효율 매트릭스 (당월, 클릭 있는 그룹)
  // 플레이스 광고는 클릭률 구조가 달라(10%대) 검색광고와 같은 축에 두면 비교가 안 되므로 제외
  const isPlace = (t: string) => /플레이스|place/i.test(t);
  const hasSearch = r.adGroups.groups.some((g) => !isPlace(g.type || g.campaign || g.ad_group));
  const pts = r.adGroups.groups
    .filter((g) => !hasSearch || !isPlace(g.type || g.campaign || g.ad_group))
    .map((g) => ({ name: g.ad_group, m: gs(g.ad_group, month) }))
    .filter((x) => x.m && x.m.clk > 0 && x.m.imp > 0)
    .map((x) => ({ name: x.name, ctr: ctr(x.m!), cpc: cpc(x.m!), cost: x.m!.cost, clk: x.m!.clk }));

  return (
    <section className="rp-sec exec" ref={box} onMouseLeave={hide}>
      <h2><span className="no">★</span>한눈에 보는 {Number(month.slice(5))}월 성과 <span className="hint">{monthLabel(month)} vs 전월 {monthLabel(r.prevMonth)}</span></h2>
      <div className="ex-headline">{headline}</div>

      <div className="ex-tiles">
        {tiles.map((t) => {
          const c = t.get(cur);
          const p = prev ? t.get(prev) : undefined;
          const d = p == null ? null : t.pp ? c - p : pct(c, p);
          const rel = p ? pct(c, p) ?? 0 : 0;
          const good: boolean | 'flat' | null = d == null || t.neutral ? null : Math.abs(rel) < 1 ? 'flat' : (d > 0) !== Boolean(t.invert);
          return (
            <div key={t.label} className="ex-tile">
              <div className="ex-tl">{t.label}</div>
              <div className="ex-tv">{t.fmt(c)}<small>{t.unit}</small></div>
              <div className="ex-td">
                {d == null ? <span className="muted">전월 자료 없음</span> : (
                  <>
                    <span className="ex-chip" style={{ color: d > 0 ? UP : d < 0 ? DOWN : undefined }}>
                      {d > 0 ? '▲' : d < 0 ? '▼' : ''} {t.pp ? `${Math.abs(d).toFixed(Math.abs(d) < 0.1 ? 3 : 2)}%p` : `${Math.abs(d).toFixed(1)}%`}
                    </span>
                    <span className="muted"> 전월 {t.fmt(p!)}{t.unit}</span>
                    {good != null && <span className={`ex-eval ${good === 'flat' ? 'f' : good ? 'g' : 'b'}`}>{good === 'flat' ? '보합' : good ? '개선' : '악화'}</span>}
                  </>
                )}
              </div>
              <Spark data={series.map((m) => ({ month: m.month, v: t.get(m) }))} cur={month} fmt={(v) => `${t.fmt(v)}${t.unit}`} show={show} hide={hide} />
            </div>
          );
        })}
      </div>

      {types.length > 0 && (
        <div className="ex-block">
          <h3>캠페인 유형별 전월 vs 당월</h3>
          <div className="ex-legend"><span><i style={{ background: PREV }} />전월</span><span><i style={{ background: CUR }} />당월</span></div>
          <div className="ex-multi">
            {([
              ['노출수', (m?: M) => m?.imp ?? 0, '회'],
              ['클릭수', (m?: M) => m?.clk ?? 0, '건'],
              ['광고비', (m?: M) => m?.cost ?? 0, '원'],
            ] as const).map(([label, get, unit]) => (
              <PairBars key={label} title={label} unit={unit} rows={types.map((t) => ({ name: t, p: get(cs(t, r.prevMonth)), c: get(cs(t, month)) }))} hasPrev={Boolean(prev)} show={show} hide={hide} />
            ))}
          </div>
        </div>
      )}

      <div className="ex-grid2">
        {types.length > 0 && (
          <div className="ex-block">
            <h3>광고비 구성비 (캠페인 유형)</h3>
            <Mix rows={[...(prev ? [{ label: '전월', month: r.prevMonth }] : []), { label: '당월', month }].map((x) => ({ label: x.label, parts: types.map((t) => ({ name: t, v: cs(t, x.month)?.cost ?? 0 })) }))} colorOf={colorOf} show={show} hide={hide} />
            <div className="ex-legend">{types.map((t) => <span key={t}><i style={{ background: colorOf.get(t) }} />{t}</span>)}</div>
          </div>
        )}
        {prev && grp.length > 0 && (
          <div className="ex-block">
            <h3>광고그룹 클릭 증감 <span className="hint">변화 큰 순 상위 {grp.length}개</span></h3>
            <Diverge rows={grp.map((g) => ({ name: g.name, d: g.d, p: g.p?.clk ?? 0, c: g.c?.clk ?? 0 }))} show={show} hide={hide} />
          </div>
        )}
      </div>

      {pts.length >= 2 && (
        <div className="ex-block">
          <h3>광고그룹 효율 매트릭스 <span className="hint">당월 · 가로 클릭률, 세로 클릭당 비용, 원 크기 = 광고비{hasSearch ? ' · 플레이스 제외' : ''}</span></h3>
          <Matrix pts={pts} show={show} hide={hide} />
        </div>
      )}

      {tip && <div className="ex-tip" style={{ left: tip.x + 14, top: tip.y + 10 }}>{tip.body}</div>}
    </section>
  );
}

type TipFns = { show: (e: MouseEvent, body: ReactNode) => void; hide: () => void };

function Spark({ data, cur, fmt, show, hide }: { data: { month: string; v: number }[]; cur: string; fmt: (v: number) => string } & TipFns) {
  if (data.length < 2) return null;
  const W = 200, H = 44, P = 4;
  const vs = data.map((d) => d.v);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const x = (i: number) => P + (i * (W - 2 * P)) / (data.length - 1);
  const y = (v: number) => H - P - (hi === lo ? 0.5 : (v - lo) / (hi - lo)) * (H - 2 * P);
  const ci = data.findIndex((d) => d.month === cur);
  const step = (W - 2 * P) / (data.length - 1);
  return (
    <svg className="ex-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="최근 추이">
      <polyline points={data.map((d, i) => `${x(i)},${y(d.v)}`).join(' ')} fill="none" stroke={CUR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={0.85} />
      {ci >= 0 && <circle cx={x(ci)} cy={y(data[ci].v)} r={3.5} fill={CUR} stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
      {data.map((d, i) => (
        <rect key={d.month} x={x(i) - step / 2} y={0} width={step} height={H} fill="transparent"
          onMouseMove={(e) => show(e, <><b>{monthLabel(d.month)}</b><br />{fmt(d.v)}</>)} onMouseLeave={hide} />
      ))}
    </svg>
  );
}

function PairBars({ title, unit, rows, hasPrev, show, hide }: { title: string; unit: string; rows: { name: string; p: number; c: number }[]; hasPrev: boolean } & TipFns) {
  const W = 360, LW = 92, RW = 112, BH = 9, GAP = 2, ROW = 2 * BH + GAP + 16;
  const H = rows.length * ROW + 6;
  const max = Math.max(1, ...rows.flatMap((x) => [x.p, x.c]));
  const sx = (v: number) => (v / max) * (W - LW - RW);
  return (
    <div className="ex-panel">
      <div className="ex-ptitle">{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`캠페인 유형별 ${title} 전월 대비`}>
        {rows.map((x, i) => {
          const y0 = 4 + i * ROW;
          const d = pct(x.c, x.p);
          const tipBody = <><b>{x.name} · {title}</b><br />전월 {n0(x.p)}{unit}<br />당월 {n0(x.c)}{unit}{hasPrev && <><br />증감 {sgn(x.c - x.p)}{n0(Math.abs(x.c - x.p))}{unit} ({pctTxt(d)})</>}</>;
          return (
            <g key={x.name} onMouseMove={(e) => show(e, tipBody)} onMouseLeave={hide} className="ex-hit">
              <rect x={0} y={y0 - 2} width={W} height={ROW - 4} fill="transparent" />
              <text x={0} y={y0 + BH + 4} className="ex-lab">{x.name.length > 8 ? x.name.slice(0, 8) + '…' : x.name}</text>
              {hasPrev && <rect x={LW} y={y0} width={Math.max(sx(x.p), x.p ? 2 : 0)} height={BH} rx={3} fill={PREV} />}
              <rect x={LW} y={y0 + BH + GAP} width={Math.max(sx(x.c), x.c ? 2 : 0)} height={BH} rx={3} fill={CUR} />
              <text x={LW + sx(x.c) + 5} y={y0 + 2 * BH + GAP - 1} className="ex-val">{short(x.c)}</text>
              {hasPrev && (
                <text x={W} y={y0 + BH + 4} textAnchor="end" className="ex-dv" fill={x.c > x.p ? UP : x.c < x.p ? DOWN : '#64708a'}>
                  {x.c > x.p ? '▲' : x.c < x.p ? '▼' : ''}{pctTxt(d).replace(/^[+−]/, '')}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Mix({ rows, colorOf, show, hide }: { rows: { label: string; parts: { name: string; v: number }[] }[]; colorOf: Map<string, string> } & TipFns) {
  const W = 520, LW = 40, BH = 30, ROW = 44;
  const iw = W - LW;
  return (
    <svg viewBox={`0 0 ${W} ${rows.length * ROW}`} width="100%" role="img" aria-label="광고비 구성비">
      {rows.map((row, ri) => {
        const total = row.parts.reduce((a, b) => a + b.v, 0) || 1;
        let acc = 0;
        const y = ri * ROW + 4;
        return (
          <g key={row.label}>
            <text x={0} y={y + BH / 2 + 5} className="ex-lab b">{row.label}</text>
            {row.parts.filter((p) => p.v > 0).map((p) => {
              const w = (p.v / total) * iw;
              const x = LW + acc;
              acc += w;
              const share = (p.v / total) * 100;
              const fill = colorOf.get(p.name) ?? OTHER;
              const dark = fill === '#257de0';
              return (
                <g key={p.name} onMouseMove={(e) => show(e, <><b>{row.label} · {p.name}</b><br />{n0(p.v)}원 ({share.toFixed(1)}%)</>)} onMouseLeave={hide}>
                  <rect x={x + 1} y={y} width={Math.max(0, w - 2)} height={BH} rx={4} fill={fill} />
                  {w > 54 && <text x={x + w / 2} y={y + BH / 2 + 5} textAnchor="middle" className="ex-in" fill={dark ? '#fff' : '#1a2230'}>{share.toFixed(0)}%</text>}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

function Diverge({ rows, show, hide }: { rows: { name: string; d: number; p: number; c: number }[] } & TipFns) {
  const W = 520, LW = 120, VW = 86, ROW = 26, BH = 14;
  const H = rows.length * ROW + 8;
  const max = Math.max(1, ...rows.map((x) => Math.abs(x.d)));
  const half = (W - LW - VW) / 2;
  const mid = LW + half;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="광고그룹 클릭 증감">
      <line x1={mid} x2={mid} y1={0} y2={H} stroke="#aab3c2" strokeWidth={1} />
      {rows.map((x, i) => {
        const y = 4 + i * ROW;
        const w = Math.max(2, (Math.abs(x.d) / max) * half);
        const pos = x.d > 0;
        return (
          <g key={x.name} onMouseMove={(e) => show(e, <><b>{x.name}</b><br />클릭 {n0(x.p)} → {n0(x.c)}건<br />{sgn(x.d)}{n0(Math.abs(x.d))}건 ({pctTxt(pct(x.c, x.p))})</>)} onMouseLeave={hide}>
            <rect x={0} y={y - 2} width={W} height={ROW} fill="transparent" />
            <text x={LW - 8} y={y + BH - 2} textAnchor="end" className="ex-lab">{x.name.length > 11 ? x.name.slice(0, 11) + '…' : x.name}</text>
            <rect x={pos ? mid + 1 : mid - w - 1} y={y} width={w} height={BH} rx={4} fill={pos ? UP : DOWN} opacity={0.88} />
            <text x={pos ? mid + w + 6 : mid - w - 6} y={y + BH - 2} textAnchor={pos ? 'start' : 'end'} className="ex-val">{sgn(x.d)}{n0(Math.abs(x.d))}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Matrix({ pts, show, hide }: { pts: { name: string; ctr: number; cpc: number; cost: number; clk: number }[] } & TipFns) {
  const W = 900, H = 300, L = 60, R = 20, T = 30, B = 34;
  const iw = W - L - R, ih = H - T - B;
  const xs = pts.map((p) => p.ctr), ys = pts.map((p) => p.cpc);
  const pad = (lo: number, hi: number) => { const s = (hi - lo) || hi || 1; return [Math.max(0, lo - s * 0.12), hi + s * 0.12]; };
  const [x0, x1] = pad(Math.min(...xs), Math.max(...xs));
  const [y0, y1] = pad(Math.min(...ys), Math.max(...ys));
  const sx = (v: number) => L + ((v - x0) / (x1 - x0 || 1)) * iw;
  const sy = (v: number) => T + ih - ((v - y0) / (y1 - y0 || 1)) * ih;
  const maxCost = Math.max(...pts.map((p) => p.cost), 1);
  const rad = (c: number) => 5 + Math.sqrt(c / maxCost) * 20;
  const med = (a: number[]) => { const s = [...a].sort((p, q) => p - q); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const mx = med(xs), my = med(ys);
  const labeled = new Set([...pts].sort((a, b) => b.cost - a.cost).slice(0, 6).map((p) => p.name));
  const ticks = [0, 0.5, 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="광고그룹 효율 매트릭스">
      <rect x={sx(mx)} y={sy(my)} width={Math.max(0, W - R - sx(mx))} height={Math.max(0, T + ih - sy(my))} fill="#e6f4ea" opacity={0.6} />
      <text x={W - R} y={T - 10} textAnchor="end" className="ex-q g">효율 우수 · 클릭률↑ 클릭당 비용↓ ↘</text>
      <rect x={L} y={T} width={Math.max(0, sx(mx) - L)} height={Math.max(0, sy(my) - T)} fill="#fdecea" opacity={0.5} />
      <text x={L + 6} y={T - 10} className="ex-q b">↖ 점검 필요 · 클릭률↓ 클릭당 비용↑</text>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={T + ih * (1 - t)} y2={T + ih * (1 - t)} stroke="#eef1f6" />
          <text x={L - 6} y={T + ih * (1 - t) + 4} textAnchor="end" className="ex-ax">{n0(y0 + (y1 - y0) * t)}원</text>
          <text x={L + iw * t} y={H - 12} textAnchor="middle" className="ex-ax">{(x0 + (x1 - x0) * t).toFixed(2)}%</text>
        </g>
      ))}
      <line x1={sx(mx)} x2={sx(mx)} y1={T} y2={T + ih} stroke="#aab3c2" strokeDasharray="4 4" />
      <line x1={L} x2={W - R} y1={sy(my)} y2={sy(my)} stroke="#aab3c2" strokeDasharray="4 4" />
      {[...pts].sort((a, b) => b.cost - a.cost).map((p) => (
        <g key={p.name} onMouseMove={(e) => show(e, <><b>{p.name}</b><br />클릭률 {p2(p.ctr)} · 클릭당 {n0(p.cpc)}원<br />클릭 {n0(p.clk)}건 · 광고비 {n0(p.cost)}원</>)} onMouseLeave={hide}>
          <circle cx={sx(p.ctr)} cy={sy(p.cpc)} r={rad(p.cost)} fill={CUR} fillOpacity={0.55} stroke="#fff" strokeWidth={2} />
          {labeled.has(p.name) && <text x={sx(p.ctr) + (sx(p.ctr) > W - 160 ? -rad(p.cost) - 6 : rad(p.cost) + 6)} y={sy(p.cpc) + 4} textAnchor={sx(p.ctr) > W - 160 ? 'end' : 'start'} className="ex-lab sm">{p.name.length > 10 ? p.name.slice(0, 10) + '…' : p.name}</text>}
        </g>
      ))}
    </svg>
  );
}
