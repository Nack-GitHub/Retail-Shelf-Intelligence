"""The OSA status thresholds must mean the same thing on both sides of the wire.

The web app draws its own status pills, so it carries a copy of the two
thresholds that decide OK / LOW / CRITICAL. A copy is only safe while something
notices when it stops matching: the frontend's copy sat at 70 while this
config said 75 for long enough that one shelf could read CRITICAL on the
result screen and LOW on the check-out screen of the same visit.

This test reads the frontend module and fails the moment the two disagree.
It runs with no services and no network.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.core.config import settings

OSA_MODULE = Path(__file__).resolve().parents[3] / "frontend" / "src" / "lib" / "osa.ts"


def _threshold(source: str, name: str) -> float:
    """The percentage the frontend uses for `name`, as a 0..1 ratio.

    Read out of the OSA_THRESHOLDS declaration specifically: `critical` is an
    ordinary enough word that a looser search would happily pick up a tone map
    or a comment somewhere else in the file and compare the wrong number.
    """
    block = re.search(r"OSA_THRESHOLDS\s*=\s*\{(.*?)\}", source, re.DOTALL)
    assert block is not None, (
        f"{OSA_MODULE} no longer declares OSA_THRESHOLDS. It is the frontend's "
        "only copy of the OSA bands — keep it, or this contract cannot be checked."
    )

    match = re.search(rf"\b{name}\s*:\s*([0-9]+(?:\.[0-9]+)?)", block.group(1))
    assert match is not None, (
        f"OSA_THRESHOLDS in {OSA_MODULE} no longer declares `{name}`."
    )
    return float(match.group(1)) / 100


@pytest.fixture(scope="module")
def frontend_source() -> str:
    if not OSA_MODULE.exists():
        pytest.fail(
            f"expected the frontend OSA thresholds at {OSA_MODULE}. "
            "Every screen that colours an OSA figure reads them from there; "
            "if the module moved, point this test at its new home."
        )
    return OSA_MODULE.read_text(encoding="utf-8")


@pytest.mark.parametrize("name", ["critical", "low"])
def test_frontend_mirrors_the_backend_thresholds(frontend_source: str, name: str) -> None:
    frontend = _threshold(frontend_source, name)
    backend = getattr(settings, f"{name}_threshold")

    assert frontend == pytest.approx(backend), (
        f"the OSA `{name}` threshold disagrees: "
        f"{OSA_MODULE.name} says {frontend * 100:g}%, "
        f"backend/app/core/config.py says {backend * 100:g}%. "
        "The backend decides; update the frontend copy to match."
    )
