"""
Centralized State Machine for Assessment and DocumentAnalysis state transitions.

Two levels of state tracking:
- DocumentAnalysis (per-image): PENDING → PROCESSING → NEEDS_INPUT/COMPLETED → FAILED
- Assessment (overall): Derived from image states during doc analysis, 
                        then direct for THREAT_MODELING → REVIEW → APPROVED/CHANGES_REQUESTED
"""

import logging
from sqlalchemy.orm import Session
from atm.db_models.models import (
    Assessment,
    DocumentAnalysis,
    AssessmentState,
    AssessmentStage,
)

logger = logging.getLogger(__name__)

# ==========================================
# Allowed Transitions
# ==========================================

# Per-image transitions (doc analysis phase)
IMAGE_TRANSITIONS = {
    AssessmentState.PENDING: {AssessmentState.PROCESSING},
    AssessmentState.PROCESSING: {
        AssessmentState.AWAITING_REVIEW,   # Phase A finished → pause
        AssessmentState.NEEDS_INPUT,
        AssessmentState.COMPLETED,
        AssessmentState.FAILED,
    },
    AssessmentState.AWAITING_REVIEW: {
        AssessmentState.PROCESSING,         # User clicked Next → Phase B starts
        AssessmentState.FAILED,
    },
    AssessmentState.NEEDS_INPUT: {AssessmentState.COMPLETED},
    AssessmentState.COMPLETED: set(),  # Terminal for image-level
    AssessmentState.FAILED: {AssessmentState.PENDING},  # Retry resets to PENDING
}

# Assessment-level transitions (threat modeling + review phase)
ASSESSMENT_TRANSITIONS = {
    AssessmentState.PENDING: {AssessmentState.PROCESSING},
    AssessmentState.PROCESSING: {AssessmentState.NEEDS_INPUT, AssessmentState.COMPLETED, AssessmentState.FAILED, AssessmentState.REVIEW},
    AssessmentState.NEEDS_INPUT: {AssessmentState.COMPLETED},
    AssessmentState.COMPLETED: {AssessmentState.PROCESSING},  # "Run Threat Modeling"
    AssessmentState.FAILED: {AssessmentState.PENDING, AssessmentState.PROCESSING},  # Retry
    AssessmentState.REVIEW: {AssessmentState.APPROVED, AssessmentState.CHANGES_REQUESTED, AssessmentState.PROCESSING},
    AssessmentState.APPROVED: set(),  # Terminal
    AssessmentState.CHANGES_REQUESTED: {AssessmentState.REVIEW},
}


class InvalidTransitionError(Exception):
    """Raised when an invalid state transition is attempted."""
    pass


# ==========================================
# Image-Level State Management
# ==========================================

def transition_image(
    db: Session,
    assessment_id: str,
    image_id: str,
    new_state: AssessmentState,
    new_stage: AssessmentStage,
    error_message: str = None,
) -> None:
    """
    Transitions a single DocumentAnalysis (image) row to a new state.
    Validates the transition against IMAGE_TRANSITIONS.
    After transitioning, derives and updates the assessment-level state.
    """
    image_analysis = (
        db.query(DocumentAnalysis)
        .filter_by(assessment_id=assessment_id, image_id=image_id)
        .first()
    )
    if not image_analysis:
        raise ValueError(f"DocumentAnalysis not found: assessment={assessment_id}, image={image_id}")

    # Refresh from DB to avoid stale-read conflicts from concurrent workers
    db.refresh(image_analysis)

    current_state = image_analysis.state
    allowed = IMAGE_TRANSITIONS.get(current_state, set())

    # Allow same-state transitions (stage changes within PROCESSING)
    if new_state != current_state and new_state not in allowed:
        raise InvalidTransitionError(
            f"[Image {image_id}] Invalid transition: {current_state.value} → {new_state.value}. "
            f"Allowed: {[s.value for s in allowed]}"
        )

    image_analysis.state = new_state
    image_analysis.stage = new_stage
    if error_message is not None:
        image_analysis.error_message = error_message[:500] if error_message else None
    elif current_state == AssessmentState.FAILED:
        # Clear error when transitioning away from FAILED (e.g., retry)
        image_analysis.error_message = None

    db.flush()
    logger.info(f"[{assessment_id}][img:{image_id}] Image → {new_state.value} / {new_stage.value}")

    # Derive and update assessment-level state
    _sync_assessment_state(db, assessment_id)
    db.commit()


