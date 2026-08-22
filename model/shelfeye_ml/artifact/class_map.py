"""Loads the class map that ships inside a model artifact.

The map is the boundary that lets the SKU list change without a backend
deploy: raw class names live here, `SemanticType` values leave here, and the
backend only ever sees the latter.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import cached_property
from pathlib import Path

import yaml

from shelfeye_contracts import SemanticType


@dataclass(frozen=True, slots=True)
class ClassEntry:
    class_id: int
    name: str
    semantic_type: SemanticType


class ClassMap:
    """An artifact's class_id -> (name, semantic_type) table."""

    def __init__(self, entries: dict[int, ClassEntry], *, dataset: str, dataset_version: str) -> None:
        self._entries = entries
        self.dataset = dataset
        self.dataset_version = dataset_version

    @classmethod
    def load(cls, path: str | Path) -> ClassMap:
        raw = yaml.safe_load(Path(path).read_text())
        entries = {
            int(cid): ClassEntry(
                class_id=int(cid),
                name=body["name"],
                semantic_type=SemanticType(body["semantic_type"]),
            )
            for cid, body in raw["classes"].items()
        }
        declared = int(raw["num_classes"])
        if len(entries) != declared:
            raise ValueError(f"class_map declares {declared} classes but lists {len(entries)}")
        return cls(
            entries,
            dataset=str(raw["dataset"]),
            dataset_version=str(raw["dataset_version"]),
        )

    def __len__(self) -> int:
        return len(self._entries)

    def __contains__(self, class_id: int) -> bool:
        return class_id in self._entries

    def entry(self, class_id: int) -> ClassEntry:
        try:
            return self._entries[class_id]
        except KeyError:
            # A class the artifact does not know about means the weights and the
            # map came from different runs. Failing loudly beats mislabelling a
            # gap as a product.
            raise KeyError(f"class_id {class_id} is not in this artifact's class map") from None

    def semantic_type(self, class_id: int) -> SemanticType:
        return self.entry(class_id).semantic_type

    def name(self, class_id: int) -> str:
        return self.entry(class_id).name

    @cached_property
    def gap_class_ids(self) -> tuple[int, ...]:
        return tuple(e.class_id for e in self._entries.values() if e.semantic_type is SemanticType.GAP)

    @cached_property
    def names_by_id(self) -> dict[int, str]:
        return {cid: e.name for cid, e in self._entries.items()}

    def counts_by_semantic_type(self) -> dict[SemanticType, int]:
        counts: dict[SemanticType, int] = {st: 0 for st in SemanticType}
        for entry in self._entries.values():
            counts[entry.semantic_type] += 1
        return counts
