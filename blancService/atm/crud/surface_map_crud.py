"""
CRUD helpers for the Surface Discovery / ThreatModeller inventory.

Single-table store: one row per (assessment_id, image_id) holding the
full surface_map JSON. Survives Mermaid re-syncs because manual edits live
in the JSON payload, not in `DocumentAnalysis.flow_diagram`.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from atm.api_schemas.api_v1.threat_modeling_schema import SurfaceMapPayload
from atm.db_models.models import SurfaceMap


def get_surface_map(db: Session, assessment_id: str, image_id: str) -> Optional[SurfaceMap]:
    return (
        db.query(SurfaceMap)
        .filter(
            SurfaceMap.assessment_id == assessment_id,
            SurfaceMap.image_id == image_id,
        )
        .first()
    )


def upsert_surface_map(
    db: Session,
    assessment_id: str,
    image_id: str,
    payload: SurfaceMapPayload,
) -> SurfaceMap:
    row = get_surface_map(db, assessment_id, image_id)
    # `by_alias=False` keeps snake_case keys (trust_level, threat_level)
    blob = payload.model_dump(by_alias=False, exclude_none=False)

    if row is None:
        row = SurfaceMap(
            assessment_id=assessment_id,
            image_id=image_id,
            surface_map=blob,
        )
        db.add(row)
    else:
        row.surface_map = blob

    db.commit()
    db.refresh(row)
    return row


def delete_surface_map(db: Session, assessment_id: str, image_id: str) -> bool:
    row = get_surface_map(db, assessment_id, image_id)
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True
