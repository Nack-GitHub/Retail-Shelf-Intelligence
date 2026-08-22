import { cn } from "@/lib/cn";
import type { OsaStatus, RiskBand } from "@/types";

export function Pill({
  tone = "neutral",
  className,
  children,
}: {
  tone?: "neutral" | "ok" | "warn" | "danger" | "primary" | "uncertain";
  className?: string;
  children: React.ReactNode;
}) {
  const tones = {
    neutral: "bg-surface-2 text-muted",
    ok: "bg-ok-soft text-[#07794a]",
    warn: "bg-warn-soft text-[#b45f04]",
    danger: "bg-danger-soft text-[#a52218]",
    primary: "bg-primary-soft text-primary-ink",
    uncertain: "bg-uncertain-soft text-muted",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[13px] font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const RISK_META: Record<RiskBand, { label: string; tone: "danger" | "warn" | "ok"; dot: string }> = {
  HIGH: { label: "เสี่ยงสูง", tone: "danger", dot: "bg-danger" },
  MEDIUM: { label: "เสี่ยงกลาง", tone: "warn", dot: "bg-warn" },
  LOW: { label: "เสี่ยงต่ำ", tone: "ok", dot: "bg-ok" },
};

/** Risk is never conveyed by colour alone — always a dot + a word. */
export function RiskBadge({ band, className }: { band: RiskBand; className?: string }) {
  const m = RISK_META[band];
  return (
    <Pill tone={m.tone} className={className}>
      <span className={cn("size-1.5 rounded-full", m.dot)} aria-hidden />
      {m.label}
    </Pill>
  );
}

const OSA_META: Record<OsaStatus, { label: string; tone: "ok" | "warn" | "danger" }> = {
  OK: { label: "ปกติ", tone: "ok" },
  LOW: { label: "ต่ำ", tone: "warn" },
  CRITICAL: { label: "วิกฤต", tone: "danger" },
};

export function OsaStatusPill({ status, className }: { status: OsaStatus; className?: string }) {
  const m = OSA_META[status];
  return (
    <Pill tone={m.tone} className={className}>
      <span
        className={cn(
          "size-1.5 rounded-full",
          status === "OK" ? "bg-ok" : status === "LOW" ? "bg-warn" : "bg-danger",
        )}
        aria-hidden
      />
      {m.label}
    </Pill>
  );
}

export function osaStatusOf(osa: number): OsaStatus {
  return osa >= 90 ? "OK" : osa >= 70 ? "LOW" : "CRITICAL";
}
