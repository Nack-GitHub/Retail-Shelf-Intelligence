"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { useSize } from "./useSize";
import { easeOut } from "@/lib/motion";
import { cn } from "@/lib/cn";

export interface Point {
  label: string;
  /** null = no measurement for this slot. The line breaks across it and no dot
   *  is drawn — an unobserved week is not a reading of zero, and joining
   *  straight through one invents a slope nobody measured. */
  value: number | null;
}

/** Label every point while they fit, then thin evenly. Twelve "24 ส.ค." labels
 *  in a 600px axis overlap into a grey smear; the first and last always
 *  survive so the span of the chart stays readable. */
function labelStride(count: number, innerWidth: number): number {
  const fits = Math.max(1, Math.floor(innerWidth / 56));
  return Math.max(1, Math.ceil(count / fits));
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

  // Scale off the measurements only — a null must not drag the axis to zero.
  const values = data.map((d) => d.value).filter((v): v is number => v !== null);
  const lo = min ?? Math.min(...values, target ?? Infinity);
  const hi = max ?? Math.max(...values, target ?? -Infinity);
  const span = hi - lo || 1;
  const padded = { lo: lo - span * 0.12, hi: hi + span * 0.12 };
  const range = padded.hi - padded.lo;

  const x = (i: number) => (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v: number) => ih - ((v - padded.lo) / range) * ih;
  /** width of one point's column — used for gap bands and hover targets */
  const slot = data.length > 0 ? iw / data.length : 0;

  const { path, areaPath, ticks, gaps } = useMemo(() => {
    // One run of consecutive measured points becomes one subpath. Drawing a
    // single `M…L…` through the lot would bridge every gap.
    const runs: { i: number; value: number }[][] = [];
    let run: { i: number; value: number }[] = [];
    data.forEach((d, i) => {
      if (d.value === null) {
        if (run.length) runs.push(run);
        run = [];
      } else {
        run.push({ i, value: d.value });
      }
    });
    if (run.length) runs.push(run);

    const p = runs
      .map((r) =>
        r.map((pt, k) => `${k === 0 ? "M" : "L"}${x(pt.i).toFixed(2)},${y(pt.value).toFixed(2)}`).join(" "),
      )
      .join(" ");

    // A run of one has no line to fill under; its dot carries it instead.
    const a = runs
      .filter((r) => r.length > 1)
      .map((r) => {
        const line = r
          .map((pt, k) => `${k === 0 ? "M" : "L"}${x(pt.i).toFixed(2)},${y(pt.value).toFixed(2)}`)
          .join(" ");
        return `${line} L${x(r[r.length - 1].i).toFixed(2)},${ih} L${x(r[0].i).toFixed(2)},${ih} Z`;
      })
      .join(" ");

    const step = range / 3;
    const t = Array.from({ length: 4 }, (_, i) => padded.lo + step * i);
    const g = data.map((d, i) => (d.value === null ? i : -1)).filter((i) => i >= 0);
    return { path: p, areaPath: a, ticks: t, gaps: g };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, iw, ih, range, padded.lo]);

  const stride = labelStride(data.length, iw);
  const active = hover !== null ? data[hover] : null;

  return (
    <div ref={ref} className={cn("relative w-full", className)} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} className="block overflow-visible">
          <g transform={`translate(${pad.left} ${pad.top})`}>
            {/* Weeks with no photograph. Without this the break in the line
                reads as a rendering glitch rather than as "nobody went". */}
            {gaps.map((i) => (
              <rect
                key={`gap-${i}`}
                x={x(i) - slot / 2}
                y={0}
                width={slot}
                height={ih}
                fill="#98a2b3"
                opacity={0.07}
              />
            ))}

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

            {data.map((d, i) =>
              d.value === null ? null : (
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
              ),
            )}

            {/* x labels */}
            {data.map((d, i) =>
              i % stride !== 0 && i !== data.length - 1 && hover !== i ? null : (
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
              ),
            )}

            {hover !== null && (
              <line x1={x(hover)} x2={x(hover)} y1={0} y2={ih} stroke="#101828" strokeWidth={1} strokeDasharray="4 4" opacity={0.35} />
            )}

            {/* hit areas */}
            {data.map((d, i) => (
              <rect
                key={d.label}
                x={x(i) - slot / 2}
                y={0}
                width={slot}
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
            // An empty week has no y to anchor to, so the card sits mid-plot.
            top: active.value === null ? pad.top + ih / 2 : pad.top + y(active.value) - 52,
          }}
        >
          <p className="text-[11px] text-muted">{active.label}</p>
          {active.value === null ? (
            <p className="text-[13px] font-medium text-muted">ไม่มีการตรวจ</p>
          ) : (
            <p className="tnum text-[14px] font-semibold">
              {active.value.toFixed(decimals)}
              {unit}
            </p>
          )}
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
  /** null = unmeasured week; the line breaks rather than dipping through it */
  values: (number | null)[];
  width?: number;
  height?: number;
  color?: string;
}) {
  const measured = values.filter((v): v is number => v !== null);
  const lo = Math.min(...measured);
  const hi = Math.max(...measured);
  const span = hi - lo || 1;
  const path = values
    .map((v, i) => {
      if (v === null) return null;
      const px = (i / (values.length - 1)) * width;
      const py = height - ((v - lo) / span) * (height - 6) - 3;
      return { px, py, i };
    })
    .reduce<{ d: string; previous: number | null }>(
      (acc, pt) => {
        if (!pt) return { d: acc.d, previous: null };
        const command = acc.previous === null || pt.i !== acc.previous + 1 ? "M" : "L";
        return {
          d: `${acc.d}${acc.d ? " " : ""}${command}${pt.px.toFixed(1)},${pt.py.toFixed(1)}`,
          previous: pt.i,
        };
      },
      { d: "", previous: null },
    ).d;
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
