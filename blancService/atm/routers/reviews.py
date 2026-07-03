from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from typing import List, Optional
from pydantic import BaseModel
import logging

from atm.db.database import get_db
from atm.utils import standard_response
from atm.core.auth.auth import require_roles, get_current_user
from atm.core.state_machine import transition_assessment, InvalidTransitionError
from atm.db_models.models import (
    Assessment,
    AssessmentState,
    AssessmentReviewer,
    AssessmentResults,
    ReviewStatus,
    User
)

# --- Pydantic Schemas ---

class AssignReviewersRequest(BaseModel):
    reviewer_ids: List[str]

class ReviewSubmission(BaseModel):
    status: str  # "APPROVED" or "REJECTED"
    comment: Optional[str] = None

class ApproveRequest(BaseModel):
    comment: Optional[str] = None

class ThreatReviewRequest(BaseModel):
    status: str  # "APPROVED" or "REJECTED"
    comment: Optional[str] = None

class ReviewerDetail(BaseModel):
    reviewer_id: str
    reviewer_name: Optional[str] = None
    reviewer_email: Optional[str] = None
    status: str
    comment: Optional[str] = None
    reviewed_at: Optional[str] = None

    class Config:
        from_attributes = True

# --- Router ---

review_router = APIRouter(
    prefix="/reviews",
    tags=["Reviews"],
    dependencies=[Depends(require_roles(["USER", "ADMIN"]))]
)


