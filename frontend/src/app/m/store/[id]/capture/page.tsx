"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { CaptureFrame } from "@/components/shelf/CaptureFrame";
import { Button } from "@/components/ui/Button";
/* Read here rather than imported from a shared module on purpose: Turbopack
   folds `process.env.NEXT_PUBLIC_DEMO_MODE` into a literal at the use site, but
   a `const` re-exported from another module stays a runtime lookup — the branch
   survives minification and drags the demo-only components into the bundle with
   it. Verified by grepping .next/static both ways. See next.config.ts. */
const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "1";
import { fetchStore } from "@/lib/api/routes";
import { fetchCategories } from "@/lib/api/catalog";
import { useResource } from "@/lib/api/useResource";
import { LoadingBlock } from "@/components/ui/AsyncState";
import { useFlow } from "@/lib/flow/useFlow";
import { FlowGuardBlock } from "@/components/mobile/FlowGuardBlock";
import { useDemo } from "@/lib/store";
import { CameraGrabError, useCamera } from "@/hooks/useCamera";
import { intakePhoto, PhotoIntakeError, type CapturedPhoto } from "@/lib/capture";
import { easeOut, springSnappy } from "@/lib/motion";
import { cn } from "@/lib/cn";

export default function CaptureScreen() {
  const { id } = useParams<{ id: string }>();
  const flow = useFlow("CAPTURE");
  const reduced = useReducedMotion();

  const consent = useDemo((s) => s.consent);
  const categoryId = useDemo((s) => s.categoryId);
  const bay = useDemo((s) => s.bay);
  const stageCapture = useDemo((s) => s.stageCapture);
  const logPhoto = useDemo((s) => s.logPhoto);
  const reviewShot = useDemo((s) => s.reviewShot);
  const setReviewShot = useDemo((s) => s.setReviewShot);
  const photoLog = useDemo((s) => s.photoLog);

  const storeResource = useResource(() => fetchStore(id), [id]);
  const catalog = useResource(() => fetchCategories(id), [id]);
  const store = storeResource.data;
  const cat = catalog.data?.find((c) => c.id === categoryId) ?? catalog.data?.[0] ?? null;


  // Derived from the visit rather than held here: leaving this screen for the
  // capture log or the sync queue unmounts it, and a rep who comes back must
  // find the shot they took, not an empty viewfinder.
  const phase = reviewShot ? "PREVIEW" : "CAPTURE";
  const photo = reviewShot?.photo ?? null;
  const shots = useMemo(() => photoLog.filter((p) => p.phase === "BEFORE"), [photoLog]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const timers = useRef<number[]>([]);

  // GUARDRAIL: no consent recorded means the camera never opens.
  const { videoRef, status: camStatus, message: camMessage, isLive: live, grab, retry } =
    useCamera({ active: consent, aspect: 16 / 9 });

  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  /* Removed: a spirit level driven by Math.random(), and a quality banner that
     cycled "ภาพเบลอ / แสงน้อยเกินไป / ถ่ายให้เห็นชั้นวางทั้งชั้น" on a timer.
     Neither read the camera. A rep who tilts the phone and watches the degrees
     disagree learns the whole screen is decoration, and image quality is
     judged server-side anyway — a failed job comes back with its own Thai
     sentence saying what to do. Framing help that does not claim to measure
     (the grid, the corner marks, the standing-distance hint) stays. */

  async function shoot() {
    if (busy) return;
    setError(null);
    setFlash(true);
    timers.current.push(window.setTimeout(() => setFlash(false), 180));

    if (!live) {
      // No camera on this device — carry on with the drawn stand-in shelf so
      // the rest of the flow stays reviewable.
      setReviewShot({ photo: null });
      return;
    }

    setBusy(true);
    try {
      const p = await intakePhoto(await grab(), "CAMERA", "BEFORE");
      logPhoto(p);
      setReviewShot({ photo: p });
    } catch (err) {
      setError(
        err instanceof PhotoIntakeError || err instanceof CameraGrabError
          ? err.message
          : "ถ่ายภาพไม่สำเร็จ ลองอีกครั้ง",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const p = await intakePhoto(file, "UPLOAD", "BEFORE");
      logPhoto(p);
      setReviewShot({ photo: p });
    } catch (err) {
      setError(
        err instanceof PhotoIntakeError ? err.message : "เปิดไฟล์รูปไม่สำเร็จ",
      );
    } finally {
      setBusy(false);
    }
  }

  function usePhoto() {
    stageCapture(photo);
    flow.go("PROCESSING");
  }

  // The camera is behind three gates: a shelf must have been chosen, the
  // store's own data must have loaded, and consent must be recorded
  // (GUARDRAIL — never open the lens without it).
  if (flow.blocked) return <FlowGuardBlock flow={flow} dark />;
  if (!store || !cat) return <LoadingBlock label="กำลังเตรียมกล้อง…" />;
  if (!consent) return <ConsentGate storeId={id} storeName={store.name} />;

  return (
    <div className="on-dark relative flex min-h-0 flex-1 flex-col bg-ink">
      <div className="relative flex min-h-0 flex-1 flex-col justify-center overflow-hidden bg-black">
        {/* status banner */}
        <div className="px-3 pb-2.5">
          <AnimatePresence mode="wait">
            {error ? (
              <Banner key="err" tone="danger" icon={<AlertIcon />} text={error} />
            ) : busy ? (
              <Banner key="busy" tone="ink" dot="bg-primary" text="กำลังประมวลผลภาพบนเครื่อง" />
            ) : live ? (
              <Banner
                key="ready"
                tone="ink"
                dot="bg-ok"
                /* No bay means the shelf picker was skipped, which the flow
                   guard already refuses — naming a bay that does not exist
                   would put a fabricated label on the evidence. */
                text={`พร้อมถ่าย · ${cat.name}${bay ? ` ชั้น ${bay}` : ""}`}
              />
            ) : (
              <Banner
                key="nocam"
                tone="ink"
                dot="bg-warn"
                text={camStatus === "REQUESTING" ? "กำลังขอสิทธิ์ใช้กล้อง…" : "ไม่ได้ใช้กล้อง — โหมดตัวอย่าง"}
              />
            )}
          </AnimatePresence>
        </div>

        {/* ---- capture region: 16:9, exactly what gets saved ---- */}
        <div className="relative aspect-[16/9] w-full shrink-0 overflow-hidden bg-ink-2">
          {/* The <video> must stay mounted across the preview: unmounting it
              hands back a fresh element on "ถ่ายใหม่" that the live stream is
              no longer attached to, which shows as a black viewfinder. The
              preview covers it instead. */}
          {live && (
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              playsInline
              muted
              autoPlay
            />
          )}

          {!live && phase === "CAPTURE" && (
            <motion.div
              className="absolute inset-0"
              animate={reduced ? undefined : { scale: [1.02, 1.035, 1.02] }}
              transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
            >
              <CaptureFrame fit="contain" alt="ภาพชั้นวางตัวอย่าง" />
            </motion.div>
          )}

          {phase === "PREVIEW" && <PreviewLayer photo={photo} />}

          {phase === "CAPTURE" && (
            <>
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute inset-0 border border-white/40" />
                {(
                  [
                    ["top-0 left-0", "border-t-[3px] border-l-[3px]"],
                    ["top-0 right-0", "border-t-[3px] border-r-[3px]"],
                    ["bottom-0 left-0", "border-b-[3px] border-l-[3px]"],
                    ["bottom-0 right-0", "border-b-[3px] border-r-[3px]"],
                  ] as const
                ).map(([pos, edge], i) => (
                  <motion.span
                    key={i}
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.1 + i * 0.06, duration: 0.3, ease: easeOut }}
                    className={cn("absolute size-8 border-white", pos, edge)}
                  />
                ))}
                <div className="absolute inset-x-0 top-1/3 h-px bg-white/12" />
                <div className="absolute inset-x-0 top-2/3 h-px bg-white/12" />
              </div>

            </>
          )}

          <AnimatePresence>
            {flash && (
              <motion.div
                className="pointer-events-none absolute inset-0 bg-white"
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.9 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
              />
            )}
          </AnimatePresence>
        </div>

        {/* privacy + framing hint */}
        <div className="px-3 pt-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* This used to read "ภาพเก็บไว้ในเครื่องเท่านั้น" in every phase. It was
                true while there was no API; now "ใช้ภาพนี้" hands the blob straight to
                the upload. A promise of privacy that the next tap breaks is worse than
                no promise at all, so the pill says where the photo actually is. */}
            <span className="flex items-center gap-1.5 rounded-pill bg-ink-2/90 px-3 py-1.5">
              <LockIcon />
              <span className="text-[13px] font-medium text-ink-text">
                {phase === "PREVIEW" ? "ส่งขึ้นระบบเมื่อกดใช้ภาพนี้" : "ภาพยังอยู่ในเครื่อง"}
              </span>
            </span>
            <p className="text-[12px] text-ink-muted">
              {phase === "PREVIEW" ? "ตรวจสอบภาพก่อนใช้" : "ให้ชั้นวางเต็มกรอบ"}
            </p>
          </div>
          {/* There is no on-device face blur — capture.ts records the honest
              `faceBlur.method: "NOT_WIRED"`. Staying silent about that next to the
              shutter lets a rep assume someone else is handling it, which is exactly
              how a customer's face reaches object storage. */}
          <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
            ระบบไม่เบลอใบหน้าให้อัตโนมัติ — เลี่ยงไม่ให้ลูกค้าหรือพนักงานร้านติดอยู่ในเฟรม
          </p>
        </div>

        {/* camera trouble */}
        <AnimatePresence>
          {phase === "CAPTURE" && camMessage && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="mx-3 mt-3 rounded-card border border-ink-line bg-ink-2 px-3.5 py-3"
            >
              <p className="text-[13px] leading-relaxed text-ink-muted">{camMessage}</p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {camStatus !== "INSECURE" && camStatus !== "UNSUPPORTED" && (
                  <Button size="sm" variant="onDark" onClick={() => void retry()}>
                    ขอสิทธิ์กล้องอีกครั้ง
                  </Button>
                )}
                <Button size="sm" variant="outlineDark" onClick={() => fileRef.current?.click()}>
                  อัปโหลดรูปแทน
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ---------- controls ---------- */}
      <div className="shrink-0 border-t border-ink-line bg-ink px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={onPick}
          className="sr-only"
          aria-label="เลือกรูปจากเครื่อง"
        />

        <AnimatePresence mode="wait">
          {phase === "PREVIEW" ? (
            <motion.div
              key="preview-actions"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.26, ease: easeOut }}
            >
              {photo && <PhotoFacts photo={photo} />}
              <div className="mt-3 flex gap-3">
                <Button
                  variant="outlineDark"
                  size="lg"
                  className="flex-1"
                  onClick={() => setReviewShot(null)}
                >
                  ถ่ายใหม่
                </Button>
                <Button size="lg" className="flex-[1.4]" onClick={usePhoto}>
                  ใช้ภาพนี้
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="shutter"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.26, ease: easeOut }}
            >
              <div className="flex items-center justify-between">
                <div className="flex w-24 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="grid size-11 place-items-center rounded-btn border border-ink-line text-ink-text transition-colors hover:bg-ink-3"
                    aria-label="อัปโหลดรูปจากเครื่อง"
                  >
                    <UploadIcon />
                  </button>
                  {shots[0] && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="relative block size-11 overflow-hidden rounded-inset border border-ink-line"
                    >
                      <Image
                        src={shots[0].objectUrl}
                        alt=""
                        fill
                        unoptimized
                        sizes="44px"
                        className="object-cover"
                      />
                      {shots.length > 1 && (
                        <span className="tnum absolute inset-0 grid place-items-center bg-ink/60 text-[12px] font-semibold text-ink-text">
                          {shots.length}
                        </span>
                      )}
                    </motion.span>
                  )}
                </div>

                <motion.button
                  type="button"
                  onClick={shoot}
                  disabled={busy}
                  aria-label="ถ่ายภาพ"
                  whileTap={{ scale: 0.9 }}
                  transition={springSnappy}
                  className="grid size-[72px] place-items-center rounded-full border-[3px] border-ink-text disabled:opacity-50"
                >
                  {busy ? (
                    <motion.span
                      className="size-8 rounded-full border-[3px] border-ink-text/30 border-t-ink-text"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 0.7, repeat: Infinity, ease: "linear" }}
                    />
                  ) : (
                    <span className="size-[58px] rounded-full bg-ink-text" />
                  )}
                </motion.button>

                <div className="flex w-24 justify-end">
                  <button
                    type="button"
                    onClick={flow.back}
                    className="grid size-11 place-items-center rounded-btn text-ink-muted transition-colors hover:bg-ink-3 hover:text-ink-text"
                    aria-label="ยกเลิกและกลับ"
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </div>

              <p className="mt-2.5 text-center text-[12px] text-ink-muted">
                ยืนห่างชั้นวางประมาณ 1.5–2 เมตร ให้เห็นครบทั้งชั้น
              </p>
            </motion.div>
          )}
        </AnimatePresence>

      </div>

      <span className="sr-only" aria-live="polite">
        {error ?? (phase === "PREVIEW" ? "ถ่ายภาพแล้ว รอตรวจสอบ" : "")}
      </span>
      <span className="sr-only">ร้าน {store.name}</span>
    </div>
  );
}

