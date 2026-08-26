"""Evaluation and the promotion gate.

The gate thresholds encode one asymmetry that matters more than anything else
in this project:

    A MISSED GAP is lost revenue that can never be recovered — the rep has
    already walked away. A FALSE ALARM costs a few seconds of their attention.

These errors are not symmetric, so the operating point is chosen for recall on
`Empty Shelf` first, then precision is maximised subject to that. Precision
still has a floor, because below it reps stop trusting the alerts within weeks
and adoption collapses, which destroys the project's value just as thoroughly.

In this demo build the gate REPORTS rather than blocks; wiring it into CI as a
hard gate is the Sprint 4 task.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
DATA_YAML = ROOT / "data" / "data.yaml"

GAP_CLASS_NAME = "Empty Shelf"


@dataclass(frozen=True, slots=True)
class Gate:
    name: str
    threshold: float
    rationale: str

    def check(self, value: float | None) -> tuple[bool, str]:
        if value is None:
            return False, "not measured"
        return value >= self.threshold, f"{value:.4f} vs >= {self.threshold}"


GATES = [
    Gate("recall_empty_shelf", 0.90,
         "A missed gap is unrecoverable revenue; the rep has already left."),
    Gate("precision_empty_shelf", 0.85,
         "Below this, reps stop trusting alerts and adoption collapses."),
    Gate("map50_overall", 0.85, "Overall detection quality."),
]


def evaluate(weights: Path, split: str = "test", imgsz: int = 640) -> dict:
    from ultralytics import YOLO

    model = YOLO(str(weights))
    metrics = model.val(data=str(DATA_YAML), split=split, imgsz=imgsz, verbose=False)

    names = yaml.safe_load(DATA_YAML.read_text())["names"]
    per_class: dict[str, dict[str, float]] = {}

    # ap_class_index maps each row of the per-class arrays back to a class id.
    for row, class_id in enumerate(metrics.box.ap_class_index):
        per_class[names[int(class_id)]] = {
            "precision": round(float(metrics.box.p[row]), 4),
            "recall": round(float(metrics.box.r[row]), 4),
            "map50": round(float(metrics.box.ap50[row]), 4),
        }

    gap = per_class.get(GAP_CLASS_NAME, {})
    summary = {
        "split": split,
        "imgsz": imgsz,
        "overall": {
            "map50": round(float(metrics.box.map50), 4),
            "map50_95": round(float(metrics.box.map), 4),
            "precision": round(float(metrics.box.mp), 4),
            "recall": round(float(metrics.box.mr), 4),
        },
        "gap_class": {
            "name": GAP_CLASS_NAME,
            "precision": gap.get("precision"),
            "recall": gap.get("recall"),
            "map50": gap.get("map50"),
        },
        "per_class": per_class,
    }

    measured = {
        "recall_empty_shelf": gap.get("recall"),
        "precision_empty_shelf": gap.get("precision"),
        "map50_overall": summary["overall"]["map50"],
    }
    summary["gates"] = {
        gate.name: {
            "passed": (result := gate.check(measured[gate.name]))[0],
            "detail": result[1],
            "rationale": gate.rationale,
        }
        for gate in GATES
    }
    summary["all_gates_passed"] = all(g["passed"] for g in summary["gates"].values())
    return summary


def print_report(summary: dict) -> None:
    overall = summary["overall"]
    print(f"\n=== {summary['split']} split @ imgsz {summary['imgsz']} ===")
    print(f"mAP@50 {overall['map50']:.4f}   mAP@50-95 {overall['map50_95']:.4f}   "
          f"P {overall['precision']:.4f}   R {overall['recall']:.4f}")

    gap = summary["gap_class"]
    print(f"\n{gap['name']} (the class that matters):")
    print(f"  recall    {gap['recall']}   <- optimise this first")
    print(f"  precision {gap['precision']}")
    print(f"  mAP@50    {gap['map50']}")

    print("\nPromotion gates:")
    for name, gate in summary["gates"].items():
        print(f"  [{'PASS' if gate['passed'] else 'FAIL'}] {name:<26} {gate['detail']}")
    print(f"\nall gates passed: {summary['all_gates_passed']}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--split", default="test", choices=["train", "val", "test"])
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    weights = args.weights if args.weights.is_absolute() else ROOT / args.weights
    summary = evaluate(weights, args.split, args.imgsz)
    print_report(summary)

    out = args.out or weights.parent.parent / "metrics.json"
    out.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"\nwritten: {out}")


if __name__ == "__main__":
    main()