@review_router.get("/assessments-under-review")
def list_assessments_under_review(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    List all assessments currently in REVIEW state that are assigned to the current user as a reviewer.
    """
    reviewer_entries = (
        db.query(AssessmentReviewer)
        .filter(AssessmentReviewer.reviewer_id == current_user.userId)
        .all()
    )

    assessment_ids = [r.assessment_id for r in reviewer_entries]

    if not assessment_ids:
        return standard_response(200, "No assessments under review", {"assessments": []})

    assessments = (
        db.query(Assessment)
        .filter(
            Assessment.assessment_id.in_(assessment_ids),
            Assessment.state.in_([AssessmentState.REVIEW, AssessmentState.CHANGES_REQUESTED])
        )
        .order_by(Assessment.updated_at.desc())
        .all()
    )

    result = []
    for a in assessments:
        reviewers = db.query(AssessmentReviewer).filter(
            AssessmentReviewer.assessment_id == a.assessment_id
        ).all()

        reviewer_list = []
        for r in reviewers:
            user = db.query(User).filter(User.userId == r.reviewer_id).first()
            reviewer_list.append({
                "reviewer_id": r.reviewer_id,
                "reviewer_name": user.name if user else None,
                "reviewer_email": user.email if user else None,
                "status": r.status.value if r.status else "PENDING",
                "comment": r.comment,
                "reviewed_at": str(r.reviewed_at) if r.reviewed_at else None
            })

        result.append({
            "assessment_id": a.assessment_id,
            "app_name": a.app_name,
            "framework": a.framework,
            "team": a.team,
            "org_name": a.org_name,
            "state": a.state.value,
            "created_at": str(a.created_at) if a.created_at else None,
            "updated_at": str(a.updated_at) if a.updated_at else None,
            "reviewers": reviewer_list
        })

    return standard_response(200, "Assessments under review fetched successfully", {
        "count": len(result),
        "assessments": result
    })


@review_router.post("/{assessment_id}/assign-reviewers")
def assign_reviewers(
    assessment_id: str,
    request: AssignReviewersRequest,
    db: Session = Depends(get_db)
):
    """
    Assign reviewers to an assessment and transition its state to REVIEW.
    """
    assessment = db.query(Assessment).filter(Assessment.assessment_id == assessment_id).first()
    if not assessment:
        return standard_response(404, "Assessment not found", {})

    if assessment.state not in (AssessmentState.REVIEW, AssessmentState.CHANGES_REQUESTED):
        return standard_response(400, "Assessment must be in REVIEW or CHANGES_REQUESTED state to assign reviewers.", {})

    # Validate all reviewer IDs exist
    for r_id in request.reviewer_ids:
        user_exists = db.query(User).filter(User.userId == r_id).first()
        if not user_exists:
            return standard_response(400, f"User '{r_id}' does not exist", {})

    # Clear existing reviewers
    db.query(AssessmentReviewer).filter(AssessmentReviewer.assessment_id == assessment_id).delete()

    # Add new reviewers
    for r_id in request.reviewer_ids:
        new_reviewer = AssessmentReviewer(
            assessment_id=assessment_id,
            reviewer_id=r_id,
            status=ReviewStatus.PENDING
        )
        db.add(new_reviewer)

    # Transition state to REVIEW
    try:
        transition_assessment(db, assessment_id, AssessmentState.REVIEW, assessment.stage)
    except InvalidTransitionError:
        # Already in REVIEW, that's fine for re-assignment — just commit reviewers
        db.commit()

    return standard_response(200, "Reviewers assigned successfully", {
        "assessment_id": assessment_id,
        "state": assessment.state.value,
        "reviewer_count": len(request.reviewer_ids)
    })


@review_router.get("/reviewer-search")
def reviewer_search(
    search: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Search active users for reviewer assignment.
    - search: min 3 chars, filters by name or email (ilike)
    - role: filter by role first to limit scope (e.g., USER, ADMIN)
    """
    query = db.query(User).filter(User.isActive == True)

    # Require min 2 chars to avoid full table scans. Escape LIKE
    # wildcards (%, _) so "%" alone can't turn into a CPU DoS.
    if search:
        if len(search) < 2:
            return standard_response(400, "Search term must be at least 2 characters", {})
        safe = search[:50].replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_")
        query = query.filter(
            (User.name.ilike(f"%{safe}%", escape="\\")) |
            (User.email.ilike(f"%{safe}%", escape="\\"))
        )

    users = query.all()
    user_list = [
        {
            "userId": u.userId,
            "name": u.name,
            "email": u.email,
        }
        for u in users
    ]
    return standard_response(200, "Users fetched successfully", {"users": user_list})


@review_router.get("/{assessment_id}/reviewers")
def get_reviewers(
    assessment_id: str,
    db: Session = Depends(get_db)
):
    """
    Get all assigned reviewers and their review status for an assessment.
    """
    assessment = db.query(Assessment).filter(Assessment.assessment_id == assessment_id).first()
    if not assessment:
        return standard_response(404, "Assessment not found", {})

    reviewers = db.query(AssessmentReviewer).filter(
        AssessmentReviewer.assessment_id == assessment_id
    ).all()

    reviewer_list = []
    for r in reviewers:
        user = db.query(User).filter(User.userId == r.reviewer_id).first()
        reviewer_list.append({
            "reviewer_id": r.reviewer_id,
            "reviewer_name": user.name if user else None,
            "reviewer_email": user.email if user else None,
            "status": r.status.value if r.status else "PENDING",
            "comment": r.comment,
            "reviewed_at": str(r.reviewed_at) if r.reviewed_at else None
        })

    return standard_response(200, "Reviewers fetched successfully", {
        "assessment_id": assessment_id,
        "state": assessment.state.value,
        "reviewers": reviewer_list
    })


@review_router.post("/{assessment_id}/submit-review")
def submit_review(
    assessment_id: str,
    review_data: ReviewSubmission,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Submit a review for an assessment. Only assigned reviewers can submit.
    Auto-approves the assessment if all reviewers approve.
    Moves to NEEDS_INPUT if any reviewer rejects.
    """
    # 1. Verify the user is an assigned reviewer
    review_entry = db.query(AssessmentReviewer).filter(
        AssessmentReviewer.assessment_id == assessment_id,
        AssessmentReviewer.reviewer_id == current_user.userId
    ).first()

    if not review_entry:
        return standard_response(403, "You are not assigned as a reviewer for this assessment", {})

    # Validate status value
    try:
        new_status = ReviewStatus(review_data.status)
    except ValueError:
        return standard_response(400, f"Invalid review status. Must be one of: {[s.value for s in ReviewStatus]}", {})

    # 2. Update the reviewer's status
    review_entry.status = new_status
    review_entry.comment = review_data.comment
    review_entry.reviewed_at = func.now()
    db.flush()

    # 3. Check aggregate state to determine assessment outcome
    assessment = db.query(Assessment).filter(Assessment.assessment_id == assessment_id).first()
    all_reviews = db.query(AssessmentReviewer).filter(
        AssessmentReviewer.assessment_id == assessment_id
    ).all()

    if new_status == ReviewStatus.REJECTED:
        # Any rejection moves assessment to CHANGES_REQUESTED
        try:
            transition_assessment(db, assessment_id, AssessmentState.CHANGES_REQUESTED, assessment.stage)
        except InvalidTransitionError as e:
            logging.warning(f"State transition failed during review rejection: {e}")
    elif all(r.status == ReviewStatus.APPROVED for r in all_reviews):
        # All approved → auto-approve the assessment
        try:
            transition_assessment(db, assessment_id, AssessmentState.APPROVED, assessment.stage)
        except InvalidTransitionError as e:
            logging.warning(f"State transition failed during review approval: {e}")

    db.commit()

    return standard_response(200, "Review submitted successfully", {
        "assessment_id": assessment_id,
        "review_status": new_status.value,
        "assessment_state": assessment.state.value
    })


@review_router.post("/{assessment_id}/approve")
def approve_assessment(
    assessment_id: str,
    request: ApproveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Final approval of threat modeling by any one assigned reviewer.
    A single reviewer's approval is enough to approve the entire assessment.
    """
    assessment = db.query(Assessment).filter(Assessment.assessment_id == assessment_id).first()
    if not assessment:
        return standard_response(404, "Assessment not found", {})

    if assessment.state != AssessmentState.REVIEW:
        return standard_response(400, "Assessment must be in REVIEW state to approve.", {})

    # Verify the user is an assigned reviewer
    review_entry = db.query(AssessmentReviewer).filter(
        AssessmentReviewer.assessment_id == assessment_id,
        AssessmentReviewer.reviewer_id == current_user.userId
    ).first()

    if not review_entry:
        return standard_response(403, "You are not assigned as a reviewer for this assessment", {})

    # Update this reviewer's status to APPROVED
    review_entry.status = ReviewStatus.APPROVED
    review_entry.comment = request.comment
    review_entry.reviewed_at = func.now()

    # One reviewer approval is sufficient — approve the assessment
    try:
        transition_assessment(db, assessment_id, AssessmentState.APPROVED, assessment.stage)
    except InvalidTransitionError as e:
        return standard_response(400, f"Cannot approve: {str(e)}", {})
    assessment.approved_by = current_user.userId
    assessment.approved_comment = request.comment
    assessment.approved_at = func.now()
    db.commit()

    return standard_response(200, "Assessment approved successfully", {
        "assessment_id": assessment_id,
        "state": assessment.state.value,
        "approved_by": current_user.userId,
        "approved_comment": request.comment
    })


@review_router.post("/{assessment_id}/threats/{threat_id}/review")
def review_threat(
    assessment_id: str,
    threat_id: int,
    request: ThreatReviewRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Approve or reject an individual threat with a comment.
    Allowed for the assessment creator and assigned reviewers.
    """
    # Verify the user is the assessment creator or an assigned reviewer
    assessment = db.query(Assessment).filter(
        Assessment.assessment_id == assessment_id
    ).first()
    if not assessment:
        return standard_response(404, "Assessment not found", {})

    is_creator = assessment.user_id == current_user.userId
    is_reviewer = db.query(AssessmentReviewer).filter(
        AssessmentReviewer.assessment_id == assessment_id,
        AssessmentReviewer.reviewer_id == current_user.userId
    ).first() is not None

    if not is_creator and not is_reviewer:
        return standard_response(403, "Only the assessment creator or assigned reviewers can review threats", {})

    # Validate status
    if request.status not in ("APPROVED", "REJECTED"):
        return standard_response(400, "Status must be 'APPROVED' or 'REJECTED'", {})

    # Find the threat
    threat = db.query(AssessmentResults).filter(
        AssessmentResults.id == threat_id,
        AssessmentResults.assessment_id == assessment_id
    ).first()

    if not threat:
        return standard_response(404, "Threat not found", {})

    # Update threat review fields
    threat.review_status = request.status
    threat.review_comment = request.comment
    threat.reviewed_by = current_user.userId
    threat.reviewed_at = func.now()
    db.commit()

    return standard_response(200, "Threat reviewed successfully", {
        "threat_id": threat_id,
        "assessment_id": assessment_id,
        "review_status": threat.review_status,
        "review_comment": threat.review_comment,
        "reviewed_by": current_user.userId
    })


@review_router.post("/{assessment_id}/threats/bulk-review")
def bulk_review_threats(
    assessment_id: str,
    reviews: List[ThreatReviewRequest],
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Bulk approve/reject all threats for an assessment.
    Applies the same status and comment to all threats.
    Allowed for the assessment creator and assigned reviewers.
    """
    # Verify the user is the assessment creator or an assigned reviewer
    assessment = db.query(Assessment).filter(
        Assessment.assessment_id == assessment_id
    ).first()
    if not assessment:
        return standard_response(404, "Assessment not found", {})

    is_creator = assessment.user_id == current_user.userId
    is_reviewer = db.query(AssessmentReviewer).filter(
        AssessmentReviewer.assessment_id == assessment_id,
        AssessmentReviewer.reviewer_id == current_user.userId
    ).first() is not None

    if not is_creator and not is_reviewer:
        return standard_response(403, "Only the assessment creator or assigned reviewers can review threats", {})

    threats = db.query(AssessmentResults).filter(
        AssessmentResults.assessment_id == assessment_id
    ).all()

    if not threats:
        return standard_response(404, "No threats found for this assessment", {})

    # Apply same status/comment to all threats
    status = reviews[0].status if reviews else "APPROVED"
    comment = reviews[0].comment if reviews else None

    if status not in ("APPROVED", "REJECTED"):
        return standard_response(400, "Status must be 'APPROVED' or 'REJECTED'", {})

    for t in threats:
        t.review_status = status
        t.review_comment = comment
        t.reviewed_by = current_user.userId
        t.reviewed_at = func.now()

    db.commit()

    return standard_response(200, f"All {len(threats)} threats marked as {status}", {
        "assessment_id": assessment_id,
        "review_status": status,
        "threats_reviewed": len(threats)
    })