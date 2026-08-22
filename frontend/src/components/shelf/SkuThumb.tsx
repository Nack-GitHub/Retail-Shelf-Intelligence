import { cn } from "@/lib/cn";

const PALETTE: Record<string, { body: string; band: string; cap: string }> = {
  "CF-ESP-180": { body: "#4a3226", band: "#c8a06a", cap: "#2c1d16" },
  "CF-LAT-180": { body: "#b8a184", band: "#f0e6d6", cap: "#7d6a52" },
  "CF-REF-200": { body: "#d9c9a8", band: "#7b3f2e", cap: "#a8977a" },
  "RC-ORI-27": { body: "#c0392b", band: "#f4d8b0", cap: "#8c2820" },
  "RC-MOC-25": { body: "#7b3f2e", band: "#e2b07a", cap: "#54291d" },
  "GB-BLK-30": { body: "#2f3640", band: "#c9a227", cap: "#1c2027" },
};

export function SkuThumb({ code, className }: { code: string; className?: string }) {
  const p = PALETTE[code] ?? { body: "#667085", band: "#e2e7ee", cap: "#475467" };
  const isCan = code.startsWith("CF-") && !code.includes("REF");
  return (
    <span
      className={cn(
        "grid size-12 shrink-0 place-items-center overflow-hidden rounded-inset bg-surface-2",
        className,
      )}
    >
      <svg viewBox="0 0 48 48" className="size-full" aria-hidden>
        <rect width="48" height="48" fill="#eceff4" />
        {isCan ? (
          <>
            <rect x="15" y="10" width="18" height="30" rx="4" fill={p.body} />
            <rect x="15" y="10" width="5" height="30" rx="2.5" fill="#fff" opacity="0.2" />
            <rect x="17" y="22" width="14" height="8" rx="2" fill={p.band} />
            <rect x="18" y="7" width="12" height="5" rx="2" fill={p.cap} />
          </>
        ) : (
          <>
            <rect x="12" y="11" width="24" height="28" rx="3" fill={p.body} />
            <rect x="12" y="11" width="24" height="3" fill="#fff" opacity="0.25" />
            <rect x="15" y="20" width="18" height="9" rx="2" fill={p.band} />
            <rect x="18" y="32" width="12" height="3" rx="1.5" fill={p.band} opacity="0.55" />
          </>
        )}
      </svg>
    </span>
  );
}
