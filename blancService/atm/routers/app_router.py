from atm.core.auth.auth import require_roles
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from atm.api_schemas.api_v1.app import AppOnboardRequest
from atm.db.database import get_db
from atm.db_models.models import Org, App
from atm.utils import standard_response
import uuid



app_router = APIRouter(prefix="/app", tags=["App_Onboarding"], dependencies=[Depends(require_roles(["USER", "ADMIN"]))],)

@app_router.post("/onboard", response_model=dict)
def onboard_app(body: AppOnboardRequest, db: Session = Depends(get_db)):
    # 1) validate organization exists
    org = db.query(Org).filter(Org.id == body.org_id).first()
    if not org:
        return standard_response(400, "Organization not found", {})

    # 2) create app
    app_id = str(uuid.uuid4())
    new_app = App(
        id=app_id,
        name=body.name,
        org_id=body.org_id,
        status="IN_PROGRESS"  # app onboarding started
    )
    db.add(new_app)

    # commit
    try:
        db.commit()
        db.refresh(new_app)
    except Exception as e:
        db.rollback()
        return standard_response(500, "Failed to onboard app", {})

    # response
    data = {
        "id": new_app.id,
        "name": new_app.name,
        "org_id": new_app.org_id,
        "status": new_app.status.lower()
    }

    return standard_response(200, "App created successfully", data)

@app_router.get("/all", response_model=dict)
def get_all_apps(
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Max records to return"),
    db: Session = Depends(get_db),
):
    # fetch all apps
    apps = db.query(App).offset(skip).limit(limit).all()

    # prepare response data
    data = [
        {
            "id": app.id,
            "name": app.name,
            "org_id": app.org_id,
            "status": app.status.lower()
        }
        for app in apps
    ]

    return standard_response(200, "Apps fetched successfully", data)