function PreviewLayer({ photo }: { photo: CapturedPhoto | null }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 1.03 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: easeOut }}
      className="absolute inset-0 bg-ink"
    >
      <CaptureFrame photo={photo} fit="contain" alt="ภาพที่เพิ่งถ่าย" />
      <motion.span
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.14, ...springSnappy }}
        className="absolute right-2.5 top-2.5 flex items-center gap-1.5 rounded-pill bg-ink/80 px-3 py-1.5 text-[13px] font-semibold text-ink-text backdrop-blur-sm"
      >
        {photo ? `${photo.width}×${photo.height}` : "ภาพตัวอย่าง"}
      </motion.span>
    </motion.div>
  );
}

/** What the intake step actually recorded — visible on the device, because
 *  nobody can read a console on a phone. */
function PhotoFacts({ photo }: { photo: CapturedPhoto }) {
  return (
    <div className="rounded-card border border-ink-line bg-ink-2 px-3.5 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-muted">
        <span className="font-semibold text-ink-text">
          {photo.source === "CAMERA" ? "จากกล้อง" : "จากไฟล์"}
        </span>
        <span className="tnum">
          {photo.width}×{photo.height}
        </span>
        <span className="tnum">{(photo.bytes / 1024).toFixed(0)} KB</span>
        <span className="tnum">{photo.processingMs} ms</span>
        {DEMO_MODE && (
          <Link href="/m/captures" className="ml-auto font-medium text-[#7fb0ff] underline-offset-2 hover:underline">
            ดูบันทึกภาพ
          </Link>
        )}
      </div>
    </div>
  );
}

