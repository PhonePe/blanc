"""
CRUD helpers for the Surface Discovery / ThreatModeller inventory.

Single-table store: one row per (assessment_id, image_id) holding the
full surface_map JSON. Survives Mermaid re-syncs because manual edits live
in the JSON payload, not in `DocumentAnalysis.flow_diagram`.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Optional

from mariadb import OperationalError as MariaDBOperationalError
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from blanc.schemas.surface_map import SurfaceMapPayload
from blanc.db_models.models import SurfaceMap

logger = logging.getLogger(__name__)


# Retry knobs for MariaDB's ``Record has changed since last read`` (aka
# ``HA_ERR_RECORD_CHANGED``, error 1020 in some builds). This can fire from
# ``INSERT ... ON DUPLICATE KEY UPDATE`` on composite PKs when InnoDB's
# unique-key probe races another transaction's lock. Retrying with a fresh
# transaction almost always succeeds — the racing transaction has
# committed by the time we re-enter.
_MAX_UPSERT_ATTEMPTS = 4
_UPSERT_BACKOFF_SECONDS = (0.05, 0.15, 0.4)  # matches attempts 2, 3, 4


def _is_record_changed_error(exc: BaseException) -> bool:
    """True if the exception chain contains MariaDB's ``Record has changed``."""
    seen: set[int] = set()
    cur: Optional[BaseException] = exc
    while cur is not None and id(cur) not in seen:
        seen.add(id(cur))
        msg = str(cur).lower()
        if "record has changed since last read" in msg:
            return True
        cur = cur.__cause__ or cur.__context__
    return False


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
    """Atomic upsert via ``INSERT ... ON DUPLICATE KEY UPDATE`` with retry.

    The bare upsert still occasionally races under InnoDB — the fingerprint
    is MariaDB's ``OperationalError: Record has changed since last read in
    table 'surface_map'``. It happens when a unique-key probe finds a
    version-marked row whose lock is held by another transaction between
    check and take. Retrying with a rolled-back session almost always
    succeeds because the racing writer has committed by then.

    ``by_alias=False`` keeps snake_case keys (trust_level, threat_level).
    """
    blob = payload.model_dump(by_alias=False, exclude_none=False)

    last_error: Optional[BaseException] = None
    for attempt in range(1, _MAX_UPSERT_ATTEMPTS + 1):
        now = datetime.utcnow()
        stmt = mysql_insert(SurfaceMap.__table__).values(
            assessment_id=assessment_id,
            image_id=image_id,
            surface_map=blob,
            created_at=now,
            updated_at=now,
        )
        # On duplicate PK: refresh the payload and bump updated_at.
        # Preserve original created_at.
        stmt = stmt.on_duplicate_key_update(
            surface_map=stmt.inserted.surface_map,
            updated_at=stmt.inserted.updated_at,
        )
        try:
            db.execute(stmt)
            db.commit()
            break
        except (OperationalError, MariaDBOperationalError) as e:
            last_error = e
            # Roll back the poisoned session so the next attempt starts
            # from a clean slate. Without this the next db.execute would
            # inherit PendingRollbackError.
            db.rollback()

            if not _is_record_changed_error(e):
                raise

            if attempt < _MAX_UPSERT_ATTEMPTS:
                sleep_for = _UPSERT_BACKOFF_SECONDS[attempt - 1]
                logger.warning(
                    "upsert_surface_map hit HA_ERR_RECORD_CHANGED "
                    "(attempt %d/%d, backing off %.2fs) for %s/%s",
                    attempt, _MAX_UPSERT_ATTEMPTS, sleep_for,
                    assessment_id, image_id,
                )
                time.sleep(sleep_for)
                continue
            # Fell out of retries — bubble the last error up.
            logger.exception(
                "upsert_surface_map exhausted retries for %s/%s",
                assessment_id, image_id,
            )
            raise
    else:
        # for/else — no break happened → we exhausted the loop without
        # a successful commit. Should be unreachable because the raise
        # above triggers first, but included for defensive symmetry.
        assert last_error is not None
        raise last_error

    row = get_surface_map(db, assessment_id, image_id)
    assert row is not None, (
        "surface_map row disappeared immediately after upsert — "
        "check DB replication / isolation"
    )
    return row


def delete_surface_map(db: Session, assessment_id: str, image_id: str) -> bool:
    row = get_surface_map(db, assessment_id, image_id)
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True
