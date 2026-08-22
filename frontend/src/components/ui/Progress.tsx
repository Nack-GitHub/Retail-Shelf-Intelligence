"use client";

import {
  motion,
  useMotionValue,
  useTransform,
  animate,
  useReducedMotion,
} from "motion/react";
import { useEffect } from "react";
import { cn } from "@/lib/cn";
import { easeOut } from "@/lib/motion";

export function ProgressRing({
  value,
  size = 148,
  stroke = 8,
  track = "rgba(255,255,255,0.14)",
  color = "#1b6fe8",
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  track?: string;
  color?: string;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c - (c * Math.min(100, value)) / 100 }}
          transition={{ duration: 0.5, ease: easeOut }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

export function Bar({
  value,
  tone = "primary",
  className,
  height = 6,
  delay = 0,
}: {
  value: number;
  tone?: "primary" | "ok" | "warn" | "danger" | "muted";
  className?: string;
  height?: number;
  delay?: number;
}) {
  const tones = {
    primary: "bg-primary",
    ok: "bg-ok",
    warn: "bg-warn",
    danger: "bg-danger",
    muted: "bg-muted",
  } as const;
  return (
    <div
      className={cn("overflow-hidden rounded-pill bg-surface-2", className)}
      style={{ height }}
    >
      <motion.div
        className={cn("h-full rounded-pill", tones[tone])}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: Math.max(0, Math.min(1, value / 100)) }}
        style={{ originX: 0 }}
        transition={{ duration: 0.6, ease: easeOut, delay }}
      />
    </div>
  );
}

/** Animated number. Counts from the previous value so changes read as motion. */
export function CountUp({
  to,
  duration = 0.9,
  decimals = 0,
  suffix = "",
  className,
}: {
  to: number;
  duration?: number;
  decimals?: number;
  suffix?: string;
  className?: string;
}) {
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => v.toFixed(decimals) + suffix);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) {
      mv.set(to);
      return;
    }
    const controls = animate(mv, to, { duration, ease: easeOut });
    return controls.stop;
  }, [to, duration, mv, reduced]);

  return <motion.span className={cn("tnum", className)}>{text}</motion.span>;
}
