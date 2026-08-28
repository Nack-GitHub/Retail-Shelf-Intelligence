import { request, toPercent } from "@/lib/api/client";
import type { ShelfCategory } from "@/types";

interface CategoryWire {
  id: string;
  name: string;
  bays: string[];
  skuCount: number;
  /** ratio 0..1, or null when this store has never had this shelf analysed */
  lastOsa: number | null;
  supported: boolean;
}

/** The shelves a rep can choose to photograph at this store.
 *
 *  Store-scoped on purpose: the OSA on each card is this store's own last
 *  measurement, not a chain average. */
export async function fetchCategories(storeId: string): Promise<ShelfCategory[]> {
  const wire = await request<CategoryWire[]>(
    `/v1/categories?storeId=${encodeURIComponent(storeId)}`,
  );
  return wire.map((c) => ({ ...c, lastOsa: toPercent(c.lastOsa) }));
}
