import Image from "next/image";
import { ShelfPhoto } from "@/components/shelf/ShelfPhoto";
import type { Slot } from "@/lib/mock/shelf";
import type { CapturedPhoto } from "@/lib/capture";
import { cn } from "@/lib/cn";

/** Shows the photo the rep actually took. Falls back to the drawn stand-in
 *  shelf when there is none — a desktop reviewer with no camera still gets
 *  the whole flow. */
export function CaptureFrame({
  photo,
  slots,
  fit = "contain",
  className,
  alt = "ภาพชั้นวางที่ถ่ายไว้",
}: {
  photo?: CapturedPhoto | null;
  slots?: Slot[];
  fit?: "cover" | "contain";
  className?: string;
  alt?: string;
}) {
  if (photo) {
    return (
      <Image
        src={photo.objectUrl}
        alt={alt}
        fill
        unoptimized
        sizes="100vw"
        className={cn(fit === "cover" ? "object-cover" : "object-contain", className)}
      />
    );
  }
  return <ShelfPhoto slots={slots} fit={fit} className={className} />;
}
