import os
import uuid
import json
import logging
import asyncio
from typing import List, Dict, Any
from fastapi import UploadFile, HTTPException
from sqlalchemy.orm import Session
from fastapi.encoders import jsonable_encoder

from blanc.crud import assessment_crud
from blanc.core.state_machine import transition_assessment, transition_image, get_image_states
from blanc.config_parsers.settings import get_settings
from blanc.util.file_sniff import safe_filename
from blanc.db_models.models import (
    Assessment,
    AssessmentState,
    AssessmentStage,
    DocumentAnalysis,
    AssessmentResults,
    AssessmentDocument,
)

# RMQ imports
from blanc.queue.rmq_message import RMQMessage, TaskType
from blanc.queue.producer import publish_task

# RAG imports
from blanc.core.rag_client.factory import get_rag_client
from blanc.core.llm_client import get_llm_client, set_assessment_context
from blanc.core.storage import get_storage_backend
from blanc.skills import get_skill

config = get_settings()


def _phase_a_task_for_image(analysis: DocumentAnalysis) -> RMQMessage:
    """Build the Phase A RMQ message for one image row.

    Chooses between the image-based (``IMAGE_ANALYSIS_PHASE_A``) and
    mermaid-based (``IMAGE_ANALYSIS_PHASE_A_FROM_MERMAID``) task types.
    A row is treated as mermaid-input when its ``image_path`` is empty
    AND its ``flow_diagram`` carries a non-empty Mermaid string — the
    same rule the startup recovery loop uses in :mod:`blanc.app`, kept
    identical so retry / recovery cannot diverge.
    """
    stored_mermaid = ""
    if isinstance(analysis.flow_diagram, dict):
        stored_mermaid = (analysis.flow_diagram.get("mermaid") or "").strip()

    is_mermaid_row = not (analysis.image_path or "").strip() and bool(stored_mermaid)

    if is_mermaid_row:
        return RMQMessage(
            task_type=TaskType.IMAGE_ANALYSIS_PHASE_A_FROM_MERMAID,
            assessment_id=analysis.assessment_id,
            image_id=analysis.image_id,
            mermaid_text=stored_mermaid,
            diagram_type=analysis.diagram_type,
        )

    return RMQMessage(
        task_type=TaskType.IMAGE_ANALYSIS_PHASE_A,
        assessment_id=analysis.assessment_id,
        image_id=analysis.image_id,
        image_path=analysis.image_path,
        diagram_type=analysis.diagram_type,
    )


def _format_onboarding_qna(
    qna: List[Dict[str, str]],
    *,
    max_chars: int = 4000,
) -> str:
    """Render an org / app onboarding Q&A list for the auto-answer prompt.

    Compact ``[category] Q → A`` bullets, one per line. Truncates at
    ``max_chars`` (falling back to a whole-entry boundary rather than
    mid-answer) so a very large onboarding set doesn't blow the LLM
    context budget for a single clarification question.

    Empty input returns the same sentinel the caller uses for "no data
    available" so the two branches converge in the prompt.
    """
    if not qna:
        return "(no onboarding answers recorded)"

    lines: List[str] = []
    used = 0
    for entry in qna:
        q = (entry.get("question") or "").strip()
        a = (entry.get("answer") or "").strip()
        if not q or not a:
            continue
        cat = (entry.get("category") or "").strip()
        prefix = f"[{cat}] " if cat else ""
        line = f"- {prefix}{q} → {a}"
        # +1 for the newline joiner.
        if used + len(line) + 1 > max_chars and lines:
            lines.append(
                f"- … ({len(qna) - len(lines)} more onboarding answers truncated)"
            )
            break
        lines.append(line)
        used += len(line) + 1

    if not lines:
        return "(no onboarding answers recorded)"
    return "\n".join(lines)


