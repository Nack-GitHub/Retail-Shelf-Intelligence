import { request, toPercent } from "@/lib/api/client";
import type { RiskBand, Store, StoreFormat } from "@/types";

/** The wire shape. Ratios, exactly as the API sends them — the conversion to
 *  the percentages every screen renders happens in `toStore` below and
 *  nowhere else. */
interface StoreWire {
  id: string;
  externalCode: string;
  name: string;
  chain: string;
  storeFormat: StoreFormat;
  areaId: string;
  address: string;
  lat: number;
  lng: number;
  photoPolicy: "ALLOWED" | "RESTRICTED" | "FORBIDDEN";
  visitWindow: string;
  lastOsa: number | null;
  daysSinceLastVisit: number | null;
  riskBand: RiskBand;
  riskScore: number;
  repeatGapSkus: number;
  distanceKm?: number;
}

function toStore(wire: StoreWire): Store {
  return {
    ...wire,
    distanceKm: wire.distanceKm ?? null,
    // 0.875 → 88. Null survives as null: "never measured" must not become 0%.
    lastOsa: toPercent(wire.lastOsa),
    riskScore: toPercent(wire.riskScore) ?? 0,
  };
}

/** Today's stores, worst first.
 *
 *  The API sorts by (risk DESC, distance ASC) — an hour saved driving is
 *  worth less than a critical store left unvisited — so the order arrives
 *  correct and must not be re-sorted here. */
export async function fetchTodaysRoute(position?: {
  lat: number;
  lng: number;
}): Promise<Store[]> {
  const query = position ? `?lat=${position.lat}&lng=${position.lng}` : "";
  const wire = await request<StoreWire[]>(`/v1/routes/today${query}`);
  return wire.map(toStore);
}

export async function fetchStore(storeId: string): Promise<Store> {
  return toStore(await request<StoreWire>(`/v1/stores/${storeId}`));
}

export async function fetchStores(areaId?: string): Promise<Store[]> {
  const query = areaId ? `?areaId=${encodeURIComponent(areaId)}` : "";
  const wire = await request<StoreWire[]>(`/v1/stores${query}`);
  return wire.map(toStore);
}

/** The device's position, or null if it declines or takes too long.
 *
 *  Null is a fine answer: the API defaults to the area centroid, so a rep who
 *  refuses location still gets their route — just ordered by risk alone. */
export function currentPosition(timeoutMs = 4000): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}
