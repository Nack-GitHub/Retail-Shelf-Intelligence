"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { springSnappy } from "@/lib/motion";

export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  id,
  required,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
  hint?: string;
  id: string;
  required?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex items-start gap-3 rounded-card border p-4 cursor-pointer transition-colors duration-150",
        checked ? "border-primary bg-primary-soft" : "border-line-strong bg-bg hover:bg-surface",
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        required={required}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
      />
      <span
        aria-hidden
        className={cn(
          "mt-0.5 grid size-6 shrink-0 place-items-center rounded-[7px] border-2 transition-colors duration-150",
          "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary",
          checked ? "border-primary bg-primary" : "border-line-strong bg-bg",
        )}
      >
        <motion.svg
          viewBox="0 0 20 20"
          className="size-4"
          initial={false}
          animate={{ scale: checked ? 1 : 0.4, opacity: checked ? 1 : 0 }}
          transition={springSnappy}
        >
          <path
            d="M4 10.5l4 4 8-8.5"
            fill="none"
            stroke="#fff"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </motion.svg>
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-medium leading-snug">{label}</span>
        {hint && <span className="mt-1 block text-[13px] text-muted leading-relaxed">{hint}</span>}
      </span>
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  dark,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  dark?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2.5"
    >
      <span
        className={cn(
          "text-[13px] font-medium",
          dark ? "text-ink-muted" : "text-muted",
        )}
      >
        {label}
      </span>
      <span
        aria-hidden
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-pill transition-colors duration-200",
          checked ? "bg-primary" : dark ? "bg-ink-line" : "bg-line-strong",
        )}
      >
        <motion.span
          className="absolute top-0.5 size-5 rounded-full bg-white shadow-[var(--shadow-sm)]"
          animate={{ left: checked ? 22 : 2 }}
          transition={springSnappy}
        />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  ariaLabel: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex rounded-chip border border-line bg-surface p-1"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative h-8 rounded-[7px] px-3 text-[13px] font-medium transition-colors duration-150",
              active ? "text-text" : "text-muted hover:text-text",
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${ariaLabel}`}
                className="absolute inset-0 rounded-[7px] bg-bg shadow-[var(--shadow-sm)]"
                transition={springSnappy}
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
