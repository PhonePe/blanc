"""Org-scoped CRUD helpers.

Prior to this module the only Org lookups in the codebase were inline
``db.query(Org)`` calls in the org router. Auto-answer needs to resolve
``Assessment.org_name`` (a plain string, no FK) back to an ``Org.id`` in
order to load the org's onboarding Q&A, so the lookups are centralised
here instead of duplicating query logic across services.
"""
from __future__ import annotations

import logging
from typing import Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from blanc.db_models.models import Org, OrganizationResponse, Question

logger = logging.getLogger(__name__)


def get_org_by_id(db: Session, org_id: str) -> Optional[Org]:
    return db.query(Org).filter(Org.id == org_id).first()


def get_org_by_name(db: Session, name: str) -> Optional[Org]:
    """Case-insensitive exact match on ``Org.name``.

    Returns the first match. Emits a warning if the name resolves to
    more than one org — that's a data-model smell (org names are
    supposed to be unique) that the caller should surface.
    """
    if not name:
        return None
    trimmed = name.strip()
    if not trimmed:
        return None
    rows = (
        db.query(Org)
        .filter(func.lower(Org.name) == trimmed.lower())
        .all()
    )
    if not rows:
        return None
    if len(rows) > 1:
        logger.warning(
            "org_crud.get_org_by_name: %d orgs match name %r — returning first (%s). "
            "Uniqueness on Org.name is expected.",
            len(rows), trimmed, rows[0].id,
        )
    return rows[0]


def get_org_qna(db: Session, org_id: str) -> List[Dict[str, str]]:
    """Return every onboarding answer the org has given so far.

    Shape matches what ``OnboardingService.get_org_progress`` returns
    per response but flattened across categories — auto-answer wants
    a linear list, not category grouping.

    Empty list on unknown org / no answers. Never raises.
    """
    if not org_id:
        return []
    rows = (
        db.query(OrganizationResponse, Question)
        .join(Question, OrganizationResponse.question_id == Question.id)
        .filter(OrganizationResponse.org_id == org_id)
        .all()
    )
    out: List[Dict[str, str]] = []
    for resp, question in rows:
        answer = (resp.response or "").strip()
        if not answer:
            continue
        out.append({
            "category": question.category_id or "",
            "question": question.question,
            "answer": answer,
        })
    return out


__all__ = ["get_org_by_id", "get_org_by_name", "get_org_qna"]
