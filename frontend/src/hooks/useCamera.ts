"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* Real device camera. Prefers the rear lens, streams into a <video> the
   caller owns, and grabs a still by drawing the current frame to a canvas.

   The caller receives a ref *callback* rather than passing a ref object in.
   That is the whole trick to a viewfinder that survives leaving the screen and
   coming back: the stream and the <video> element become available in either
   order, and an effect keyed on a ref object never re-runs when the element
   finally mounts. The first visit hides this — the permission sheet is slow
   enough that the element always wins — and every visit afterwards, when
   permission is already granted, loses the race and shows black.

   getUserMedia only exists in a secure context, so over plain http on a
   phone (a LAN IP, say) there is no camera at all — reported as its own
   status, because the fix is different: serve the dev server over https. */

export type CameraStatus =
  | "IDLE"
  | "REQUESTING"
  | "READY"
  | "DENIED"
  | "NOT_FOUND"
  | "IN_USE"
  | "INSECURE"
  | "UNSUPPORTED"
  | "ERROR";

const MESSAGES: Partial<Record<CameraStatus, string>> = {
  DENIED: "ไม่ได้รับอนุญาตให้ใช้กล้อง — เปิดสิทธิ์กล้องให้เว็บนี้ในตั้งค่าเบราว์เซอร์ แล้วลองใหม่",
  NOT_FOUND: "ไม่พบกล้องบนอุปกรณ์นี้",
  IN_USE: "กล้องถูกใช้งานโดยแอปอื่นอยู่ ปิดแอปนั้นแล้วลองใหม่",
  INSECURE:
    "เบราว์เซอร์เปิดกล้องได้เฉพาะบน https หรือ localhost เท่านั้น — ถ้าทดสอบบนมือถือผ่าน LAN ให้รันเซิร์ฟเวอร์แบบ https",
  UNSUPPORTED: "เบราว์เซอร์นี้ไม่รองรับการเปิดกล้องผ่านเว็บ",
  ERROR: "เปิดกล้องไม่สำเร็จ",
};

export function useCamera({
  active,
  aspect = 16 / 9,
}: {
  active: boolean;
  aspect?: number;
}) {
  const [status, setStatus] = useState<CameraStatus>("IDLE");
  // The <video> is only rendered once status is READY, so the element does
  // not exist yet at the moment getUserMedia resolves. Both the stream and the
  // element therefore live in state: attaching one to the other is an effect
  // that re-runs whenever either of them changes.
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  /* Every start and stop bumps this. A getUserMedia that resolves after its
     bump has no owner: the screen it belonged to is gone, or a newer request
     has replaced it. Without this the abandoned stream is assigned to a dead
     component and its track stays open for the life of the tab — and the next
     getUserMedia fails with NotReadableError, which the rep reads as
     "กล้องถูกใช้งานโดยแอปอื่นอยู่" while no other app is running. */
  const generation = useRef(0);

  const stop = useCallback(() => {
    generation.current += 1;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  const start = useCallback(async () => {
    if (typeof window === "undefined") return;

    if (!window.isSecureContext) {
      setStatus("INSECURE");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("UNSUPPORTED");
      return;
    }

    const mine = ++generation.current;
    setStatus("REQUESTING");
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      if (mine !== generation.current) {
        next.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = next;
      setStream(next);
      setStatus("READY");
    } catch (err) {
      if (mine !== generation.current) return;
      const name = err instanceof DOMException ? err.name : "";
      setStatus(
        name === "NotAllowedError" || name === "SecurityError"
          ? "DENIED"
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? "NOT_FOUND"
            : name === "NotReadableError"
              ? "IN_USE"
              : "ERROR",
      );
    }
  }, []);

  // Attach once both the stream and the element exist — in whichever order
  // they arrive.
  useEffect(() => {
    if (!video || !stream) return;
    video.srcObject = stream;
    video.setAttribute("playsinline", "true"); // iOS refuses inline playback without it
    video.muted = true;
    void video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [stream, video]);

  useEffect(() => {
    // acting on the next tick keeps the permission prompt out of the commit
    // phase, and keeps this effect body free of synchronous state updates
    const id = window.setTimeout(() => {
      if (active) void start();
      else stop();
    }, 0);
    return () => {
      window.clearTimeout(id);
      stop();
    };
  }, [active, start, stop]);

  /** Grabs the current frame, cropped to the region the viewfinder shows. */
  const grab = useCallback(async (): Promise<Blob | null> => {
    if (!video || !video.videoWidth) return null;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    // the viewfinder renders the stream with object-cover inside an
    // `aspect` box, so the still must use that same centre crop
    let sw = vw;
    let sh = vh;
    if (vw / vh > aspect) sw = Math.round(vh * aspect);
    else sh = Math.round(vw / aspect);
    const sx = Math.round((vw - sw) / 2);
    const sy = Math.round((vh - sh) / 2);

    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);

    return new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );
  }, [aspect, video]);

  return {
    /** attach to the <video>; a callback ref, so mounting order does not matter */
    videoRef: setVideo,
    status,
    message: MESSAGES[status] ?? null,
    isLive: status === "READY",
    start,
    stop,
    grab,
    retry: start,
  };
}