def _sync_assessment_state(db: Session, assessment_id: str) -> None:
    """
    Derives the assessment state from all its image states.
    Only applies during the doc analysis phase (before THREAT_MODELING).
    Handles concurrent updates from parallel image workers via retry.
    """
    for attempt in range(3):
        try:
            assessment = db.query(Assessment).filter_by(assessment_id=assessment_id).first()
            if not assessment:
                return

            # Refresh to get the latest version and avoid stale-read conflicts
            db.refresh(assessment)

            # Don't override assessment state if we're in threat modeling or review phase
            if assessment.state in (
                AssessmentState.REVIEW,
                AssessmentState.APPROVED,
                AssessmentState.CHANGES_REQUESTED,
            ):
                return

            # If assessment is in THREAT_MODELING stage, don't override from image states
            if assessment.stage == AssessmentStage.THREAT_MODELING:
                return

            images = db.query(DocumentAnalysis).filter_by(assessment_id=assessment_id).all()
            if not images:
                return

            states = [img.state for img in images]

            if any(s == AssessmentState.PROCESSING for s in states):
                derived = AssessmentState.PROCESSING
                # Use the stage of the least-progressed processing image
                processing_images = [img for img in images if img.state == AssessmentState.PROCESSING]
                derived_stage = min(processing_images, key=lambda x: _stage_order(x.stage)).stage
            elif any(s == AssessmentState.FAILED for s in states):
                derived = AssessmentState.FAILED
                derived_stage = AssessmentStage.INITIALIZING
            elif any(s == AssessmentState.NEEDS_INPUT for s in states):
                derived = AssessmentState.NEEDS_INPUT
                derived_stage = AssessmentStage.CLARIFICATION
            elif any(s == AssessmentState.AWAITING_REVIEW for s in states):
                derived = AssessmentState.AWAITING_REVIEW
                derived_stage = AssessmentStage.COMPONENT_ANALYSIS
            elif all(s == AssessmentState.COMPLETED for s in states):
                derived = AssessmentState.COMPLETED
                derived_stage = AssessmentStage.CLARIFICATION
            else:
                derived = AssessmentState.PENDING
                derived_stage = AssessmentStage.INITIALIZING

            assessment.state = derived
            assessment.stage = derived_stage
            db.flush()
            logger.info(f"[{assessment_id}] Assessment derived → {derived.value} / {derived_stage.value}")
            return  # Success — exit retry loop

        except Exception as e:
            if "Record has changed since last read" in str(e) and attempt < 2:
                logger.warning(
                    f"[{assessment_id}] Assessment sync conflict (attempt {attempt + 1}), retrying..."
                )
                db.rollback()
                continue
            raise


_STAGE_ORDER = {
    AssessmentStage.INITIALIZING: 0,
    AssessmentStage.IMAGE_PROCESSING: 1,
    AssessmentStage.COMPONENT_ANALYSIS: 2,
    AssessmentStage.SUMMARIZING: 3,
    AssessmentStage.CLARIFICATION: 4,
    AssessmentStage.THREAT_MODELING: 5,
}

def _stage_order(stage: AssessmentStage) -> int:
    return _STAGE_ORDER.get(stage, 0)


# ==========================================
# Assessment-Level State Management
# ==========================================

def transition_assessment(
    db: Session,
    assessment_id: str,
    new_state: AssessmentState,
    new_stage: AssessmentStage,
    error_message: str = None,
) -> None:
    """
    Transitions the assessment to a new state.
    Used for threat modeling, review, and approval phases.
    Validates against ASSESSMENT_TRANSITIONS.
    """
    assessment = db.query(Assessment).filter_by(assessment_id=assessment_id).first()
    if not assessment:
        raise ValueError(f"Assessment not found: {assessment_id}")

    current_state = assessment.state
    allowed = ASSESSMENT_TRANSITIONS.get(current_state, set())

    # Allow same-state transitions (e.g., stage changes within PROCESSING)
    if new_state != current_state and new_state not in allowed:
        raise InvalidTransitionError(
            f"[Assessment {assessment_id}] Invalid transition: {current_state.value} → {new_state.value}. "
            f"Allowed: {[s.value for s in allowed]}"
        )

    assessment.state = new_state
    assessment.stage = new_stage
    if error_message is not None:
        assessment.error_message = error_message[:500] if error_message else None
    elif current_state == AssessmentState.FAILED:
        assessment.error_message = None

    db.commit()
    logger.info(f"[{assessment_id}] Assessment → {new_state.value} / {new_stage.value}")


# ==========================================
# Helpers
# ==========================================

def get_image_states(db: Session, assessment_id: str) -> list:
    """Returns a list of dicts with per-image state info."""
    images = db.query(DocumentAnalysis).filter_by(assessment_id=assessment_id).all()
    return [
        {
            "image_id": img.image_id,
            "image_path": img.image_path,
            "state": img.state,
            "stage": img.stage,
            "error_message": img.error_message,
        }
        for img in images
    ]
