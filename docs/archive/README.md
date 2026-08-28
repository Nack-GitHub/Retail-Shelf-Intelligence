# Archive

Planning documents for work that is **finished**, one directory per round of
work. They are kept because they record *why* the system is shaped the way it
is — decisions the code itself cannot explain — not because anything here is
still an open task.

Each round holds the same three documents: the specification it was delivered
against, the implementation plan, and the task list with its acceptance
criteria.

## Rounds, oldest first

### [backend-and-ml/](backend-and-ml/) — the two services

The FastAPI backend and the ML training/inference pipeline, joined only by
`contracts/`. 18 tasks.

Still the reference for the inference contract, the append-only rules on
`detections` and `shelf_analyses`, and the three standing prohibitions. Also
records the promotion gates the trained model **fails** — it still fails them:
`shelf-product-yolo26l-960` passes mAP@0.5 and misses recall and precision on
the gap class. `ML_CLIENT` is nevertheless `http`, decided 2026-08-28, because
`mock` picks its detections from the filename and cannot be tested against.
See [uat.md](../uat.md) for what that means for anyone testing.

### [frontend-integration/](frontend-integration/) — connecting the app to the API

Replacing `lib/mock/` with real HTTP calls, and the 7 endpoints that turned
out to be missing. 17 tasks, plus two rounds of review.

Worth reading for the decisions that shaped the data layer: one client module
owns the base URL and the token, the ratio→percent conversion happens once per
resource at the boundary, and **a card with no query behind it is omitted
rather than estimated** — which is why there is no cost KPI, no drift chart,
and no SKU×day heatmap.

The `todo.md` also lists what the two review rounds found. The instructive
ones are the failures that were invisible to a per-file check: identity that
was reachable only by *composing* two endpoints that were each clean on their
own, and an offline message that promised storage for operations that never
queued.

---

**Still live, not archived:**

| | |
| :-- | :-- |
| [README.md](../../README.md) | Entry point |
| [running.md](../running.md) | How to run everything |
| [contracts/inference-v1.yaml](../../contracts/inference-v1.yaml) | The normative contract between the services |
| [backend.md](../backend.md) · [ui.md](../ui.md) | The original requirements both rounds were driven from |

The prohibitions described in these specs are enforced by
[test_prohibitions.py](../../backend/tests/integration/test_prohibitions.py),
so they hold whether or not anyone reads them.
