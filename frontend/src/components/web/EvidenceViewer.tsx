"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ShelfPhoto } from "@/components/shelf/ShelfPhoto";
import { DetectionOverlay, type OverlayFilter } from "@/components/shelf/DetectionOverlay";
import { Button } from "@/components/ui/Button";
import { Toggle } from "@/components/ui/Controls";
import { Pill } from "@/components/ui/Badge";
import { buildAnalysis, slotsAfter } from "@/lib/mock/shelf";
import type { EvidenceItem } from "@/lib/mock/analytics";
import { fade, scaleIn, easeOut } from "@/lib/motion";
import { cn } from "@/lib/cn";

const analysis = buildAnalysis();
const FIXED = ["gap-r0s2", "gap-r0s6", "gap-r1s1", "gap-r1s7"];

/** W3 — Evidence Viewer.
 *  Metadata shows the capturer's ROLE, never their identity or any
 *  performance figure. This is the negotiation artefact, not an appraisal. */
export function EvidenceViewer({
  item,
  storeName,
  onClose,
}: {
  item: EvidenceItem | null;
  storeName: string;
  onClose: () => void;
}) {
  const [showOverlay, setShowOverlay] = useState(true);
  const [phase, setPhase] = useState<"BEFORE" | "AFTER">("BEFORE");
  const [filter, setFilter] = useState<OverlayFilter>("ALL");
  const [disputed, setDisputed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // opening a different piece of evidence resets the view to its "before"
  const [openedId, setOpenedId] = useState<string | null>(null);
  if (item && item.id !== openedId) {
    setOpenedId(item.id);
    setDisputed(item.disputed);
    setPhase("BEFORE");
  }

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => panelRef.current?.focus(), 50);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [item, onClose]);

  return (
    <AnimatePresence>
      {item && (
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
            aria-label={`หลักฐานการตรวจ ${item.date}`}
            variants={scaleIn}
            initial="hidden"
            animate="show"
            exit="exit"
            className="relative flex max-h-[92dvh] w-full max-w-[1100px] flex-col overflow-hidden rounded-card border border-line bg-bg shadow-[var(--shadow-lift)] outline-none lg:flex-row"
          >
            {/* ---- photo ---- */}
            <div className="relative flex min-w-0 flex-1 items-center bg-ink">
              <div className="relative aspect-[16/9] w-full">
                {phase === "BEFORE" ? (
                  <ShelfPhoto fit="contain" />
                ) : (
                  <ShelfPhoto slots={slotsAfter(FIXED)} fit="contain" />
                )}
                <AnimatePresence>
                  {showOverlay && phase === "BEFORE" && (
                    <motion.div
                      variants={fade}
                      initial="hidden"
                      animate="show"
                      exit="exit"
                      className="absolute inset-0"
                    >
                      <DetectionOverlay
                        detections={analysis.detections}
                        filter={filter}
                        fit="contain"
                        imageWidth={analysis.imageWidth}
                        imageHeight={analysis.imageHeight}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="absolute left-4 top-4 flex flex-wrap gap-2">
                {(["BEFORE", "AFTER"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPhase(p)}
                    aria-pressed={phase === p}
                    className={cn(
                      "h-9 rounded-pill px-3.5 text-[13px] font-medium transition-colors",
                      phase === p
                        ? "bg-ink-text text-ink"
                        : "bg-ink/70 text-ink-text backdrop-blur-sm hover:bg-ink/90",
                    )}
                  >
                    {p === "BEFORE" ? `ก่อน · OSA ${item.osaBefore}%` : `หลัง · OSA ${item.osaAfter ?? "—"}%`}
                  </button>
                ))}
              </div>

              <div className="on-dark absolute bottom-4 left-4 flex flex-wrap items-center gap-3 rounded-btn bg-ink/75 px-3.5 py-2.5 backdrop-blur-sm">
                <Toggle dark checked={showOverlay} onChange={setShowOverlay} label="แสดงกรอบตรวจจับ" />
              </div>

              {showOverlay && phase === "BEFORE" && (
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
            </div>

            {/* ---- metadata ---- */}
            <div className="flex w-full shrink-0 flex-col overflow-y-auto border-t border-line lg:w-[340px] lg:border-l lg:border-t-0">
              <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
                <div>
                  <h2 className="text-[16px] font-semibold leading-snug">หลักฐานการตรวจ</h2>
                  <p className="mt-0.5 text-[13px] text-muted">
                    {item.date} · {item.time} น.
                  </p>
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
                <Row label="หมวด / ชั้นวาง" value={`${item.category} · ${item.bay}`} />
                <Row label="วันและเวลา" value={`${item.date} ${item.time} น.`} />
                <Row label="พิกัด GPS" value={item.gps} mono />
                <Row label="ผู้ถ่าย" value={item.capturedByRole} hint="ระบุเป็นบทบาท ไม่ระบุตัวบุคคล" />
                <Row label="โมเดลที่ใช้" value={item.modelVersion} mono />
                <Row
                  label="ผลลัพธ์"
                  value={`พบช่องว่าง ${item.gaps} จุด · แก้ไขแล้ว ${item.fixed} จุด`}
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
                        อยู่ระหว่างโต้แย้งผล
                      </p>
                      <p className="mt-1 text-[13px] leading-relaxed text-[#95500a]">
                        ส่งให้ทีมข้อมูลตรวจสอบแล้ว ผลนี้จะไม่ถูกนำไปใช้จนกว่าจะได้ข้อสรุป
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
                <Button variant="ghost" full className="mt-2">
                  <ExportIcon /> ส่งออกเป็น PDF สำหรับเจรจา
                </Button>
                <p className="mt-2.5 text-[12px] leading-relaxed text-faint">
                  ไฟล์ PDF จะมีภาพ พิกัด และเวลา เพื่อใช้ประกอบการเจรจากับร้านค้า
                  ระบบไม่ส่งเอกสารนี้ให้ร้านโดยอัตโนมัติ
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

function ExportIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3v12M7 10l5 5 5-5M4 20h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export { Pill };
