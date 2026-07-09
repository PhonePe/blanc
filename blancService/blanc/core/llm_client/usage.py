"""
Pluggable LLM usage / cost sinks.

The core client emits a :class:`UsageRecord` after every successful call. Sinks
decide what to do with it: drop, log, persist, ship to Prometheus, etc.
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass
class UsageRecord:
    call_type: str               # "structured" | "text" | provider-specific
    model: str
    input_tokens: int
    output_tokens: int
    total_tokens: int
    tokens_billed: int
    duration_ms: int
    estimated_cost: float
    assessment_id: Optional[str] = None


class UsageSink(ABC):
    @abstractmethod
    def record(self, usage: UsageRecord) -> None: ...


class NullUsageSink(UsageSink):
    """No-op sink — default when no observability is configured."""

    def record(self, usage: UsageRecord) -> None:  # pragma: no cover
        return None


class LoggingUsageSink(UsageSink):
    """Emits one structured log line per call."""

    def __init__(self, logger: Optional[logging.Logger] = None, level: int = logging.INFO):
        self._logger = logger or logging.getLogger("blanc.llm.usage")
        self._level = level

    def record(self, usage: UsageRecord) -> None:
        self._logger.log(
            self._level,
            "llm_usage call_type=%s model=%s in=%d out=%d total=%d billed=%d "
            "duration_ms=%d cost=%.6f assessment_id=%s",
            usage.call_type,
            usage.model,
            usage.input_tokens,
            usage.output_tokens,
            usage.total_tokens,
            usage.tokens_billed,
            usage.duration_ms,
            usage.estimated_cost,
            usage.assessment_id or "-",
        )


class SqlAlchemyUsageSink(UsageSink):
    """Persists usage to the application's LLMUsage table.

    Kept out of :mod:`.client` so that the core has no SQLAlchemy dependency.
    Imports are lazy so the rest of the package stays importable in test /
    standalone contexts (e.g. CLI smoke checks).
    """

    def __init__(self):
        self._logger = logging.getLogger("blanc.llm.usage")

    def record(self, usage: UsageRecord) -> None:
        if usage.tokens_billed <= 0 and usage.total_tokens <= 0:
            return
        try:
            from blanc.db.database import get_db_session
            from blanc.db_models.models import LLMUsage as LLMUsageRow

            with get_db_session() as db:
                row = LLMUsageRow(
                    assessment_id=usage.assessment_id,
                    call_type=usage.call_type,
                    model=usage.model,
                    input_tokens=usage.input_tokens,
                    output_tokens=usage.output_tokens,
                    total_tokens=usage.total_tokens,
                    tokens_billed=usage.tokens_billed,
                    estimated_cost=usage.estimated_cost,
                    duration_ms=usage.duration_ms,
                )
                db.add(row)
                db.commit()
        except Exception as e:  # pragma: no cover - best-effort observability
            self._logger.warning("Failed to log LLM usage: %s", e)


__all__ = [
    "LoggingUsageSink",
    "NullUsageSink",
    "SqlAlchemyUsageSink",
    "UsageRecord",
    "UsageSink",
]
