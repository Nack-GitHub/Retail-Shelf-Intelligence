"use client";

import { Button } from "@/components/ui/Button";
import type { Flow } from "@/lib/flow/useFlow";
import { cn } from "@/lib/cn";

/* Shown when a screen has been reached without the visit behind it — a reload
   in the shop, a back press after the visit closed, a pasted link.

   The alternative these screens used to reach for was `return null`, which
   renders as a blank panel inside the phone frame: nothing to read, nothing to
   press, and no clue whether the app has crashed or is still loading. The rule
   this project already states for data loading holds here too — a blank screen
   that explains nothing is a bug, not a neutral state. */

export function FlowGuardBlock({ flow, dark }: { flow: Flow; dark?: boolean }) {
  const { title, body, action } = flow.blockedCopy;

  return (
    <div
      role="status"
      className={cn(
        "flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center",
        dark ? "on-dark bg-ink" : "bg-bg",
      )}
    >
      <div
        className={cn(
          "grid size-14 place-items-center rounded-full",
          dark ? "bg-ink-2" : "bg-surface-2",
        )}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.45" />
          <path d="M12 7.5v5.5M12 16.2h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </div>

      <h1 className={cn("mt-4 text-[18px] font-semibold", dark && "text-ink-text")}>{title}</h1>
      <p
        className={cn(
          "mt-2 max-w-[300px] text-[14px] leading-relaxed",
          dark ? "text-ink-muted" : "text-muted",
        )}
      >
        {body}
      </p>

      <Button size="lg" className="mt-6 w-full max-w-[280px]" onClick={flow.goFallback}>
        {action}
      </Button>
    </div>
  );
}
