"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/cn";

/** Stylised map tile — no network tiles, no API key, no PII in a URL. */
export function MapSnippet({
  match,
  className,
}: {
  match: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative overflow-hidden rounded-card bg-[#e8ecef]", className)}>
      <svg viewBox="0 0 360 160" className="h-full w-full" aria-label="แผนที่ตำแหน่งร้าน" role="img">
        <rect width="360" height="160" fill="#e9edf1" />
        {/* blocks */}
        {[
          [10, 8, 110, 54], [140, 4, 90, 44], [250, 10, 100, 50],
          [4, 84, 96, 68], [120, 68, 76, 40], [216, 74, 64, 34],
          [300, 76, 56, 76], [120, 120, 160, 36],
        ].map(([x, y, w, h], i) => (
          <rect key={i} x={x} y={y} width={w} height={h} rx="3" fill="#dde3e9" />
        ))}
        {/* roads */}
        <rect x="0" y="62" width="360" height="16" fill="#fff" />
        <rect x="100" y="0" width="14" height="160" fill="#fff" />
        <rect x="282" y="0" width="12" height="160" fill="#fbfcfd" />
        <rect x="0" y="110" width="360" height="9" fill="#fbfcfd" />
        <path d="M0 70h360" stroke="#f0b429" strokeWidth="1.6" strokeDasharray="10 8" opacity="0.55" />

        {/* store pin */}
        <g transform="translate(196 52)">
          <ellipse cx="0" cy="30" rx="9" ry="3.5" fill="#101828" opacity="0.18" />
          <path d="M0 30c0 0 12-11.4 12-19A12 12 0 10-12 11c0 7.6 12 19 12 19z" fill="#1b6fe8" />
          <circle cx="0" cy="11" r="4.6" fill="#fff" />
        </g>

        {/* device position */}
        <g transform={match ? "translate(178 84)" : "translate(74 128)"}>
          <motion.circle
            r="20"
            fill={match ? "#1b6fe8" : "#f79009"}
            opacity="0.18"
            animate={{ scale: [1, 1.35, 1], opacity: [0.22, 0.05, 0.22] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          />
          <circle r="7" fill={match ? "#1b6fe8" : "#f79009"} stroke="#fff" strokeWidth="3" />
        </g>

        {!match && (
          <path
            d="M74 128 Q120 100 196 74"
            stroke="#f79009"
            strokeWidth="2"
            strokeDasharray="6 6"
            fill="none"
          />
        )}
      </svg>
    </div>
  );
}
