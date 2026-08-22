"use client";

import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";

export function MobileHeader({
  title,
  subtitle,
  onBack,
  right,
  dark,
  progress,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  dark?: boolean;
  /** 0–1, drawn as a hairline under the header */
  progress?: number;
}) {
  const router = useRouter();
  const back = onBack ?? (() => router.back());
  return (
    <header
      className={cn(
        "sticky top-0 z-30 shrink-0 border-b",
        dark ? "on-dark border-ink-line bg-ink/95 backdrop-blur-sm" : "border-line bg-bg/95 backdrop-blur-sm",
      )}
    >
      <div className="flex items-center gap-2 px-2 py-2.5">
        <button
          type="button"
          onClick={back}
          aria-label="ย้อนกลับ"
          className={cn(
            "grid size-11 shrink-0 place-items-center rounded-btn transition-colors",
            dark ? "text-ink-text hover:bg-ink-3" : "text-text hover:bg-surface-2",
          )}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <h1 className={cn("truncate text-[16px] font-semibold leading-tight", dark && "text-ink-text")}>
            {title}
          </h1>
          {subtitle && (
            <p className={cn("truncate text-[13px] leading-tight", dark ? "text-ink-muted" : "text-muted")}>
              {subtitle}
            </p>
          )}
        </div>
        {right && <div className="shrink-0 pr-1">{right}</div>}
      </div>
      {progress !== undefined && (
        <div className={cn("h-[3px] w-full", dark ? "bg-ink-3" : "bg-surface-2")}>
          <motion.div
            className="h-full bg-primary"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: Math.max(0, Math.min(1, progress)) }}
            style={{ originX: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
      )}
    </header>
  );
}

/** Primary actions live in the thumb zone: bottom-anchored, never scrolled away. */
export function BottomBar({
  children,
  dark,
  className,
}: {
  children: React.ReactNode;
  dark?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-30 shrink-0 border-t px-4 pt-3",
        "pb-[max(12px,env(safe-area-inset-bottom))]",
        dark ? "on-dark border-ink-line bg-ink" : "border-line bg-bg",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Scroll({
  children,
  className,
  dark,
}: {
  children: React.ReactNode;
  className?: string;
  dark?: boolean;
}) {
  return (
    <main
      className={cn(
        "min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-y-thin",
        dark ? "on-dark bg-ink" : "bg-surface",
        className,
      )}
    >
      {children}
    </main>
  );
}
