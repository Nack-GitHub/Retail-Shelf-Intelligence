"""Structured JSON logging with a request_id that survives every hop.

The request_id is minted at the API edge, attached to the Celery task, and
sent to the ML service in the inference request. One id ties together the
HTTP call, the queue, the worker and the model — which is the only way to
answer "what happened to this photo" in a system with three processes.
"""

from __future__ import annotations

import logging
import sys
from contextvars import ContextVar
from uuid import uuid4

import structlog

_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)


def set_request_id(value: str | None = None) -> str:
    rid = value or str(uuid4())
    _request_id.set(rid)
    return rid


def get_request_id() -> str | None:
    return _request_id.get()


def _inject_request_id(_logger, _name, event_dict):
    if rid := _request_id.get():
        event_dict["request_id"] = rid
    return event_dict


def configure_logging(level: str = "INFO") -> None:
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=level)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            _inject_request_id,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(getattr(logging, level)),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str) -> structlog.BoundLogger:
    return structlog.get_logger(name)
