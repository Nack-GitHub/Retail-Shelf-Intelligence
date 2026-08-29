import type { OsaPoint } from "@/lib/api/analytics";

/* Weekly OSA buckets arrive from the API only for the weeks that actually hold
 * a photograph. Handed straight to a chart that spaces points by index, a store
 * photographed on 29 มิ.ย., 3 ส.ค. and 24 ส.ค. draws its 5-week gap and its
 * 3-week gap at exactly the same width — so the slope of the line, which is the
 * one thing a trend chart exists to communicate, is wrong.
 *
 * Filling the missing weeks fixes the spacing and says something a manager
 * wants to know anyway: nobody went into this shop for five weeks. The value is
 * null rather than 0 — the shelf was not empty, it was unobserved, and the
 * chart has to draw those differently. */

export interface TrendPoint {
  /** ISO date of the Monday this week starts on */
  bucket: string;
  /** null when no shelf was photographed that week */
  osa: number | null;
  visits: number;
}

const WEEK_MS = 7 * 86_400_000;

/** A dense week-by-week series between the first and last bucket the API sent.
 *
 *  Buckets are `date_trunc('week', …)` so they are always Mondays, and stepping
 *  a week at a time from the first one lands on every later one. If that ever
 *  stops being true the input is returned untouched: a chart with the wrong
 *  spacing beats a chart that quietly dropped a measurement. */
export function fillWeeklyGaps(points: OsaPoint[]): TrendPoint[] {
  if (points.length < 2) return points.map((p) => ({ ...p }));

  const start = Date.parse(points[0].bucket);
  const end = Date.parse(points[points.length - 1].bucket);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return points.map((p) => ({ ...p }));
  }

  const byBucket = new Map(points.map((p) => [p.bucket, p]));
  const filled: TrendPoint[] = [];
  for (let t = start; t <= end; t += WEEK_MS) {
    const bucket = new Date(t).toISOString().slice(0, 10);
    const measured = byBucket.get(bucket);
    filled.push(
      measured
        ? { bucket, osa: measured.osa, visits: measured.visits }
        : { bucket, osa: null, visits: 0 },
    );
  }

  // Every bucket the API sent must survive. If one did not land on the weekly
  // grid, fall back rather than lose it.
  const kept = filled.filter((p) => p.osa !== null).length;
  return kept === points.length ? filled : points.map((p) => ({ ...p }));
}

/** How many weeks in the series were actually measured.
 *
 *  The "ต้องมีอย่างน้อย 2 สัปดาห์" guard on every trend screen has to count
 *  these, not the filled series — otherwise one measurement plus nine blanks
 *  would look like enough data to draw a trend through. */
export function measuredWeeks(points: TrendPoint[]): number {
  return points.filter((p) => p.osa !== null).length;
}
