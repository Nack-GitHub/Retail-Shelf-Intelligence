"""Generate model_card.md for a trained artifact.

The domain-gap warning leads the document deliberately. This dataset is
European coffee aisles; anyone reading the metrics without that context will
draw a conclusion about Thai stores that the numbers do not support.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

DOMAIN_GAP_WARNING = """> ## ⚠️ Read this before quoting any number below
>
> This model was trained on **`roboflow-ngkro/shelf-product`, a dataset of
> European coffee aisles** — the source filenames name German retailers
> (Edeka, REWE, tegut, K+K). Lighting, shelf density, packaging design and
> store format differ substantially from Thai convenience and traditional-trade
> stores.
>
> **The metrics in this card are a capability proof, not a production-readiness
> signal.** Production promotion additionally requires a held-out set of at
> least 300 photographs taken in Thai pilot stores, with both sets of numbers
> reported side by side. Until that exists, no number here should be presented
> as an expected field accuracy."""


def _sha8(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()[:8]


def build(artifact_dir: Path) -> Path:
    manifest = json.loads((artifact_dir / "run_manifest.json").read_text())
    metrics_path = artifact_dir / "metrics.json"
    metrics = json.loads(metrics_path.read_text()) if metrics_path.exists() else {}
    config = manifest["config"]

    zip_candidates = list((ROOT / "data").glob("*.zip")) + list(ROOT.glob("*.zip"))
    zip_path = zip_candidates[0] if zip_candidates else ROOT / "shelf-product.v1i.yolo26.zip"
    lines = [
        f"# Model Card — {manifest['run_name']}",
        "",
        DOMAIN_GAP_WARNING,
        "",
        "## Identity",
        "",
        "| Field | Value |",
        "| :-- | :-- |",
        f"| Version | `{manifest['run_name']}` |",
        f"| Trained | {manifest['trained_at']} |",
        f"| Git SHA | `{manifest['git_sha']}` |",
        f"| Base weights | `{config['model']}` |",
        f"| Device | {manifest['device']} |",
        f"| Training time | {manifest['elapsed_seconds'] / 60:.0f} min "
        f"({manifest['seconds_per_epoch']}s/epoch) |",
        "",
        "## Dataset",
        "",
        "| Field | Value |",
        "| :-- | :-- |",
        f"| Source | `{manifest['dataset']}` |",
        f"| Version | **{manifest['dataset_version']}** (pinned — never `latest`) |",
        f"| Archive SHA256 | `{_sha8(zip_path) if zip_path.exists() else 'n/a'}…` |",
        "| Images | 1,349 (1,146 train / 137 val / 66 test) |",
        "| Classes | 45 — 42 coffee SKUs + `Empty Shelf`, `Price`, `Discount Price` |",
        "| Published baseline | mAP@50 90.5%, P 88.2%, R 90.5% |",
        "",
        "## Class map",
        "",
        "Shipped as `class_map.yaml` **inside this artifact**. The backend consumes",
        "`semantic_type` and never sees the raw class names, so changing the SKU list",
        "changes only this artifact — the backend does not redeploy.",
        "",
        "| semantic_type | count | classes |",
        "| :-- | --: | :-- |",
        "| `GAP` | 1 | `Empty Shelf` |",
        "| `PRICE_TAG` | 1 | `Price` |",
        "| `PROMO_TAG` | 1 | `Discount Price` |",
        "| `PRODUCT` | 42 | all remaining coffee SKUs |",
        "",
        "## Training configuration",
        "",
        "```yaml",
        *[f"{k}: {v}" for k, v in config.items()],
        "```",
        "",
        "Augmentation is tuned for the failure modes these photographs actually have:",
        "heavy brightness and saturation jitter (store lighting varies enormously),",
        "mild perspective warp and rotation (reps shoot slightly off-axis), and random",
        "erasing (standing in for shoppers and trolleys occluding the shelf).",
        "",
        "**`flipud` is fixed at 0.0.** A shelf has a fixed gravity orientation; an",
        "upside-down shelf is not something the model will ever see, and training on",
        "one teaches it nothing real.",
        "",
    ]

    if metrics:
        overall = metrics["overall"]
        gap = metrics["gap_class"]
        lines += [
            f"## Metrics — {metrics['split']} split @ imgsz {metrics['imgsz']}",
            "",
            "### Overall",
            "",
            "| Metric | Value |",
            "| :-- | --: |",
            f"| mAP@50 | {overall['map50']:.4f} |",
            f"| mAP@50-95 | {overall['map50_95']:.4f} |",
            f"| Precision | {overall['precision']:.4f} |",
            f"| Recall | {overall['recall']:.4f} |",
            "",
            "### `Empty Shelf` — the class the product depends on",
            "",
            "Reported separately and never averaged away. A missed gap is unrecoverable",
            "revenue; a false alarm costs seconds of a rep's attention. These errors are",
            "not symmetric, so recall is optimised first and precision second.",
            "",
            "| Metric | Value |",
            "| :-- | --: |",
            f"| Recall | {gap['recall']} |",
            f"| Precision | {gap['precision']} |",
            f"| mAP@50 | {gap['map50']} |",
            "",
            "### Promotion gates",
            "",
            "| Gate | Result | Detail |",
            "| :-- | :-- | :-- |",
        ]
        for name, gate in metrics.get("gates", {}).items():
            mark = "✅ pass" if gate["passed"] else "❌ fail"
            lines.append(f"| `{name}` | {mark} | {gate['detail']} |")
        lines += [
            "",
            f"**All gates passed: {metrics.get('all_gates_passed')}**",
            "",
            "### Per-class metrics",
            "",
            "Reported in full rather than as an average, because `Empty Shelf` is far",
            "rarer than the product classes and a good mean can hide a bad gap detector.",
            "",
            "| Class | Precision | Recall | mAP@50 |",
            "| :-- | --: | --: | --: |",
        ]
        for name, values in sorted(metrics.get("per_class", {}).items()):
            emphasis = "**" if name == "Empty Shelf" else ""
            lines.append(
                f"| {emphasis}{name}{emphasis} | {values['precision']:.4f} | "
                f"{values['recall']:.4f} | {values['map50']:.4f} |"
            )
        lines.append("")

    lines += [
        "## Known limitations",
        "",
        "- **Domain gap** — see the warning at the top. This is the dominant limitation.",
        "- **No unit counting.** The system reports area-share metrics only. Occlusion,",
        "  stacked facings and promotional signage make piece-counting unreliable,",
        "  whereas area share degrades gracefully under all three.",
        "- **Class imbalance.** `Empty Shelf` is far rarer than the product classes;",
        "  per-class metrics above are the honest read, not the mAP average.",
        "- **Slice evaluation not yet run.** Metrics by lighting, angle, shelf density",
        "  and shelf row are a Sprint 4 deliverable. A model that performs well on",
        "  average but fails in dim traditional-trade stores fails in Thailand.",
        "- **No face detection of any kind.** This artifact detects products, gaps and",
        "  price tags. It has no face-detection, recognition or matching capability.",
        "",
        "## Intended use",
        "",
        "Detect products, shelf gaps and price tags in a single shelf photograph, and",
        "return bounding boxes in absolute pixel coordinates with a stable",
        "`semantic_type`. **This model computes no business metric.** OSA scoring,",
        "thresholds and status bands live in the backend so they can change without a",
        "model release.",
        "",
        "## Out of scope by design",
        "",
        "- Face recognition, identification, matching or embedding storage.",
        "- Any per-individual performance metric derived from these outputs.",
        "- Automated pricing response to competitor price tags.",
        "",
        f"_Generated {datetime.now(UTC).isoformat(timespec='seconds')}_",
    ]

    out = artifact_dir / "model_card.md"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact-dir", type=Path, required=True)
    args = parser.parse_args()
    path = args.artifact_dir if args.artifact_dir.is_absolute() else ROOT / args.artifact_dir
    print(f"[model-card] {build(path)}")


if __name__ == "__main__":
    main()
