"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { MobileHeader, BottomBar, Scroll } from "@/components/mobile/Chrome";
import { CropView } from "@/components/shelf/CropView";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Badge";
import { Segmented } from "@/components/ui/Controls";
import { REJECT_REASONS } from "@/lib/constants";
import { useFlow } from "@/lib/flow/useFlow";
import { FlowGuardBlock } from "@/components/mobile/FlowGuardBlock";
import { useDemo } from "@/lib/store";
import { messageOf } from "@/lib/api/errors";
import type { GapFinding, RejectReason } from "@/types";
import { easeOut, listItem, stagger } from "@/lib/motion";
import { cn } from "@/lib/cn";

export default function VerifyScreen() {
  const flow = useFlow("VERIFY");

  const analysis = useDemo((s) => s.analysis);
  const photo = useDemo((s) => s.photo);
  const findings = useDemo((s) => s.findings);
  const verify = useDemo((s) => s.verify);
  const loadTasks = useDemo((s) => s.loadTasks);

  const [mode, setMode] = useState<"ONE" | "ALL">("ONE");
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reached with nothing to verify — a reload, or a back press from the task
  // list after the analysis fell out of memory. This used to render nothing at
  // all: a blank panel inside the phone frame, with no way forward.
  if (flow.blocked || !analysis) return <FlowGuardBlock flow={flow} />;

  const current = findings[Math.min(index, findings.length - 1)];
  const decided = findings.filter((f) => f.verificationStatus !== "PENDING").length;
  const allDone = decided === findings.length;

  function advance() {
    if (index < findings.length - 1) {
      setDir(1);
      setIndex((i) => i + 1);
    }
  }

  async function record(
    f: GapFinding,
    verdict: "CONFIRMED" | "REJECTED",
    reason?: RejectReason,
  ) {
    setError(null);
    try {
      // The store updates optimistically and rolls back if the server
      // refuses, so the rep keeps tapping at their own pace.
      await verify(f.id, verdict, reason);
      window.setTimeout(advance, 220);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  function confirm(f: GapFinding) {
    void record(f, "CONFIRMED");
  }

  function reject(f: GapFinding, reason: RejectReason) {
    setRejecting(null);
    void record(f, "REJECTED", reason);
  }

  async function goTasks() {
    setBusy(true);
    setError(null);
    try {
      // Read back what the SERVER created from the confirmed gaps, rather
      // than assuming the client and the database agree.
      await loadTasks();
      flow.go("TASKS");
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  }

  return (
    <>
      <MobileHeader
        title="ตรวจสอบผลทีละจุด"
        subtitle={`ตัดสินใจแล้ว ${decided} จาก ${findings.length} จุด`}
        progress={decided / findings.length}
        onBack={flow.back}
        right={
          <Segmented
            ariaLabel="รูปแบบการตรวจสอบ"
            value={mode}
            onChange={setMode}
            options={[
              { value: "ONE", label: "ทีละจุด" },
              { value: "ALL", label: "ทั้งหมด" },
            ]}
          />
        }
      />

      {mode === "ONE" ? (
        <>
          <Scroll className="pb-4">
            <div className="px-4 pt-3">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-medium text-muted">
                  จุดที่ <span className="tnum font-semibold text-text">{index + 1}</span> จาก{" "}
                  <span className="tnum">{findings.length}</span>
                </p>
                <div className="flex gap-1" aria-hidden>
                  {findings.map((f, i) => (
                    <span
                      key={f.id}
                      className={cn(
                        "h-1.5 rounded-full transition-all duration-300",
                        i === index ? "w-5 bg-text" : "w-1.5",
                        i !== index &&
                          (f.verificationStatus === "CONFIRMED"
                            ? "bg-danger"
                            : f.verificationStatus === "REJECTED"
                              ? "bg-muted"
                              : "bg-line-strong"),
                      )}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="relative mt-3 overflow-hidden">
              <AnimatePresence mode="wait" custom={dir}>
                <motion.div
                  key={current.id}
                  initial={{ opacity: 0, x: 40 * dir }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -40 * dir }}
                  transition={{ duration: 0.28, ease: easeOut }}
                >
                  <CropView
                    bbox={analysis.detections.find((d) => d.detectionId === current.detectionId)!.bbox}
                    detections={analysis.detections}
                    focusId={current.detectionId}
                    photo={photo}
                    imageWidth={analysis.imageWidth}
                    imageHeight={analysis.imageHeight}
                  />

                  <div className="px-4 pt-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-[18px] font-semibold leading-snug">
                          {current.positionLabel}
                        </h2>
                        <p className="mt-1 text-[14px] text-muted">
                          สินค้าที่ควรอยู่ตรงนี้ · {current.skuBrand} {current.skuName}
                        </p>
                      </div>
                      {current.isLowConfidence ? (
                        <Pill tone="uncertain">ต้องตรวจสอบ</Pill>
                      ) : (
                        <Pill tone="danger">ช่องว่าง</Pill>
                      )}
                    </div>

                    <ConfidenceBar value={current.confidence} low={current.isLowConfidence} />

                    <AnimatePresence>
                      {current.verificationStatus !== "PENDING" && (
                        <motion.div
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          className={cn(
                            "mt-3 rounded-chip px-3.5 py-2.5 text-[14px] font-medium",
                            current.verificationStatus === "CONFIRMED"
                              ? "bg-danger-soft text-[#a52218]"
                              : "bg-surface-2 text-muted",
                          )}
                        >
                          {current.verificationStatus === "CONFIRMED"
                            ? "บันทึกแล้ว: ขาดจริง — เพิ่มเข้ารายการที่ต้องทำ"
                            : `บันทึกแล้ว: ไม่ใช่ช่องว่าง (${
                                REJECT_REASONS.find((r) => r.id === current.rejectedReason)?.label ?? "-"
                              })`}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            <p className="mt-4 px-4 text-[13px] leading-relaxed text-muted">
              ทั้งสองตัวเลือกสำคัญเท่ากัน — การกด “ไม่ใช่” ไม่ใช่การข้ามงาน
              แต่เป็นข้อมูลที่ทำให้โมเดลแม่นขึ้นในรอบถัดไป
            </p>
          </Scroll>

          <BottomBar>
            {/* GUARDRAIL: identical geometry, identical type weight.
                Neither option is styled as the preferred one. */}
            <div className="grid grid-cols-2 gap-3">
              <VerdictButton
                tone="confirm"
                label="ใช่ ขาดจริง"
                active={current.verificationStatus === "CONFIRMED"}
                onClick={() => confirm(current)}
              />
              <VerdictButton
                tone="reject"
                label="ไม่ใช่"
                active={current.verificationStatus === "REJECTED"}
                onClick={() => setRejecting(current.id)}
              />
            </div>

            <div className="mt-2.5 flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setDir(-1);
                  setIndex((i) => Math.max(0, i - 1));
                }}
                disabled={index === 0}
                className="h-10 rounded-btn px-3 text-[14px] font-medium text-muted transition-colors hover:bg-surface-2 disabled:opacity-40"
              >
                ← จุดก่อนหน้า
              </button>
              <div className="flex-1" />
              {allDone ? (
                <Button size="sm" className="h-10 px-4" disabled={busy} onClick={() => void goTasks()}>
                  ไปยังรายการที่ต้องทำ
                </Button>
              ) : (
                <button
                  type="button"
                  onClick={advance}
                  disabled={index >= findings.length - 1}
                  className="h-10 rounded-btn px-3 text-[14px] font-medium text-muted transition-colors hover:bg-surface-2 disabled:opacity-40"
                >
                  ข้ามไปก่อน →
                </button>
              )}
            </div>
          </BottomBar>
        </>
      ) : (
        <>
          <Scroll className="px-4 pt-4 pb-4">
            <motion.ul variants={stagger(0.05)} initial="hidden" animate="show" className="flex flex-col gap-3">
              {findings.map((f) => (
                <motion.li
                  key={f.id}
                  variants={listItem}
                  className="overflow-hidden rounded-card border border-line bg-bg shadow-[var(--shadow-card)]"
                >
                  <div className="flex gap-3 p-3">
                    <div className="w-[104px] shrink-0 overflow-hidden rounded-inset">
                      <CropView
                        bbox={analysis.detections.find((d) => d.detectionId === f.detectionId)!.bbox}
                        detections={analysis.detections}
                        focusId={f.detectionId}
                        zoomTarget={0.55}
                        photo={photo}
                        imageWidth={analysis.imageWidth}
                        imageHeight={analysis.imageHeight}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-semibold leading-snug">{f.positionLabel}</p>
                      <p className="mt-0.5 truncate text-[13px] text-muted">
                        {f.skuBrand} {f.skuName}
                      </p>
                      <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted">
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            f.isLowConfidence ? "bg-uncertain" : "bg-danger",
                          )}
                          aria-hidden
                        />
                        ความมั่นใจ <span className="tnum">{Math.round(f.confidence * 100)}%</span>
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 border-t border-line p-3">
                    <VerdictButton
                      compact
                      tone="confirm"
                      label="ใช่ ขาดจริง"
                      active={f.verificationStatus === "CONFIRMED"}
                      onClick={() => verify(f.id, "CONFIRMED")}
                    />
                    <VerdictButton
                      compact
                      tone="reject"
                      label="ไม่ใช่"
                      active={f.verificationStatus === "REJECTED"}
                      onClick={() => setRejecting(f.id)}
                    />
                  </div>
                </motion.li>
              ))}
            </motion.ul>
          </Scroll>
          <BottomBar>
            {error && (
              <p role="alert" className="mb-2.5 rounded-card bg-danger/10 px-3.5 py-2.5 text-[13px] leading-relaxed text-danger">
                {error}
              </p>
            )}
            <Button size="lg" full disabled={!allDone || busy} onClick={() => void goTasks()}>
              {allDone ? "ไปยังรายการที่ต้องทำ" : `เหลืออีก ${findings.length - decided} จุด`}
            </Button>
          </BottomBar>
        </>
      )}

      <Sheet
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title="ทำไมจุดนี้ไม่ใช่ช่องว่าง"
        description="ข้อมูลนี้จะถูกส่งเข้าคิวปรับปรุงโมเดล ไม่มีผลต่อการประเมินตัวคุณ"
      >
        <ul className="flex flex-col gap-2 pb-2">
          {REJECT_REASONS.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => {
                  const f = findings.find((x) => x.id === rejecting);
                  if (f) reject(f, r.id as RejectReason);
                }}
                className="w-full rounded-card border border-line-strong bg-bg px-4 py-3.5 text-left transition-colors hover:border-text hover:bg-surface"
              >
                <p className="text-[15px] font-medium">{r.label}</p>
                <p className="mt-0.5 text-[13px] text-muted">{r.hint}</p>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}

function VerdictButton({
  tone,
  label,
  active,
  onClick,
  compact,
}: {
  tone: "confirm" | "reject";
  label: string;
  active: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.975 }}
      transition={{ duration: 0.09 }}
      aria-pressed={active}
      className={cn(
        // identical box model for both verdicts — the only difference is the glyph
        "flex items-center justify-center gap-2 rounded-btn border-2 font-semibold transition-colors",
        compact ? "h-11 text-[14px]" : "h-14 text-[16px]",
        active
          ? tone === "confirm"
            ? "border-danger bg-danger text-white"
            : "border-text bg-text text-white"
          : "border-line-strong bg-bg text-text hover:bg-surface",
      )}
    >
      {tone === "confirm" ? (
        <svg width={compact ? 17 : 20} height={compact ? 17 : 20} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M5 12.5l5 5L19 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width={compact ? 17 : 20} height={compact ? 17 : 20} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
      )}
      {label}
    </motion.button>
  );
}

function ConfidenceBar({ value, low }: { value: number; low: boolean }) {
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between text-[13px]">
        <span className="text-muted">ความมั่นใจของโมเดล</span>
        <span className="tnum font-semibold">{Math.round(value * 100)}%</span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-pill bg-surface-2">
        <motion.div
          className={cn("h-full rounded-pill", low ? "bg-uncertain" : "bg-danger")}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: value }}
          style={{ originX: 0 }}
          transition={{ duration: 0.55, ease: easeOut }}
        />
      </div>
      {low && (
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          ต่ำกว่าเกณฑ์ 60% — ระบบต้องการคำตัดสินจากคุณเป็นพิเศษ
        </p>
      )}
    </div>
  );
}
