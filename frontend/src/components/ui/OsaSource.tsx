import { osaSourceNote } from "@/lib/osa";
import { cn } from "@/lib/cn";
import type { OsaPhase } from "@/types";

/** The line under an OSA figure that says which photograph produced it.
 *
 *  One component rather than four copies: the whole point of this line is that
 *  every screen showing the same number describes it the same way. Renders
 *  nothing when there is nothing to describe. */
export function OsaSource({
  store,
  categoryName,
  className,
}: {
  store: {
    lastOsa: number | null;
    lastOsaPhase: OsaPhase | null;
    lastOsaAt: string | null;
    daysSinceLastVisit: number | null;
  };
  /** shelf name, where the screen has the catalogue to resolve it */
  categoryName?: string | null;
  className?: string;
}) {
  const note = osaSourceNote(store, categoryName);
  if (!note) return null;
  return <p className={cn("text-[12px] text-muted", className)}>{note}</p>;
}
