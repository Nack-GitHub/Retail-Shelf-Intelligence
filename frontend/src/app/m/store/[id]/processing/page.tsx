"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { CaptureFrame } from "@/components/shelf/CaptureFrame";
import { ProgressRing } from "@/components/ui/Progress";
import { Button } from "@/components/ui/Button";
import { useFlow } from "@/lib/flow/useFlow";
import { useDemo } from "@/lib/store";
import { fetchResult, pollJob, uploadCapture, type Job } from "@/lib/api/captures";
import { ApiError, messageOf } from "@/lib/api/errors";
import { enqueue, isAvailable } from "@/lib/offline/queue";
import { easeOut, springSnappy } from "@/lib/motion";
import { cn } from "@/lib/cn";

/* This screen does the actual work: it uploads the photo the rep just kept,
   waits for the model, and hands the verdict to /result.

   ⛔ A failed job NEVER shows an OSA number. "Nothing found at all" and "no
   gaps found" are different answers, and rendering a failure as a full shelf
   would poison every trend built on this data. */

type Phase = "UPLOADING" | "ANALYSING" | "FAILED" | "QUEUED";

const STEPS = [
  { id: "upload", label: "อัปโหลดภาพขึ้นเซิร์ฟเวอร์" },
  { id: "detect", label: "ตรวจจับสินค้าและช่องว่าง" },
  { id: "osa", label: "คำนวณ OSA และจัดลำดับความสำคัญ" },
] as const;

