import { cn } from "@/lib/cn";

export function Logo({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={cn("shrink-0", className)} aria-hidden>
      <rect width="40" height="40" rx="12" fill="#1b6fe8" />
      <rect x="9" y="11" width="22" height="3" rx="1.5" fill="#fff" opacity="0.55" />
      <rect x="9" y="18.5" width="22" height="3" rx="1.5" fill="#fff" opacity="0.55" />
      <rect x="9" y="26" width="22" height="3" rx="1.5" fill="#fff" opacity="0.55" />
      <rect x="17.5" y="16" width="9" height="8" rx="1.5" fill="#0a0e14" opacity="0.28" />
      <circle cx="22" cy="20" r="4.6" fill="#fff" />
      <circle cx="22" cy="20" r="2" fill="#1b6fe8" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("text-[17px] font-bold tracking-tight", className)}>
      Shelf<span className="text-primary">Eye</span>
    </span>
  );
}
