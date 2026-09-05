"""Turn k fold results into one number you can defend.

A single run's gap recall is a point estimate with two independent sources of
error stacked on top of each other: sampling error from a finite eval split,
and run-to-run error from initialisation, augmentation draws and which epoch
`patience` happened to stop on. Reporting one fold hides both.

The number this prints is mean +- SD across folds, and the SD is the part that
decides what to do next:

    SD < 0.02   the pipeline is stable. A config change that moves the mean by
                more than ~0.04 is real.
    SD 0.02-0.05  normal for a dataset this size. Only trust differences larger
                than 2*SD, and stop tuning knobs that move the mean by less.
    SD > 0.05   the folds disagree more than most config changes will. That is
                a property of the DATA, not of the model — different slices of
                these annotations are teaching different things. Chasing
                hyperparameters here is chasing noise; go fix the labels.

    python -m shelfeye_ml.eval.aggregate_folds --run shelf-product-yolo26l-640-recall
"""

from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path

from shelfeye_ml.eval.dataset_stats import wilson_interval

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "artifacts"

# Mirrors the promotion gate in shelfeye_ml.eval.evaluate.
RECALL_TARGET = 0.90
PRECISION_FLOOR = 0.85

# Above this, fold-to-fold disagreement swamps anything a config change will do.
UNSTABLE_SD = 0.05


def load_folds(run: str, folds: int) -> list[dict]:
    out = []
    for k in range(folds):
        metrics = ARTIFACTS / f"{run}-fold{k}" / "metrics.json"
        if not metrics.exists():
            raise SystemExit(
                f"{metrics} not found — fold {k} has not been evaluated yet.\n"
                f"Run: python -m shelfeye_ml.eval.evaluate --weights "
                f"artifacts/{run}-fold{k}/weights/best.pt --split test "
                f"--data data/splits/kfold/fold{k}/data.yaml"
            )
        out.append(json.loads(metrics.read_text(encoding="utf-8")))
    return out


def summarise(values: list[float]) -> dict:
    return {
        "mean": round(statistics.fmean(values), 4),
        # Sample SD: these folds are a sample of the runs we could have done.
        "sd": round(statistics.stdev(values), 4) if len(values) > 1 else 0.0,
        "min": round(min(values), 4),
        "max": round(max(values), 4),
    }


def aggregate(run: str, folds: int) -> dict:
    results = load_folds(run, folds)

    recall = [r["gap_class"]["recall"] for r in results]
    precision = [r["gap_class"]["precision"] for r in results]
    map50 = [r["gap_class"]["map50"] for r in results]
    overall = [r["overall"]["map50"] for r in results]
    instances = [r["gap_class"]["instances"] for r in results]

    # Pooling the folds treats them as one large evaluation. Legitimate here
    # because every fold scores the SAME held-out test split, so the instances
    # are the same instances seen by k differently-trained models — the pooled
    # interval describes the pipeline, not any one model.
    pooled_n = sum(instances)
    pooled_recall = sum(r * n for r, n in zip(recall, instances, strict=True)) / max(pooled_n, 1)
    lo, hi = wilson_interval(pooled_recall, pooled_n)

    stats = {
        "run": run,
        "folds": folds,
        "gap_recall": summarise(recall),
        "gap_precision": summarise(precision),
        "gap_map50": summarise(map50),
        "overall_map50": summarise(overall),
        "pooled": {
            "recall": round(pooled_recall, 4),
            "instances": pooled_n,
            "recall_ci95": [round(lo, 4), round(hi, 4)],
        },
        "per_fold": [
            {"fold": k, "recall": recall[k], "precision": precision[k],
             "map50": map50[k], "instances": instances[k]}
            for k in range(folds)
        ],
    }
    stats["gate"] = {
        # Same rule as the single-run gate: the lower bound has to clear the
        # bar, not the average.
        "recall_passed": lo >= RECALL_TARGET,
        "precision_passed": statistics.fmean(precision) >= PRECISION_FLOOR,
        "stable": stats["gap_recall"]["sd"] <= UNSTABLE_SD,
    }
    return stats


def print_report(stats: dict) -> None:
    print(f"\n=== {stats['run']} — {stats['folds']}-fold cross-validation ===\n")
    print(f"  {'fold':<6}{'recall':>9}{'precision':>11}{'mAP@50':>9}{'n':>7}")
    for row in stats["per_fold"]:
        print(f"  {row['fold']:<6}{row['recall']:>9.4f}{row['precision']:>11.4f}"
              f"{row['map50']:>9.4f}{row['instances']:>7}")

    gap = stats["gap_recall"]
    print(f"\n  Empty Shelf recall   {gap['mean']:.4f} +- {gap['sd']:.4f} "
          f"(min {gap['min']:.4f}, max {gap['max']:.4f})")
    prec = stats["gap_precision"]
    print(f"  Empty Shelf precision {prec['mean']:.4f} +- {prec['sd']:.4f}")

    pooled = stats["pooled"]
    ci = pooled["recall_ci95"]
    print(f"\n  pooled recall {pooled['recall']:.4f} "
          f"[95% CI {ci[0]:.3f}-{ci[1]:.3f}, n={pooled['instances']}]")

    gate = stats["gate"]
    print(f"\n  [{'PASS' if gate['recall_passed'] else 'FAIL'}] recall    "
          f"lower bound {ci[0]:.3f} vs >= {RECALL_TARGET}")
    print(f"  [{'PASS' if gate['precision_passed'] else 'FAIL'}] precision "
          f"mean {prec['mean']:.3f} vs >= {PRECISION_FLOOR}")

    sd = gap["sd"]
    print()
    if sd > UNSTABLE_SD:
        print(f"  ⛔ SD {sd:.4f} > {UNSTABLE_SD}: the folds disagree more than a config")
        print("     change is likely to move the mean. Different slices of these")
        print("     annotations teach different things — that is a label problem.")
        print("     Tuning hyperparameters against this is tuning against noise.")
    elif sd > 0.02:
        print(f"  ⚠️  SD {sd:.4f}: normal for a dataset this size. Only believe a")
        print(f"     config difference larger than {2 * sd:.3f}.")
    else:
        print(f"  ✅ SD {sd:.4f}: pipeline is stable, small differences are readable.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Aggregate k-fold results.")
    parser.add_argument("--run", required=True,
                        help="run_name from the config, WITHOUT the -foldN suffix")
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    stats = aggregate(args.run, args.folds)
    print_report(stats)

    out = args.out or ARTIFACTS / f"{args.run}-cv.json"
    out.write_text(json.dumps(stats, indent=2), encoding="utf-8")
    print(f"\nwritten: {out}")


if __name__ == "__main__":
    main()