export default function ProcessingScreen() {
  const { id } = useParams<{ id: string }>();
  const flow = useFlow("PROCESSING");
  // Destructured so the upload effect below depends on the one callback it
  // calls rather than on the whole flow object.
  const { go } = flow;

  const photo = useDemo((s) => s.photo);
  const visitId = useDemo((s) => s.visitId);
  const categoryId = useDemo((s) => s.categoryId);
  const bay = useDemo((s) => s.bay);
  const consumeCapture = useDemo((s) => s.consumeCapture);
  const setAnalysis = useDemo((s) => s.setAnalysis);

  const [phase, setPhase] = useState<Phase>("UPLOADING");
  const [step, setStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Guards against React 18 double-invoking effects in development, which
  // would otherwise upload the same photo twice.
  const running = useRef(false);

  const run = useCallback(async () => {
    if (running.current) return;
    if (!photo || !visitId || !categoryId || !bay) return;
    running.current = true;

    setPhase("UPLOADING");
    setStep(0);
    setFailure(null);

    try {
      const job = await uploadCapture({
        visitId,
        category: categoryId,
        shelfBayLabel: bay,
        phase: "BEFORE",
        photo,
      });

      setPhase("ANALYSING");
      setStep(1);

      const finished = await pollJob(job.jobId, {
        onProgress: (j: Job) => setStep(j.status === "RUNNING" ? 2 : 1),
      });

      if (finished.status === "FAILED") {
        // The API already wrote the sentence the rep needs, in Thai, and it
        // says what to do — not just that something broke.
        setFailure(finished.userMessage ?? "วิเคราะห์ภาพไม่สำเร็จ กรุณาถ่ายใหม่");
        setPhase("FAILED");
        return;
      }

      const result = await fetchResult(finished.captureId);
      setAnalysis(finished.captureId, result);
      setStep(3);
      consumeCapture();
      go("RESULT");
    } catch (err) {
      // No signal. The photo is kept — with its bytes — and replayed when the
      // connection comes back. Losing a rep's shelf photo because the shop has
      // concrete walls is the one failure this whole queue exists to prevent.
      if (err instanceof ApiError && (err.code === "OFFLINE" || err.code === "TIMEOUT") && (await isAvailable())) {
        await enqueue({
          id: photo.idempotencyKey,
          kind: "CAPTURE",
          label: `ภาพชั้นวาง ${categoryId} · ชั้น ${bay}`,
          storeId: id,
          payload: {
            visitId,
            category: categoryId,
            shelfBayLabel: bay,
            phase: "BEFORE",
            contentType: photo.mimeType || "image/jpeg",
            imageWidth: photo.width,
            imageHeight: photo.height,
            capturedAt: photo.capturedAt,
            device: photo.device,
          },
          blob: photo.blob,
        });
        setPhase("QUEUED");
        return;
      }
      setFailure(messageOf(err));
      setPhase("FAILED");
    } finally {
      running.current = false;
    }
  }, [photo, visitId, categoryId, bay, setAnalysis, consumeCapture, go, id]);

  useEffect(() => {
    void run();
  }, [run, attempt]);

  // Elapsed clock, purely for the ring. Stops when the work does.
  useEffect(() => {
    if (phase === "FAILED") return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 100);
    return () => window.clearInterval(timer);
  }, [phase, attempt]);

  // Landed here without a photo — a reload, or a deep link. Sending them back
  // to the camera is more useful than an empty ring that never fills.
  if (!photo || !visitId) {
    return (
      <div className="on-dark flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-ink px-6 text-center">
        <h1 className="text-[19px] font-semibold text-ink-text">ไม่มีภาพที่รอวิเคราะห์</h1>
        <p className="max-w-[280px] text-[14px] leading-relaxed text-ink-muted">
          {visitId
            ? "เริ่มถ่ายภาพชั้นวางเพื่อดูผลการตรวจ"
            : "ยังไม่ได้เช็คอินที่ร้านนี้ กรุณาเช็คอินก่อนเปิดกล้อง"}
        </p>
        <Button
          size="lg"
          onClick={() => flow.go(visitId ? "CAPTURE" : "CHECKIN", { replace: true })}
        >
          {visitId ? "เปิดกล้อง" : "ไปหน้าเช็คอิน"}
        </Button>
      </div>
    );
  }

  if (phase === "QUEUED") {
    return (
      <div className="on-dark flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-ink px-6 text-center">
        <div className="grid size-16 place-items-center rounded-full bg-warn/15">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" className="text-warn" aria-hidden>
            <path d="M2 8.8a16 16 0 0120 0M5.5 12.4a11 11 0 0113 0M9 16a6 6 0 016 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M12 20h.01" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M3 3l18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <h1 className="text-[19px] font-semibold text-ink-text">ไม่มีสัญญาณ — เก็บภาพไว้ในเครื่องแล้ว</h1>
        <p className="max-w-[300px] text-[14px] leading-relaxed text-ink-muted">
          ภาพนี้จะถูกส่งขึ้นเซิร์ฟเวอร์และวิเคราะห์ให้อัตโนมัติเมื่อกลับมาออนไลน์
          ไม่ต้องถ่ายซ้ำ
        </p>
        <div className="mt-2 flex w-full max-w-[300px] flex-col gap-2.5">
          <Button size="lg" full onClick={() => flow.exit("/m/sync")}>
            ดูคิวที่รอส่ง
          </Button>
          <Button
            variant="outlineDark"
            size="lg"
            full
            onClick={() => flow.go("CATEGORY", { replace: true })}
          >
            ตรวจชั้นวางถัดไป
          </Button>
        </div>
      </div>
    );
  }

  const progress = phase === "FAILED" ? 100 : Math.min(96, (step / STEPS.length) * 100 + 8);

  return (
    <div className="on-dark relative flex min-h-0 flex-1 flex-col overflow-hidden bg-ink">
      {/* the photo stays visible so the rep keeps context while waiting */}
      <div className="absolute inset-0 opacity-25">
        <CaptureFrame photo={photo} fit="cover" />
      </div>
      <div className="absolute inset-0 bg-ink/70" />

      {phase !== "FAILED" && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute inset-x-0 h-24"
            style={{
              animation: "scan 2.6s ease-in-out infinite",
              background:
                "linear-gradient(180deg, transparent, rgba(27,111,232,0.28), transparent)",
            }}
          />
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-6">
        <AnimatePresence mode="wait">
          {phase === "FAILED" ? (
            <motion.div
              key="failed"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={springSnappy}
              className="flex w-full max-w-[300px] flex-col items-center text-center"
            >
              <div className="grid size-16 place-items-center rounded-full bg-danger/15">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" className="text-danger" aria-hidden>
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                  <path d="M12 7.5v5.5M12 16.3h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                </svg>
              </div>
              <h1 className="mt-4 text-[19px] font-semibold text-ink-text">วิเคราะห์ไม่สำเร็จ</h1>
              <p className="mt-1.5 text-[14px] leading-relaxed text-ink-muted">{failure}</p>
              <div className="mt-6 flex w-full flex-col gap-2.5">
                <Button size="lg" full onClick={() => flow.go("CAPTURE", { replace: true })}>
                  ถ่ายใหม่
                </Button>
                <Button
                  variant="outlineDark"
                  size="lg"
                  full
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  ลองวิเคราะห์ภาพเดิมอีกครั้ง
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="working"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3, ease: easeOut }}
              className="flex w-full max-w-[320px] flex-col items-center"
            >
              <ProgressRing value={progress} size={156} stroke={9} color="#1b6fe8">
                <div className="text-center">
                  <p className="tnum text-[34px] font-bold leading-none text-ink-text">
                    {elapsed.toFixed(1)}
                  </p>
                  <p className="mt-1 text-[13px] text-ink-muted">วินาที</p>
                </div>
              </ProgressRing>

              <h1 className="mt-6 text-center text-[19px] font-semibold text-ink-text">
                {phase === "UPLOADING" ? "กำลังอัปโหลดภาพ…" : "กำลังวิเคราะห์ชั้นวาง…"}
              </h1>
              <p className="mt-1.5 text-center text-[14px] text-ink-muted">
                เป้าหมายไม่เกิน 10 วินาที
              </p>

              <ul className="mt-6 w-full space-y-2.5">
                {STEPS.map((s, i) => {
                  const active = step >= i;
                  const complete = step > i;
                  return (
                    <li key={s.id} className="flex items-center gap-3">
                      <span
                        className={cn(
                          "grid size-6 shrink-0 place-items-center rounded-full transition-colors duration-300",
                          complete ? "bg-ok" : active ? "bg-primary" : "bg-ink-3",
                        )}
                      >
                        {complete ? (
                          <motion.svg
                            width="14" height="14" viewBox="0 0 24 24" fill="none"
                            initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={springSnappy}
                          >
                            <path d="M5 12.5l4.5 4.5L19 7" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                          </motion.svg>
                        ) : active ? (
                          <motion.span
                            className="size-2.5 rounded-full bg-white"
                            animate={{ opacity: [1, 0.35, 1] }}
                            transition={{ duration: 1.1, repeat: Infinity }}
                          />
                        ) : null}
                      </span>
                      <span
                        className={cn(
                          "text-[14px] transition-colors duration-300",
                          active ? "text-ink-text" : "text-ink-muted/60",
                        )}
                      >
                        {s.label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        {phase === "FAILED" ? "วิเคราะห์ไม่สำเร็จ" : "กำลังวิเคราะห์ชั้นวาง"}
      </span>
    </div>
  );
}
