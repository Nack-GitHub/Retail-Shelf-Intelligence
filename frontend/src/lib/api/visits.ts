import { request, toPercent } from "@/lib/api/client";

export interface Visit {
  id: string;
  storeId: string;
  checkedInAt: string;
  checkedOutAt: string | null;
  /** false is a flag, never a block — reps legitimately stand outside a shop */
  gpsMatch: boolean;
  photoConsentConfirmed: boolean | null;
  /** percent 0-100, or null before any shelf has been analysed */
  osaBefore: number | null;
  osaAfter: number | null;
  status: string;
}

interface VisitWire extends Omit<Visit, "osaBefore" | "osaAfter"> {
  osaBefore: number | null;
  osaAfter: number | null;
  userId: string;
}

function toVisit(wire: VisitWire): Visit {
  // userId is deliberately dropped rather than carried through the app: the
  // client has no screen that may show who did what, so it should not hold it.
  return {
    id: wire.id,
    storeId: wire.storeId,
    checkedInAt: wire.checkedInAt,
    checkedOutAt: wire.checkedOutAt,
    gpsMatch: wire.gpsMatch,
    photoConsentConfirmed: wire.photoConsentConfirmed,
    osaBefore: toPercent(wire.osaBefore),
    osaAfter: toPercent(wire.osaAfter),
    status: wire.status,
  };
}

/** Opens a visit. Rejects with a Thai ApiError if the store forbids photography. */
export async function checkIn(input: {
  storeId: string;
  gpsLat?: number | null;
  gpsLng?: number | null;
  photoConsentConfirmed: boolean;
}): Promise<Visit> {
  return toVisit(
    await request<VisitWire>("/v1/visits", {
      method: "POST",
      body: {
        storeId: input.storeId,
        gpsLat: input.gpsLat ?? null,
        gpsLng: input.gpsLng ?? null,
        photoConsentConfirmed: input.photoConsentConfirmed,
      },
    }),
  );
}

export async function fetchVisit(visitId: string): Promise<Visit> {
  return toVisit(await request<VisitWire>(`/v1/visits/${encodeURIComponent(visitId)}`));
}

export interface CheckoutSummary {
  visitId: string;
  osaBefore: number | null;
  osaAfter: number | null;
  tasksTotal: number;
  tasksFixed: number;
  tasksBlocked: number;
  checkedOutAt: string;
}

export async function checkOut(visitId: string): Promise<CheckoutSummary> {
  const wire = await request<CheckoutSummary>(`/v1/visits/${encodeURIComponent(visitId)}/checkout`, {
    method: "POST",
  });
  return {
    ...wire,
    osaBefore: toPercent(wire.osaBefore),
    osaAfter: toPercent(wire.osaAfter),
  };
}
