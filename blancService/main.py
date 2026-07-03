import logging
import uvicorn
from fastapi import FastAPI
from atm.routers import assessment_router, auth_router
from fastapi.middleware.cors import CORSMiddleware
from atm.config_parsers.log_utils import LoggingConfig
from atm.config_parsers.settings import get_settings
from atm.db.database import Base, engine, SessionLocal
from atm.db_models import models
from atm.db_models.models import Assessment, DocumentAnalysis, AssessmentState, AssessmentStage
from atm.queue.threaded_consumer_wrapper import ThreadedConsumerWrapper
from atm.queue.producer import publish_task
from atm.queue.rmq_message import RMQMessage, TaskType
from atm.routers import org_router
from atm.routers import question_router
from atm.routers import onboarding_router
from atm.routers import app_router
from atm.routers import application_router
from atm.routers import threat_modeling_router
from atm.routers import health_check_router
from atm.routers import rag_router
from atm.routers import enum_router
from atm.routers import reviews
from atm.routers import llm_usage_router
from fastapi.staticfiles import StaticFiles

logger = logging.getLogger(__name__)

# Initialize Config and Logging
config = get_settings()
LoggingConfig.configure_logging()

# Ensure the schema is present on first boot. `atm.db.database` already
# ran CREATE DATABASE IF NOT EXISTS on import; here we ask SQLAlchemy to
# emit CREATE TABLE for anything the models declare that the DB doesn't
# have yet. Idempotent — existing tables are left alone. Column-level
# migrations (like the state/stage widening) are still your problem.
Base.metadata.create_all(bind=engine)
logger.info("Schema ready — Base.metadata.create_all() complete.")

app = FastAPI()


# --- /uploads hardening middleware -----------------------------------------
# The uploads StaticFiles mount is a stored-XSS foot-gun on its own: the
# server picks a Content-Type off the filename, and an attacker who
# managed to store an `.svg` or `.html` file would get script execution
# in this origin.
#
# We can't easily set headers via StaticFiles's response, so intercept in
# a middleware: for anything under /uploads/, add `X-Content-Type-Options: nosniff`
# (kills the browser's MIME sniffing) and `Content-Disposition: attachment`
# (forces download rather than inline render, defeating executable HTML/SVG).
@app.middleware("http")
async def _harden_uploads_response(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/uploads/"):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers.setdefault("Content-Disposition", "attachment")
        response.headers["Referrer-Policy"] = "no-referrer"
    return response


#mount static files for uploaded documents
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
# Start background consumer
threadedConsumerWrapper = ThreadedConsumerWrapper()
threadedConsumerWrapper.start()

# Define allowed origins. Add your deployed frontend URL via the
# FRONTEND_URL env var (or config.frontend.base_url) in production.
origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    config.frontend.base_url,
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(set(origins)),
    allow_credentials=True,
    # Explicit lists — was `["*"]` in both dimensions, which combined
    # with `allow_credentials=True` gave any origin in the list full
    # method / header freedom. Tighten to what the frontend actually uses.
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
    max_age=600,
)

# Include routers
app.include_router(assessment_router.assessment_router)
app.include_router(auth_router.auth_router)
app.include_router(org_router.org_router)
app.include_router(question_router.question_router)
app.include_router(onboarding_router.onboarding_router)
app.include_router(app_router.app_router)
app.include_router(application_router.application_router)
app.include_router(threat_modeling_router.threat_model_router)
app.include_router(health_check_router.health_router)
app.include_router(rag_router.router)
app.include_router(enum_router.router)
app.include_router(reviews.review_router)
app.include_router(llm_usage_router.llm_usage_router)


