'use client';
import { useState } from 'react';
import { monthLabel } from '@/lib/ads/types';
import { n0 } from './fmt';

/** 월별 추이: 막대(광고비) + 선(클릭수). 외부 라이브러리 없이 SVG */
export default function TrendChart({ data, highlight }: { data: { month: string; cost: number; clk: number; imp: number }[]; highlight: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length < 2) return null;
  const W = 900, H = 240, L = 56, R = 56, T = 16, B = 34;
  const iw = W - L - R, ih = H - T - B;
  const maxCost = Math.max(...data.map((d) => d.cost), 1);
  const maxClk = Math.max(...data.map((d) => d.clk), 1);
  const step = iw / data.length;
  const bw = Math.max(4, Math.min(28, step * 0.6));
  const x = (i: number) => L + step * i + step / 2;
  const yc = (v: number) => T + ih - (v / maxCost) * ih;
  const yk = (v: number) => T + ih - (v / maxClk) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const every = Math.ceil(data.length / 12);
  const h = hover != null ? data[hover] : null;

  return (
    <div className="chart-wrap">
      <div className="chart-legend">
        <span><i className="sw cbar" /> 광고비</span>
        <span><i className="sw line" /> 클릭수</span>
        {h && <span className="chart-tip">{monthLabel(h.month)} · 광고비 {n0(h.cost)}원 · 클릭 {n0(h.clk)} · 노출 {n0(h.imp)}</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="월별 광고비와 클릭수 추이" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={T + ih * (1 - t)} y2={T + ih * (1 - t)} className="grid" />
            <text x={L - 6} y={T + ih * (1 - t) + 4} textAnchor="end" className="ax">{n0((maxCost * t) / 1000)}k</text>
            <text x={W - R + 6} y={T + ih * (1 - t) + 4} className="ax">{n0(maxClk * t)}</text>
          </g>
        ))}
        {data.map((d, i) => (
          <rect
            key={d.month}
            x={x(i) - bw / 2}
            y={yc(d.cost)}
            width={bw}
            height={Math.max(0, T + ih - yc(d.cost))}
            className={d.month === highlight ? 'cbar hi' : 'cbar'}
            rx={2}
          />
        ))}
        <polyline points={data.map((d, i) => `${x(i)},${yk(d.clk)}`).join(' ')} className="line" />
        {data.map((d, i) => <circle key={d.month} cx={x(i)} cy={yk(d.clk)} r={hover === i ? 4.5 : 2.5} className="dot" />)}
        {data.map((d, i) =>
          i % every === 0 || i === data.length - 1 ? (
            <text key={d.month} x={x(i)} y={H - 12} textAnchor="middle" className="ax">{d.month.slice(2).replace('-', '.')}</text>
          ) : null,
        )}
        {data.map((d, i) => (
          <rect key={`h${i}`} x={L + step * i} y={T} width={step} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />
        ))}
      </svg>
    </div>
  );
}
