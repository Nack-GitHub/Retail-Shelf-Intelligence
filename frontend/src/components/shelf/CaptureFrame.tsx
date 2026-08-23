import Image from "next/image";
import { ShelfPhoto } from "@/components/shelf/ShelfPhoto";
import type { Slot } from "@/lib/mock/shelf";
import type { CapturedPhoto } from "@/lib/capture";
import { cn } from "@/lib/cn";

/** Shows the shelf, in order of preference:
 *
 *  1. the blob still in memory from this session — paints instantly, no
 *     network, and it is byte-for-byte what was uploaded
 *  2. the server's signed URL — for a manager reviewing evidence later, or a
 *     rep who reloaded the page
 *  3. the drawn stand-in — a reviewer on a machine with no camera can still
 *     walk the whole flow
 *
 *  The order matters on a phone with poor signal: re-downloading a photo the
 *  device just took would leave the result screen grey for seconds. */
export function CaptureFrame({
  photo,
  imageUrl,
  slots,
  fit = "contain",
  className,
  alt = "ภาพชั้นวางที่ถ่ายไว้",
}: {
  photo?: CapturedPhoto | null;
  /** presigned GET from the API, used when the local blob is gone */
  imageUrl?: string | null;
  slots?: Slot[];
  fit?: "cover" | "contain";
  className?: string;
  alt?: string;
}) {
  const src = photo?.objectUrl ?? imageUrl ?? null;

  if (src) {
    return (
      <Image
        src={src}
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
