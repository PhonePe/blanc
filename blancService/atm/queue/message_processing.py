import asyncio
import logging
import os
import traceback

from atm.config_parsers.settings import get_settings
from atm.core.document_analysis import (
    analyze_single_image_phase_a,
    analyze_single_image_phase_a_from_mermaid,
    analyze_single_image_phase_b,
)
from atm.core.llm_client import set_assessment_context
from atm.core.threat_modeling import threat_modeling_pipeline
from atm.db.database import SessionLocal
from atm.db_models.models import Assessment, DocumentAnalysis, AssessmentState
from atm.queue.rmq_message import RMQMessage, TaskType

# RAG imports for PDF ingestion
from atm.core.rag_client.extractor import extract_text_from_pdf_bytes
from atm.core.rag_client.chunker import generate_appsec_chunks
from atm.core.rag_client.factory import get_rag_client

config = get_settings()
logger = logging.getLogger(__name__)

MAX_RETRIES = 3


def _safe_upload_path(assessment_id: str, path: str) -> str:
    """Resolve ``path`` and confirm it lives inside ``uploads/{assessment_id}/``.

    RMQ messages carry absolute file paths in ``image_path`` / ``pdf_path``.
    Without this check, anyone who can publish to the queue (or steal the
    guest:guest credentials) could enqueue ``pdf_path=/etc/passwd`` and the
    consumer would happily ingest it into the RAG store or feed it to the
    LLM.

    Raises ``ValueError`` for anything outside the assessment's upload
    folder. Callers should treat the exception as an operational failure
    and drop the message.
    """
    root = os.path.abspath(os.path.join("uploads", assessment_id))
    full = os.path.abspath(path)
    if full != root and not full.startswith(root + os.sep):
        raise ValueError(
            f"Path {path!r} does not live under uploads/{assessment_id}/"
        )
    return full


async def dispatch_task(rmq_msg: RMQMessage):
    """
    Core dispatcher: routes an RMQMessage to the correct handler.
    Called from both the RMQ consumer callback and the in-process fallback.
    """
    # Normalise the raw string from the JSON payload into a TaskType enum so
    # downstream comparisons work whether the producer sent the value as a
    # plain string or an enum member.
    raw_task_type = rmq_msg.task_type
    try:
        task_type = raw_task_type if isinstance(raw_task_type, TaskType) else TaskType(raw_task_type)
    except ValueError:
        logger.error(
            f"[{rmq_msg.assessment_id}] Unknown task_type '{raw_task_type}'. "
            f"Known types: {[t.value for t in TaskType]}"
        )
        return

    assessment_id = rmq_msg.assessment_id

    if not assessment_id:
        logger.error("RMQ message missing assessment_id, discarding.")
        return

    logger.info(f"[{assessment_id}] Processing task: {task_type.value}")

    try:
        if task_type == TaskType.IMAGE_ANALYSIS_PHASE_A:
            await _handle_image_phase_a(rmq_msg)
        elif task_type == TaskType.IMAGE_ANALYSIS_PHASE_A_FROM_MERMAID:
            await _handle_image_phase_a_from_mermaid(rmq_msg)
        elif task_type == TaskType.IMAGE_ANALYSIS_PHASE_B:
            await _handle_image_phase_b(rmq_msg)
        elif task_type == TaskType.PDF_INGESTION:
            await _handle_pdf_ingestion(rmq_msg)
        elif task_type == TaskType.THREAT_MODELING:
            await _handle_threat_modeling(rmq_msg)
        else:
            logger.error(f"[{assessment_id}] Unhandled task_type: {task_type.value}")
    except Exception as e:
        logger.error(
            f"[{assessment_id}] Unhandled error in {task_type.value}: {e}\n"
            f"{traceback.format_exc()}"
        )


async def callback(msg):
    """
    RMQ consumer callback — parses message body and delegates to dispatch_task.
    """
    rmq_msg = RMQMessage.from_bytes(msg.body)
    await dispatch_task(rmq_msg)


# ── Image Analysis Phase A (mermaid + components) ───────────────

