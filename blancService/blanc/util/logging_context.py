"""Ambient context that stdlib logging can pick up automatically.

Uses ``contextvars`` so the values are per-async-task and per-thread —
no explicit passing of ``assessment_id`` through 15 layers of function
signatures just to prefix every log line with it.

Wiring
------
1. :func:`install_context_filter` is called once from
   :mod:`blanc.config_parsers.log_utils`. It attaches a ``logging.Filter``
   to the root logger that copies the contextvars onto every
   ``LogRecord`` before it's emitted.
2. Consumers set the context at the top of a request / task / pipeline
   stage — e.g. the request-ID middleware in :mod:`blanc.app` sets the
   HTTP request id, and :func:`blanc.core.llm_client.set_assessment_context`
   sets the assessment id.
3. Every log line then carries the bound values without the caller
   having to remember to write them. The format string in ``log_utils``
   picks them up via ``%(request_id)s`` / ``%(assessment_id)s`` / etc.

Compare this to the previous pattern::

    logger.info(f"[{assessment_id}][img:{image_id}] Phase A start")

which was copy-pasted in 29 places. Now::

    bind_log_context(assessment_id=aid, image_id=iid)
    logger.info("Phase A start")

and every subsequent log line inside the same task carries both ids.
"""
from __future__ import annotations

import logging
from contextvars import ContextVar
from typing import Any

# One contextvar per bound key. Empty string means "not set" so the log
# format string never blows up on a missing attribute. We deliberately do
# NOT store a single dict here — separate contextvars make the "which
# task set this?" story easier to reason about under asyncio + threads.
_request_id: ContextVar[str] = ContextVar("blanc_request_id", default="")
_assessment_id: ContextVar[str] = ContextVar("blanc_assessment_id", default="")
_image_id: ContextVar[str] = ContextVar("blanc_image_id", default="")

_KNOWN_KEYS = ("request_id", "assessment_id", "image_id")


def bind_log_context(**kwargs: Any) -> None:
    """Update the ambient log context. Unknown keys are ignored.

    Example::

        bind_log_context(assessment_id="abc-123", image_id="img-1")

    Values are stringified — the log format only speaks in strings. Pass
    ``""`` to clear a key.
    """
    for key, value in kwargs.items():
        cv = _lookup(key)
        if cv is not None:
            cv.set("" if value is None else str(value))


def clear_log_context() -> None:
    """Reset all bound keys. Useful in tests."""
    for key in _KNOWN_KEYS:
        _lookup(key).set("")


def _lookup(key: str) -> ContextVar[str] | None:
    return {
        "request_id": _request_id,
        "assessment_id": _assessment_id,
        "image_id": _image_id,
    }.get(key)


class _ContextFilter(logging.Filter):
    """Copy each bound contextvar onto the ``LogRecord`` before format runs.

    The default ``LogRecord`` doesn't know about our contextvars, so a
    format string like ``%(assessment_id)s`` would raise. This filter
    guarantees every record has the attributes set — empty string when
    nothing is bound.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = _request_id.get()
        record.assessment_id = _assessment_id.get()
        record.image_id = _image_id.get()
        return True


def install_context_filter() -> None:
    """Attach the context filter to every configured handler.

    Individual loggers that set ``propagate: no`` (aio_pika, httpx, etc.)
    bypass the root logger, so a filter attached only to the root would
    miss their records — the console handler on those loggers would
    then hit the format string with no ``request_id`` attribute and
    raise ``KeyError: 'request_id'``.

    Attaching to every handler covers both propagating and
    non-propagating loggers cleanly. Idempotent — safe to call twice.
    """
    seen: set[int] = set()
    for logger in [logging.getLogger()] + [
        logging.getLogger(name) for name in logging.root.manager.loggerDict  # type: ignore[attr-defined]
    ]:
        for handler in logger.handlers:
            if id(handler) in seen:
                continue
            seen.add(id(handler))
            if not any(isinstance(f, _ContextFilter) for f in handler.filters):
                handler.addFilter(_ContextFilter())


__all__ = [
    "bind_log_context",
    "clear_log_context",
    "install_context_filter",
]
