"use client";

import { motion } from "motion/react";
import type { Detection, GapFinding } from "@/types";
import { easeOut } from "@/lib/motion";

/** LOW_CONF is every box the model was unsure about, whatever it is — the audit
 *  view a manager wants. LOW_CONF_GAP is the subset a rep can act on, which is
 *  what the mobile "ต้องตรวจสอบ" chip counts. The two are deliberately separate:
 *  one screen is asking "what did the model struggle with", the other "what do
 *  I have to decide before I leave". */
export type OverlayFilter = "ALL" | "GAP" | "PRODUCT" | "LOW_CONF" | "LOW_CONF_GAP" | "TAG";

/* Stroke widths and badge sizes below are authored against a 1920-wide frame.
   A 4000px phone photo would otherwise get hairline boxes and unreadable
   labels, so every dimension is multiplied by the ratio to this reference —
   the boxes themselves are always absolute pixels in the source image. */
const STROKE_REFERENCE_WIDTH = 1920;

const COLORS = {
  PRODUCT: "#12b76a",
  GAP: "#d92d20",
  LOW: "#98a2b3",
  TAG: "#7fb0ff",
} as const;

/** Branch on semanticType only.
 *
 *  className is raw model output: the 45 class names change on every retrain,
 *  so testing one here would silently stop matching the day the ML team
 *  renames a class. semanticType is the stable contract. */
function kindOf(d: Detection): "PRODUCT" | "GAP" | "TAG" {
  if (d.semanticType === "PRICE_TAG" || d.semanticType === "PROMO_TAG") return "TAG";
  if (d.semanticType === "GAP") return "GAP";
  return "PRODUCT";
}

function matches(d: Detection, f: OverlayFilter, lowConfidence: number) {
  const k = kindOf(d);
  switch (f) {
    case "ALL": return k !== "TAG";
    case "GAP": return k === "GAP";
    case "PRODUCT": return k === "PRODUCT";
    case "LOW_CONF": return d.confidence < lowConfidence;
    case "LOW_CONF_GAP": return k === "GAP" && d.confidence < lowConfidence;
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
  lowConfidenceThreshold = 0.55,
  imageWidth,
  imageHeight,
}: {
  detections: Detection[];
  findings?: GapFinding[];
  filter?: OverlayFilter;
  focusDetectionId?: string | null;
  animate?: boolean;
  showLabels?: boolean;
  fit?: "cover" | "contain";
  /** The value the SERVER used to decide `isLowConfidence`. Hardcoding a
   *  different one here made the overlay and the verify screen disagree about
   *  the same detection. The default matches config.py only as a fallback for
   *  callers with no analysis to hand. */
  lowConfidenceThreshold?: number;
  /** pixel space the bounding boxes are expressed in — required, because a
   *  wrong guess here draws every box in the wrong place */
  imageWidth: number;
  imageHeight: number;
}) {
  const pxScale = imageWidth / STROKE_REFERENCE_WIDTH;
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
        const on = matches(d, filter, lowConfidenceThreshold);
        const kind = kindOf(d);
        const low = d.confidence < lowConfidenceThreshold;
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
            {/* Gaps only. "ต้องตรวจสอบ" tells the rep to go and decide something,
                and an uncertain PRODUCT or price tag gives them nothing to decide.
                On a real bay photo 87% of the boxes under the threshold are those
                — roughly 3.7 badges per photo where 0.5 are actionable — and the
                badge is a fixed-width block with no collision avoidance, so they
                pile up on top of each other. The dashed stroke below still marks
                every uncertain box. */}
            {showLabels && low && !dimmed && kind === "GAP" && (
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
