"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";

/* `onBack` is required. It used to default to router.back(), which is the
   browser's history — "where did you come from" — while the arrow in a header
   promises "one step back in this flow". The two agree only by coincidence,
   and every screen took the default, so no screen ever said where its back
   arrow went. Where it goes now comes from the flow map. */
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
  onBack: () => void;
  right?: React.ReactNode;
  dark?: boolean;
  /** 0–1, drawn as a hairline under the header */
  progress?: number;
}) {
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
          onClick={onBack}
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

/* Where each screen was scrolled to, by path.
 *
 * The browser restores scroll for the window, and nothing here scrolls the
 * window: the phone frame is exactly one viewport tall and the content scrolls
 * inside this element. So going back to a long task list always landed at the
 * top, however far down the rep had worked. */
const scrollPositions = new Map<string, number>();

export function Scroll({
  children,
  className,
  dark,
}: {
  children: React.ReactNode;
  className?: string;
  dark?: boolean;
}) {
  const pathname = usePathname();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // The day's route list is the boundary between visits. Anything below it
    // belongs to a shop the rep has left, and restoring those offsets on a
    // later visit to the same store would be a memory of the wrong morning.
    if (pathname === "/m") {
      for (const key of [...scrollPositions.keys()]) {
        if (key.startsWith("/m/store/")) scrollPositions.delete(key);
      }
    }

    const target = scrollPositions.get(pathname) ?? 0;
    // Restoring cannot happen in one go: the list is usually still loading, so
    // the element is too short to hold the offset and the assignment clamps to
    // zero. Keep trying as the content grows, and do not record anything until
    // the position has actually been reached — otherwise the clamped value
    // overwrites the real one.
    let restored = target === 0;

    const restore = () => {
      if (restored) return;
      el.scrollTop = target;
      if (Math.abs(el.scrollTop - target) < 2) restored = true;
    };
    restore();

    const growth = new ResizeObserver(restore);
    growth.observe(el);
    if (el.firstElementChild) growth.observe(el.firstElementChild);
    // Content that never grows enough should not leave an observer running for
    // the life of the screen, nor block recording from then on.
    const giveUp = window.setTimeout(() => {
      restored = true;
      growth.disconnect();
    }, 2000);

    let frame = 0;
    const onScroll = () => {
      if (!restored) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => scrollPositions.set(pathname, el.scrollTop));
    };
    el.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.clearTimeout(giveUp);
      window.cancelAnimationFrame(frame);
      growth.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, [pathname]);

  return (
    <main
      ref={ref}
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
