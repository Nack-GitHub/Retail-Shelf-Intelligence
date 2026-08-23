"""The "how is this store doing" query, in one place.

Three routers need the same three facts about a set of stores — latest OSA,
days since the last visit, repeat gap SKUs — and each was computing them with
its own pair of aggregate queries. Three copies of a risk query is three
chances for the route screen and the manager's ranking to disagree about which
store is worst, which is exactly the kind of contradiction that ends a demo.

⛔ Every aggregation here is by STORE. Nothing in this module may group by,
filter on, or return a user id.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Capture, GapFindingRow, ShelfAnalysisRow, Visit
from app.services.risk import risk_band, risk_score


@dataclass(frozen=True)
class StoreRisk:
    """`None` means never measured — which is not the same as zero."""

    last_osa: float | None
    days_since_last_visit: int | None
    repeat_gap_skus: int
    score: float
    band: str


NEVER_MEASURED = StoreRisk(
    last_osa=None,
    days_since_last_visit=None,
    repeat_gap_skus=0,
    score=risk_score(None, None, 0),
    band=risk_band(risk_score(None, None, 0)).value,
)


async def load(db: AsyncSession, store_ids: list[UUID] | None = None) -> dict[UUID, StoreRisk]:
    """Risk facts per store, in three aggregate queries rather than one per store.

    Stores with no history are simply absent from the result; callers fall back
    to `NEVER_MEASURED`, which scores high on purpose — the point of the route
    is to find out, and "no data" is not "fine".
    """
    scope = store_ids if store_ids else None

    # The LATEST analysis, not the best one. MAX(osa_score) answers "how good
    # has this shelf ever looked", which is 1.0 for any store that was ever
    # fully stocked — so every store reads 100% and the risk ranking flattens
    # to nothing. DISTINCT ON takes the first row per store under the ORDER BY,
    # which is the most recent computation.
    osa_query = (
        select(Visit.store_id, ShelfAnalysisRow.osa_score)
        .join(Capture, Capture.visit_id == Visit.id)
        .join(ShelfAnalysisRow, ShelfAnalysisRow.capture_id == Capture.id)
        .distinct(Visit.store_id)
        .order_by(Visit.store_id, ShelfAnalysisRow.computed_at.desc())
    )
    visit_query = select(Visit.store_id, func.max(Visit.checked_in_at)).group_by(Visit.store_id)

    # A SKU found missing on more than one visit is a shelf the store is not
    # keeping stocked, not a one-off — it weighs into the score separately.
    repeat_query = (
        select(
            Visit.store_id,
            func.count(func.distinct(GapFindingRow.sku_code)),
        )
        .join(Capture, Capture.visit_id == Visit.id)
        .join(GapFindingRow, GapFindingRow.capture_id == Capture.id)
        .where(GapFindingRow.verification_status == "CONFIRMED")
        .group_by(Visit.store_id)
    )

    if scope:
        osa_query = osa_query.where(Visit.store_id.in_(scope))
        visit_query = visit_query.where(Visit.store_id.in_(scope))
        repeat_query = repeat_query.where(Visit.store_id.in_(scope))

    last_osa = dict((await db.execute(osa_query)).all())
    last_seen = dict((await db.execute(visit_query)).all())
    repeats = dict((await db.execute(repeat_query)).all())

    now = datetime.now(UTC)
    facts: dict[UUID, StoreRisk] = {}
    for store_id in set(last_osa) | set(last_seen) | set(repeats):
        seen_at = last_seen.get(store_id)
        days = (now - seen_at).days if seen_at else None
        osa = last_osa.get(store_id)
        repeat = repeats.get(store_id, 0)
        score = risk_score(osa, days, repeat)
        facts[store_id] = StoreRisk(
            last_osa=round(osa, 4) if osa is not None else None,
            days_since_last_visit=days,
            repeat_gap_skus=repeat,
            score=score,
            band=risk_band(score).value,
        )
    return facts


def for_store(facts: dict[UUID, StoreRisk], store_id: UUID) -> StoreRisk:
    return facts.get(store_id, NEVER_MEASURED)