async def recover_stuck_tasks():
    """
    On startup, scan for assessments/images stuck in transient states
    (PENDING or PROCESSING) and re-publish their RMQ tasks.
    This handles the case where the server was restarted mid-processing
    and the RMQ message was lost.
    Only recovers tasks updated within the last 24 hours to avoid re-triggering
    ancient abandoned assessments.
    """
    from datetime import datetime, timedelta
    cutoff = datetime.utcnow() - timedelta(hours=24)

    db = SessionLocal()
    try:
        # 1. Re-publish stuck image analysis tasks
        stuck_images = (
            db.query(DocumentAnalysis)
            .filter(
                DocumentAnalysis.state.in_([AssessmentState.PENDING, AssessmentState.PROCESSING]),
                DocumentAnalysis.created_at >= cutoff,
            )
            .all()
        )
        for img in stuck_images:
            # Only re-publish if the parent assessment isn't in THREAT_MODELING stage
            parent = db.query(Assessment).filter_by(assessment_id=img.assessment_id).first()
            if parent and parent.stage == AssessmentStage.THREAT_MODELING:
                continue

            # Distinguish mermaid-mode rows from image-mode rows. Mermaid
            # rows have image_path="" (sentinel we set in the service) and
            # store the mermaid text on flow_diagram.mermaid. Recovery
            # must republish the right task type — the path guard on the
            # worker correctly refuses an empty image_path, so mermaid
            # rows would loop forever on IMAGE_ANALYSIS_PHASE_A.
            stored_mermaid = ""
            if isinstance(img.flow_diagram, dict):
                stored_mermaid = (img.flow_diagram.get("mermaid") or "").strip()

            is_mermaid_row = not (img.image_path or "").strip() and bool(stored_mermaid)

            if is_mermaid_row:
                logger.info(
                    f"[RECOVERY] Re-publishing IMAGE_ANALYSIS_PHASE_A_FROM_MERMAID "
                    f"for {img.assessment_id}/{img.image_id}"
                )
                await publish_task(RMQMessage(
                    task_type=TaskType.IMAGE_ANALYSIS_PHASE_A_FROM_MERMAID,
                    assessment_id=img.assessment_id,
                    image_id=img.image_id,
                    mermaid_text=stored_mermaid,
                    diagram_type=img.diagram_type,
                ))
                continue

            if not (img.image_path or "").strip():
                # Legacy dead row: no file, no mermaid text. Nothing to
                # recover — skip it rather than looping. Mark it FAILED
                # so the UI stops polling.
                logger.warning(
                    f"[RECOVERY] Skipping {img.assessment_id}/{img.image_id}: "
                    "empty image_path and no stored mermaid. Marking FAILED."
                )
                img.state = AssessmentState.FAILED
                img.error_message = "Recovery skipped: no image and no mermaid text on record."
                db.commit()
                continue

            logger.info(
                f"[RECOVERY] Re-publishing IMAGE_ANALYSIS_PHASE_A for "
                f"{img.assessment_id}/{img.image_id}"
            )
            await publish_task(RMQMessage(
                task_type=TaskType.IMAGE_ANALYSIS_PHASE_A,
                assessment_id=img.assessment_id,
                image_id=img.image_id,
                image_path=img.image_path,
                diagram_type=img.diagram_type,
            ))

        # 2. Re-publish stuck threat modeling tasks
        stuck_threat = (
            db.query(Assessment)
            .filter(
                Assessment.state == AssessmentState.PROCESSING,
                Assessment.stage == AssessmentStage.THREAT_MODELING,
                Assessment.updated_at >= cutoff,
            )
            .all()
        )
        for a in stuck_threat:
            logger.info(f"[RECOVERY] Re-publishing THREAT_MODELING for {a.assessment_id}")
            await publish_task(RMQMessage(
                task_type=TaskType.THREAT_MODELING,
                assessment_id=a.assessment_id,
            ))

        total = len(stuck_images) + len(stuck_threat)
        if total:
            logger.info(f"[RECOVERY] Re-published {total} stuck tasks ({len(stuck_images)} images, {len(stuck_threat)} threat models)")
        else:
            logger.info("[RECOVERY] No stuck tasks found")
    except Exception as e:
        logger.error(f"[RECOVERY] Failed to recover stuck tasks: {e}")
    finally:
        db.close()


@app.on_event("startup")
async def startup_recovery():
    await recover_stuck_tasks()


if __name__ == "__main__":
    uvicorn.run("main:app",
                host=config.fastApiConfig.appHost,
                port=config.fastApiConfig.appPort,
                workers=config.fastApiConfig.num_workers,
                reload=True,
                use_colors=False)
