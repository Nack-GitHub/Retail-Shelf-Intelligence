"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { ShelfPhoto } from "@/components/shelf/ShelfPhoto";
import { ProgressRing } from "@/components/ui/Progress";
import { Button } from "@/components/ui/Button";
import { StateSwitcher } from "@/components/mobile/StateSwitcher";
import { useDemo } from "@/lib/store";
import { easeOut, springSnappy } from "@/lib/motion";
import { cn } from "@/lib/cn";

type Mode = "ONLINE" | "OFFLINE" | "FAILED";

const STEPS_ONLINE = [
  { id: "upload", label: "อัปโหลดภาพที่เบลอใบหน้าแล้ว", at: 0 },
  { id: "detect", label: "ตรวจจับสินค้าและช่องว่าง", at: 34 },
  { id: "osa", label: "คำนวณ OSA และจัดลำดับความสำคัญ", at: 72 },
];

const STEPS_OFFLINE = [
  { id: "local", label: "รันโมเดลบนเครื่อง (โหมดเร็ว)", at: 0 },
  { id: "detect", label: "ตรวจจับสินค้าและช่องว่าง", at: 40 },
  { id: "queue", label: "เข้าคิวส่งขึ้นเซิร์ฟเวอร์ภายหลัง", at: 78 },
];

export default function ProcessingScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const online = useDemo((s) => s.online);
  const justCaptured = useDemo((s) => s.justCaptured);
  const consumeCapture = useDemo((s) => s.consumeCapture);

  const [mode, setMode] = useState<Mode>(online ? "ONLINE" : "OFFLINE");
  // Arriving from the camera, this screen moves on by itself. Once someone
  // picks a state from the demo switcher they are inspecting it, so hold.
  const [inspecting, setInspecting] = useState(false);

  return (
    <div className="on-dark relative flex min-h-0 flex-1 flex-col overflow-hidden bg-ink">
      {/* the photo stays visible so the rep keeps context while waiting */}
      <div className="absolute inset-0 opacity-25">
        <ShelfPhoto />
      </div>
      <div className="absolute inset-0 bg-ink/70" />

      {/* scan line sweeping the frame */}
      {mode !== "FAILED" && (
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
          {mode === "FAILED" ? (
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
              <p className="mt-1.5 text-[14px] leading-relaxed text-ink-muted">
                เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (NETWORK_TIMEOUT) ภาพถูกเก็บไว้ในเครื่องแล้ว
                ไม่สูญหาย
              </p>
              <div className="mt-6 flex w-full flex-col gap-2.5">
                <Button
                  size="lg"
                  full
                  onClick={() => {
                    setInspecting(false);
                    setMode(online ? "ONLINE" : "OFFLINE");
                  }}
                >
                  ลองอีกครั้ง
                </Button>
                <Button
                  variant="outlineDark"
                  size="lg"
                  full
                  onClick={() => {
                    setInspecting(false);
                    setMode("OFFLINE");
                  }}
                >
                  วิเคราะห์บนเครื่องแทน
                </Button>
              </div>
            </motion.div>
          ) : (
            <Working
              key={mode}
              mode={mode}
              onDone={
                inspecting || !justCaptured
                  ? undefined
                  : () => {
                      consumeCapture();
                      router.push(`/m/store/${id}/result`);
                    }
              }
            />
          )}
        </AnimatePresence>
      </div>

      <div className="relative shrink-0 px-4 pb-[max(12px,env(safe-area-inset-bottom))]">
        <StateSwitcher
          dark
          value={mode}
          onChange={(v) => {
            setInspecting(true);
            setMode(v);
          }}
          options={[
            { value: "ONLINE", label: "กำลังประมวลผล" },
            { value: "OFFLINE", label: "โหมดออฟไลน์" },
            { value: "FAILED", label: "ล้มเหลว" },
          ]}
        />
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        {mode === "FAILED" ? "วิเคราะห์ไม่สำเร็จ" : "กำลังวิเคราะห์ชั้นวาง"}
      </span>
    </div>
  );
}

/* Remounted whenever the mode changes (key={mode}), so the timer state
   starts from zero without ever resetting state inside an effect. */
function Working({
  mode,
  onDone,
}: {
  mode: Exclude<Mode, "FAILED">;
  /** omitted while the screen is being inspected — the ring fills and holds */
  onDone?: () => void;
}) {
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const fired = useRef(false);

  useEffect(() => {
    const started = Date.now();
    const target = mode === "OFFLINE" ? 5200 : 3400;
    const tick = window.setInterval(() => {
      const ms = Date.now() - started;
      const p = Math.min(100, (ms / target) * 100);
      // the clock stops when the work does, even if the screen is being held
      setElapsed(Math.min(ms, target) / 1000);
      setProgress(p);
      if (p >= 100 && !fired.current && onDone) {
        fired.current = true;
        window.setTimeout(onDone, 420);
      }
    }, 90);
    return () => window.clearInterval(tick);
  }, [mode, onDone]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3, ease: easeOut }}
      className="flex w-full max-w-[320px] flex-col items-center"
    >
      <ProgressRing
        value={progress}
        size={156}
        stroke={9}
        color={mode === "OFFLINE" ? "#f79009" : "#1b6fe8"}
      >
        <div className="text-center">
          <p className="tnum text-[34px] font-bold leading-none text-ink-text">
            {elapsed.toFixed(1)}
          </p>
          <p className="mt-1 text-[13px] text-ink-muted">วินาที</p>
        </div>
      </ProgressRing>

      <h1 className="mt-6 text-center text-[19px] font-semibold text-ink-text">
        {mode === "OFFLINE" ? "ไม่มีสัญญาณ — วิเคราะห์บนเครื่อง" : "กำลังวิเคราะห์ชั้นวาง…"}
      </h1>
      <p className="mt-1.5 text-center text-[14px] text-ink-muted">
        {mode === "OFFLINE"
          ? "โหมดเร็ว ความแม่นยำต่ำกว่าเล็กน้อย และจะประมวลผลซ้ำเมื่อออนไลน์"
          : "เป้าหมายไม่เกิน 10 วินาที · โมเดล shelf-product-v3"}
      </p>

      <ul className="mt-6 w-full space-y-2.5">
        {(mode === "OFFLINE" ? STEPS_OFFLINE : STEPS_ONLINE).map((s) => {
          const active = progress >= s.at;
          const complete = progress >= s.at + 32;
          return (
            <li key={s.id} className="flex items-center gap-3">
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full transition-colors duration-300",
                  complete
                    ? "bg-ok"
                    : active
                      ? mode === "OFFLINE" ? "bg-warn" : "bg-primary"
                      : "bg-ink-3",
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
  );
}
