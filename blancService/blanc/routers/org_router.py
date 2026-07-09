from blanc.core.auth.auth import require_roles
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from blanc.schemas.org import OrgCreate
from blanc.db.database import get_db
from blanc.db_models.models import Org
from blanc.utils import standard_response
import uuid

org_router = APIRouter(prefix="/org", tags=["Organization"], dependencies=[Depends(require_roles(["USER", "ADMIN"]))])

@org_router.post("/new")
def create_org(
    body: OrgCreate,
    db: Session = Depends(get_db)
):
    # 1️⃣ Check if org already exists
    existing = db.query(Org).filter(Org.name == body.name).first()
    if existing:
        return standard_response(
            400,
            "Organization already exists",
            {}
        )

    # 2️⃣ Create new org
    org_id = str(uuid.uuid4())
    new_org = Org(
        id=org_id,
        name=body.name,
        status="PENDING"
    )

    db.add(new_org)
    db.commit()
    db.refresh(new_org)

    # 3️⃣ Return standardized response
    data = {
        "id": new_org.id,
        "name": new_org.name,
        "status": new_org.status.lower()
    }

    return standard_response(
        200,
        "Organization created successfully",
        data
    )

@org_router.get("/all")
def get_all_organizations(
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Max records to return"),
    db: Session = Depends(get_db),
):
    """
    Fetch all organizations in the system.
    """
    orgs = db.query(Org).offset(skip).limit(limit).all()

    if not orgs:
        return standard_response(
            200,
            "No organizations found.",
            []
        )

    data = []
    for org in orgs:
        data.append({
            "id": org.id,
            "name": getattr(org, "name", None),  # Use the appropriate attribute
            "created_at": getattr(org, "created_at", None),  # Optional
            "status": getattr(org, "status", None)  # Optional
        })

    return standard_response(
        200,
        "Organizations fetched successfully.",
        data
    )

