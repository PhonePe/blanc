import logging
import uuid
from typing import Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session
from blanc.db_models.models import (
    App, 
    ApplicationResponse, 
    OnboardingProgress, 
    Question, 
    Category
)

logger = logging.getLogger(__name__)


def get_app(db: Session, app_id: str) -> Optional[App]:
    return db.query(App).filter(App.id == app_id).first()


def get_app_by_name(
    db: Session, name: str, org_id: Optional[str] = None,
) -> Optional[App]:
    """Case-insensitive exact match on ``App.name``.

    When ``org_id`` is supplied the search is scoped to that org —
    important because ``App.name`` is only unique within an org
    (multiple orgs might have an "auth" app). Without an org scope
    the first match wins and a warning is logged if the name is
    ambiguous.
    """
    if not name:
        return None
    trimmed = name.strip()
    if not trimmed:
        return None

    q = db.query(App).filter(func.lower(App.name) == trimmed.lower())
    if org_id:
        q = q.filter(App.org_id == org_id)
    rows = q.all()
    if not rows:
        return None
    if len(rows) > 1 and not org_id:
        logger.warning(
            "application_crud.get_app_by_name: %d apps match name %r across orgs — "
            "returning first (%s). Pass org_id to disambiguate.",
            len(rows), trimmed, rows[0].id,
        )
    return rows[0]


def get_app_qna(db: Session, app_id: str) -> List[Dict[str, str]]:
    """Return every onboarding answer the app has, flattened.

    Empty list on unknown app / no answers. Never raises.
    """
    if not app_id:
        return []
    rows = (
        db.query(ApplicationResponse, Question)
        .join(Question, ApplicationResponse.question_id == Question.id)
        .filter(ApplicationResponse.app_id == app_id)
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

def get_response(db: Session, app_id: str, question_id: str) -> Optional[ApplicationResponse]:
    return db.query(ApplicationResponse).filter(
        ApplicationResponse.app_id == app_id,
        ApplicationResponse.question_id == question_id,
    ).first()

def create_response(db: Session, app_id: str, question_id: str, answer: str) -> ApplicationResponse:
    db_obj = ApplicationResponse(
        id=str(uuid.uuid4()),
        app_id=app_id,
        question_id=question_id,
        response=answer
    )
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj

def create_response_no_commit(db: Session, app_id: str, question_id: str, answer: str) -> ApplicationResponse:
    db_obj = ApplicationResponse(
        id=str(uuid.uuid4()),
        app_id=app_id,
        question_id=question_id,
        response=answer
    )
    db.add(db_obj)
    return db_obj

def update_response(db: Session, db_obj: ApplicationResponse, answer: str) -> ApplicationResponse:
    db_obj.response = answer
    db.commit()
    db.refresh(db_obj)
    return db_obj

def get_total_questions_by_category(db: Session, category_id: str) -> int:
    return db.query(Question).filter(Question.category_id == category_id).count()

def count_answered_questions(db: Session, app_id: str, category_id: str) -> int:
    return (
        db.query(ApplicationResponse)
        .join(Question, ApplicationResponse.question_id == Question.id)
        .filter(
            ApplicationResponse.app_id == app_id,
            Question.category_id == category_id
        )
        .count()
    )

def get_progress(db: Session, app_id: str, category_id: str) -> Optional[OnboardingProgress]:
    return (
        db.query(OnboardingProgress)
        .filter(
            OnboardingProgress.entity_type == "APP",
            OnboardingProgress.entity_id == app_id,
            OnboardingProgress.category_id == category_id,
        )
        .first()
    )

def create_progress(db: Session, app_id: str, category_id: str, status: str, org_id: Optional[str] = None) -> OnboardingProgress:
    db_obj = OnboardingProgress(
        id=str(uuid.uuid4()),
        org_id=org_id,
        entity_type="APP",
        entity_id=app_id,
        category_id=category_id,
        status=status,
    )
    db.add(db_obj)
    db.commit()
    return db_obj

def update_progress_status(db: Session, db_obj: OnboardingProgress, status: str, org_id: Optional[str] = None):
    db_obj.status = status
    if org_id and not db_obj.org_id:
        db_obj.org_id = org_id
    db.commit()
    return db_obj

def get_all_responses(db: Session, app_id: str) -> List[ApplicationResponse]:
    return db.query(ApplicationResponse).filter(ApplicationResponse.app_id == app_id).all()

def get_question(db: Session, question_id: str) -> Optional[Question]:
    return db.query(Question).filter(Question.id == question_id).first()

def get_category(db: Session, category_id: str) -> Optional[Category]:
    return db.query(Category).filter(Category.id == category_id).first()