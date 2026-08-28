"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import { DetectionOverlay, type OverlayFilter } from "@/components/shelf/DetectionOverlay";
import { Button } from "@/components/ui/Button";
import { Toggle } from "@/components/ui/Controls";
import { ErrorBlock, LoadingBlock } from "@/components/ui/AsyncState";
import { fetchResult, type AnalysisResult } from "@/lib/api/captures";
import { useResource } from "@/lib/api/useResource";
import type { VisitCapture } from "@/lib/api/analytics";
import { fade, scaleIn, easeOut } from "@/lib/motion";
import { cn } from "@/lib/cn";

/** W3 — Evidence Viewer.
 *
 *  Opens the actual photograph and the actual boxes the model drew on it.
 *  A manager disputing a finding with a store needs the pixels, not a
 *  reconstruction of them.
 *
 *  ⛔ Metadata shows the capturer's ROLE and never their identity. This is a
 *  negotiation artefact, not an appraisal — and the API does not return a
 *  rep's name for exactly this reason. */
export function EvidenceViewer({
  capture,
  storeName,
  visitedAt,
  gapsFound,
  gapsFixed,
  onClose,
}: {
  capture: VisitCapture | null;
  storeName: string;
  visitedAt: string | null;
  gapsFound: number;
  gapsFixed: number;
  onClose: () => void;
}) {
  const [showOverlay, setShowOverlay] = useState(true);
  const [filter, setFilter] = useState<OverlayFilter>("ALL");
  const [disputed, setDisputed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const captureId = capture?.captureId ?? null;
  const analysis = useResource<AnalysisResult | null>(
    async () => (captureId ? fetchResult(captureId) : null),
    [captureId],
  );

  // opening a different capture resets the view
  const [openedId, setOpenedId] = useState<string | null>(null);
  if (captureId && captureId !== openedId) {
    setOpenedId(captureId);
    setDisputed(false);
    setFilter("ALL");
  }

  useEffect(() => {
    if (!capture) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => panelRef.current?.focus(), 50);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [capture, onClose]);

  const result = analysis.data;
  const captured = capture?.capturedAt ?? visitedAt;
  const capturedLabel = captured
    ? new Date(captured).toLocaleString("th-TH", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

  return (
    <AnimatePresence>
      {capture && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 sm:p-6">
          <motion.button
            type="button"
            aria-label="ปิดหน้าต่างหลักฐาน"
            variants={fade}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={onClose}
            className="absolute inset-0 cursor-default bg-[#101828]/60"
          />
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={`หลักฐานการตรวจ ${capturedLabel}`}
            variants={scaleIn}
            initial="hidden"
            animate="show"
            exit="exit"
            className="relative flex max-h-[92dvh] w-full max-w-[1100px] flex-col overflow-hidden rounded-card border border-line bg-bg shadow-[var(--shadow-lift)] outline-none lg:flex-row"
          >
            {/* ---- photo ---- */}
            <div className="relative flex min-w-0 flex-1 items-center bg-ink">
              {analysis.state === "LOADING" ? (
                <LoadingBlock label="กำลังโหลดภาพหลักฐาน…" className="w-full" />
              ) : analysis.state === "ERROR" ? (
                <div className="w-full p-6">
                  <ErrorBlock message={analysis.error ?? ""} onRetry={analysis.reload} />
                </div>
              ) : !result?.imageUrl ? (
                /* "We have no URL" is all we actually know — it could be a
                   missing object key, a presign failure, or an analysis that
                   has not landed. Naming retention as the cause is a specific
                   claim standing in for an unknown one. */
                <p className="w-full px-6 py-16 text-center text-[14px] text-ink-muted">
                  ไม่มีภาพสำหรับรายการนี้
                </p>
              ) : (
                <>
                  <div className="relative aspect-[16/9] w-full">
                    <Image
                      src={result.imageUrl}
                      alt="ภาพชั้นวางที่ใช้เป็นหลักฐาน"
                      fill
                      unoptimized
                      sizes="(min-width: 1024px) 760px, 100vw"
                      className="object-contain"
                    />
                    <AnimatePresence>
                      {showOverlay && (
                        <motion.div
                          variants={fade}
                          initial="hidden"
                          animate="show"
                          exit="exit"
                          className="absolute inset-0"
                        >
                          <DetectionOverlay
                            detections={result.detections}
                            findings={result.gapFindings}
                            filter={filter}
                            fit="contain"
                            imageWidth={result.imageWidth}
                            imageHeight={result.imageHeight}
                            lowConfidenceThreshold={result.lowConfidenceThreshold}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="absolute left-4 top-4 flex flex-wrap gap-2">
                    <span className="h-9 rounded-pill bg-ink-text px-3.5 text-[13px] font-medium leading-9 text-ink">
                      {capture.phase === "AFTER" ? "หลังเติมของ" : "ก่อนเติมของ"} · OSA{" "}
                      {result.osaScore}%
                    </span>
                  </div>

                  <div className="on-dark absolute bottom-4 left-4 flex flex-wrap items-center gap-3 rounded-btn bg-ink/75 px-3.5 py-2.5 backdrop-blur-sm">
                    <Toggle dark checked={showOverlay} onChange={setShowOverlay} label="แสดงกรอบตรวจจับ" />
                  </div>

                  {showOverlay && (
                    <div className="scroll-x absolute inset-x-4 top-16 flex gap-1.5">
                      {(
                        [
                          { id: "ALL", label: "ทั้งหมด" },
                          { id: "GAP", label: "ช่องว่าง" },
                          { id: "LOW_CONF", label: "ความมั่นใจต่ำ" },
                        ] as { id: OverlayFilter; label: string }[]
                      ).map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setFilter(c.id)}
                          aria-pressed={filter === c.id}
                          className={cn(
                            "h-8 shrink-0 rounded-pill px-3 text-[12px] font-medium transition-colors",
                            filter === c.id
                              ? "bg-primary text-white"
                              : "bg-ink/65 text-ink-muted backdrop-blur-sm hover:text-ink-text",
                          )}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ---- metadata ---- */}
            <div className="flex w-full shrink-0 flex-col overflow-y-auto border-t border-line lg:w-[340px] lg:border-l lg:border-t-0">
              <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
                <div>
                  <h2 className="text-[16px] font-semibold leading-snug">หลักฐานการตรวจ</h2>
                  <p className="mt-0.5 text-[13px] text-muted">{capturedLabel}</p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="ปิด"
                  className="grid size-9 shrink-0 place-items-center rounded-btn text-muted transition-colors hover:bg-surface-2 hover:text-text"
                >
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              <dl className="divide-y divide-line">
                <Row label="ร้าน" value={storeName} />
                <Row
                  label="หมวด / ชั้นวาง"
                  value={[capture.category, capture.shelfBayLabel].filter(Boolean).join(" · ")}
                />
                <Row label="วันและเวลา" value={capturedLabel} />
                <Row
                  label="ผู้ถ่าย"
                  value="พนักงานภาคสนาม"
                  hint="ระบุเป็นบทบาท ไม่ระบุตัวบุคคล"
                />
                <Row label="โมเดลที่ใช้" value={result?.modelVersion ?? capture.modelVersion ?? "—"} mono />
                <Row
                  label="ผลลัพธ์ของการเข้าร้านนี้"
                  value={`พบช่องว่าง ${gapsFound} จุด · แก้ไขแล้ว ${gapsFixed} จุด`}
                />
              </dl>

              <div className="mt-auto border-t border-line px-5 py-4">
                <AnimatePresence mode="wait">
                  {disputed ? (
                    <motion.div
                      key="disputed"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, ease: easeOut }}
                      className="rounded-card bg-warn-soft px-3.5 py-3"
                    >
                      <p className="flex items-center gap-1.5 text-[14px] font-semibold text-[#b45f04]">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                          <path d="M12 3l9.5 16.5h-19L12 3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                          <path d="M12 9.5v4M12 16.6h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                        </svg>
                        บันทึกการโต้แย้งไว้ในหน้าจอนี้แล้ว
                      </p>
                      <p className="mt-1 text-[13px] leading-relaxed text-[#95500a]">
                        ยังไม่มีการส่งเรื่องต่อให้ทีมข้อมูล — บันทึกอยู่ในหน้าจอนี้เท่านั้น
                        และจะหายเมื่อปิดหน้าต่าง
                      </p>
                    </motion.div>
                  ) : (
                    <motion.div key="actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                      <Button variant="secondary" full onClick={() => setDisputed(true)}>
                        โต้แย้งผลนี้
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
                <p className="mt-2.5 text-[12px] leading-relaxed text-faint">
                  ระบบไม่ส่งเอกสารหรือข้อความใด ๆ ให้ร้านค้าโดยอัตโนมัติ
                  ทุกการติดต่อร้านต้องทำโดยคนเท่านั้น
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function Row({
  label,
  value,
  hint,
  mono,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-3">
      <dt className="shrink-0 text-[13px] text-muted">{label}</dt>
      <dd className="min-w-0 text-right">
        <span className={cn("block text-[13px] font-medium", mono && "tnum font-mono text-[12px]")}>
          {value}
        </span>
        {hint && <span className="mt-0.5 block text-[12px] text-faint">{hint}</span>}
      </dd>
    </div>
  );
}
