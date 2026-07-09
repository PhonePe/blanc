"""Timezone-aware "now" helper.

Python 3.13 deprecates :func:`datetime.utcnow`. This helper hides that
detail behind one call site so callers don't ship deprecation warnings
across the codebase.

Everything Blanc stores in the DB is UTC; there's no local-time story.
"""
from __future__ import annotations

from datetime import datetime, timezone


def now_utc() -> datetime:
    """Return a timezone-aware ``datetime`` in UTC.

    Prefer this over ``datetime.utcnow()`` — the latter returns a
    *naive* datetime (no tzinfo) and is deprecated in 3.12+.
    """
    return datetime.now(timezone.utc)


__all__ = ["now_utc"]
