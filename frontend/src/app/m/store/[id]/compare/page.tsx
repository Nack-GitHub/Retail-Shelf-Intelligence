"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { MobileHeader, BottomBar, Scroll } from "@/components/mobile/Chrome";
import { CaptureFrame } from "@/components/shelf/CaptureFrame";
import { CameraGrabError, useCamera } from "@/hooks/useCamera";
import { intakePhoto, PhotoIntakeError, type CapturedPhoto } from "@/lib/capture";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Controls";
import { CountUp } from "@/components/ui/Progress";
import { OsaStatusPill } from "@/components/ui/Badge";
import { osaStatusOf } from "@/lib/osa";
import { useFlow } from "@/lib/flow/useFlow";
import { FlowGuardBlock } from "@/components/mobile/FlowGuardBlock";
import { useDemo, useOsaAfter, useVisitStats } from "@/lib/store";
import { pollJob, uploadCapture } from "@/lib/api/captures";
import { messageOf } from "@/lib/api/errors";
import { easeOut, fadeUp, springSnappy, springSoft } from "@/lib/motion";
import { cn } from "@/lib/cn";

export default function CompareScreen() {
  const flow = useFlow("COMPARE");

  const analysis = useDemo((s) => s.analysis);
  const afterCaptured = useDemo((s) => s.afterCaptured);
  const markAfterCaptured = useDemo((s) => s.markAfterCaptured);
  const beforePhoto = useDemo((s) => s.photo);
  const afterPhoto = useDemo((s) => s.afterPhoto);
  const setAfterPhoto = useDemo((s) => s.setAfterPhoto);
  const logPhoto = useDemo((s) => s.logPhoto);
  const visitId = useDemo((s) => s.visitId);
  const categoryId = useDemo((s) => s.categoryId);
  const bay = useDemo((s) => s.bay);
  const osaAfter = useOsaAfter();
  const stats = useVisitStats();

  const [mode, setMode] = useState<"SLIDER" | "SIDE">("SLIDER");
  const [split, setSplit] = useState(50);
  const [flash, setFlash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const timers = useRef<number[]>([]);

  /* The shutter's timers outlive a rep who backs out mid-press. One of them
     records that the after-photo was taken, so without this the visit ends up
     holding a photograph nobody ever took — and coming back to this screen
     shows the comparison instead of the camera. */
  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  // the After shot uses the same camera and the same intake function as
  // the Before shot, so both photos are recorded identically
  const { videoRef, message: camMessage, isLive: live, grab } = useCamera({
    active: !afterCaptured,
    aspect: 16 / 9,
  });

  const osaBefore = analysis?.osaScore ?? null;

  /* This screen is captioned "หลักฐานการแก้ไขที่ร้านนี้". It used to fill the
     AFTER side with slotsAfter() — the drawn shelf with every ticked task's gap
     painted over — whenever no after-photo existed, and slide it against the
     real BEFORE photograph. That is a manufactured before/after: the "proof"
     moved because the rep ticked a checkbox, not because the shelf changed.
     No after-photo now means no comparison, and the screen says why. */
  const hasComparison = !!afterPhoto;

  /** Sends the AFTER shot through the same path as the BEFORE shot.
   *
   *  This is what makes checkout's osa_after a measurement rather than an
   *  estimate: the server reads it off the latest AFTER-phase analysis for the
   *  visit. An after-photo that stays on the phone proves nothing. */
  async function uploadAfter(p: CapturedPhoto) {
    if (!visitId || !categoryId || !bay) return;
    setUploading(true);
    try {
      const job = await uploadCapture({
        visitId,
        category: categoryId,
        shelfBayLabel: bay,
        phase: "AFTER",
        photo: p,
      });
      const finished = await pollJob(job.jobId);
      if (finished.status === "FAILED") {
        setError(finished.userMessage ?? "วิเคราะห์ภาพหลังเติมของไม่สำเร็จ กรุณาถ่ายใหม่");
      }
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setUploading(false);
    }
  }

  async function shoot() {
    if (busy) return;
    setError(null);
    setFlash(true);
    timers.current.push(window.setTimeout(() => setFlash(false), 170));

    if (!live) {
      timers.current.push(window.setTimeout(markAfterCaptured, 420));
      return;
    }
    setBusy(true);
    try {
      const p = await intakePhoto(await grab(), "CAMERA", "AFTER");
      logPhoto(p);
      setAfterPhoto(p);
      markAfterCaptured();
      void uploadAfter(p);
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
      const p = await intakePhoto(file, "UPLOAD", "AFTER");
      logPhoto(p);
      setAfterPhoto(p);
      markAfterCaptured();
      void uploadAfter(p);
    } catch (err) {
      setError(err instanceof PhotoIntakeError ? err.message : "เปิดไฟล์รูปไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  function moveFromPointer(clientX: number) {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSplit(Math.max(2, Math.min(98, ((clientX - r.left) / r.width) * 100)));
  }

  if (flow.blocked) return <FlowGuardBlock flow={flow} />;

  if (!afterCaptured) {
    return (
      <div className="on-dark relative flex min-h-0 flex-1 flex-col bg-ink">
        <MobileHeader
          dark
          title="ถ่ายภาพหลังเติมของ"
          subtitle="ถ่ายมุมเดิมกับภาพแรก"
          progress={0.88}
          onBack={flow.back}
        />
        <div className="relative flex min-h-0 flex-1 items-center overflow-hidden bg-black">
          <div className="relative aspect-[16/9] w-full overflow-hidden">
            {live ? (
              <video
                ref={videoRef}
                className="h-full w-full object-cover"
                playsInline
                muted
                autoPlay
              />
            ) : (
              /* The stand-in for a machine with no camera. It shows the shelf
                 as-is, not the shelf with every ticked gap painted in: this is
                 a viewfinder, and a viewfinder that already shows the work
                 done is telling the rep the photo is unnecessary. */
              <CaptureFrame fit="contain" alt="ภาพชั้นวางตัวอย่าง" />
            )}
          </div>
          <div className="pointer-events-none absolute left-0 right-0 top-1/2 aspect-[16/9] w-full -translate-y-1/2 p-1.5">
            <div className="absolute inset-0 rounded-[10px] border-2 border-dashed border-white/55" />
          </div>
          <div className="absolute inset-x-3 top-3">
            <div
              className={`flex items-center gap-2 rounded-btn px-3.5 py-2.5 ${
                error ? "bg-danger" : "bg-primary"
              }`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-white" aria-hidden>
                <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
                <path d="M3 10h18" stroke="currentColor" strokeWidth="2" />
              </svg>
              <p className="text-[14px] font-semibold text-white">
                {error ?? "จัดกรอบให้ตรงกับภาพก่อนเติมของ"}
              </p>
            </div>
          </div>
          <AnimatePresence>
            {flash && (
              <motion.div
                className="absolute inset-0 bg-white"
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.9 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
              />
            )}
          </AnimatePresence>
        </div>
        <div className="shrink-0 border-t border-ink-line bg-ink px-4 pt-4 pb-[max(14px,env(safe-area-inset-bottom))]">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={onPick}
            className="sr-only"
            aria-label="เลือกรูปหลังเติมของจากเครื่อง"
          />
          <div className="flex items-center justify-between">
            <div className="w-24">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="grid size-11 place-items-center rounded-btn border border-ink-line text-ink-text transition-colors hover:bg-ink-3"
                aria-label="อัปโหลดรูปจากเครื่อง"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M12 16V4M7 9l5-5 5 5M4 20h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
            <motion.button
              type="button"
              onClick={shoot}
              disabled={busy}
              aria-label="ถ่ายภาพหลังเติมของ"
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
            <div className="w-24" />
          </div>
          {camMessage && (
            <p className="mt-3 text-center text-[12px] leading-relaxed text-ink-muted">
              {camMessage}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <MobileHeader
        title="เทียบก่อน–หลัง"
        subtitle="หลักฐานการแก้ไขที่ร้านนี้"
        onBack={flow.back}
        progress={0.94}
        right={
          <Segmented
            ariaLabel="รูปแบบการเทียบภาพ"
            value={mode}
            onChange={setMode}
            options={[
              { value: "SLIDER", label: "เลื่อน" },
              { value: "SIDE", label: "คู่กัน" },
            ]}
          />
        }
      />

      <Scroll className="pb-5">
        <motion.div variants={fadeUp} initial="hidden" animate="show">
          {!hasComparison ? (
            <div className="flex flex-col items-center bg-ink px-6 py-14 text-center">
              <div className="grid size-14 place-items-center rounded-full bg-ink-2 text-ink-muted">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <rect x="3" y="6" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="2" />
                  <circle cx="12" cy="13" r="3.5" stroke="currentColor" strokeWidth="2" />
                  <path d="M8.5 6l1.2-2h4.6L15.5 6" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                </svg>
              </div>
              <h2 className="mt-4 text-[17px] font-semibold text-ink-text">ยังไม่มีภาพหลังเติมของ</h2>
              <p className="mt-1.5 max-w-[280px] text-[14px] leading-relaxed text-ink-muted">
                ต้องมีภาพจริงทั้งก่อนและหลังจึงจะเทียบกันได้
                — งานที่ติ๊กว่าแก้แล้วยังถูกบันทึกไว้ตามปกติ
              </p>
            </div>
          ) : mode === "SLIDER" ? (
            <div
              ref={trackRef}
              className="relative aspect-[16/9] touch-none select-none overflow-hidden bg-ink"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                moveFromPointer(e.clientX);
              }}
              onPointerMove={(e) => {
                if (e.buttons === 1) moveFromPointer(e.clientX);
              }}
            >
              <div className="absolute inset-0">
                <CaptureFrame photo={afterPhoto} fit="contain" alt="ภาพหลังเติมของ" />
              </div>
              <div
                className="absolute inset-y-0 left-0 overflow-hidden"
                style={{ width: `${split}%` }}
              >
                <div className="absolute inset-y-0 left-0 h-full" style={{ width: `${(100 / split) * 100}%` }}>
                  <CaptureFrame photo={beforePhoto} fit="contain" alt="ภาพก่อนเติมของ" />
                </div>
              </div>

              <span className="absolute left-3 top-3 rounded-pill bg-ink/75 px-2.5 py-1.5 text-[12px] font-semibold text-ink-text backdrop-blur-sm">
                ก่อน · OSA {osaBefore ?? "—"}%
              </span>
              <span className="absolute right-3 top-3 rounded-pill bg-ok/90 px-2.5 py-1.5 text-[12px] font-semibold text-white">
                หลัง{osaAfter === null ? " · รอผลตอนเช็คเอาต์" : ` · OSA ${osaAfter}%`}
              </span>

              {/* divider */}
              <div className="pointer-events-none absolute inset-y-0" style={{ left: `${split}%` }}>
                <div className="absolute inset-y-0 -left-px w-0.5 bg-white shadow-[0_0_10px_rgba(0,0,0,0.5)]" />
                <div
                  role="slider"
                  tabIndex={0}
                  aria-label="เลื่อนเพื่อเทียบภาพก่อนและหลัง"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(split)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowLeft") setSplit((v) => Math.max(2, v - 4));
                    if (e.key === "ArrowRight") setSplit((v) => Math.min(98, v + 4));
                  }}
                  className="pointer-events-auto absolute top-1/2 grid size-11 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize place-items-center rounded-full border-2 border-white bg-white/25 backdrop-blur-sm"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-white" aria-hidden>
                    <path d="M9 7l-4 5 4 5M15 7l4 5-4 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-0.5 bg-line">
              <figure className="relative aspect-[9/11] overflow-hidden bg-ink">
                <CaptureFrame photo={beforePhoto} fit="cover" alt="ภาพก่อนเติมของ" />
                <figcaption className="absolute inset-x-2 bottom-2 rounded-pill bg-ink/75 px-2.5 py-1.5 text-center text-[12px] font-semibold text-ink-text backdrop-blur-sm">
                  ก่อน · {osaBefore}%
                </figcaption>
              </figure>
              <figure className="relative aspect-[9/11] overflow-hidden bg-ink">
                <CaptureFrame photo={afterPhoto} fit="cover" alt="ภาพหลังเติมของ" />
                <figcaption className="absolute inset-x-2 bottom-2 rounded-pill bg-ok/90 px-2.5 py-1.5 text-center text-[12px] font-semibold text-white">
                  หลัง · {osaAfter}%
                </figcaption>
              </figure>
            </div>
          )}
        </motion.div>

        <div className="px-4 pt-4">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: easeOut, delay: 0.1 }}
            className="rounded-card border border-line bg-bg p-5 shadow-[var(--shadow-card)]"
          >
            <p className="text-[13px] font-medium text-muted">ผลลัพธ์ที่ชั้นวางนี้</p>
            {/* The after-score is measured at checkout from the AFTER photo.
                Until then this screen says so instead of guessing. */}
            {osaAfter === null ? (
              <div className="mt-2 flex items-center gap-3">
                <span className="tnum text-[30px] font-bold leading-none">
                  {osaBefore ?? "—"}%
                </span>
                <span className="text-[13px] leading-relaxed text-muted">
                  {uploading
                    ? "กำลังส่งภาพหลังเติมของไปวิเคราะห์…"
                    : "ค่า OSA หลังเติมของจะคำนวณตอนปิดการเข้าร้าน"}
                </span>
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-3">
                <span className="tnum text-[30px] font-bold leading-none text-muted">
                  {osaBefore ?? "—"}%
                </span>
                <motion.svg
                  width="30" height="20" viewBox="0 0 30 20" fill="none" className="text-primary"
                  initial={{ x: -6, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 0.35, ...springSoft }}
                >
                  <path d="M2 10h24M20 4l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </motion.svg>
                <span className="flex items-baseline text-[38px] font-bold leading-none tracking-tight text-ok">
                  <CountUp to={osaAfter} />%
                </span>
                <OsaStatusPill status={osaStatusOf(osaAfter)} className="ml-auto" />
              </div>
            )}

            <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-4">
              <Stat label="ช่องว่างที่พบ" value={stats.total} />
              <Stat label="เติมสำเร็จ" value={stats.fixed.length} tone="ok" />
              <Stat label="ส่งต่อทีมอื่น" value={stats.blocked.length} tone="warn" />
            </dl>
          </motion.div>

          <p className="mt-3 px-1 text-[13px] leading-relaxed text-muted">
            ภาพทั้งสองถูกเก็บเป็นหลักฐานคู่กัน ผู้จัดการพื้นที่เปิดดูย้อนหลังได้จากหน้าเว็บ
          </p>
        </div>
      </Scroll>

      <BottomBar>
        {/* The upload is what makes the after-photo a measurement rather than a
            picture on a phone. Leaving the way on open during it lets a rep
            reach a summary that reports no after-photo at all, for a shelf they
            have just photographed. The card above says what is happening. */}
        <Button size="lg" full disabled={uploading} onClick={() => flow.go("CHECKOUT")}>
          สรุปและเช็คเอาต์
        </Button>
      </BottomBar>
    </>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn";
}) {
  return (
    <div>
      <dt className="text-[12px] leading-tight text-muted">{label}</dt>
      <dd
        className={cn(
          "tnum mt-1 text-[22px] font-bold leading-none",
          tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-text",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
