import uuid
from sqlalchemy.orm import Session
from typing import Dict, Any, Optional

from blanc.db_models.models import OrganizationResponse, OnboardingProgress, Question, Category
from blanc.schemas.onboarding import OnboardingRequest

class OnboardingService:
    @staticmethod
    def get_total_questions_for_category(category_id: str, db: Session) -> int:
        """Count all questions belonging to a category."""
        return (
            db.query(Question)
            .filter(Question.category_id == category_id)
            .count()
        )

    @staticmethod
    def update_onboarding_status(org_id: str, category_id: str, db: Session):
        """
        Updates onboarding progress for a given organization + category.
        """
        total_questions = OnboardingService.get_total_questions_for_category(category_id, db)

        # Count answered questions
        answered_questions = (
            db.query(OrganizationResponse)
            .join(Question, OrganizationResponse.question_id == Question.id)
            .filter(
                OrganizationResponse.org_id == org_id,
                Question.category_id == category_id
            )
            .count()
        )

        # Check if progress exists
        progress = (
            db.query(OnboardingProgress)
            .filter(
                OnboardingProgress.org_id == org_id,
                OnboardingProgress.category_id == category_id,
                OnboardingProgress.entity_type == "ORG"
            )
            .first()
        )

        if not progress:
            progress = OnboardingProgress(
                id=str(uuid.uuid4()),
                org_id=org_id,
                entity_type="ORG",
                entity_id=org_id,
                category_id=category_id,
                status="IN_PROGRESS",
            )
            db.add(progress)

        progress.status = "COMPLETED" if answered_questions >= total_questions else "IN_PROGRESS"
        db.commit()

    @staticmethod
    def save_responses(onboarding_request: OnboardingRequest, db: Session):
        """
        Stores/updates onboarding responses for an organization and updates progress.
        """
        org_id = onboarding_request.orgId
        category_id = onboarding_request.category
        responses = onboarding_request.response

        # Use a single transaction for all question updates
        try:
            for response in responses:
                question_id = response.questionId
                answer = response.answer

                # Check if the response already exists
                existing_response = (
                    db.query(OrganizationResponse)
                    .filter(
                        OrganizationResponse.org_id == org_id,
                        OrganizationResponse.question_id == question_id,
                    )
                    .first()
                )

                if existing_response:
                    existing_response.response = answer
                else:
                    new_response = OrganizationResponse(
                        id=str(uuid.uuid4()),
                        org_id=org_id,
                        question_id=question_id,
                        response=answer,
                    )
                    db.add(new_response)
            
            db.commit()
            
            # Update status after successful commit of responses
            OnboardingService.update_onboarding_status(org_id, category_id, db)
            
        except Exception as e:
            db.rollback()
            raise e

    @staticmethod
    def get_org_progress(org_id: str, db: Session) -> Optional[Dict[str, Any]]:
        """
        Returns progress for all categories for the given org.
        """
        rows = (
            db.query(OrganizationResponse, Question)
            .join(Question, OrganizationResponse.question_id == Question.id)
            .filter(OrganizationResponse.org_id == org_id)
            .all()
        )

        if not rows:
            return None

        # Pre-fetch total questions per category in one query
        category_ids = {question.category_id for _, question in rows}
        category_totals = {}
        for cat_id in category_ids:
            category_totals[cat_id] = OnboardingService.get_total_questions_for_category(cat_id, db)

        categories = {}

        for response, question in rows:
            category_id = question.category_id

            if category_id not in categories:
                categories[category_id] = {
                    "category": category_id,
                    "responses": [],
                    "answered_questions": 0,
                    "total_questions": category_totals[category_id],
                    "status": "IN_PROGRESS"
                }

            categories[category_id]["responses"].append({
                "questionId": response.question_id,
                "question": question.question,
                "answer": response.response
            })
            categories[category_id]["answered_questions"] += 1

        # Assign status for each category
        for cat in categories.values():
            if cat["answered_questions"] >= cat["total_questions"]:
                cat["status"] = "COMPLETED"

        return {
            "organization_id": org_id,
            "categories": list(categories.values())
        }

    @staticmethod
    def get_category_name(category_id: str, db: Session) -> Optional[Dict[str, str]]:
        category = db.query(Category).filter(Category.id == category_id).first()
        if not category:
            return None
        return {
            "id": category.id,
            "name": category.name
        }