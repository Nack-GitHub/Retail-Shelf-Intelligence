import { cn } from "@/lib/cn";
import { OSA_TONE, type OsaTone } from "@/lib/osa";
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

const OSA_LABEL: Record<OsaStatus, string> = {
  OK: "ปกติ",
  LOW: "ต่ำ",
  CRITICAL: "วิกฤต",
};

// Written out rather than composed, because Tailwind only ships the classes it
// can see spelled in full.
const OSA_DOT: Record<OsaTone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
};

/** Never colour alone — always a dot and a word, like RiskBadge. */
export function OsaStatusPill({ status, className }: { status: OsaStatus; className?: string }) {
  const tone = OSA_TONE[status];
  return (
    <Pill tone={tone} className={className}>
      <span className={cn("size-1.5 rounded-full", OSA_DOT[tone])} aria-hidden />
      {OSA_LABEL[status]}
    </Pill>
  );
}
