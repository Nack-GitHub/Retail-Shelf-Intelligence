"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { useSize } from "./useSize";
import { easeOut } from "@/lib/motion";
import { cn } from "@/lib/cn";

export interface Point {
  label: string;
  value: number;
}

export function LineChart({
  data,
  height = 240,
  min,
  max,
  color = "#1b6fe8",
  area = true,
  target,
  targetLabel,
  unit = "%",
  decimals = 1,
  className,
}: {
  data: Point[];
  height?: number;
  min?: number;
  max?: number;
  color?: string;
  area?: boolean;
  target?: number;
  targetLabel?: string;
  unit?: string;
  decimals?: number;
  className?: string;
}) {
  const { ref, width } = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const pad = { top: 16, right: 16, bottom: 30, left: 42 };
  const iw = Math.max(0, width - pad.left - pad.right);
  const ih = height - pad.top - pad.bottom;

  const values = data.map((d) => d.value);
  const lo = min ?? Math.min(...values, target ?? Infinity);
  const hi = max ?? Math.max(...values, target ?? -Infinity);
  const span = hi - lo || 1;
  const padded = { lo: lo - span * 0.12, hi: hi + span * 0.12 };
  const range = padded.hi - padded.lo;

  const x = (i: number) => (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v: number) => ih - ((v - padded.lo) / range) * ih;

  const { path, areaPath, ticks } = useMemo(() => {
    const p = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(d.value).toFixed(2)}`).join(" ");
    const a = `${p} L${x(data.length - 1).toFixed(2)},${ih} L0,${ih} Z`;
    const step = range / 3;
    const t = Array.from({ length: 4 }, (_, i) => padded.lo + step * i);
    return { path: p, areaPath: a, ticks: t };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, iw, ih, range, padded.lo]);

  const active = hover !== null ? data[hover] : null;

  return (
    <div ref={ref} className={cn("relative w-full", className)} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} className="block overflow-visible">
          <g transform={`translate(${pad.left} ${pad.top})`}>
            {/* horizontal guides */}
            {ticks.map((t, i) => (
              <g key={i}>
                <line x1={0} x2={iw} y1={y(t)} y2={y(t)} stroke="#e2e7ee" strokeWidth={1} />
                <text x={-10} y={y(t) + 4} textAnchor="end" className="tnum" fill="#98a2b3" fontSize={11}>
                  {t.toFixed(0)}
                </text>
              </g>
            ))}

            {target !== undefined && (
              <g>
                <line
                  x1={0} x2={iw} y1={y(target)} y2={y(target)}
                  stroke="#d92d20" strokeWidth={1.5} strokeDasharray="6 5"
                />
                <text x={iw} y={y(target) - 7} textAnchor="end" fill="#d92d20" fontSize={11} fontWeight={600}>
                  {targetLabel ?? `เกณฑ์ ${target}`}
                </text>
              </g>
            )}

            {area && (
              <motion.path
                d={areaPath}
                fill={color}
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.09 }}
                transition={{ duration: 0.6, delay: 0.35 }}
              />
            )}

            <motion.path
              d={path}
              fill="none"
              stroke={color}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.05, ease: easeOut }}
            />

            {data.map((d, i) => (
              <motion.circle
                key={d.label}
                cx={x(i)}
                cy={y(d.value)}
                r={hover === i ? 5.5 : 3.5}
                fill="#fff"
                stroke={color}
                strokeWidth={2.5}
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.5 + i * 0.035, duration: 0.3, ease: easeOut }}
              />
            ))}

            {/* x labels */}
            {data.map((d, i) => (
              <text
                key={d.label}
                x={x(i)}
                y={ih + 20}
                textAnchor="middle"
                fill={hover === i ? "#101828" : "#98a2b3"}
                fontSize={11}
                fontWeight={hover === i ? 600 : 400}
              >
                {d.label}
              </text>
            ))}

            {hover !== null && (
              <line x1={x(hover)} x2={x(hover)} y1={0} y2={ih} stroke="#101828" strokeWidth={1} strokeDasharray="4 4" opacity={0.35} />
            )}

            {/* hit areas */}
            {data.map((d, i) => (
              <rect
                key={d.label}
                x={x(i) - iw / (data.length * 2)}
                y={0}
                width={iw / data.length}
                height={ih}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            ))}
          </g>
        </svg>
      )}

      {active && hover !== null && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-chip border border-line bg-bg px-2.5 py-1.5 shadow-[var(--shadow-lift)]"
          style={{
            left: pad.left + x(hover),
            top: pad.top + y(active.value) - 52,
          }}
        >
          <p className="text-[11px] text-muted">{active.label}</p>
          <p className="tnum text-[14px] font-semibold">
            {active.value.toFixed(decimals)}
            {unit}
          </p>
        </motion.div>
      )}
    </div>
  );
}

export function Sparkline({
  values,
  width = 120,
  height = 34,
  color = "#1b6fe8",
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const path = values
    .map((v, i) => {
      const px = (i / (values.length - 1)) * width;
      const py = height - ((v - lo) / span) * (height - 6) - 3;
      return `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} aria-hidden className="overflow-visible">
      <motion.path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.9, ease: easeOut }}
      />
    </svg>
  );
}
