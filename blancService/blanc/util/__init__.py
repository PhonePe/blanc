"""Shared utilities used across the codebase.

Everything here is dependency-light and stateless — no I/O, no DB, no
LLM. If a helper you want to add needs those, it probably belongs in
``services/`` or ``core/`` instead.
"""
from blanc.util.ids import new_id
from blanc.util.repositories import get_or_404
from blanc.util.time import now_utc

__all__ = ["get_or_404", "new_id", "now_utc"]
