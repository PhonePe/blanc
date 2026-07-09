"""Cursor-free page + offset pagination helpers.

Kept intentionally small — Blanc's list endpoints so far return the full
row set. Introducing a proper page type here means the first endpoint
that needs pagination can adopt it in a couple of lines without a
one-off wrapper.

Example::

    from blanc.util.pagination import Page, PageParams, paginate

    @router.get("/assessment", response_model=Page[AssessmentResponse])
    def list_assessments(
        params: PageParams = Depends(),
        db: Session = Depends(get_db),
    ) -> Page[AssessmentResponse]:
        q = db.query(Assessment).order_by(Assessment.created_at.desc())
        return paginate(q, params)
"""
from __future__ import annotations

from typing import Generic, List, TypeVar

from fastapi import Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Query as OrmQuery

T = TypeVar("T")


class PageParams(BaseModel):
    """Query-string page params — plug into a FastAPI dep."""

    page: int = Field(1, ge=1, description="1-indexed page number")
    page_size: int = Field(50, ge=1, le=200, description="Rows per page (max 200)")

    @classmethod
    def from_query(
        cls,
        page: int = Query(1, ge=1),
        page_size: int = Query(50, ge=1, le=200),
    ) -> "PageParams":
        """Depend on this from routers so ``PageParams`` shows up in Swagger."""
        return cls(page=page, page_size=page_size)


class Page(BaseModel, Generic[T]):
    """Wire format for a single page of results."""

    items: List[T]
    page: int
    page_size: int
    total: int
    has_next: bool


def paginate(query: OrmQuery, params: PageParams) -> Page:
    """Materialise a SQLAlchemy ``Query`` into a :class:`Page`.

    Runs one COUNT + one LIMIT/OFFSET SELECT. For large tables consider
    a keyset variant (last-id cursor) — not implemented here because
    none of the current lists cross ~1k rows in practice.
    """
    total = query.order_by(None).count()
    offset = (params.page - 1) * params.page_size
    items = query.offset(offset).limit(params.page_size).all()
    return Page(
        items=items,
        page=params.page,
        page_size=params.page_size,
        total=total,
        has_next=offset + params.page_size < total,
    )


__all__ = ["Page", "PageParams", "paginate"]
