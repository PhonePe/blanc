from sqlalchemy.orm import Session, joinedload
from datetime import datetime
from typing import List, Optional
import uuid
import json
from atm.db_models.models import (
    Assessment,
    AssessmentDocument,
    DocumentAnalysis,
    AssessmentResults,
    AssessmentReviewer,
    LLMUsage,
    AssessmentState,
    AssessmentStage,
)
from atm.api_schemas.api_v1.assessment import AssessmentCreate


def create_assessment_entry(db: Session, assessment_data: AssessmentCreate, user_id: str) -> Assessment:
    new_id = str(uuid.uuid4())

    # Auto-select framework based on diagram type:
    # sequenceDiagram → BUSINESS_LOGIC, otherwise → STRIDE
    if assessment_data.diagram_type and assessment_data.diagram_type.value == "sequenceDiagram":
        framework = "BUSINESS_LOGIC"
    else:
        framework = "STRIDE"

    new_assessment = Assessment(
        assessment_id=new_id,
        assessment_type=assessment_data.assessment_type.value,
        framework=framework,
        team=assessment_data.team,
        app_name=assessment_data.app_name,
        org_name=assessment_data.org_name,
        interface=assessment_data.interface,
        operating_system=assessment_data.operating_system,
        state="PENDING",
        stage="INITIALIZING",
        feature_name=assessment_data.feature_name,
        feature_version=assessment_data.feature_version,
        user_id=user_id,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db.add(new_assessment)
    db.flush()
    return new_assessment


def create_document_entry(db: Session, assessment_id: str, document_type: str, file_meta: dict) -> AssessmentDocument:
    doc_record = AssessmentDocument(
        assessment_id=assessment_id,
        document_type=document_type,
        document_id=str(uuid.uuid4()),
        meta=file_meta
    )
    db.add(doc_record)
    return doc_record


def create_image_analysis_entry(
    db: Session, assessment_id: str, image_id: str, image_path: str,
    diagram_type: str = "flowchart TD",
) -> DocumentAnalysis:
    """Creates a DocumentAnalysis row for a single image."""
    record = DocumentAnalysis(
        assessment_id=assessment_id,
        image_id=image_id,
        image_path=image_path,
        diagram_type=diagram_type,
        state=AssessmentState.PENDING,
        stage=AssessmentStage.INITIALIZING,
    )
    db.add(record)
    return record


def get_assessment_by_id(db: Session, assessment_id: str) -> Optional[Assessment]:
    return db.query(Assessment).filter_by(assessment_id=assessment_id).first()


def get_assessments_by_user(
    db: Session, user_id: str | None, skip: int, limit: int,
    search: str | None = None, framework: str | None = None,
    app_name: str | None = None, org_name: str | None = None,
):
    query = db.query(Assessment).options(joinedload(Assessment.user))
    if user_id:
        query = query.filter(Assessment.user_id == user_id)
    # Exact-match filters
    if framework:
        query = query.filter(Assessment.framework == framework)
    if app_name:
        query = query.filter(Assessment.app_name == app_name)
    if org_name:
        query = query.filter(Assessment.org_name == org_name)

    # Free-text search across multiple columns. Escape LIKE wildcards
    # (%, _) and cap the length — otherwise a search of "%" alone
    # becomes a full-table CPU DoS on large tenants.
    if search:
        safe = search[:64].replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_")
        like = f"%{safe}%"
        query = query.filter(
            Assessment.feature_name.ilike(like, escape="\\")
            | Assessment.framework.ilike(like, escape="\\")
            | Assessment.app_name.ilike(like, escape="\\")
            | Assessment.org_name.ilike(like, escape="\\")
        )

    total = query.count()
    assessments = (
        query
        .order_by(Assessment.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return assessments, total


def get_analysis_by_assessment_id(db: Session, assessment_id: str) -> List[DocumentAnalysis]:
    """Returns all image-level analysis rows for an assessment."""
    return db.query(DocumentAnalysis).filter_by(assessment_id=assessment_id).all()


def get_analysis_by_image_id(db: Session, assessment_id: str, image_id: str) -> Optional[DocumentAnalysis]:
    """Returns a single image analysis row."""
    return (
        db.query(DocumentAnalysis)
        .filter_by(assessment_id=assessment_id, image_id=image_id)
        .first()
    )


def get_threats_by_assessment_id(db: Session, assessment_id: str):
    return db.query(AssessmentResults).filter_by(assessment_id=assessment_id).all()


def delete_assessment(db: Session, assessment_id: str) -> bool:
    """Deletes an assessment and all related records (cascade)."""
    assessment = get_assessment_by_id(db, assessment_id)
    if not assessment:
        return False

    # Delete child records first
    db.query(LLMUsage).filter_by(assessment_id=assessment_id).delete()
    db.query(AssessmentReviewer).filter_by(assessment_id=assessment_id).delete()
    db.query(AssessmentResults).filter_by(assessment_id=assessment_id).delete()
    db.query(DocumentAnalysis).filter_by(assessment_id=assessment_id).delete()
    db.query(AssessmentDocument).filter_by(assessment_id=assessment_id).delete()

    # Delete the assessment itself
    db.delete(assessment)
    db.commit()
    return True


def update_analysis_clarifications(db: Session, analysis: DocumentAnalysis, submission):
    if submission.mermaid_code:
        analysis.flow_diagram = {"mermaid": submission.mermaid_code}

    if submission.clarification_questions:
        existing_clarifications = analysis.clarification or []
        existing_auto_answered_by_question = {
            item.get("question"): item.get("auto_answered")
            for item in existing_clarifications
            if isinstance(item, dict) and item.get("question") is not None
        }

        clarifications_list = []
        for q in submission.clarification_questions:
            auto_answered = q.auto_answered
            if auto_answered is None:
                auto_answered = existing_auto_answered_by_question.get(q.question, False)

            if not isinstance(auto_answered, bool):
                auto_answered = False

            clarifications_list.append(
                {
                    "question": q.question,
                    "answer": q.answer,
                    "auto_answered": auto_answered,
                }
            )

        analysis.clarification = clarifications_list

    db.commit()
    db.refresh(analysis)
    return analysis