function ConsentGate({ storeId, storeName }: { storeId: string; storeName: string }) {
  return (
    <div className="on-dark flex min-h-0 flex-1 flex-col items-center justify-center bg-ink px-6 text-center">
      <div className="grid size-16 place-items-center rounded-full bg-warn/15">
        <LockIcon />
      </div>
      <h1 className="mt-4 text-[19px] font-semibold text-ink-text">ยังเปิดกล้องไม่ได้</h1>
      <p className="mt-2 max-w-[280px] text-[14px] leading-relaxed text-ink-muted">
        ต้องยืนยันก่อนว่าได้รับอนุญาตจาก {storeName} ให้ถ่ายภาพแล้ว
        จึงจะเปิดกล้องได้
      </p>
      <Link href={`/m/store/${storeId}/checkin`} className="mt-6 w-full max-w-[280px]">
        <Button size="lg" full>
          ไปหน้าเช็คอิน
        </Button>
      </Link>
    </div>
  );
}

function Banner({
  tone,
  icon,
  dot,
  text,
}: {
  tone: "warn" | "danger" | "ink";
  icon?: React.ReactNode;
  dot?: string;
  text: string;
}) {
  const tones = {
    warn: "bg-warn text-white",
    danger: "bg-danger text-white",
    ink: "bg-ink-2/90 text-ink-text",
  } as const;
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.26, ease: easeOut }}
      className={cn("flex items-center gap-2 rounded-btn px-3.5 py-2.5", tones[tone])}
    >
      {dot && <span className={cn("size-2 shrink-0 rounded-full", dot)} />}
      {icon}
      <p className="text-[14px] font-medium">{text}</p>
    </motion.div>
  );
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden className="text-current">
      <rect x="4" y="10" width="16" height="11" rx="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M8 10V7a4 4 0 018 0v3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
function UploadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 16V4M7 9l5-5 5 5M4 20h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7.5v5.5M12 16.2h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
