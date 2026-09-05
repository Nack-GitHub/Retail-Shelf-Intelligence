"""Evaluation and the promotion gate.

The gate thresholds encode one asymmetry that matters more than anything else
in this project:

    A MISSED GAP is lost revenue that can never be recovered — the rep has
    already walked away. A FALSE ALARM costs a few seconds of their attention.

These errors are not symmetric, so the operating point is chosen for recall on
`Empty Shelf` first, then precision is maximised subject to that. Precision
still has a floor, because below it reps stop trusting the alerts within weeks
and adoption collapses, which destroys the project's value just as thoroughly.

A gate passes on the LOWER BOUND of the 95% interval, not on the point
estimate. The Roboflow test split holds 124 gap instances, and a recall of
exactly 0.90 measured over 124 instances has a 95% interval of [0.835, 0.941]
— it is consistent with the true value being 0.84. Promoting on the point
estimate promotes coin flips. Widen the split (see shelfeye_ml.training.resplit)
until the interval is narrower than the improvement you care about.

In this demo build the gate REPORTS rather than blocks; wiring it into CI as a
hard gate is the Sprint 4 task.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import yaml

from shelfeye_ml.eval.dataset_stats import count_instances, wilson_interval

ROOT = Path(__file__).resolve().parents[2]
DATA_YAML = ROOT / "data" / "data.yaml"

GAP_CLASS_NAME = "Empty Shelf"

# Below this many ground-truth instances a per-class recall is not a
# measurement, it is an anecdote. Reported, but flagged and never gated on.
MIN_INSTANCES_FOR_A_VERDICT = 20


@dataclass(frozen=True, slots=True)
class Gate:
    name: str
    threshold: float
    rationale: str

    def check(self, value: float | None, n: int | None = None) -> tuple[bool, str]:
        if value is None:
            return False, "not measured"
        if not n:
            return value >= self.threshold, f"{value:.4f} vs >= {self.threshold}"
        lo, hi = wilson_interval(value, n)
        return lo >= self.threshold, (
            f"{value:.4f} [95% CI {lo:.3f}-{hi:.3f}, n={n}] vs >= {self.threshold}"
        )


GATES = [
    Gate("recall_empty_shelf", 0.90,
         "A missed gap is unrecoverable revenue; the rep has already left."),
    Gate("precision_empty_shelf", 0.85,
         "Below this, reps stop trusting alerts and adoption collapses."),
    Gate("map50_overall", 0.85, "Overall detection quality."),
]


def evaluate(weights: Path, split: str = "test", imgsz: int = 640,
             data_yaml: Path = DATA_YAML) -> dict:
    from ultralytics import YOLO

    model = YOLO(str(weights))
    metrics = model.val(data=str(data_yaml), split=split, imgsz=imgsz, verbose=False)

    names = yaml.safe_load(data_yaml.read_text())["names"]
    instances = count_instances(data_yaml, split)
    per_class: dict[str, dict[str, float]] = {}

    # ap_class_index maps each row of the per-class arrays back to a class id.
    for row, class_id in enumerate(metrics.box.ap_class_index):
        class_id = int(class_id)
        n = instances.get(class_id, 0)
        recall = float(metrics.box.r[row])
        lo, hi = wilson_interval(recall, n)
        per_class[names[class_id]] = {
            "precision": round(float(metrics.box.p[row]), 4),
            "recall": round(recall, 4),
            "recall_ci95": [round(lo, 4), round(hi, 4)],
            "map50": round(float(metrics.box.ap50[row]), 4),
            "instances": n,
            # Ranking runs against classes flagged here would be ranking noise.
            "insufficient_data": n < MIN_INSTANCES_FOR_A_VERDICT,
        }

    gap = per_class.get(GAP_CLASS_NAME, {})
    gap_n = gap.get("instances", 0)
    summary = {
        "split": split,
        "imgsz": imgsz,
        "data": str(data_yaml),
        "weights": str(weights),
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
            "recall_ci95": gap.get("recall_ci95"),
            "map50": gap.get("map50"),
            "instances": gap_n,
        },
        "classes_with_insufficient_data": sorted(
            name for name, c in per_class.items() if c["insufficient_data"]
        ),
        "per_class": per_class,
    }

    measured = {
        "recall_empty_shelf": (gap.get("recall"), gap_n),
        "precision_empty_shelf": (gap.get("precision"), gap_n),
        # mAP is an area under a curve, not a proportion over n trials — a
        # Wilson interval would be meaningless, so this one gates on the point.
        "map50_overall": (summary["overall"]["map50"], None),
    }
    summary["gates"] = {
        gate.name: {
            "passed": (result := gate.check(*measured[gate.name]))[0],
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
    print(f"data: {summary['data']}")
    print(f"mAP@50 {overall['map50']:.4f}   mAP@50-95 {overall['map50_95']:.4f}   "
          f"P {overall['precision']:.4f}   R {overall['recall']:.4f}")

    gap = summary["gap_class"]
    ci = gap.get("recall_ci95") or [float("nan"), float("nan")]
    print(f"\n{gap['name']} (the class that matters), n={gap['instances']}:")
    print(f"  recall    {gap['recall']}  [95% CI {ci[0]:.3f}-{ci[1]:.3f}]   <- optimise this first")
    print(f"  precision {gap['precision']}")
    print(f"  mAP@50    {gap['map50']}")

    thin = summary["classes_with_insufficient_data"]
    if thin:
        print(f"\n⚠️  {len(thin)} class(es) with < {MIN_INSTANCES_FOR_A_VERDICT} instances — "
              f"their recall is noise, and it is dragging the overall mean:")
        print(f"   {', '.join(thin)}")

    print("\nPromotion gates (pass = lower bound of the 95% interval clears the bar):")
    for name, gate in summary["gates"].items():
        print(f"  [{'PASS' if gate['passed'] else 'FAIL'}] {name:<26} {gate['detail']}")
    print(f"\nall gates passed: {summary['all_gates_passed']}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--split", default="test", choices=["train", "val", "test"])
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--data", type=Path, default=DATA_YAML,
                        help="dataset yaml, e.g. data/splits/holdout/data.yaml")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    weights = args.weights if args.weights.is_absolute() else ROOT / args.weights
    data_yaml = args.data if args.data.is_absolute() else ROOT / args.data
    summary = evaluate(weights, args.split, args.imgsz, data_yaml)
    print_report(summary)

    out = args.out or weights.parent.parent / "metrics.json"
    out.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"\nwritten: {out}")


if __name__ == "__main__":
    main()
