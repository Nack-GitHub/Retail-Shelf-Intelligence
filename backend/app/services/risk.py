"""Store risk scoring and distance — pure helpers, no I/O.

Risk drives the order of a rep's day. It is deliberately a STORE-level
property: nothing here takes a user into account, and nothing here may.
"""

from __future__ import annotations

import math

from app.domain.enums import RiskBand

EARTH_RADIUS_KM = 6371.0


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def risk_score(
    last_osa: float | None, days_since_last_visit: int | None, repeat_gap_skus: int
) -> float:
    """0..1, higher is more urgent.

    A store never visited is treated as high risk rather than unknown — the
    whole point of the route is to find out, and "no data" is not "fine".
    """
    osa_component = 1.0 - (last_osa if last_osa is not None else 0.5)
    staleness = min((days_since_last_visit if days_since_last_visit is not None else 30) / 30, 1.0)
    repeat_component = min(repeat_gap_skus / 10, 1.0)
    return round(0.55 * osa_component + 0.30 * staleness + 0.15 * repeat_component, 4)


def risk_band(score: float) -> RiskBand:
    if score >= 0.55:
        return RiskBand.HIGH
    if score >= 0.35:
        return RiskBand.MEDIUM
    return RiskBand.LOW
