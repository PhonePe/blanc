from blanc.core.auth.auth import require_roles
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from blanc.schemas.onboarding import OnboardingRequest
from blanc.db.database import get_db
from blanc.utils import standard_response
from blanc.services.onboarding_service import OnboardingService

onboarding_router = APIRouter(tags=["ORG_onboarding"], dependencies=[Depends(require_roles("ADMIN"))],)

@onboarding_router.post("/onboarding")
def update_onboarding_responses(
        onboarding_request: OnboardingRequest, db: Session = Depends(get_db)
):
    """
    Stores/updates onboarding responses for an organization and updates progress.
    """
    OnboardingService.save_responses(onboarding_request, db)

    return standard_response(
        200,
        "Onboarding responses updated successfully.",
        None
    )


@onboarding_router.get("/onboarding/{org_id}")
def get_onboarding_progress(org_id: str, db: Session = Depends(get_db)):
    """
    Returns progress for all categories for the given org.
    """
    data = OnboardingService.get_org_progress(org_id, db)

    if not data:
        return standard_response(
            200,
            f"No onboarding progress found for org_id '{org_id}'",
            {
                "organization_id": org_id,
                "categories": []
            }
        )

    return standard_response(
        200,
        "Onboarding progress fetched successfully.",
        data
    )


@onboarding_router.get("/category/{category_id}/name")
def get_category_name(category_id: str, db: Session = Depends(get_db)):
    """
    Fetch the human-readable name of a category based on its ID.
    """
    data = OnboardingService.get_category_name(category_id, db)

    if not data:
        return standard_response(
            404, 
            f"Category with id '{category_id}' not found.",
            None
        )

    return standard_response(
        200,
        "Category name fetched successfully.",
        data
    )