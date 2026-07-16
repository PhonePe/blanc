"""Framework write helpers.

Connectors never touch SQLAlchemy directly. The dispatcher sets the
per-hydrate ``(assessment_id, image_id)`` on a :class:`ContextVar`
before iterating; connectors call :func:`update_surface_field`, which
picks the context up and writes into the right row.

The helper also enforces the two invariants:

1. **User-lock**   — if ``sources[<field>].provider == "user"``, the
   write is silently dropped.
2. **Provenance** — every successful write stamps
   ``sources[<field>] = FieldSource(...)`` so the UI can render a "🔗
   <ConnectorName> · <when>" chip and the reconciler can compare
   precedence.
"""
from __future__ import annotations

import asyncio
import contextvars
import logging
from datetime import datetime
from typing import Any, Optional

from blanc.crud import surface_map_crud
from blanc.db.database import get_db_session
from blanc.schemas.surface_map import FieldSource, SurfaceMapPayload

logger = logging.getLogger(__name__)

_ctx: contextvars.ContextVar[dict] = contextvars.ContextVar(
    "blanc_surface_map_ctx", default={}
)


def set_context(assessment_id: str, image_id: str) -> None:
    """Called by the dispatcher before iterating a surface map."""
    _ctx.set({"assessment_id": assessment_id, "image_id": image_id})


def clear_context() -> None:
    _ctx.set({})


def _get_context() -> dict:
    ctx = _ctx.get()
    if not ctx.get("assessment_id") or not ctx.get("image_id"):
        raise RuntimeError(
            "update_surface_field called without assessment context — "
            "dispatcher must call set_context() before running connectors."
        )
    return ctx


async def update_surface_field(
    *,
    entity_id: str,
    kind: str,                     # "component" | "boundary"
    field: str,
    value: Any,
    provider: str,
    source_ref: Optional[str] = None,
) -> None:
    """Write one field on one component/boundary with provenance.

    SQLAlchemy work runs in a worker thread via :func:`asyncio.to_thread`
    so we don't block the event loop while the dispatcher fans out other
    connectors concurrently.
    """
    ctx = _get_context()

    def _sync_write() -> None:
        with get_db_session() as db:
            row = surface_map_crud.get_surface_map(
                db, ctx["assessment_id"], ctx["image_id"],
            )
            if not row or not row.surface_map:
                logger.debug(
                    "[%s][img:%s] no surface_map row — skipping write of %s.%s",
                    ctx["assessment_id"], ctx["image_id"], kind, field,
                )
                return

            payload = SurfaceMapPayload(**row.surface_map)
            targets = (
                payload.components if kind == "component"
                else payload.trust_boundaries
            )
            entity = next((e for e in targets if e.id == entity_id), None)
            if entity is None:
                logger.debug(
                    "[%s][img:%s] entity %s not found in %ss",
                    ctx["assessment_id"], ctx["image_id"], entity_id, kind,
                )
                return

            # 1. User-lock — analyst edits win, always.
            existing = entity.sources.get(field)
            if existing and existing.provider == "user":
                logger.debug(
                    "[%s][img:%s] skipping %s.%s — user-locked",
                    ctx["assessment_id"], ctx["image_id"], entity_id, field,
                )
                return

            # 2. No-op guard — don't churn updated_at if the value is
            #    already what the connector would write.
            if getattr(entity, field, None) == value and existing \
                    and existing.provider == provider:
                return

            setattr(entity, field, value)
            entity.sources[field] = FieldSource(
                provider=provider,
                fetched_at=datetime.utcnow(),
                source_ref=source_ref,
            )
            surface_map_crud.upsert_surface_map(
                db, ctx["assessment_id"], ctx["image_id"], payload,
            )
            logger.info(
                "[%s][img:%s] %s.%s ← %s (via %s)",
                ctx["assessment_id"], ctx["image_id"],
                entity_id, field, _short(value), provider,
            )

    await asyncio.to_thread(_sync_write)


def _short(v: Any, limit: int = 60) -> str:
    s = str(v)
    return s if len(s) <= limit else s[: limit - 1] + "…"


__all__ = ["set_context", "clear_context", "update_surface_field"]
