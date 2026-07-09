"""Small data-access helpers reused across routers, services and CRUD.

Right now this contains :func:`get_or_404` — the pattern "look up a row
by id, raise ``HTTPException(404)`` if missing" was hand-rolled in 11
places. Centralising it here means:

* Every 404 message uses the same shape (``"<Model> not found"``).
* The lookup criterion can be extended (e.g. add ``is_deleted=False``
  soft-delete guard) in one place.
* Routers stop needing ``sqlalchemy`` imports for a two-line query.
"""
from __future__ import annotations

from typing import Any, Type, TypeVar

from fastapi import HTTPException
from sqlalchemy.orm import Session

T = TypeVar("T")


def get_or_404(db: Session, model: Type[T], **filters: Any) -> T:
    """Return the single row matching ``filters`` or raise ``HTTPException(404)``.

    Example::

        assessment = get_or_404(db, Assessment, assessment_id=aid)

    Uses ``.filter_by(**filters).first()`` under the hood, so any
    combination of column names supported by SQLAlchemy works. When
    no row matches, raises a 404 with a message shaped like
    ``"Assessment not found"``.
    """
    row = db.query(model).filter_by(**filters).first()
    if row is None:
        raise HTTPException(
            status_code=404,
            detail=f"{model.__name__} not found",
        )
    return row


__all__ = ["get_or_404"]
