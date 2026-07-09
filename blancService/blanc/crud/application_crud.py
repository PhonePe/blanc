import uuid
from typing import List, Optional
from sqlalchemy.orm import Session
from blanc.db_models.models import (
    App, 
    ApplicationResponse, 
    OnboardingProgress, 
    Question, 
    Category
)

def get_app(db: Session, app_id: str) -> Optional[App]:
    return db.query(App).filter(App.id == app_id).first()

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