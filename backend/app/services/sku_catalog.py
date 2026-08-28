"""Maps a gap's shelf position to the SKU that belongs there.

A planogram lookup in a real deployment. Here it reads `planogram.json`, a
build-time export of the products the model was trained to recognise — so the
name a rep is told to restock is a product that genuinely appears on these
shelves, rather than one invented for a different market entirely.

⚠️ This maps POSITION to SKU. It does not read the model's class names, and
the SKU codes are sequential rather than derived from class ids: nothing here
knows what was detected next to the gap. That is the boundary rule, and it is
also how a real planogram works — the shelf plan says what belongs in a slot,
whether or not anything is currently there to photograph.

Regenerate with `make planogram` after retraining on a different class list.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

PLANOGRAM_FILE = Path(__file__).with_name("planogram.json")


@lru_cache(maxsize=1)
def _catalog() -> tuple[tuple[str, str, str, int, int], ...]:
    raw = json.loads(PLANOGRAM_FILE.read_text())
    entries = tuple(
        (sku["code"], sku["name"], sku["brand"], int(sku["priority"]), int(sku["facings"]))
        for sku in raw["skus"]
    )
    if not entries:
        raise ValueError(f"{PLANOGRAM_FILE} lists no SKUs")
    return entries


def source() -> str:
    """Which dataset this planogram describes, for the model-health screen."""
    raw = json.loads(PLANOGRAM_FILE.read_text())
    return f"{raw['source_dataset']} v{raw['dataset_version']}"


def lookup(shelf_row_index: int, position_index: int) -> tuple[str, str, str, int, int]:
    """Returns (sku_code, sku_name, brand, priority, facings).

    The stride is coprime with nothing in particular; it exists so two gaps in
    the same row get different SKUs, which is what a shelf of distinct facings
    looks like.
    """
    catalog = _catalog()
    return catalog[(shelf_row_index * 7 + position_index) % len(catalog)]
