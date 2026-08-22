"""Domain enums. Values are the wire format for the public API."""

from __future__ import annotations

from enum import StrEnum


class Role(StrEnum):
    REP = "REP"
    MANAGER = "MANAGER"
    ADMIN = "ADMIN"
    DATA = "DATA"


class StoreFormat(StrEnum):
    HYPER = "HYPER"
    SUPER = "SUPER"
    CVS = "CVS"
    TRAD = "TRAD"


class PhotoPolicy(StrEnum):
    ALLOWED = "ALLOWED"
    RESTRICTED = "RESTRICTED"
    FORBIDDEN = "FORBIDDEN"


class VisitStatus(StrEnum):
    OPEN = "OPEN"
    CLOSED = "CLOSED"


class CapturePhase(StrEnum):
    BEFORE = "BEFORE"
    AFTER = "AFTER"


class JobStatus(StrEnum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    DONE = "DONE"
    FAILED = "FAILED"


class OsaStatus(StrEnum):
    OK = "OK"
    LOW = "LOW"
    CRITICAL = "CRITICAL"


class VerificationStatus(StrEnum):
    PENDING = "PENDING"
    CONFIRMED = "CONFIRMED"
    REJECTED = "REJECTED"


class RejectReason(StrEnum):
    """Rejection reasons are training signal, not noise.

    OCCLUDED and NORMAL_EMPTY are two distinct model failure modes needing
    different fixes: the first wants more occluded-shelf training data, the
    second wants better negative examples of structural shelf voids.
    """

    OCCLUDED = "OCCLUDED"
    NOT_OUR_SKU = "NOT_OUR_SKU"
    NORMAL_EMPTY = "NORMAL_EMPTY"
    OTHER = "OTHER"


class TaskStatus(StrEnum):
    OPEN = "OPEN"
    FIXED = "FIXED"
    BLOCKED = "BLOCKED"


class BlockedReason(StrEnum):
    OUT_OF_BACKSTOCK = "OUT_OF_BACKSTOCK"
    STORE_REFUSED = "STORE_REFUSED"
    DELISTED = "DELISTED"


class RiskBand(StrEnum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class ReplenishmentStatus(StrEnum):
    REQUESTED = "REQUESTED"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    FULFILLED = "FULFILLED"
