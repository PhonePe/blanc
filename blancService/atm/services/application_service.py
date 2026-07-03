import logging
from typing import Dict, Any, Optional
from sqlalchemy.orm import Session

from atm.api_schemas.api_v1.onboarding import AppOnboardingRequest
from atm.crud import application_crud
from atm.db_models.models import ApplicationResponse, Question

class ApplicationService:
    
    @staticmethod
    def update_app_onboarding_status(app_id: str, category_id: str, db: Session):
        """Updates onboarding progress based on answered questions."""
        total_questions = application_crud.get_total_questions_by_category(db, category_id)
        answered_questions = application_crud.count_answered_questions(db, app_id, category_id)

        progress = application_crud.get_progress(db, app_id, category_id)
        
        # Get App to find Org ID
        app_obj = application_crud.get_app(db, app_id)
        org_id = getattr(app_obj, "org_id", None) if app_obj else None
        
        status = "COMPLETED" if answered_questions >= total_questions else "IN_PROGRESS"

        if not progress:
            application_crud.create_progress(db, app_id, category_id, status, org_id)
        else:
            application_crud.update_progress_status(db, progress, status, org_id)

    @staticmethod
    def save_responses(onboarding_request: AppOnboardingRequest, db: Session) -> bool:
        """
        Stores/updates onboarding responses. Returns True if successful, False if app not found.
        """
        app_id = onboarding_request.appId
        category_id = onboarding_request.category
        responses = onboarding_request.response

        if not application_crud.get_app(db, app_id):
            return False

        try:
            for resp in responses:
                existing_resp = application_crud.get_response(db, app_id, resp.questionId)
                if existing_resp:
                    existing_resp.response = resp.answer
                else:
                    application_crud.create_response_no_commit(db, app_id, resp.questionId, resp.answer)

            db.commit()

            # Update progress after successful commit
            ApplicationService.update_app_onboarding_status(app_id, category_id, db)
        except Exception as e:
            db.rollback()
            raise e

        return True

    @staticmethod
    def get_app_progress(app_id: str, db: Session) -> Optional[Dict[str, Any]]:
        rows = (
            db.query(ApplicationResponse, Question)
            .join(Question, ApplicationResponse.question_id == Question.id)
            .filter(ApplicationResponse.app_id == app_id)
            .all()
        )

        if not rows:
            return None

        # Pre-fetch total questions per category
        category_ids = {question.category_id for _, question in rows}
        category_totals = {}
        for cat_id in category_ids:
            category_totals[cat_id] = application_crud.get_total_questions_by_category(db, cat_id)

        categories = {}

        for resp, question in rows:
            cat_id = question.category_id
            if cat_id not in categories:
                categories[cat_id] = {
                    "category": cat_id,
                    "responses": [],
                    "answered_questions": 0,
                    "total_questions": category_totals[cat_id],
                    "status": "IN_PROGRESS"
                }

            categories[cat_id]["responses"].append({
                "questionId": resp.question_id,
                "question": question.question,
                "answer": resp.response
            })
            categories[cat_id]["answered_questions"] += 1

        # Determine status
        for cat in categories.values():
            if cat["answered_questions"] >= cat["total_questions"]:
                cat["status"] = "COMPLETED"

        data = {
            "app_id": app_id,
            "categories": list(categories.values())
        }
        logging.info(f"App onboarding progress fetched for app_id: {app_id}")
        return data

    @staticmethod
    def get_category_name(category_id: str, db: Session) -> Optional[Dict[str, str]]:
        category = application_crud.get_category(db, category_id)
        if not category:
            return None
        return {"id": category.id, "name": category.name}