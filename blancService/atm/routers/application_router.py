from atm.core.auth.auth import require_roles
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from atm.api_schemas.api_v1.onboarding import AppOnboardingRequest
from atm.db.database import get_db
from atm.utils import standard_response
from atm.services.application_service import ApplicationService

application_router = APIRouter(prefix="/app", tags=["Application_onboarding"], dependencies=[Depends(require_roles("ADMIN"))],)

@application_router.post("/onboarding")
def update_app_onboarding_responses(
    onboarding_request: AppOnboardingRequest, db: Session = Depends(get_db)
):
    """
    Stores/updates onboarding responses for an app and updates progress.
    """
    success = ApplicationService.save_responses(onboarding_request, db)
    
    if not success:
        return standard_response(400, "App not found", {})

    return standard_response(200, "App onboarding responses updated successfully.", None)


@application_router.get("/onboarding/{app_id}")
def get_app_onboarding_progress(app_id: str, db: Session = Depends(get_db)):
    """
    Returns progress for all categories for the given app.
    """
    data = ApplicationService.get_app_progress(app_id, db)

    if not data:
        return standard_response(
            200,
            f"No onboarding progress found for app_id '{app_id}'",
            {
                "app_id": app_id,
                "categories": []
            }
        )

    return standard_response(200, "App onboarding progress fetched successfully.", data)


@application_router.get("/category/{category_id}/name")
def get_category_name_for_app(category_id: str, db: Session = Depends(get_db)):
    """
    Fetch human-readable name of a category.
    """
    data = ApplicationService.get_category_name(category_id, db)

    if not data:
        return standard_response(404, f"Category with id '{category_id}' not found.", None)

    return standard_response(200, "Category name fetched successfully.", data)