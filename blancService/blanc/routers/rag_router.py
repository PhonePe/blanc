import logging
import re
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from blanc.schemas.rag import IngestResponse, SearchRequest
from blanc.core.auth.auth import require_roles
from blanc.core.rag_client.chunker import generate_appsec_chunks
from blanc.core.rag_client.extractor import extract_text_from_pdf_bytes
from blanc.core.rag_client.factory import get_rag_client

logger = logging.getLogger(__name__)

# Namespace / collection ids come off the URL — anything looser lets an
# unauth (before this fix) or authenticated caller pollute arbitrary
# on-disk Chroma directories, or address collections outside the
# app's own namespacing.
_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# 25 MB per PDF ingest — matches the informal cap we suggest elsewhere.
# Enforced client-side too, but never trust the client here.
_MAX_PDF_BYTES = 25 * 1024 * 1024


router = APIRouter(
    prefix="/api/v1",
    tags=["RAG"],
    # Gate the whole router. Was completely unauthenticated before,
    # which meant anyone reachable by the API could ingest into and
    # query any Chroma collection (cross-tenant IDOR).
    dependencies=[Depends(require_roles(["USER", "ADMIN"]))],
)


def get_db_client():
    """Resolve the configured RAG backend."""
    try:
        return get_rag_client()
    except Exception as e:
        logger.exception(f"Failed to initialize RAG backend")
        raise


def _check_ids(namespace: str, collection_id: str) -> None:
    if not (_SAFE_ID.match(namespace) and _SAFE_ID.match(collection_id)):
        raise HTTPException(
            status_code=400,
            detail="Invalid namespace or collection_id — must match [A-Za-z0-9_-]{1,64}",
        )


def _safe_filename(name: str) -> str:
    """Strip control chars / path separators from a user-supplied filename."""
    return "".join(c for c in (name or "").split("/")[-1] if c.isprintable())[:128] or "upload.pdf"


@router.post("/{namespace}/{collection_id}/ingest", response_model=IngestResponse)
async def ingest_document(
    namespace: str,
    collection_id: str,
    file: UploadFile = File(..., description="The PDF file to ingest"),
    url: Optional[str] = Form(None, description="URL (ignored for content; retained only as chunk metadata)"),
    db_client=Depends(get_db_client),
):
    _check_ids(namespace, collection_id)

    filename = _safe_filename(file.filename)
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    # Read with a bounded cap — Starlette by default reads unbounded and
    # will happily buffer a 10 GB "PDF" into memory.
    file_bytes = await file.read()
    if len(file_bytes) > _MAX_PDF_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"PDF exceeds max size ({_MAX_PDF_BYTES // (1024 * 1024)} MB).",
        )

    try:
        logger.info(
            "Ingesting document '%s' into %s/%s",
            filename, namespace, collection_id,
        )
        pages_data = extract_text_from_pdf_bytes(file_bytes)
        if not pages_data:
            raise HTTPException(status_code=400, detail="No readable text found in PDF.")

        logger.debug("Extracted %d pages from '%s'", len(pages_data), filename)

        chunks = list(
            generate_appsec_chunks(
                pages_data=pages_data,
                source_name=filename,
                source_url=url,
                chunk_size=512,
                overlap=75,
            )
        )
        logger.debug("Generated %d chunks", len(chunks))

        await db_client.ingest_batch(namespace, collection_id, chunks)

        logger.info("Successfully ingested '%s' (%d chunks)", filename, len(chunks))
        return IngestResponse(
            status="success",
            message=f"Successfully ingested {filename}",
            total_chunks=len(chunks),
            ignored_url=url,
        )

    except HTTPException:
        raise
    except ValueError as ve:
        logger.error("Validation error during ingestion: %s", ve)
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.exception("Unexpected error during ingestion")
        raise HTTPException(status_code=500, detail="Failed to ingest document.")


@router.post("/{namespace}/{collection_id}/search")
async def search_knowledge_base(
    namespace: str,
    collection_id: str,
    request: SearchRequest,
    db_client=Depends(get_db_client),
):
    _check_ids(namespace, collection_id)

    # SearchRequest exposes only allow-listed filter fields
    # (environment, document_type). The client cannot send a raw
    # `filter.must[].match.metadata.assessment_id` and pull chunks
    # from another user's assessment. See M5 in the review.
    try:
        logger.info(
            "Searching in %s/%s with query: %s",
            namespace, collection_id, request.query[:50],
        )

        must_filters = []
        if request.environment:
            must_filters.append({"match": {"metadata.environment": request.environment}})
        if request.document_type:
            must_filters.append({"match": {"metadata.document_type": request.document_type}})

        payload = {
            "query": {
                "type": "KNN",
                "field": "text",
                "value": request.query,
                "numCandidates": request.num_candidates,
                "k": request.k,
                "similarity": 0.3,
            },
            "limit": request.k,
            "trackTotalHits": 0,
        }
        if must_filters:
            payload["filter"] = {"must": must_filters}

        results = await db_client.search(namespace, collection_id, payload)
        logger.info("Search completed")
        return results

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Search error")
        raise HTTPException(status_code=500, detail="Search failed.")
