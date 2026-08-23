"use client";

import { motion } from "motion/react";
import { fadeUp } from "@/lib/motion";
import { cn } from "@/lib/cn";

/* The two states every data screen shares. "Empty" is deliberately NOT here:
   an empty coffee shelf and an empty task list want different words and a
   different call to action, so each screen writes its own. */

export function LoadingBlock({
  label = "กำลังโหลดข้อมูล…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex flex-col items-center justify-center gap-3 px-6 py-14", className)}
    >
      <span className="size-7 animate-spin rounded-full border-[3px] border-line-strong border-t-primary" />
      <p className="text-[14px] text-muted">{label}</p>
    </div>
  );
}

export function ErrorBlock({
  message,
  onRetry,
  className,
}: {
  /** Thai, and it must say what to do next — not just what broke */
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      animate="show"
      role="alert"
      className={cn(
        "flex flex-col items-center rounded-card border border-line bg-bg px-6 py-12 text-center",
        className,
      )}
    >
      <div className="grid size-14 place-items-center rounded-full bg-danger/10">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" className="text-danger" aria-hidden>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
          <path d="M12 7.5v5.5M12 16.3h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </div>
      <h2 className="mt-3.5 text-[16px] font-semibold">โหลดข้อมูลไม่สำเร็จ</h2>
      <p className="mt-1.5 max-w-[280px] text-[14px] leading-relaxed text-muted">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 h-11 rounded-btn bg-primary px-5 text-[15px] font-semibold text-white transition-opacity hover:opacity-90"
        >
          ลองอีกครั้ง
        </button>
      )}
    </motion.div>
  );
}