class AssessmentService:
    @staticmethod
    async def create_new_assessment(
        db: Session,
        assessment_data,
        images: List[UploadFile],
        user_id: str,
        pdf_file: UploadFile = None,
        supporting_docs: List[UploadFile] = None,
        mermaid_texts: List[str] = None,
    ):
        """
        Creates a new assessment.

        Two input modes (caller ensures exactly one is populated):
          * ``images``       — per-image Phase A (vision → mermaid → components).
          * ``mermaid_texts`` — per-mermaid Phase A that skips the vision step
                                and starts at inventory generation.

        PDF ingestion (``pdf_file`` and ``supporting_docs``) is the same
        either way.

        Any DB error at any step rolls the whole thing back so the next
        request can use the same session cleanly. Without this, a
        constraint violation (e.g. a String(255) field receiving
        longer text) leaves the session in a "pending rollback" state
        and every downstream ``db.add()`` in this same request raises
        ``PendingRollbackError`` — which is what surfaces to the user
        as "Session's transaction has been rolled back".
        """
        try:
            return await AssessmentService._create_new_assessment_inner(
                db, assessment_data, images, user_id,
                pdf_file=pdf_file,
                supporting_docs=supporting_docs,
                mermaid_texts=mermaid_texts,
            )
        except HTTPException:
            db.rollback()
            raise
        except Exception as e:
            db.rollback()
            logging.exception("create_new_assessment failed; session rolled back: %s", e)
            raise HTTPException(
                status_code=500,
                detail="Failed to create assessment. Check server logs for the root cause.",
            )

    @staticmethod
    async def _create_new_assessment_inner(
        db: Session,
        assessment_data,
        images: List[UploadFile],
        user_id: str,
        pdf_file: UploadFile = None,
        supporting_docs: List[UploadFile] = None,
        mermaid_texts: List[str] = None,
    ):
        # 1. Create DB Entry (State: PENDING, Stage: INITIALIZING)
        assessment = assessment_crud.create_assessment_entry(db, assessment_data, user_id)
        set_assessment_context(assessment.assessment_id)

        storage = get_storage_backend()
        storage.ensure_dirs(assessment.assessment_id)

        # 2. Save images and create per-image DocumentAnalysis rows
        image_tasks = []  # (image_id, full_path) tuples
        for image_file in images:
            _, ext = os.path.splitext(image_file.filename)
            image_id = str(uuid.uuid4())
            file_name = f"{image_id}{ext}"

            try:
                content = await image_file.read()
                result = storage.save(
                    content=content,
                    assessment_id=assessment.assessment_id,
                    filename=file_name,
                    original_filename=safe_filename(image_file.filename),
                )
            except Exception as e:
                logging.exception(f"File save failed for {safe_filename(image_file.filename)}")
                raise HTTPException(status_code=500, detail=f"Could not save file: {image_file.filename}")

            # Document entry for tracking
            file_meta = {
                "original_filename": safe_filename(image_file.filename),
                "stored_path": result.stored_path,
                "storage_backend": result.backend,
            }
            if result.public_url:
                file_meta["public_url"] = result.public_url
            if result.document_id:
                file_meta["document_id"] = result.document_id
            assessment_crud.create_document_entry(db, assessment.assessment_id, "IMAGE", file_meta)

            # Always use the local absolute path for downstream processing
            # (LLM/RAG pipelines read bytes directly from disk). The public
            # URL is still persisted in file_meta for UI/CDN rendering.
            analysis_image_path = result.absolute_path

            # Per-image analysis row
            assessment_crud.create_image_analysis_entry(
                db, assessment.assessment_id, image_id, analysis_image_path,
                diagram_type=assessment_data.diagram_type.value,
            )

            image_tasks.append((image_id, analysis_image_path))

        # 3. Handle optional PDF — extract, chunk, ingest into vector DB
        if pdf_file:
            _, pdf_ext = os.path.splitext(pdf_file.filename)
            pdf_name = f"{str(uuid.uuid4())}{pdf_ext}"

            try:
                pdf_bytes = await pdf_file.read()
                result = storage.save(
                    content=pdf_bytes,
                    assessment_id=assessment.assessment_id,
                    filename=pdf_name,
                    original_filename=safe_filename(pdf_file.filename),
                )
            except Exception as e:
                logging.exception(f"PDF save failed")
                raise HTTPException(status_code=500, detail="Could not save PDF.")

            pdf_meta = {
                "original_filename": safe_filename(pdf_file.filename),
                "stored_path": result.stored_path,
                "storage_backend": result.backend,
            }
            if result.public_url:
                pdf_meta["public_url"] = result.public_url
            if result.document_id:
                pdf_meta["document_id"] = result.document_id
            assessment_crud.create_document_entry(db, assessment.assessment_id, "PDF", pdf_meta)

            # Queue PDF ingestion via RMQ
            await publish_task(RMQMessage(
                task_type=TaskType.PDF_INGESTION,
                assessment_id=assessment.assessment_id,
                pdf_path=result.absolute_path,
                filename=safe_filename(pdf_file.filename),
            ))

        # 3b. Handle optional supporting documents — multiple PDFs for RAG context
        if supporting_docs:
            for doc_file in supporting_docs:
                _, doc_ext = os.path.splitext(doc_file.filename)
                doc_name = f"{str(uuid.uuid4())}{doc_ext}"

                try:
                    doc_bytes = await doc_file.read()
                    result = storage.save(
                        content=doc_bytes,
                        assessment_id=assessment.assessment_id,
                        filename=doc_name,
                        original_filename=safe_filename(doc_file.filename),
                    )
                except Exception as e:
                    logging.exception(f"Supporting doc save failed for {safe_filename(doc_file.filename)}")
                    raise HTTPException(status_code=500, detail=f"Could not save supporting document: {doc_file.filename}")

                doc_meta = {
                    "original_filename": safe_filename(doc_file.filename),
                    "stored_path": result.stored_path,
                    "storage_backend": result.backend,
                }
                if result.public_url:
                    doc_meta["public_url"] = result.public_url
                if result.document_id:
                    doc_meta["document_id"] = result.document_id
                assessment_crud.create_document_entry(db, assessment.assessment_id, "PDF", doc_meta)

                await publish_task(RMQMessage(
                    task_type=TaskType.PDF_INGESTION,
                    assessment_id=assessment.assessment_id,
                    pdf_path=result.absolute_path,
                    filename=safe_filename(doc_file.filename),
                ))

        # 3c. Handle mermaid_texts (Blanc Studio flow) — no file upload.
        # Each mermaid text becomes its own DocumentAnalysis row that
        # will start Phase A at the inventory step (skipping vision).
        #
        # We also persist the mermaid text into `flow_diagram` on the
        # row RIGHT NOW, before publishing to RMQ. Two reasons:
        #   1. If the worker dies between publish and consume, the
        #      startup recovery loop can find the mermaid in the DB
        #      and republish the FROM_MERMAID task type. Without this,
        #      the recovery loop would (and did) re-publish these as
        #      IMAGE_ANALYSIS_PHASE_A with empty image_path, which
        #      the path-guard correctly refuses.
        #   2. The frontend can render the Studio-supplied diagram
        #      immediately while the LLM's own components extraction
        #      is still in flight.
        mermaid_tasks = []  # (image_id, mermaid_text) tuples
        if mermaid_texts:
            for mermaid_text in mermaid_texts:
                image_id = str(uuid.uuid4())
                record = assessment_crud.create_image_analysis_entry(
                    db,
                    assessment.assessment_id,
                    image_id,
                    image_path="",  # sentinel — no file backs this row
                    diagram_type=assessment_data.diagram_type.value,
                )
                record.flow_diagram = {"mermaid": mermaid_text}
                mermaid_tasks.append((image_id, mermaid_text))

        db.commit()

        # 4. Queue per-image analysis via RMQ (Phase A only — user gates Phase B)
        for image_id, full_path in image_tasks:
            await publish_task(RMQMessage(
                task_type=TaskType.IMAGE_ANALYSIS_PHASE_A,
                assessment_id=assessment.assessment_id,
                image_id=image_id,
                image_path=full_path,
                diagram_type=assessment_data.diagram_type.value,
            ))

        # 4b. Queue per-mermaid analysis via RMQ (Phase A from mermaid).
        for image_id, mermaid_text in mermaid_tasks:
            await publish_task(RMQMessage(
                task_type=TaskType.IMAGE_ANALYSIS_PHASE_A_FROM_MERMAID,
                assessment_id=assessment.assessment_id,
                image_id=image_id,
                mermaid_text=mermaid_text,
                diagram_type=assessment_data.diagram_type.value,
            ))

        return assessment.assessment_id

    @staticmethod
    def get_list(
        db: Session, skip: int, limit: int,
        user_id: str | None = None,
        search: str | None = None, framework: str | None = None,
        app_name: str | None = None, org_name: str | None = None,
    ):
        """Returns a paginated list of assessments with optional user/search/filter."""
        assessments, total = assessment_crud.get_assessments_by_user(
            db, user_id, skip, limit,
            search=search, framework=framework, app_name=app_name, org_name=org_name,
        )
        payload = []
        for assessment in assessments:
            item = jsonable_encoder(assessment)
            creator = getattr(assessment, "user", None)
            item["creator_email"] = (
                getattr(creator, "email", None)
                or getattr(assessment, "user_id", None)
            )
            payload.append(item)
        return payload, total

    @staticmethod
    def delete_assessment(db: Session, assessment_id: str):
        """Deletes an assessment. Returns True if deleted, False if not found."""
        return assessment_crud.delete_assessment(db, assessment_id)

    @staticmethod
    def get_progress(db: Session, assessment_id: str):
        """
        Fetches the current state/stage with per-image progress.
        """
        assessment = assessment_crud.get_assessment_by_id(db, assessment_id)
        if not assessment:
            return None

        analyses = assessment_crud.get_analysis_by_assessment_id(db, assessment_id)

        def ensure_object(val):
            if not val:
                return None
            if isinstance(val, (dict, list)):
                return val
            try:
                return json.loads(val)
            except Exception:
                return val

        images_progress = []
        for img in analyses:
            images_progress.append({
                "image_id": img.image_id,
                "image_path": img.image_path,
                "state": img.state.value if img.state else None,
                "stage": img.stage.value if img.stage else None,
                "error_message": img.error_message,
                "flow_diagram": ensure_object(img.flow_diagram),
                "analysis_summary": ensure_object(img.analysis_summary),
                "component_details": ensure_object(img.component_details),
                "clarification": ensure_object(img.clarification),
            })

        return {
            "assessment_id": assessment.assessment_id,
            "state": assessment.state,
            "stage": assessment.stage,
            "error_message": getattr(assessment, "error_message", None),
            "images": images_progress,
        }

    @staticmethod
    def get_status(db: Session, assessment_id: str):
        """Lightweight endpoint for polling the current State/Stage + per-image states."""
        assessment = assessment_crud.get_assessment_by_id(db, assessment_id)
        if not assessment:
            return None

        image_states = get_image_states(db, assessment_id)

        return {
            "state": assessment.state,
            "stage": assessment.stage,
            # Surface the assessment-level error_message so the threat / summary
            # pages can show the actual backend failure text (not a hardcoded
            # placeholder). Populated by state_machine.transition_assessment.
            "error_message": getattr(assessment, "error_message", None),
            "images": [
                {
                    "image_id": s["image_id"],
                    "state": s["state"].value if s["state"] else None,
                    "stage": s["stage"].value if s["stage"] else None,
                    "error_message": s["error_message"],
                }
                for s in image_states
            ],
        }

    @staticmethod
    def process_answers(db: Session, assessment_id: str, image_id: str, submission):
        """
        Saves user answers to clarifications for a specific image
        and transitions that image to COMPLETED.
        """
        analysis = assessment_crud.get_analysis_by_image_id(db, assessment_id, image_id)
        if not analysis:
            raise HTTPException(status_code=404, detail=f"Image analysis not found: {image_id}")

        # Update clarifications
        assessment_crud.update_analysis_clarifications(db, analysis, submission)

        # Transition image: NEEDS_INPUT → COMPLETED
        transition_image(
            db, assessment_id, image_id,
            AssessmentState.COMPLETED, AssessmentStage.CLARIFICATION
        )

        return {
            "assessment_id": assessment_id,
            "image_id": image_id,
            "state": analysis.state.value,
            "stage": analysis.stage.value,
            "clarifications": analysis.clarification,
            "mermaid": analysis.flow_diagram,
        }

    @staticmethod
    def save_answers_draft(db: Session, assessment_id: str, image_id: str, submission):
        """
        Saves user answers to clarifications for a specific image
        without transitioning state. Used for auto-save / draft saves.
        """
        analysis = assessment_crud.get_analysis_by_image_id(db, assessment_id, image_id)
        if not analysis:
            raise HTTPException(status_code=404, detail=f"Image analysis not found: {image_id}")

        assessment_crud.update_analysis_clarifications(db, analysis, submission)

        return {
            "assessment_id": assessment_id,
            "image_id": image_id,
            "state": analysis.state.value,
            "stage": analysis.stage.value,
            "clarifications": analysis.clarification,
        }

    @staticmethod
    async def continue_image_analysis(
        db: Session, assessment_id: str, image_id: str | None = None,
    ):
        """Promote one image (or all AWAITING_REVIEW images) from Phase A to Phase B.

        The image(s) must be in AWAITING_REVIEW — that's the state Phase A
        leaves them in after extracting the Mermaid + components.
        """
        assessment = assessment_crud.get_assessment_by_id(db, assessment_id)
        if not assessment:
            raise HTTPException(status_code=404, detail="Assessment not found.")

        q = db.query(DocumentAnalysis).filter_by(
            assessment_id=assessment_id,
            state=AssessmentState.AWAITING_REVIEW,
        )
        if image_id:
            q = q.filter_by(image_id=image_id)
        targets = q.all()

        if not targets:
            raise HTTPException(
                status_code=400,
                detail="No images are awaiting review for this assessment.",
            )

        for img in targets:
            await publish_task(RMQMessage(
                task_type=TaskType.IMAGE_ANALYSIS_PHASE_B,
                assessment_id=assessment_id,
                image_id=img.image_id,
            ))

        return {
            "assessment_id": assessment_id,
            "queued_images": [t.image_id for t in targets],
            "count": len(targets),
        }

    @staticmethod
    async def auto_answer_image(db: Session, assessment_id: str, image_id: str):
        """
        Auto-answer clarification questions concurrently for a specific image
        by querying RAG with assessment_id metadata filter.
        """
        analysis = assessment_crud.get_analysis_by_image_id(db, assessment_id, image_id)
        if not analysis:
            raise HTTPException(status_code=404, detail=f"Image analysis not found: {image_id}")

        clarifications = analysis.clarification
        if not clarifications:
            raise HTTPException(status_code=400, detail="No clarification questions found for this image.")

        # Normalize the stored clarification payload into a flat list. The
        # column has historically been written in three shapes:
        #   1. ["q1", "q2", ...]                    (list of strings)
        #   2. [{"question": "...", ...}, ...]      (list of dicts)
        #   3. {"questions": [...]}                 (dict wrapper — what the
        #      Phase B writer currently emits)
        # Iterating directly over a dict would walk the KEYS ("questions"),
        # producing a single bogus entry and — combined with the
        # `analysis.clarification = answered_list` write below — wiping out
        # the original question set. Always coerce to a list first.
        if isinstance(clarifications, dict):
            raw_items = clarifications.get("questions") or []
        elif isinstance(clarifications, list):
            raw_items = clarifications
        else:
            raw_items = []

        # Preserve the full original entries so we can merge auto-answers back
        # into them (and never lose fields like a pre-existing user answer).
        original_entries: List[Dict[str, Any]] = []
        questions: List[str] = []
        for item in raw_items:
            if isinstance(item, str):
                original_entries.append({"question": item, "answer": "", "auto_answered": False})
                questions.append(item)
            elif isinstance(item, dict):
                q_text = item.get("question", "")
                original_entries.append({
                    "question": q_text,
                    "answer": item.get("answer", "") or "",
                    "auto_answered": bool(item.get("auto_answered", False)),
                })
                questions.append(q_text)

        if not questions:
            raise HTTPException(status_code=400, detail="No questions to auto-answer.")

        mermaid_text = ""
        if analysis.flow_diagram and isinstance(analysis.flow_diagram, dict):
            mermaid_text = analysis.flow_diagram.get("mermaid", "")

        # Load the analyst-curated surface_map once and format it for the
        # prompt. Every question in this batch gets the same rendering,
        # so do it up front. Missing / broken surface_map is non-fatal —
        # the formatter emits a sentinel and the LLM falls back to the
        # mermaid diagram.
        from blanc.crud import surface_map_crud
        from blanc.core.document_analysis import format_surface_map_for_prompt
        surface_map_str = "(no curated surface map available — fall back to the mermaid diagram)"
        try:
            sm_row = surface_map_crud.get_surface_map(db, assessment_id, image_id)
            if sm_row and sm_row.surface_map:
                surface_map_str = format_surface_map_for_prompt(sm_row.surface_map)
        except Exception as sm_err:
            logging.warning(
                f"[{assessment_id}][img:{image_id}] surface_map fetch for "
                f"auto-answer failed: {sm_err}"
            )

        # Org + App onboarding Q&A. Fetched once per call and reused
        # across every question. Best-effort: any lookup failure logs
        # a warning and falls back to the sentinel so the skill still
        # runs (just without that grounding).
        #
        # NOTE: Assessment.org_name / .app_name are strings today, not
        # FKs, so we resolve them by case-insensitive name match. When
        # multiple orgs share a name the CRUD helper logs a warning.
        # Long-term fix is to add org_id/app_id FK columns to Assessment
        # and resolve at create time.
        from blanc.crud import application_crud, org_crud
        org_context_str = "(no organisation onboarding answers available)"
        app_context_str = "(no application onboarding answers available)"
        try:
            org = (
                org_crud.get_org_by_name(db, analysis.assessment.org_name)
                if analysis.assessment and analysis.assessment.org_name
                else None
            )
            if org:
                org_qna = org_crud.get_org_qna(db, org.id)
                if org_qna:
                    org_context_str = _format_onboarding_qna(
                        org_qna, max_chars=4000,
                    )
            else:
                if analysis.assessment and analysis.assessment.org_name:
                    logging.info(
                        f"[{assessment_id}][img:{image_id}] no Org row matches "
                        f"assessment.org_name={analysis.assessment.org_name!r} — "
                        f"skipping org onboarding context."
                    )
        except Exception as org_err:
            logging.warning(
                f"[{assessment_id}][img:{image_id}] org onboarding fetch "
                f"failed: {org_err}"
            )

        try:
            app = None
            if analysis.assessment and analysis.assessment.app_name:
                # Scope by org_id when we successfully resolved the org,
                # otherwise fall back to a global name lookup.
                scoped_org_id = org.id if org else None
                app = application_crud.get_app_by_name(
                    db, analysis.assessment.app_name, org_id=scoped_org_id,
                )
            if app:
                app_qna = application_crud.get_app_qna(db, app.id)
                if app_qna:
                    app_context_str = _format_onboarding_qna(
                        app_qna, max_chars=4000,
                    )
            else:
                if analysis.assessment and analysis.assessment.app_name:
                    logging.info(
                        f"[{assessment_id}][img:{image_id}] no App row matches "
                        f"assessment.app_name={analysis.assessment.app_name!r} — "
                        f"skipping app onboarding context."
                    )
        except Exception as app_err:
            logging.warning(
                f"[{assessment_id}][img:{image_id}] app onboarding fetch "
                f"failed: {app_err}"
            )

        vector_client = get_rag_client(config)
        namespace = config.rag_config.namespace
        collection_id = config.rag_config.collection_id

        async def _answer_one(question: str) -> Dict[str, Any]:
            try:
                docs: List[str] = []
                try:
                    docs = await vector_client.search_by_assessment(
                        namespace=namespace,
                        collection_id=collection_id,
                        query=question,
                        assessment_id=assessment_id,
                        k=5,
                    ) or []
                except Exception as rag_err:
                    # RAG failures are non-fatal — we can still try to answer
                    # using the architecture diagram alone.
                    logging.warning(
                        f"Auto-answer RAG lookup failed for '{question[:50]}...': {rag_err}"
                    )

                # Build the supporting-docs section. When RAG returns nothing
                # we still call the LLM with just the architecture diagram so
                # questions don't silently come back empty for assessments
                # without ingested PDFs.
                if docs:
                    rag_context = "\n\n---\n\n".join(docs)
                else:
                    rag_context = "(no supporting documentation available)"

                prompt = get_skill("auto_answer_clarification").render(
                    org_context=org_context_str,
                    app_context=app_context_str,
                    rag_context=rag_context,
                    arch_text=mermaid_text or "(no architecture diagram available)",
                    surface_map=surface_map_str,
                    question=question,
                )
                answer = await get_llm_client().acall_text(prompt)
                answer = (answer or "").strip()

                if not answer or answer.upper() == "UNANSWERED":
                    return {"question": question, "answer": "", "auto_answered": False}
                return {"question": question, "answer": answer, "auto_answered": True}

            except Exception as e:
                logging.warning(f"Auto-answer failed for '{question[:50]}...': {e}")
                return {"question": question, "answer": "", "auto_answered": False}

        # Run all questions concurrently
        answered_list = await asyncio.gather(*[_answer_one(q) for q in questions])
        answered_list = list(answered_list)

        # Merge auto-answers back into the original entries so we (a) preserve
        # any existing user-supplied answer for a question the LLM couldn't
        # fill in, and (b) keep the persisted row count identical to what the
        # user has been seeing in the UI. We only overwrite an existing
        # answer when the LLM produced one with auto_answered=True.
        merged: List[Dict[str, Any]] = []
        for original, auto in zip(original_entries, answered_list):
            if auto.get("auto_answered") and auto.get("answer"):
                merged.append({
                    "question": original["question"],
                    "answer": auto["answer"],
                    "auto_answered": True,
                })
            else:
                merged.append({
                    "question": original["question"],
                    "answer": original.get("answer", "") or "",
                    "auto_answered": bool(original.get("auto_answered", False)),
                })

        # Safety net: never persist if we somehow ended up with fewer rows
        # than the original (e.g. a future refactor reintroduces an iteration
        # bug). Better to drop the auto-answer payload than corrupt the
        # stored question set.
        if len(merged) < len(original_entries):
            raise HTTPException(
                status_code=500,
                detail="Auto-answer aborted: result count does not match the stored question set.",
            )

        # Persist the merged list (same shape the rest of the API returns).
        analysis.clarification = merged
        db.commit()
        db.refresh(analysis)

        unanswered = [q for q in merged if not q.get("answer")]
        auto_answered_count = sum(1 for q in merged if q.get("auto_answered") and q.get("answer"))

        # If every question now has an answer (auto or pre-existing), advance
        # the image to COMPLETED so the UI no longer prompts for input.
        if not unanswered:
            transition_image(
                db, assessment_id, image_id,
                AssessmentState.COMPLETED, AssessmentStage.CLARIFICATION
            )

        return {
            "assessment_id": assessment_id,
            "image_id": image_id,
            "total_questions": len(merged),
            "auto_answered": auto_answered_count,
            "unanswered": len(unanswered),
            "state": analysis.state.value,
            "stage": analysis.stage.value,
            "clarifications": merged,
        }

    @staticmethod
    async def run_threat_modeling(db: Session, assessment_id: str):
        """Triggers the threat modeling phase (assessment-level) via RMQ."""
        assessment = assessment_crud.get_assessment_by_id(db, assessment_id)
        if not assessment:
            raise HTTPException(status_code=404, detail="Assessment not found.")

        analyses = assessment_crud.get_analysis_by_assessment_id(db, assessment_id)
        if not analyses:
            raise HTTPException(status_code=400, detail="No document analysis found.")

        # Verify all images are COMPLETED before allowing threat modeling
        incomplete = [
            img.image_id for img in analyses
            if img.state != AssessmentState.COMPLETED
        ]
        if incomplete:
            raise HTTPException(
                status_code=400,
                detail=f"All images must be COMPLETED before threat modeling. Incomplete: {incomplete}"
            )

        # Transition assessment: COMPLETED → PROCESSING / THREAT_MODELING
        transition_assessment(
            db, assessment_id,
            AssessmentState.PROCESSING, AssessmentStage.THREAT_MODELING
        )

        await publish_task(RMQMessage(
            task_type=TaskType.THREAT_MODELING,
            assessment_id=assessment_id,
        ))
        return True

    @staticmethod
    def get_threats_data(db: Session, assessment_id: str):
        """Formats threat results for the frontend, grouped by image_id."""
        assessment = assessment_crud.get_assessment_by_id(db, assessment_id)
        if not assessment:
            return None

        threats = assessment_crud.get_threats_by_assessment_id(db, assessment_id)
        if not threats:
            return []

        return [
            {
                "id": t.id,
                "image_id": t.image_id,
                "Component": t.component_affected,
                "ThreatCategory": t.category,
                "Threat": t.title,
                "Impact": t.severity,
                "Description": t.description,
                "Likelihood": t.likelihood,
                "Mitigation": t.mitigations,
                "review_status": t.review_status,
                "review_comment": t.review_comment,
                "reviewed_by": t.reviewed_by,
                "reviewed_at": str(t.reviewed_at) if t.reviewed_at else None,
            }
            for t in threats
        ]

    @staticmethod
    def get_threats_grouped_by_image(db: Session, assessment_id: str):
        """Returns threat results grouped under each image with its analysis data."""
        assessment = assessment_crud.get_assessment_by_id(db, assessment_id)
        if not assessment:
            return None

        analyses = assessment_crud.get_analysis_by_assessment_id(db, assessment_id)
        threats = assessment_crud.get_threats_by_assessment_id(db, assessment_id)

        # Build meta lookup from assessment documents (supports stored_path and absolute path forms)
        docs = db.query(AssessmentDocument).filter_by(assessment_id=assessment_id).all()
        meta_by_path: dict = {}
        for doc in docs:
            if not doc.meta or not isinstance(doc.meta, dict):
                continue

            stored_path = doc.meta.get("stored_path")
            if stored_path:
                meta_by_path[stored_path] = doc.meta
                # Local backends usually persist absolute path in DocumentAnalysis.image_path
                meta_by_path[os.path.join(os.getcwd(), stored_path)] = doc.meta

            public_url = doc.meta.get("public_url")
            if public_url:
                meta_by_path[public_url] = doc.meta

        def _ensure_object(val):
            if not val:
                return None
            if isinstance(val, (dict, list)):
                return val
            try:
                return json.loads(val)
            except Exception:
                return val

        # Index threats by image_id
        threats_by_image = {}
        unmapped_threats = []
        for t in threats:
            entry = {
                "id": t.id,
                "ThreatCategory": t.category,
                "Threat": t.title,
                "Description": t.description,
                "Component": t.component_affected,
                "Likelihood": t.likelihood,
                "Impact": t.severity,
                "Mitigation": t.mitigations,
                "review_status": t.review_status,
                "review_comment": t.review_comment,
                "reviewed_by": t.reviewed_by,
                "reviewed_at": str(t.reviewed_at) if t.reviewed_at else None,
            }
            if t.image_id:
                threats_by_image.setdefault(t.image_id, []).append(entry)
            else:
                unmapped_threats.append(entry)

        def _get_image_meta(image_path: str | None):
            if not image_path:
                return None
            if image_path in meta_by_path:
                return meta_by_path[image_path]

            # Fallback to basename matching for robustness across path formatting differences
            image_name = os.path.basename(image_path)
            for path_key, meta in meta_by_path.items():
                if os.path.basename(path_key) == image_name:
                    return meta
            return None

        images = []
        for img in analyses:
            # Find matching document meta by image_path
            img_meta = _get_image_meta(img.image_path)

            image_metadata = {
                "original_filename": img_meta.get("original_filename") if img_meta else None,
                "storage_backend": img_meta.get("storage_backend") if img_meta else None,
                "stored_path": img_meta.get("stored_path") if img_meta else None,
                "public_url": img_meta.get("public_url") if img_meta else None,
                "document_id": img_meta.get("document_id") if img_meta else None,
            }
            images.append({
                "image_id": img.image_id,
                "image_path": img.image_path,
                "state": img.state.value if img.state else None,
                "stage": img.stage.value if img.stage else None,
                "meta": img_meta,
                "image_metadata": image_metadata,
                "flow_diagram": _ensure_object(img.flow_diagram),
                "analysis_summary": _ensure_object(img.analysis_summary),
                "component_details": _ensure_object(img.component_details),
                "clarification": _ensure_object(img.clarification),
                "threats": threats_by_image.get(img.image_id, []),
            })

        return {
            "assessment_id": assessment.assessment_id,
            "feature_name": assessment.feature_name,
            "state": assessment.state,
            "stage": assessment.stage,
            "framework": assessment.framework,
            "images": images,
            "unmapped_threats": unmapped_threats,
            "documents": [
                {
                    "document_id": doc.document_id,
                    "document_type": doc.document_type,
                    "original_filename": (doc.meta or {}).get("original_filename") if isinstance(doc.meta, dict) else None,
                    "stored_path": (doc.meta or {}).get("stored_path") if isinstance(doc.meta, dict) else None,
                    "public_url": (doc.meta or {}).get("public_url") if isinstance(doc.meta, dict) else None,
                    "storage_backend": (doc.meta or {}).get("storage_backend") if isinstance(doc.meta, dict) else None,
                }
                for doc in docs
            ],
        }

    @staticmethod
    async def reanalyze_threat_modeling(db: Session, assessment_id: str):
        """Clears existing threats and re-runs the threat modeling phase via RMQ."""
        assessment = assessment_crud.get_assessment_by_id(db, assessment_id)
        if not assessment:
            raise HTTPException(status_code=404, detail="Assessment not found")

        analyses = assessment_crud.get_analysis_by_assessment_id(db, assessment_id)
        if not analyses:
            raise HTTPException(status_code=400, detail="No document analysis found.")

        # Clear results
        db.query(AssessmentResults).filter_by(assessment_id=assessment_id).delete()
        db.commit()

        # Transition: current state → PROCESSING / THREAT_MODELING
        transition_assessment(
            db, assessment_id,
            AssessmentState.PROCESSING, AssessmentStage.THREAT_MODELING
        )

        await publish_task(RMQMessage(
            task_type=TaskType.THREAT_MODELING,
            assessment_id=assessment_id,
        ))

    @staticmethod
    async def retry_analysis_pipeline(db: Session, assessment_id: str):
        """
        Retries failed or stuck images. Re-triggers analysis via RMQ for images
        in FAILED or PENDING state.
        """
        assessment = assessment_crud.get_assessment_by_id(db, assessment_id)
        if not assessment:
            raise HTTPException(status_code=404, detail="Assessment not found")

        analyses = assessment_crud.get_analysis_by_assessment_id(db, assessment_id)
        retryable_states = {AssessmentState.FAILED, AssessmentState.PENDING}
        retryable_images = [img for img in analyses if img.state in retryable_states]

        if not retryable_images:
            raise HTTPException(status_code=400, detail="No failed or stuck images to retry.")

        # Reset each retryable image to PENDING and queue via RMQ
        for img in retryable_images:
            transition_image(
                db, assessment_id, img.image_id,
                AssessmentState.PENDING, AssessmentStage.INITIALIZING
            )

        # Dispatch each row with the correct Phase A task type — image
        # rows go through vision + OCR, Studio (mermaid) rows skip vision
        # and start at surface-map extraction.
        for img in retryable_images:
            await publish_task(_phase_a_task_for_image(img))

        return {"message": f"Retrying {len(retryable_images)} image(s)."}

    @staticmethod
    async def retry_single_image(
        db: Session, assessment_id: str, image_id: str
    ):
        """Retries analysis for a single failed image via RMQ."""
        analysis = assessment_crud.get_analysis_by_image_id(db, assessment_id, image_id)
        if not analysis:
            raise HTTPException(status_code=404, detail=f"Image analysis not found: {image_id}")

        if analysis.state != AssessmentState.FAILED:
            raise HTTPException(status_code=400, detail=f"Image {image_id} is not in FAILED state.")

        # Transition: FAILED → PENDING via state machine
        transition_image(
            db, assessment_id, image_id,
            AssessmentState.PENDING, AssessmentStage.INITIALIZING
        )

        # Studio-created (mermaid-only) rows have no image on disk, so we
        # must dispatch IMAGE_ANALYSIS_PHASE_A_FROM_MERMAID instead of the
        # image path — the helper picks the right one.
        await publish_task(_phase_a_task_for_image(analysis))

        return {"message": f"Retrying image {image_id}."}