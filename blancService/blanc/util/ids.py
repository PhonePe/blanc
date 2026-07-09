"""Identifier generation.

Kept as a helper so:

* We can flip the format (uuid4 hex vs dashed) in one place if we ever
  need to.
* Tests can monkey-patch :func:`new_id` for deterministic fixtures.
* Grep for "id generation" gives you one hit, not 20.
"""
from __future__ import annotations

import uuid


def new_id() -> str:
    """Return a new UUIDv4 as a lowercase dashed string.

    ``str(uuid.uuid4())`` was scattered across ~20 call-sites. Prefer
    this helper so the format stays consistent everywhere and future
    changes (e.g. switching to ULIDs) require touching one file.
    """
    return str(uuid.uuid4())


__all__ = ["new_id"]