async def _handle_image_phase_a(rmq_msg: RMQMessage):
    assessment_id = rmq_msg.assessment_id
    image_id = rmq_msg.image_id
    image_path = rmq_msg.image_path

    if not image_id:
        logger.error(f"[{assessment_id}] PHASE_A message missing image_id")
        return

    set_assessment_context(assessment_id)

    db = SessionLocal()
    try:
        image_analysis = (
            db.query(DocumentAnalysis)
            .filter_by(assessment_id=assessment_id, image_id=image_id)
            .first()
        )
        if not image_analysis:
            logger.warning(f"[{assessment_id}] DocumentAnalysis not found for image {image_id}")
            return

        if image_analysis.state not in (AssessmentState.PENDING, AssessmentState.FAILED):
            logger.info(
                f"[{assessment_id}] Image {image_id} in state {image_analysis.state.value}, skipping Phase A."
            )
            return

        diagram_type = rmq_msg.diagram_type or image_analysis.diagram_type or "flowchart TD"
        # Refuse absolute paths that escape uploads/{assessment_id}/.
        try:
            resolved_path = _safe_upload_path(
                assessment_id, image_path or image_analysis.image_path
            )
        except ValueError as e:
            logger.error(
                f"[{assessment_id}][img:{image_id}] Rejecting Phase A: {e}"
            )
            return
        await asyncio.to_thread(
            analyze_single_image_phase_a,
            assessment_id=assessment_id,
            image_id=image_id,
            image_path=resolved_path,
            diagram_type=diagram_type,
        )
    except Exception as e:
        logger.error(f"[{assessment_id}][img:{image_id}] Phase A failed: {e}")
    finally:
        db.close()


# ── Image Analysis Phase A — from mermaid (ATM Studio flow) ─────

async def _handle_image_phase_a_from_mermaid(rmq_msg: RMQMessage):
    """Same slot as Phase A, but the caller already handed us the
    Mermaid text — skip the vision LLM call and jump straight into the
    inventory (surface_map + components) generation.
    """
    assessment_id = rmq_msg.assessment_id
    image_id = rmq_msg.image_id
    mermaid_text = rmq_msg.mermaid_text

    if not image_id:
        logger.error(f"[{assessment_id}] PHASE_A_FROM_MERMAID message missing image_id")
        return
    if not mermaid_text:
        logger.error(f"[{assessment_id}] PHASE_A_FROM_MERMAID message missing mermaid_text")
        return

    set_assessment_context(assessment_id)

    db = SessionLocal()
    try:
        image_analysis = (
            db.query(DocumentAnalysis)
            .filter_by(assessment_id=assessment_id, image_id=image_id)
            .first()
        )
        if not image_analysis:
            logger.warning(f"[{assessment_id}] DocumentAnalysis not found for image {image_id}")
            return

        if image_analysis.state not in (AssessmentState.PENDING, AssessmentState.FAILED):
            logger.info(
                f"[{assessment_id}] Image {image_id} in state {image_analysis.state.value}, "
                "skipping Phase A (from mermaid)."
            )
            return

        diagram_type = rmq_msg.diagram_type or image_analysis.diagram_type or "flowchart TD"
        await asyncio.to_thread(
            analyze_single_image_phase_a_from_mermaid,
            assessment_id=assessment_id,
            image_id=image_id,
            mermaid_text=mermaid_text,
            diagram_type=diagram_type,
        )
    except Exception as e:
        logger.error(f"[{assessment_id}][img:{image_id}] Phase A (from mermaid) failed: {e}")
    finally:
        db.close()


# ── Image Analysis Phase B (summary + clarification) ────────────

