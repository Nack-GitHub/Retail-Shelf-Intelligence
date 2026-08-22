"""Maps a gap's shelf position to the SKU that belongs there.

A planogram lookup in a real deployment. Here it is a deterministic stand-in
so findings and tasks carry a product name a rep can act on — "ชั้นที่ 2 ·
ตำแหน่งซ้าย" alone does not tell them what to put back.

⚠️ This maps POSITION to SKU. It does not read the model's class names: the
backend must never branch on those, and a demo planogram keeps that honest.
"""

from __future__ import annotations

CATALOG = [
    ("SKU-1001", "อเมริกาโน่ กระป๋อง 180ml", "Birdy", 1, 3),
    ("SKU-1002", "ลาเต้ กระป๋อง 180ml", "Birdy", 1, 2),
    ("SKU-2001", "เอสเปรสโซ่ ขวด 220ml", "Nescafé", 2, 2),
    ("SKU-2002", "มอคค่า ขวด 220ml", "Nescafé", 2, 3),
    ("SKU-3001", "กาแฟคั่วบด ถุง 200g", "Doi Chaang", 3, 1),
    ("SKU-3002", "กาแฟ 3in1 กล่อง 27 ซอง", "Moccona", 3, 2),
]


def lookup(shelf_row_index: int, position_index: int) -> tuple[str, str, str, int, int]:
    """Returns (sku_code, sku_name, brand, priority, facings)."""
    slot = (shelf_row_index * 7 + position_index) % len(CATALOG)
    return CATALOG[slot]
