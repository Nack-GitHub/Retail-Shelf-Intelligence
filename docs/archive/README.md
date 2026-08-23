# Archive

Planning documents for work that is **finished**. They are kept because they
record *why* the system is shaped the way it is — decisions that the code
itself cannot explain — not because anything here is still an open task.

| Document | What it is |
| :-- | :-- |
| [SPEC.md](SPEC.md) | The specification the backend and ML work was delivered against. Still the reference for the inference contract, the append-only rules, and the three standing prohibitions. |
| [plan.md](plan.md) | The 6-phase implementation plan, the dependency graph, the demo-grade simplifications that were deliberately taken, and the recorded outcome — including the promotion gates that fail. |
| [todo.md](todo.md) | The 18 tasks with acceptance criteria. All complete. |

**Still live, not archived:** [README.md](../../README.md) is the entry point,
and [contracts/inference-v1.yaml](../../contracts/inference-v1.yaml) is the
normative contract between the two services. The prohibitions described in
SPEC.md are enforced by
[test_prohibitions.py](../../backend/tests/integration/test_prohibitions.py),
so they hold whether or not anyone reads the spec.
