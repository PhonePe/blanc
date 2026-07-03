from fastapi import APIRouter, Depends, Form, UploadFile, File, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session
from typing import List, Optional
import base64
import logging

from atm.utils import standard_response
from atm.db.database import get_db
from atm.util.file_sniff import is_image_bytes, is_pdf_bytes
from atm.core.auth.auth import (
    get_current_user,
    require_assessment_owner,
    require_roles,
)
from atm.api_schemas.api_v1.assessment import (
    AssessmentCreate,
    AssessmentResponse,
    AnswerSubmission,
)
from atm.services.assessment_service import AssessmentService
from atm.core.rag_client.extractor import extract_images_from_pdf_bytes

assessment_router = APIRouter(
    prefix="/assessment",
    tags=["Assessment"],
    dependencies=[Depends(require_roles(["USER", "ADMIN"]))],
)


@assessment_router.post("/new", response_model=AssessmentResponse)
async def new_assessment(
    assessment: AssessmentCreate = Depends(AssessmentCreate.as_form),
    images: Optional[List[UploadFile]] = File(None, description="One or more architecture diagram images"),
    mermaid_texts: Optional[List[str]] = Form(None, description="One or more Mermaid diagrams (ATM Studio flow). Sent instead of images."),
    pdf: Optional[UploadFile] = File(None, description="Optional PDF used as diagram source (single)"),
    supporting_docs: Optional[List[UploadFile]] = File(None, description="Optional supporting PDF documents (multiple)"),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Creates a new assessment. Two mutually-exclusive input modes:

    * **Image mode** — upload one or more architecture diagram images.
      Each image runs through the full pipeline (image → Mermaid →
      components).
    * **Mermaid mode** — send one or more ``mermaid_texts`` from ATM
      Studio. The pipeline skips the vision LLM step and starts
      directly at the inventory (surface_map + components) stage.

    Optional PDFs (single source PDF, multiple supporting docs) are
    ingested into the RAG store either way.
    """
    has_images = bool(images and any(images))
    has_mermaid = bool(mermaid_texts and any((t or "").strip() for t in mermaid_texts))

    if has_images and has_mermaid:
        raise HTTPException(
            status_code=400,
            detail="Provide either images or mermaid_texts, not both.",
        )
    if not has_images and not has_mermaid:
        raise HTTPException(
            status_code=400,
            detail="At least one architecture diagram image or mermaid_text is required.",
        )

    if has_images:
        # Validate images by sniffing magic bytes — client-declared
        # Content-Type is untrustworthy. Reset the stream after peeking
        # so the downstream service can still read() the full body.
        for img in images:
            head = await img.read(32)
            await img.seek(0)
            if not is_image_bytes(head):
                raise HTTPException(
                    status_code=400,
                    detail=f"'{img.filename}' does not look like an image (magic bytes mismatch).",
                )

    # Validate source PDF if provided
    if pdf:
        head = await pdf.read(8)
        await pdf.seek(0)
        if not is_pdf_bytes(head):
            raise HTTPException(
                status_code=400,
                detail="Source document does not look like a PDF (magic bytes mismatch).",
            )

    # Validate supporting docs — must all be PDFs
    if supporting_docs:
        for doc in supporting_docs:
            head = await doc.read(8)
            await doc.seek(0)
            if not is_pdf_bytes(head):
                raise HTTPException(
                    status_code=400,
                    detail=f"Supporting document '{doc.filename}' is not a PDF (magic bytes mismatch).",
                )

    assessment_id = await AssessmentService.create_new_assessment(
        db, assessment, images or [], current_user.userId,
        pdf_file=pdf,
        supporting_docs=supporting_docs,
        mermaid_texts=[t for t in (mermaid_texts or []) if (t or "").strip()] or None,
    )

    return standard_response(
        200,
        "Assessment created successfully",
        {"assessment_id": assessment_id},
    )


@assessment_router.post("/extract-pdf-images")
async def extract_pdf_images(
    pdf: UploadFile = File(..., description="PDF file to extract images from"),
    current_user=Depends(get_current_user),
):
    """
    Extracts embedded images from a PDF and returns them as base64-encoded data.
    Frontend uses this to let users preview and select which images to upload as diagrams.
    """
    try:
        pdf_bytes = await pdf.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail="Could not read PDF file.")

    if not is_pdf_bytes(pdf_bytes):
        raise HTTPException(
            status_code=400,
            detail="File does not look like a PDF (magic bytes mismatch).",
        )

    try:
        raw_images = extract_images_from_pdf_bytes(pdf_bytes, min_size=100)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not raw_images:
        return standard_response(200, "No images found in PDF", {"images": []})

    images_out = []
    for img in raw_images:
        b64 = base64.b64encode(img["image_bytes"]).decode("ascii")
        images_out.append({
            "page": img["page"],
            "index": img["index"],
            "ext": img["ext"],
            "width": img["width"],
            "height": img["height"],
            "data_url": f"data:image/{img['ext']};base64,{b64}",
        })

    return standard_response(
        200,
        f"Extracted {len(images_out)} image(s) from PDF",
        {"images": images_out},
    )


@assessment_router.get("/list")
def list_assessments(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=500),
    search: Optional[str] = Query(None, description="Search by feature name, framework, app name, or org name"),
    framework: Optional[str] = Query(None, description="Filter by framework (e.g. STRIDE)"),
    app_name: Optional[str] = Query(None, description="Filter by application name"),
    org_name: Optional[str] = Query(None, description="Filter by organization name"),
    self_only: bool = Query(False, description="If true, show only the current user's assessments"),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Returns assessments with their current State and Stage, with optional search/filter."""
    effective_user_id = current_user.userId if self_only else None
    assessments, total_count = AssessmentService.get_list(
        db, skip, limit,
        user_id=effective_user_id,
        search=search, framework=framework, app_name=app_name, org_name=org_name,
    )
    return standard_response(
        200,
        "Assessments fetched successfully",
        {"assessments": assessments, "total": total_count},
    )


@assessment_router.delete(
    "/{assessment_id}",
    dependencies=[Depends(require_roles(["ADMIN"]))],
)
def delete_assessment(
    assessment_id: str,
    db: Session = Depends(get_db),
):
    """Delete an assessment and all related data. Admin only."""
    deleted = AssessmentService.delete_assessment(db, assessment_id)
    if not deleted:
        return standard_response(404, "Assessment not found", {})
    return standard_response(200, "Assessment deleted successfully", {"assessment_id": assessment_id})


@assessment_router.get("/{assessment_id}/progress", dependencies=[Depends(require_assessment_owner)])
def get_assessment_progress(assessment_id: str, db: Session = Depends(get_db)):
    """
    Detailed progress view with per-image analysis data.
    Returns flow diagrams and summaries as they become available.
    """
    data = AssessmentService.get_progress(db, assessment_id)
    if not data:
        return standard_response(404, "Assessment not found", {})
    return standard_response(200, "Assessment progress fetched successfully", data)


@assessment_router.get("/{assessment_id}/status", dependencies=[Depends(require_assessment_owner)])
def get_assessment_status(assessment_id: str, db: Session = Depends(get_db)):
    """Lightweight polling endpoint for State/Stage + per-image states."""
    data = AssessmentService.get_status(db, assessment_id)
    if not data:
        return standard_response(404, "Assessment not found", {})
    return standard_response(200, "Assessment status fetched successfully", data)


@assessment_router.post("/{assessment_id}/images/{image_id}/answer", dependencies=[Depends(require_assessment_owner)])
def submit_image_answers(
    assessment_id: str,
    image_id: str,
    submission: AnswerSubmission,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Submit clarification answers for a specific image.
    Transitions that image from NEEDS_INPUT → COMPLETED.
    """
    result = AssessmentService.process_answers(db, assessment_id, image_id, submission)
    return standard_response(200, "Answers saved for image.", result)


@assessment_router.put("/{assessment_id}/images/{image_id}/save-answers", dependencies=[Depends(require_assessment_owner)])
def save_image_answers_draft(
    assessment_id: str,
    image_id: str,
    submission: AnswerSubmission,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Save clarification answers for a specific image without transitioning state.
    Used for auto-save / draft saves from the threat review page.
    """
    result = AssessmentService.save_answers_draft(db, assessment_id, image_id, submission)
    return standard_response(200, "Answers saved.", result)


@assessment_router.post("/{assessment_id}/answer", dependencies=[Depends(require_assessment_owner)])
def submit_answers(
    assessment_id: str,
    submission: AnswerSubmission,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Legacy endpoint: submits answers for the first image needing input.
    For multi-image, prefer /{assessment_id}/images/{image_id}/answer.
    """
    from atm.db_models.models import AssessmentState, DocumentAnalysis as DA
    analyses = db.query(DA).filter_by(assessment_id=assessment_id).all()

    needs_input = [a for a in analyses if a.state == AssessmentState.NEEDS_INPUT]
    if not needs_input:
        raise HTTPException(status_code=400, detail="No images need clarification input.")

    result = AssessmentService.process_answers(
        db, assessment_id, needs_input[0].image_id, submission
    )
    return standard_response(200, "Answers saved. Resuming analysis pipeline...", result)


@assessment_router.post("/{assessment_id}/retry-analysis", dependencies=[Depends(require_assessment_owner)])
async def retry_assessment_analysis(
    assessment_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Retries all failed images in the assessment."""
    result = await AssessmentService.retry_analysis_pipeline(db, assessment_id)
    return standard_response(200, result["message"], {"assessment_id": assessment_id})


@assessment_router.post("/{assessment_id}/continue", dependencies=[Depends(require_assessment_owner)])
async def continue_assessment_analysis(
    assessment_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Promote all AWAITING_REVIEW images to Phase B (summary + clarification).

    Called when the user clicks "Next" in the studio after reviewing the
    extracted mermaid diagrams and components.
    """
    result = await AssessmentService.continue_image_analysis(db, assessment_id)
    return standard_response(
        200,
        f"Generating summary & clarification for {result['count']} image(s)…",
        result,
    )


@assessment_router.post("/{assessment_id}/images/{image_id}/continue", dependencies=[Depends(require_assessment_owner)])
async def continue_single_image_analysis(
    assessment_id: str,
    image_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Promote a single AWAITING_REVIEW image to Phase B."""
    result = await AssessmentService.continue_image_analysis(db, assessment_id, image_id)
    return standard_response(
        200,
        "Phase B queued for image.",
        result,
    )


@assessment_router.post("/{assessment_id}/images/{image_id}/retry", dependencies=[Depends(require_assessment_owner)])
async def retry_single_image_analysis(
    assessment_id: str,
    image_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Retries analysis for a single failed image."""
    result = await AssessmentService.retry_single_image(db, assessment_id, image_id)
    return standard_response(200, result["message"], {"assessment_id": assessment_id, "image_id": image_id})


@assessment_router.post("/{assessment_id}/images/{image_id}/auto-answer", dependencies=[Depends(require_assessment_owner)])
async def auto_answer_image_questions(
    assessment_id: str,
    image_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Auto-answer clarification questions for a specific image using
    RAG context from the assessment's ingested PDF, filtered by assessment_id metadata.
    Returns the questions with auto-filled answers where possible.
    """
    result = await AssessmentService.auto_answer_image(db, assessment_id, image_id)
    return standard_response(200, "Auto-answer completed.", result)