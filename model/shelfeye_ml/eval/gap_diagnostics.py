"""Why the gap detector misses what it misses, and where to set its threshold.

`model.val()` reports precision and recall at the max-F1 point on the curve.
That is the right default for a leaderboard and the wrong one here: this
project has already written down that a missed gap costs revenue and a false
alarm costs seconds, and max-F1 is precisely the operating point that pretends
those two cost the same.

So this tool does its own matching and reports three things val() cannot:

1.  THE CEILING. Recall as confidence goes to zero. If the model cannot reach
    0.90 even when every box it emits is accepted, no amount of threshold
    tuning will get there and the problem is upstream in the data.

2.  THE OPERATING POINT. The lowest confidence that still holds precision at
    the 0.85 floor, and the confidence needed for recall 0.90 — with the
    precision that costs. Feed the winner to GAP_CONF_THRESHOLD in serving.

3.  WHY EACH MISS HAPPENED, which is the part that decides what to do next:

      below_threshold   found, ranked, just not confident enough  -> tune conf
      localisation      found roughly, box disagrees at IoU 0.5   -> label noise
      misclassified     something else predicted in that spot     -> class confusion
      blind             nothing predicted there at all            -> real capability gap

    A miss profile dominated by `localisation` says the annotations disagree
    with each other, not that the model is weak — and re-labelling is then the
    only fix that raises the ceiling.

Inference only. Runs on a laptop.

    python -m shelfeye_ml.eval.gap_diagnostics \
        --weights artifacts/shelf-product-yolo26l-960/weights/best.pt \
        --data data/splits/holdout/data.yaml --split test --imgsz 960
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import yaml

from shelfeye_ml.eval.dataset_stats import (
    image_to_label,
    iter_split_images,
    read_boxes,
    size_bucket,
    wilson_interval,
)

ROOT = Path(__file__).resolve().parents[2]

GAP_CLASS_ID = 19
MATCH_IOU = 0.5            # the IoU that mAP@50 and the promotion gate use
NEAR_MISS_IOU = 0.2        # below this, nothing was predicted there in any sense
PRECISION_FLOOR = 0.85     # from the promotion gate
RECALL_TARGET = 0.90       # from the promotion gate
SCAN_CONF = 0.001          # collect everything, then threshold in post


def _iou_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """IoU between two sets of xyxy boxes -> (len(a), len(b))."""
    if len(a) == 0 or len(b) == 0:
        return np.zeros((len(a), len(b)), dtype=np.float32)
    lt = np.maximum(a[:, None, :2], b[None, :, :2])
    rb = np.minimum(a[:, None, 2:], b[None, :, 2:])
    wh = np.clip(rb - lt, 0, None)
    inter = wh[..., 0] * wh[..., 1]
    area_a = np.prod(np.clip(a[:, 2:] - a[:, :2], 0, None), axis=1)
    area_b = np.prod(np.clip(b[:, 2:] - b[:, :2], 0, None), axis=1)
    return inter / np.clip(area_a[:, None] + area_b[None, :] - inter, 1e-9, None)


def _gt_boxes(image: Path, width: int, height: int) -> tuple[np.ndarray, list[str]]:
    """Ground-truth gap boxes for one image, in original pixel coords."""
    boxes, buckets = [], []
    for cls, cx, cy, w, h in read_boxes(image_to_label(image)):
        if cls != GAP_CLASS_ID:
            continue
        boxes.append([(cx - w / 2) * width, (cy - h / 2) * height,
                      (cx + w / 2) * width, (cy + h / 2) * height])
        buckets.append(size_bucket(w, h, max(width, height)))
    return np.asarray(boxes, dtype=np.float32).reshape(-1, 4), buckets


def collect(weights: Path, data_yaml: Path, split: str, imgsz: int, device: str | None) -> dict:
    """Run the model over the split and match every gap prediction to ground truth."""
    from ultralytics import YOLO

    images = iter_split_images(data_yaml, split)
    model = YOLO(str(weights))

    scored: list[tuple[float, int]] = []   # (confidence, is_true_positive)
    gt_total = 0
    misses: list[dict] = []                # one row per ground-truth gap
    per_bucket: dict[str, dict[str, int]] = {}

    predict_kwargs = dict(conf=SCAN_CONF, iou=0.7, max_det=300, imgsz=imgsz,
                          verbose=False, stream=True)
    if device:
        predict_kwargs["device"] = device

    for image, result in zip(images, model.predict(source=[str(p) for p in images],
                                                   **predict_kwargs), strict=True):
        height, width = result.orig_shape
        gt, buckets = _gt_boxes(image, width, height)
        gt_total += len(gt)

        boxes = result.boxes
        all_xyxy = boxes.xyxy.cpu().numpy().astype(np.float32) if len(boxes) else np.zeros((0, 4), np.float32)
        all_cls = boxes.cls.cpu().numpy().astype(int) if len(boxes) else np.zeros((0,), int)
        all_conf = boxes.conf.cpu().numpy().astype(np.float32) if len(boxes) else np.zeros((0,), np.float32)

        is_gap = all_cls == GAP_CLASS_ID
        gap_xyxy, gap_conf = all_xyxy[is_gap], all_conf[is_gap]
        order = np.argsort(-gap_conf)
        gap_xyxy, gap_conf = gap_xyxy[order], gap_conf[order]

        # Greedy highest-confidence-first matching, exactly how mAP counts it.
        ious = _iou_matrix(gap_xyxy, gt)
        claimed = np.zeros(len(gt), dtype=bool)
        matched_conf = np.full(len(gt), -1.0, dtype=np.float32)
        for p in range(len(gap_xyxy)):
            candidates = np.where((ious[p] >= MATCH_IOU) & ~claimed)[0]
            if len(candidates):
                g = candidates[np.argmax(ious[p][candidates])]
                claimed[g] = True
                matched_conf[g] = gap_conf[p]
                scored.append((float(gap_conf[p]), 1))
            else:
                scored.append((float(gap_conf[p]), 0))

        # Why did each ground-truth gap go unclaimed at a usable confidence?
        other_xyxy = all_xyxy[~is_gap]
        other_cls = all_cls[~is_gap]
        other_ious = _iou_matrix(gt, other_xyxy) if len(other_xyxy) else np.zeros((len(gt), 0), np.float32)
        gap_ious_t = ious.T if ious.size else np.zeros((len(gt), 0), np.float32)

        for g in range(len(gt)):
            best_gap_iou = float(gap_ious_t[g].max()) if gap_ious_t.shape[1] else 0.0
            best_other_iou = float(other_ious[g].max()) if other_ious.shape[1] else 0.0
            best_other_cls = int(other_cls[int(other_ious[g].argmax())]) if other_ious.shape[1] else -1
            misses.append({
                "image": image.name,
                "bucket": buckets[g],
                "matched_conf": float(matched_conf[g]),   # -1 when never claimed
                "best_gap_iou": round(best_gap_iou, 3),
                "best_other_iou": round(best_other_iou, 3),
                "best_other_class": best_other_cls,
            })
            per_bucket.setdefault(buckets[g], {"n": 0})["n"] += 1

    return {"scored": scored, "gt_total": gt_total, "misses": misses, "buckets": per_bucket}


def curves(scored: list[tuple[float, int]], gt_total: int) -> dict:
    """Precision and recall as a function of the confidence threshold."""
    if not scored or gt_total == 0:
        return {"conf": [], "precision": [], "recall": []}
    arr = np.asarray(sorted(scored, key=lambda x: -x[0]), dtype=np.float64)
    conf, tp = arr[:, 0], arr[:, 1]
    tp_cum = np.cumsum(tp)
    fp_cum = np.cumsum(1 - tp)
    return {
        "conf": conf,
        "precision": tp_cum / np.clip(tp_cum + fp_cum, 1e-9, None),
        "recall": tp_cum / gt_total,
    }


def operating_points(curve: dict) -> dict:
    """The three thresholds worth arguing about."""
    conf, precision, recall = curve["conf"], curve["precision"], curve["recall"]
    if len(conf) == 0:
        return {}

    f1 = 2 * precision * recall / np.clip(precision + recall, 1e-9, None)

    def point(i: int) -> dict:
        return {"conf": round(float(conf[i]), 4),
                "precision": round(float(precision[i]), 4),
                "recall": round(float(recall[i]), 4),
                "f1": round(float(f1[i]), 4)}

    out = {
        "ceiling_recall": round(float(recall.max()), 4),
        "max_f1": point(int(np.argmax(f1))),
    }

    # Recall-first: the most recall available while precision still clears the
    # floor the gate sets. This is the operating point the business case asks
    # for, and the one to copy into GAP_CONF_THRESHOLD.
    ok = np.where(precision >= PRECISION_FLOOR)[0]
    out["recall_first_at_precision_floor"] = (
        point(int(ok[np.argmax(recall[ok])])) if len(ok) else None
    )

    # And what reaching the recall gate would actually cost in precision.
    hits = np.where(recall >= RECALL_TARGET)[0]
    out["at_recall_target"] = point(int(hits[0])) if len(hits) else None
    return out


def miss_profile(misses: list[dict], conf_threshold: float) -> dict:
    """Bucket every ground-truth gap by what happened to it at this threshold."""
    profile = {"detected": 0, "below_threshold": 0, "localisation": 0,
               "misclassified": 0, "blind": 0}
    by_bucket: dict[str, dict[str, int]] = {}
    examples: dict[str, list[str]] = {k: [] for k in profile if k != "detected"}

    for row in misses:
        bucket = by_bucket.setdefault(row["bucket"], dict.fromkeys(profile, 0))
        if row["matched_conf"] >= conf_threshold:
            kind = "detected"
        elif row["matched_conf"] >= 0:
            kind = "below_threshold"
        elif row["best_gap_iou"] >= NEAR_MISS_IOU:
            kind = "localisation"
        elif row["best_other_iou"] >= MATCH_IOU:
            kind = "misclassified"
        else:
            kind = "blind"
        profile[kind] += 1
        bucket[kind] += 1
        if kind != "detected" and len(examples[kind]) < 5:
            examples[kind].append(row["image"])

    total = max(sum(profile.values()), 1)
    return {
        "threshold": round(conf_threshold, 4),
        "counts": profile,
        "share": {k: round(v / total, 4) for k, v in profile.items()},
        "by_size": by_bucket,
        "examples": examples,
    }


def _print(report: dict) -> None:
    ops = report["operating_points"]
    n = report["gt_instances"]
    print(f"\n=== Empty Shelf diagnostics — {report['split']} @ imgsz {report['imgsz']} ===")
    print(f"{n} ground-truth gaps over {report['images']} images\n")

    ceiling = ops.get("ceiling_recall", 0.0)
    lo, hi = wilson_interval(ceiling, n)
    print(f"CEILING  recall at conf->0: {ceiling:.4f}  [95% CI {lo:.3f}-{hi:.3f}]")
    if ceiling < RECALL_TARGET:
        print(f"  ⛔ {RECALL_TARGET} is UNREACHABLE at any threshold. The model never")
        print("     emits a box for those gaps. Threshold tuning cannot fix this —")
        print("     the fix is upstream: labels, resolution, or augmentation.")
    else:
        print(f"  ✅ {RECALL_TARGET} is reachable — this is a threshold choice, not a rebuild.")

    print("\nOPERATING POINTS")
    for label, key in (("max-F1 (what val() reports)", "max_f1"),
                       (f"recall-first, P>={PRECISION_FLOOR}", "recall_first_at_precision_floor"),
                       (f"cheapest conf reaching R>={RECALL_TARGET}", "at_recall_target")):
        p = ops.get(key)
        if p is None:
            print(f"  {label:<34} unreachable")
        else:
            print(f"  {label:<34} conf {p['conf']:.3f}  P {p['precision']:.3f}  "
                  f"R {p['recall']:.3f}  F1 {p['f1']:.3f}")

    print(f"\nRECALL BY BOX SIZE (at conf {report['miss_profile']['threshold']})")
    for bucket, counts in sorted(report["miss_profile"]["by_size"].items()):
        total = sum(counts.values())
        print(f"  {bucket:<8} {counts['detected']:>4}/{total:<4} = "
              f"{counts['detected'] / max(total, 1):.3f}")

    print(f"\nMISS PROFILE (at conf {report['miss_profile']['threshold']})")
    for kind, count in report["miss_profile"]["counts"].items():
        share = report["miss_profile"]["share"][kind]
        print(f"  {kind:<16} {count:>4}  ({share:.1%})")
    print("\n  below_threshold -> lower GAP_CONF_THRESHOLD, free recall")
    print("  localisation    -> annotations disagree; re-label before retraining")
    print("  misclassified   -> class confusion; check what it predicted instead")
    print("  blind           -> genuine capability gap; more/better data or resolution")


def main() -> None:
    parser = argparse.ArgumentParser(description="Diagnose Empty Shelf recall.")
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--data", type=Path, default=ROOT / "data" / "data.yaml")
    parser.add_argument("--split", default="test", choices=["train", "val", "test"])
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--device", help="cuda index, 'mps' or 'cpu'; auto when omitted")
    parser.add_argument("--conf", type=float,
                        help="threshold for the miss profile; defaults to the "
                             "recall-first operating point")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    weights = args.weights if args.weights.is_absolute() else ROOT / args.weights
    data_yaml = args.data if args.data.is_absolute() else ROOT / args.data

    raw = collect(weights, data_yaml, args.split, args.imgsz, args.device)
    curve = curves(raw["scored"], raw["gt_total"])
    ops = operating_points(curve)

    chosen = args.conf
    if chosen is None:
        point = ops.get("recall_first_at_precision_floor") or ops.get("max_f1")
        chosen = point["conf"] if point else 0.25

    names = yaml.safe_load(data_yaml.read_text())["names"]
    report = {
        "weights": str(weights),
        "data": str(data_yaml),
        "split": args.split,
        "imgsz": args.imgsz,
        "images": len(iter_split_images(data_yaml, args.split)),
        "gt_instances": raw["gt_total"],
        "operating_points": ops,
        "miss_profile": miss_profile(raw["misses"], chosen),
        # Sampled so the file stays readable; the curve has one point per box.
        "pr_curve": [
            {"conf": round(float(c), 4), "precision": round(float(p), 4), "recall": round(float(r), 4)}
            for c, p, r in zip(curve["conf"][::max(len(curve["conf"]) // 200, 1)],
                               curve["precision"][::max(len(curve["conf"]) // 200, 1)],
                               curve["recall"][::max(len(curve["conf"]) // 200, 1)], strict=False)
        ],
    }
    misclassified_as = {}
    for row in raw["misses"]:
        if row["matched_conf"] < 0 and row["best_other_iou"] >= MATCH_IOU:
            key = names[row["best_other_class"]] if row["best_other_class"] >= 0 else "?"
            misclassified_as[key] = misclassified_as.get(key, 0) + 1
    report["misclassified_as"] = dict(sorted(misclassified_as.items(),
                                             key=lambda kv: -kv[1]))

    _print(report)
    out = args.out or weights.parent.parent / "gap_diagnostics.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nwritten: {out}")


if __name__ == "__main__":
    main()