async def _handle_image_phase_b(rmq_msg: RMQMessage):
    assessment_id = rmq_msg.assessment_id
    image_id = rmq_msg.image_id

    if not image_id:
        logger.error(f"[{assessment_id}] PHASE_B message missing image_id")
        return

    set_assessment_context(assessment_id)

    db = SessionLocal()
    try:
        image_analysis = (
            db.query(DocumentAnalysis)
            .filter_by(assessment_id=assessment_id, image_id=image_id)
            .first()
        )
        if not image_analysis:
            logger.warning(f"[{assessment_id}] DocumentAnalysis not found for image {image_id}")
            return

        if image_analysis.state != AssessmentState.AWAITING_REVIEW:
            logger.info(
                f"[{assessment_id}] Image {image_id} in state {image_analysis.state.value}, "
                "expected AWAITING_REVIEW. Skipping Phase B."
            )
            return

        await asyncio.to_thread(
            analyze_single_image_phase_b,
            assessment_id=assessment_id,
            image_id=image_id,
        )
    except Exception as e:
        logger.error(f"[{assessment_id}][img:{image_id}] Phase B failed: {e}")
    finally:
        db.close()


# ── PDF Ingestion Handler ────────────────────────────────────────

async def _handle_pdf_ingestion(rmq_msg: RMQMessage):
    assessment_id = rmq_msg.assessment_id
    pdf_path = rmq_msg.pdf_path
    filename = rmq_msg.filename or "document.pdf"

    if not pdf_path:
        logger.error(f"[{assessment_id}] PDF_INGESTION message missing pdf_path")
        return

    # Refuse absolute paths that escape uploads/{assessment_id}/.
    try:
        pdf_path = _safe_upload_path(assessment_id, pdf_path)
    except ValueError as e:
        logger.error(f"[{assessment_id}] Rejecting PDF_INGESTION: {e}")
        return

    try:
        if not os.path.exists(pdf_path):
            logger.error(f"[{assessment_id}] PDF file not found at: {pdf_path}")
            return

        # Run CPU-bound PDF extraction + chunking off the event loop
        def _extract_and_chunk():
            with open(pdf_path, "rb") as f:
                pdf_bytes = f.read()
            pages_data = extract_text_from_pdf_bytes(pdf_bytes)
            if not pages_data:
                return None
            return list(generate_appsec_chunks(
                pages_data=pages_data,
                source_name=filename,
                source_url="",
                chunk_size=712,
                overlap=75,
                assessment_id=assessment_id,
            ))

        chunks = await asyncio.to_thread(_extract_and_chunk)

        if not chunks:
            logger.warning(f"[{assessment_id}] PDF '{filename}' yielded no text or chunks.")
            return

        vector_client = get_rag_client(config)
        await vector_client.ingest_batch(
            namespace=config.rag_config.namespace,
            collection_id=config.rag_config.collection_id,
            chunks=chunks,
        )
        logger.info(f"[{assessment_id}] PDF '{filename}' ingested: {len(chunks)} chunks.")

    except Exception as e:
        logger.error(f"[{assessment_id}] PDF ingestion failed for '{filename}': {e}")


# ── Threat Modeling Handler ──────────────────────────────────────

async def _handle_threat_modeling(rmq_msg: RMQMessage):
    assessment_id = rmq_msg.assessment_id

    db = SessionLocal()
    try:
        assessment = db.query(Assessment).filter_by(assessment_id=assessment_id).first()
        if not assessment:
            logger.error(f"[{assessment_id}] Assessment not found for threat modeling.")
            return

        if assessment.state != AssessmentState.PROCESSING:
            logger.warning(
                f"[{assessment_id}] Expected PROCESSING state for threat modeling, "
                f"got {assessment.state.value}. Skipping."
            )
            return
    finally:
        db.close()

    try:
        framework = assessment.framework or "STRIDE"
        await asyncio.to_thread(threat_modeling_pipeline, assessment_id, framework)

        # Clean up entire local cache folder after threat modeling completes
        try:
            from atm.core.storage import get_storage_backend
            storage = get_storage_backend()
            storage.cleanup_assessment_cache(assessment_id)
        except Exception as cleanup_err:
            logger.warning(f"[{assessment_id}] Assessment cache cleanup skipped: {cleanup_err}")

    except Exception as e:
        logger.error(f"[{assessment_id}] Threat modeling pipeline failed: {e}")
        # threat_modeling_pipeline handles its own FAILED transition internally
