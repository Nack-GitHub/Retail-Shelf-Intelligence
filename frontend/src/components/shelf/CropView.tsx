"use client";

import { motion } from "motion/react";
import { CaptureFrame } from "@/components/shelf/CaptureFrame";
import { DetectionOverlay } from "@/components/shelf/DetectionOverlay";
import { IMAGE_H, IMAGE_W } from "@/lib/mock/shelf";
import type { CapturedPhoto } from "@/lib/capture";
import type { BBox, Detection } from "@/types";
import { cn } from "@/lib/cn";
import { springSoft } from "@/lib/motion";

/** Zooms the source frame onto one detection without ever cropping the
 *  evidence away — the rep can always see the surrounding shelf. */
export function CropView({
  bbox,
  detections,
  focusId,
  zoomTarget = 0.28,
  className,
  photo,
  imageWidth = IMAGE_W,
  imageHeight = IMAGE_H,
}: {
  bbox: BBox;
  detections: Detection[];
  focusId: string;
  zoomTarget?: number;
  className?: string;
  photo?: CapturedPhoto | null;
  imageWidth?: number;
  imageHeight?: number;
}) {
  // capped deliberately: the rep must still see the shelf either side of the
  // gap, otherwise the crop stops being evidence and becomes a Rorschach test
  const scale = Math.min(3.2, Math.max(1.5, imageWidth / (bbox.w / zoomTarget)));
  const cx = bbox.x + bbox.w / 2;
  const cy = bbox.y + bbox.h / 2;

  return (
    <div className={cn("relative aspect-[16/10] overflow-hidden bg-ink", className)}>
      <motion.div
        className="absolute"
        initial={false}
        animate={{
          width: `${scale * 100}%`,
          left: `${50 - (cx / imageWidth) * scale * 100}%`,
          top: `${50 - (cy / imageHeight) * scale * 90}%`,
        }}
        transition={springSoft}
        style={{ aspectRatio: `${imageWidth} / ${imageHeight}` }}
      >
        <CaptureFrame photo={photo} fit="contain" />
        <DetectionOverlay
          detections={detections}
          filter="GAP"
          focusDetectionId={focusId}
          animate={false}
          showLabels={false}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
        />
      </motion.div>
    </div>
  );
}
