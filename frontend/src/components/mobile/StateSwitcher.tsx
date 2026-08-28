"use client";

import { cn } from "@/lib/cn";

/** Demo affordance: lets a reviewer see every state the spec asks for
 *  without needing to fake network or data conditions.
 *
 *  Every caller renders it behind `DEMO_MODE &&`, which folds to `false` at
 *  build time, so in a shipped build nothing constructs this and no screen can
 *  reach it. The module itself is still emitted — Turbopack keeps an imported
 *  module even once its only reference has been folded away — so this label
 *  survives a grep of .next/static. That is residue, not a control: there is
 *  no code path left that renders it. Deleting the file is the only way to
 *  remove the string, and that would take the demo build with it. */
export function StateSwitcher<T extends string>({
  value,
  onChange,
  options,
  label = "สาธิตสถานะหน้าจอ",
  dark,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label?: string;
  dark?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-card border border-dashed px-3.5 py-3",
        dark ? "border-ink-line bg-ink-2" : "border-line-strong bg-surface-2/60",
      )}
    >
      <p
        className={cn(
          "mb-2 flex items-center gap-1.5 text-[12px] font-medium",
          dark ? "text-ink-muted" : "text-faint",
        )}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
          <path d="M12 16v-4.5M12 8.2h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={o.value === value}
            className={cn(
              "h-8 rounded-pill px-3 text-[13px] font-medium transition-colors",
              o.value === value
                ? "bg-text text-white"
                : dark
                  ? "bg-ink-3 text-ink-muted hover:text-ink-text"
                  : "bg-bg text-muted hover:text-text",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
