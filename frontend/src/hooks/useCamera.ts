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

/** A shutter press that could not produce a frame. Carries the sentence the
 *  rep should read: "ถ่ายภาพไม่สำเร็จ" on its own tells them nothing about
 *  whether to wait, retry, or give up and upload from the gallery. */
export class CameraGrabError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_READY" | "NO_FRAME" | "UNSUPPORTED",
  ) {
    super(message);
    this.name = "CameraGrabError";
  }
}

/** The camera does not come back the instant another app lets go of it, so
 *  each failed recovery waits longer than the last, up to this ceiling. */
const RECOVERY_BACKOFF_MS = [200, 600, 1500, 4000];

/** Resolves once the element reports frame dimensions, or false on timeout. */
function waitForFrame(video: HTMLVideoElement, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const events = ["loadedmetadata", "loadeddata", "playing"] as const;
    let timer = 0;

    const finish = (ok: boolean) => {
      window.clearTimeout(timer);
      events.forEach((e) => video.removeEventListener(e, onProgress));
      resolve(ok);
    };
    function onProgress() {
      if (video.videoWidth) finish(true);
    }

    events.forEach((e) => video.addEventListener(e, onProgress));
    timer = window.setTimeout(() => finish(false), timeoutMs);
    onProgress();
  });
}

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

  // The recovery pass runs from event listeners, which capture whatever these
  // were when the listener was attached. Reading them through refs keeps one
  // set of listeners for the life of the screen instead of re-binding on
  // every status change.
  const activeRef = useRef(active);
  activeRef.current = active;
  const statusRef = useRef(status);
  statusRef.current = status;
  const recovery = useRef<{ attempts: number; timer: number }>({ attempts: 0, timer: 0 });

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

  /* Reopens the camera when the track we were handed has died.
   *
   * iOS Safari ends the video track when the app goes to the background or the
   * screen locks, and it does so silently: `status` stays READY, the banner
   * still says "พร้อมถ่าย", and the viewfinder is black with no way to fix it.
   * Nothing short of watching for the death notices catches this. */
  const recover = useCallback(() => {
    if (!activeRef.current) return;
    if (statusRef.current === "REQUESTING") return; // a request is already in flight
    if (recovery.current.timer) return;

    const track = streamRef.current?.getVideoTracks()[0];
    if (track?.readyState === "live") return;

    const wait =
      RECOVERY_BACKOFF_MS[Math.min(recovery.current.attempts, RECOVERY_BACKOFF_MS.length - 1)];
    recovery.current.attempts += 1;
    recovery.current.timer = window.setTimeout(() => {
      recovery.current.timer = 0;
      stop();
      void start();
    }, wait);
  }, [start, stop]);

  // A stream that came back healthy clears the debt from earlier attempts.
  useEffect(() => {
    if (status === "READY") recovery.current.attempts = 0;
  }, [status]);

  useEffect(() => {
    const pending = recovery.current;
    return () => {
      window.clearTimeout(pending.timer);
      pending.timer = 0;
    };
  }, []);

  useEffect(() => {
    if (!stream) return;
    const tracks = stream.getVideoTracks();
    tracks.forEach((t) => t.addEventListener("ended", recover));
    return () => tracks.forEach((t) => t.removeEventListener("ended", recover));
  }, [stream, recover]);

  /* The "ended" event is not guaranteed. A track can be reclaimed and go to
     readyState "ended" without notifying anyone, which leaves a viewfinder
     that is black while the app insists it is ready — the state a rep cannot
     get out of without knowing to leave the screen and come back. Reading a
     property every couple of seconds is a cheap floor under that. */
  useEffect(() => {
    if (!stream || status !== "READY") return;
    const id = window.setInterval(recover, 2000);
    return () => window.clearInterval(id);
  }, [stream, status, recover]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") recover();
    };
    document.addEventListener("visibilitychange", onVisible);
    // pageshow fires on a bfcache restore, where no effect re-runs at all and
    // the stream the page is holding may have been torn down while it slept.
    window.addEventListener("pageshow", recover);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", recover);
    };
  }, [recover]);

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

  /** Grabs the current frame, cropped to the region the viewfinder shows.
   *
   *  Throws CameraGrabError rather than returning null: "no frame yet" and
   *  "this device cannot encode" send the rep to different remedies, and both
   *  used to surface as the same shrug of a message. */
  const grab = useCallback(async (): Promise<Blob> => {
    if (!video) {
      throw new CameraGrabError("กล้องยังไม่พร้อม รอสักครู่แล้วลองใหม่", "NOT_READY");
    }

    // A shutter pressed the instant the viewfinder appears can beat the first
    // decoded frame, and drawing a video with no dimensions yields a blank
    // image — so wait for one rather than failing on a technicality.
    if (!video.videoWidth && !(await waitForFrame(video))) {
      throw new CameraGrabError("กล้องยังไม่ส่งภาพ ลองปิดแล้วเปิดกล้องใหม่อีกครั้ง", "NO_FRAME");
    }

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
    if (!ctx) {
      throw new CameraGrabError("อุปกรณ์นี้บันทึกภาพจากกล้องไม่ได้", "UNSUPPORTED");
    }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );
    if (!blob) {
      throw new CameraGrabError("อุปกรณ์นี้บันทึกภาพจากกล้องไม่ได้", "UNSUPPORTED");
    }
    return blob;
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
