"""FastAPI app factory.

Split out of the historical ``main.py`` so importing the app doesn't
have side effects — starting RMQ consumers, running DB bootstrap,
scanning for stuck tasks. Those now live inside a proper ``lifespan``
handler that only runs when uvicorn is actually serving the app.

Usage in scripts / tests::

    from blanc.app import create_app
    app = create_app()

Usage in production (``main.py``)::

    from blanc.app import create_app
    app = create_app()
    if __name__ == "__main__":
        uvicorn.run(app, ...)
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from datetime import timedelta

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from blanc.config_parsers.log_utils import LoggingConfig
from blanc.config_parsers.settings import get_settings
from blanc.db.database import Base, engine, ensure_database_exists
from blanc.db_models.models import (
    Assessment,
    AssessmentStage,
    AssessmentState,
    DocumentAnalysis,
)
from blanc.db.database import get_db_session
from blanc.queue.producer import publish_task
from blanc.queue.rmq_message import RMQMessage, TaskType
from blanc.queue.threaded_consumer_wrapper import ThreadedConsumerWrapper
from blanc.util.time import now_utc

logger = logging.getLogger(__name__)


# ── Startup helpers ──────────────────────────────────────────────

def _ensure_uploads_dir(config) -> str:
    """Create + write-probe the uploads directory.

    Returns the resolved path so the caller can hand it to StaticFiles.
    Aborts startup if the process can't write there — otherwise the
    first upload would fail with a cryptic PermissionError inside
    starlette.
    """
    import tempfile

    uploads = config.storage.local_upload_dir or "uploads"
    os.makedirs(uploads, exist_ok=True)

    # Write-probe in a fresh tempfile INSIDE the uploads dir. Two constraints:
    #  1. Must be inside `uploads/` so we're actually checking THAT dir's perms.
    #  2. Must NOT trigger uvicorn's `--reload` file watcher — which would
    #     restart the app on every boot, killing any in-flight consumer.
    # tempfile.mkstemp opens with O_CREAT|O_EXCL, gives us a unique name,
    # and we unlink immediately. The create+delete pair happens in a single
    # tick, but WatchFiles debounces and detects both — so we use `.` prefix
    # to at least stay out of the way of noisy tools, and delete before the
    # first watcher poll cycle completes in practice.
    #
    # We use `dir_fd`-style probing (create+fsync+remove) with a leading
    # dot to keep the file hidden. If uvicorn STILL reload-flaps on this
    # dir, exclude it via `--reload-exclude uploads/*`.
    fd, probe_path = tempfile.mkstemp(prefix=".blanc_write_probe_", dir=uploads)
    try:
        os.close(fd)
        os.remove(probe_path)
    except OSError as e:
        raise RuntimeError(
            f"Uploads directory {uploads!r} is not writable ({e}). "
            "Check ownership / permissions — on Docker, the api container "
            "runs as uid=10001 (user 'blanc')."
        ) from e
    return uploads


async def _recover_stuck_tasks() -> None:
    """Re-publish any images / assessments that were mid-processing when
    the server last shut down.

    Only touches rows updated in the last 24h so ancient abandoned
    assessments don't get resurrected.
    """
    cutoff = now_utc().replace(tzinfo=None) - timedelta(hours=24)

    try:
        with get_db_session() as db:
            stuck_images = (
                db.query(DocumentAnalysis)
                .filter(
                    DocumentAnalysis.state.in_(
                        [AssessmentState.PENDING, AssessmentState.PROCESSING]
                    ),
                    DocumentAnalysis.created_at >= cutoff,
                )
                .all()
            )
            for img in stuck_images:
                parent = (
                    db.query(Assessment)
                    .filter_by(assessment_id=img.assessment_id)
                    .first()
                )
                if parent and parent.stage == AssessmentStage.THREAT_MODELING:
                    continue

                stored_mermaid = ""
                if isinstance(img.flow_diagram, dict):
                    stored_mermaid = (
                        img.flow_diagram.get("mermaid") or ""
                    ).strip()
                is_mermaid_row = (
                    not (img.image_path or "").strip() and bool(stored_mermaid)
                )

                if is_mermaid_row:
                    logger.info(
                        "[RECOVERY] Re-publishing IMAGE_ANALYSIS_PHASE_A_FROM_MERMAID "
                        "for %s/%s",
                        img.assessment_id, img.image_id,
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
                    # recover — mark it FAILED so the UI stops polling.
                    logger.warning(
                        "[RECOVERY] Skipping %s/%s: empty image_path and no "
                        "stored mermaid. Marking FAILED.",
                        img.assessment_id, img.image_id,
                    )
                    img.state = AssessmentState.FAILED
                    img.error_message = (
                        "Recovery skipped: no image and no mermaid text on record."
                    )
                    db.commit()
                    continue

                logger.info(
                    "[RECOVERY] Re-publishing IMAGE_ANALYSIS_PHASE_A for %s/%s",
                    img.assessment_id, img.image_id,
                )
                await publish_task(RMQMessage(
                    task_type=TaskType.IMAGE_ANALYSIS_PHASE_A,
                    assessment_id=img.assessment_id,
                    image_id=img.image_id,
                    image_path=img.image_path,
                    diagram_type=img.diagram_type,
                ))

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
                logger.info(
                    "[RECOVERY] Re-publishing THREAT_MODELING for %s",
                    a.assessment_id,
                )
                await publish_task(RMQMessage(
                    task_type=TaskType.THREAT_MODELING,
                    assessment_id=a.assessment_id,
                ))

            total = len(stuck_images) + len(stuck_threat)
            if total:
                logger.info(
                    "[RECOVERY] Re-published %d stuck tasks "
                    "(%d images, %d threat models)",
                    total, len(stuck_images), len(stuck_threat),
                )
            else:
                logger.info("[RECOVERY] No stuck tasks found")
    except Exception:
        # Recovery is best-effort — don't refuse to boot if it fails.
        logger.exception("[RECOVERY] Failed to recover stuck tasks")


# ── Lifespan handler ─────────────────────────────────────────────

@asynccontextmanager
async def _lifespan(app: FastAPI):
    """Start-and-stop side effects, isolated from module import.

    Runs once at server start, once at server stop. During tests we can
    build the app with :func:`create_app` without any of this firing.
    """
    logger.info("Starting Blanc backend")

    # Bring up threaded RMQ consumers — they connect on their own.
    consumer_wrapper = ThreadedConsumerWrapper()
    consumer_wrapper.start()
    app.state.consumer_wrapper = consumer_wrapper

    # Best-effort recovery of anything stuck when the server last stopped.
    await _recover_stuck_tasks()

    logger.info("Blanc backend ready")
    yield
    logger.info("Blanc backend shutting down")


# ── Uploads hardening middleware ─────────────────────────────────

async def _harden_uploads_response(request: Request, call_next):
    """Stored-XSS foot-gun on the ``/uploads`` StaticFiles mount:

    * ``nosniff`` kills browser MIME sniffing (blocks disguised SVG/HTML).
    * ``Content-Disposition: attachment`` forces download-not-render.
    * ``Referrer-Policy: no-referrer`` prevents accidental token leak.
    """
    response = await call_next(request)
    if request.url.path.startswith("/uploads/"):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers.setdefault("Content-Disposition", "attachment")
        response.headers["Referrer-Policy"] = "no-referrer"
    return response


async def _request_id_middleware(request: Request, call_next):
    """Attach a request-id to the ambient log context so every log line
    inside the handler carries it — no explicit passing required.

    Honour an inbound ``X-Request-ID`` header if the caller sends one
    (useful when the studio wants to correlate a click to a backend
    trace). Otherwise generate a fresh UUIDv4 truncated to 8 chars for
    readability.
    """
    from blanc.util.ids import new_id
    from blanc.util.logging_context import bind_log_context, clear_log_context

    incoming = request.headers.get("X-Request-ID")
    rid = incoming if incoming else new_id().replace("-", "")[:12]

    bind_log_context(request_id=rid)
    try:
        response = await call_next(request)
    finally:
        # Log context is per-async-task, so this clears the value ONLY
        # for the current task — cross-request bleed isn't possible. We
        # still clear as belt-and-braces for asyncio tasks that get
        # reused by uvicorn's worker pool.
        clear_log_context()

    response.headers["X-Request-ID"] = rid
    return response


# ── Factory ──────────────────────────────────────────────────────

def create_app() -> FastAPI:
    """Build the FastAPI app and wire its routers.

    Idempotent — safe to call from tests. All expensive side effects
    (RMQ, recovery scan) live in :func:`_lifespan` so they only run when
    uvicorn actually serves the app.
    """
    config = get_settings()
    LoggingConfig.configure_logging()

    # Ensure the schema is present on first boot.
    ensure_database_exists()
    Base.metadata.create_all(bind=engine)
    logger.info("Schema ready — Base.metadata.create_all() complete.")

    uploads_dir = _ensure_uploads_dir(config)

    app = FastAPI(
        title="Blanc",
        description="Blanc — AI-powered Threat Modeling Studio",
        lifespan=_lifespan,
    )

    # Register in order — middleware runs LIFO, so the request-id
    # middleware wraps the harden-uploads one and every downstream
    # handler sees the bound rid on every log line.
    app.middleware("http")(_harden_uploads_response)
    app.middleware("http")(_request_id_middleware)
    app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")

    # ── External integrations dispatcher ──────────────────────────
    # Build once at boot. Failure to build any single connector is
    # logged and does NOT block startup — the rest of the app is
    # still usable, we just skip external hydration for that source.
    from blanc.core.integrations.factory import build_dispatcher
    app.state.integrations_dispatcher = build_dispatcher(config)

    origins = sorted({
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        config.frontend.base_url,
    })
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        # `["*"]` for methods + headers combined with allow_credentials would
        # give any origin in the list full method / header freedom — tighten.
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Requested-With", "X-Request-ID"],
        max_age=600,
    )

    # Routers — import here (not at module top) so `create_app` stays the
    # single entry point for wiring the app graph.
    from blanc.routers import (
        app_router,
        application_router,
        assessment_router,
        auth_router,
        enum_router,
        health_check_router,
        llm_usage_router,
        onboarding_router,
        org_router,
        question_router,
        rag_router,
        reviews,
        threat_modeling_router,
    )
    from blanc.routers.admin_router import admin_router

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
    app.include_router(admin_router)

    return app


__all__ = ["create_app"]
