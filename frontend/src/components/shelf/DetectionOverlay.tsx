"use client";

import { motion } from "motion/react";
import { IMAGE_H, IMAGE_W } from "@/lib/mock/shelf";
import type { Detection, GapFinding } from "@/types";
import { easeOut } from "@/lib/motion";

export type OverlayFilter = "ALL" | "GAP" | "ALMOST" | "PRODUCT" | "LOW_CONF" | "TAG";

const COLORS = {
  PRODUCT: "#12b76a",
  ALMOST: "#f79009",
  GAP: "#d92d20",
  LOW: "#98a2b3",
  TAG: "#7fb0ff",
} as const;

function kindOf(d: Detection): "PRODUCT" | "ALMOST" | "GAP" | "TAG" {
  if (d.semanticType === "PRICE_TAG") return "TAG";
  if (d.semanticType === "GAP") return "GAP";
  return d.className === "Low Stock Facing" ? "ALMOST" : "PRODUCT";
}

function matches(d: Detection, f: OverlayFilter) {
  const k = kindOf(d);
  switch (f) {
    case "ALL": return k !== "TAG";
    case "GAP": return k === "GAP";
    case "ALMOST": return k === "ALMOST";
    case "PRODUCT": return k === "PRODUCT";
    case "LOW_CONF": return d.confidence < 0.6;
    case "TAG": return k === "TAG";
  }
}

export function DetectionOverlay({
  detections,
  findings = [],
  filter = "ALL",
  focusDetectionId,
  animate: shouldAnimate = true,
  showLabels = true,
  fit = "cover",
  imageWidth = IMAGE_W,
  imageHeight = IMAGE_H,
}: {
  detections: Detection[];
  findings?: GapFinding[];
  filter?: OverlayFilter;
  focusDetectionId?: string | null;
  animate?: boolean;
  showLabels?: boolean;
  fit?: "cover" | "contain";
  /** pixel space the bounding boxes are expressed in */
  imageWidth?: number;
  imageHeight?: number;
}) {
  // stroke and badge sizes are authored against the 1920-wide mock, so they
  // scale with whatever resolution the real photo came in at
  const pxScale = imageWidth / IMAGE_W;
  const verdictOf = new Map(
    findings.map((f) => [f.detectionId, f.verificationStatus] as const),
  );

  return (
    <svg
      viewBox={`0 0 ${imageWidth} ${imageHeight}`}
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio={fit === "cover" ? "xMidYMid slice" : "xMidYMid meet"}
      aria-hidden
    >
      {detections.map((d, i) => {
        const on = matches(d, filter);
        const kind = kindOf(d);
        const low = d.confidence < 0.6;
        const verdict = verdictOf.get(d.detectionId);
        const focused = focusDetectionId === d.detectionId;
        const stroke = low ? COLORS.LOW : COLORS[kind];
        const { x, y, w, h } = d.bbox;

        const dimmed = focusDetectionId ? !focused : !on;

        return (
          <motion.g
            key={d.detectionId}
            initial={shouldAnimate ? { opacity: 0, scale: 0.82 } : false}
            animate={{ opacity: dimmed ? 0.16 : 1, scale: 1 }}
            style={{ originX: `${x + w / 2}px`, originY: `${y + h / 2}px` }}
            transition={{
              duration: 0.34,
              ease: easeOut,
              delay: shouldAnimate ? Math.min(0.5, i * 0.022) : 0,
            }}
          >
            {kind === "GAP" && (
              <rect x={x} y={y} width={w} height={h} fill={stroke} opacity={0.16} />
            )}
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill="none"
              stroke={stroke}
              strokeWidth={(focused ? 8 : kind === "TAG" ? 2.5 : 4.5) * pxScale}
              strokeDasharray={low ? `${14 * pxScale} ${10 * pxScale}` : undefined}
              rx={4 * pxScale}
            />
            {focused && (
              <rect
                x={x - 8 * pxScale}
                y={y - 8 * pxScale}
                width={w + 16 * pxScale}
                height={h + 16 * pxScale}
                fill="none"
                stroke="#fff"
                strokeWidth={3 * pxScale}
                rx={7 * pxScale}
                opacity={0.8}
              />
            )}
            {verdict === "CONFIRMED" && (
              <g transform={`translate(${x + w - 34 * pxScale} ${y + 10 * pxScale}) scale(${pxScale})`}>
                <circle cx={12} cy={12} r={16} fill="#d92d20" />
                <path d="M4 12.5l5 5 10-10" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" transform="translate(0,-0.5)" />
              </g>
            )}
            {verdict === "REJECTED" && (
              <g transform={`translate(${x + w - 34 * pxScale} ${y + 10 * pxScale}) scale(${pxScale})`}>
                <circle cx={12} cy={12} r={16} fill="#667085" />
                <path d="M5 5l14 14M19 5L5 19" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
              </g>
            )}
            {showLabels && low && !dimmed && (
              <g transform={`translate(${x} ${Math.max(30 * pxScale, y - 34 * pxScale)}) scale(${pxScale})`}>
                <rect width={168} height={30} rx={6} fill={COLORS.LOW} />
                <text x={10} y={21} fill="#fff" fontSize={19} fontWeight={600}>
                  ต้องตรวจสอบ
                </text>
              </g>
            )}
          </motion.g>
        );
      })}
    </svg>
  );
}
