import json
import logging
import tempfile
from pathlib import Path
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session

from PIL import Image

# Database imports
from blanc.db_models.models import Assessment, DocumentAnalysis, AssessmentState, AssessmentStage
from blanc.db.database import get_db_session
from blanc.skills import get_skill

# Import your Pydantic models
from blanc.schemas.llm.analysis import (
    MermaidResponse,
    SummaryResponse,
    ComponentsResponse,
    QuestionsResponse,
)
from blanc.core.llm_client import get_llm_client, set_assessment_context
from blanc.core.ocr import should_run_paddle_ocr
from blanc.core.state_machine import transition_image
from blanc.schemas.surface_map import SurfaceMapPayload


# ── Integrations dispatcher (lazy singleton) ────────────────────
# Built on first use. Lives at module scope so RMQ consumers reuse
# the same HTTP clients (and TTL cache / circuit breaker state)
# across every image and assessment.
_dispatcher = None


def _integrations_dispatcher():
    global _dispatcher
    if _dispatcher is None:
        from blanc.config_parsers.settings import get_settings
        from blanc.core.integrations.factory import build_dispatcher
        _dispatcher = build_dispatcher(get_settings())
    return _dispatcher


# Max edge sent to the vision endpoint. Larger images get downscaled to a
# temp file before upload — the OpenAI vision endpoint rejects very large
# inline base64 payloads with opaque stream resets.
MAX_IMAGE_EDGE_PX_FOR_LLM = 2048


REFUSAL_MARKERS = (
    "image resolution is too low",
    "resolution is too low to accurately read",
    "image text is not readable",
    "text is not readable at provided resolution",
    "please upload a higher-resolution image",
    "please upload a higher resolution image",
    "please upload a clearer image",
    "provide a textual list of participants and interactions",
    "cannot accurately read components and messages",
    "cannot read the diagram",
    "unable to read the diagram",
)


class ImageNotClearError(ValueError):
    """Raised when the uploaded image cannot be converted faithfully."""


def _contains_refusal_text(text: str) -> bool:
    lowered = text.lower()
    return any(marker in lowered for marker in REFUSAL_MARKERS)


# Mermaid header tokens we recognise. Order matters — longer / more
# specific tokens first so we don't match "graph" inside "sequenceDiagram".
_MERMAID_HEADER_TOKENS = (
    "sequenceDiagram",
    "flowchart TD",
    "flowchart LR",
    "flowchart BT",
    "flowchart RL",
    "flowchart",
    "graph TD",
    "graph LR",
    "graph TB",
    "graph BT",
    "graph RL",
    "graph",
    "C4Context",
    "C4Container",
    "C4Component",
    "classDiagram",
    "stateDiagram-v2",
    "stateDiagram",
    "erDiagram",
)


def _detect_mermaid_header(mermaid_text: str) -> Optional[str]:
    """Return the canonical header of the supplied Mermaid source, if any.

    Reads the first non-empty, non-comment line and matches it against
    :data:`_MERMAID_HEADER_TOKENS`. Returns ``None`` when no known
    header is found — callers should treat that as a parse failure.
    """
    for raw_line in mermaid_text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("%%"):
            continue
        for token in _MERMAID_HEADER_TOKENS:
            if line.startswith(token):
                return token
        return None
    return None


def _validate_mermaid_output(
    mermaid_text: str,
    diagram_type: str,
    *,
    auto_detect: bool = False,
) -> None:
    """Validate an LLM-generated Mermaid blob.

    Parameters
    ----------
    mermaid_text:
        Raw Mermaid source returned by the model.
    diagram_type:
        The diagram type the caller asked for (e.g. ``"flowchart TD"``).
        In strict mode the output must start with exactly this string.
    auto_detect:
        When ``True`` (used by the PaddleOCR path) the skill is allowed
        to pick the diagram type itself — we sniff the actual header
        from the Mermaid source and apply the structural checks for
        that detected type instead.
    """
    stripped = mermaid_text.strip()
    if not stripped:
        raise ImageNotClearError("The image could not be converted into a non-empty Mermaid diagram.")

    if _contains_refusal_text(stripped):
        raise ImageNotClearError(
            "The model reported that the uploaded image is not readable enough to convert safely."
        )

    if auto_detect:
        detected = _detect_mermaid_header(stripped)
        if detected is None:
            raise ImageNotClearError(
                "The generated Mermaid output did not start with a recognised diagram header."
            )
        effective_type = detected
    else:
        if not stripped.startswith(diagram_type):
            raise ImageNotClearError(
                f"The generated Mermaid output did not start with the expected diagram type '{diagram_type}'."
            )
        effective_type = diagram_type

    if effective_type == "sequenceDiagram":
        has_participants = "participant " in stripped
        has_messages = any(token in stripped for token in ("->>", "-->>", "->", "-->"))
        if not (has_participants and has_messages):
            raise ImageNotClearError(
                "The generated sequence diagram is incomplete and does not contain readable participants and interactions."
            )
    elif effective_type.startswith("flowchart") or effective_type.startswith("graph"):
        has_edges = any(token in stripped for token in ("-->", "---", "==>", "-.->"))
        if not has_edges:
            raise ImageNotClearError(
                "The generated flowchart is incomplete and does not contain readable component relationships."
            )
    elif effective_type == "C4Context":
        has_nodes = any(token in stripped for token in ("Person(", "System(", "System_Ext(", "SystemDb("))
        has_relationships = "Rel(" in stripped
        if not (has_nodes and has_relationships):
            raise ImageNotClearError(
                "The generated C4 context diagram is incomplete and does not contain readable systems and relationships."
            )


def _downscale_for_llm(image_path: str, tmp_dir: Path, max_edge: int) -> str:
    """Return a path safe to attach to the vision endpoint.

    Images whose max edge already fits within ``max_edge`` are returned
    unchanged. Larger images are downscaled into ``tmp_dir`` (PNG,
    optimized) so they can be base64-embedded without tripping the
    provider's payload limits.
    """
    with Image.open(image_path) as source:
        width, height = source.size
        if max(width, height) <= max_edge:
            return image_path
        scale = max_edge / float(max(width, height))
        new_size = (max(1, int(width * scale)), max(1, int(height * scale)))
        resized = source.convert("RGB").resize(new_size, Image.Resampling.LANCZOS)

    resized_path = tmp_dir / f"{Path(image_path).stem}_resized.png"
    resized.save(resized_path, format="PNG", optimize=True)
    return str(resized_path)


def _image_to_mermaid_with_ocr(
    image_path: str,
    diagram_type: str,
    assessment_id: Optional[str],
) -> Dict[str, str]:
    """Large-image path: PaddleOCR → image_to_mermaid_auto skill.

    Used when either dimension of the image reaches the PaddleOCR
    threshold (>= 2048 px). PaddleOCR runs first and produces a JSON
    payload of recognised text + bounding boxes; that JSON is rendered
    into the prompt alongside the (downscaled) image, mirroring the
    flow validated by ``test_folder/test_call_llm.py``.
    """
    # Lazy import: keeps PaddleOCR (+ paddlepaddle + opencv) off the
    # cold-start path for small-image flows that never reach this branch.
    from blanc.core.ocr import extract_ocr_context

    logging.info(
        "[%s] image_to_mermaid: routing %s through PaddleOCR (oversized image)",
        assessment_id,
        image_path,
    )
    ocr_payload = extract_ocr_context(image_path)
    ocr_context = json.dumps(ocr_payload, ensure_ascii=False, indent=2)
    prompt = get_skill("image_to_mermaid_auto").render(ocr_context=ocr_context)

    with tempfile.TemporaryDirectory(prefix="blanc_llm_img_") as tmp_dir_name:
        send_image_path = _downscale_for_llm(
            image_path, Path(tmp_dir_name), MAX_IMAGE_EDGE_PX_FOR_LLM
        )
        # high detail: post-downscale the image is ≤ 2048 px so the
        # vision tokens stay reasonable, and we need the model to
        # actually read the diagram alongside the OCR JSON — "low"
        # collapses it to a 512px thumbnail and triggers refusal stubs.
        response_obj = get_llm_client().call(
            prompt,
            MermaidResponse,
            image_path=send_image_path,
            assessment_id=assessment_id,
            purpose="vision",
            image_detail="high",
        )

    # auto_detect=True: the image_to_mermaid_auto skill picks the
    # diagram type from the OCR/image geometry, so we accept whatever
    # valid header it returns instead of forcing the caller's argument.
    _validate_mermaid_output(response_obj.mermaid, diagram_type, auto_detect=True)
    return {"mermaid": response_obj.mermaid}


def image_to_mermaid(
    image_path: str,
    diagram_type: str = "flowchart TD",
    assessment_id: Optional[str] = None,
) -> Dict[str, str]:
    # Oversized diagrams (either dimension ≥ 2048 px) get the PaddleOCR
    # round-trip first — gives the vision LLM exact text + bboxes so it
    # doesn't have to read tiny labels off a downscaled thumbnail.
    if should_run_paddle_ocr(image_path):
        return _image_to_mermaid_with_ocr(image_path, diagram_type, assessment_id)

    prompt = get_skill("image_to_mermaid").render(diagram_type=diagram_type)
    response_obj = get_llm_client().call(
        prompt,
        MermaidResponse,
        image_path=image_path,
        assessment_id=assessment_id,
        purpose="vision",
        image_detail="high",
    )

    _validate_mermaid_output(response_obj.mermaid, diagram_type)
    return {"mermaid": response_obj.mermaid}


def high_level_summary(arch_text: str, assessment_id: Optional[str] = None) -> Dict[str, str]:
    response_obj = get_llm_client().call(
        get_skill("high_level_summary").render(arch_text=arch_text),
        SummaryResponse,
        assessment_id=assessment_id,
        purpose="summarization",
    )
    return response_obj.model_dump()


def component_breakdown(arch_text: str, assessment_id: Optional[str] = None) -> Dict[str, List[Dict[str, Any]]]:
    response_obj = get_llm_client().call(
        get_skill("component_breakdown").render(arch_text=arch_text),
        ComponentsResponse,
        assessment_id=assessment_id,
        purpose="component_analysis",
    )
    return response_obj.model_dump()


def format_surface_map_for_prompt(surface_map: Optional[Dict[str, Any]]) -> str:
    """Render a persisted surface_map JSON blob into a prompt-friendly string.

    Returns a sentinel string when no curated inventory exists yet, so
    the LLM knows to fall back on the mermaid diagram. The raw ``mermaid``
    copy stored inside the surface_map is dropped — the caller already
    passes the mermaid separately, and duplicating it wastes context.
    """
    if not surface_map or not isinstance(surface_map, dict):
        return "(no curated surface map available — fall back to the mermaid diagram)"
    trimmed = {k: v for k, v in surface_map.items() if k != "mermaid"}
    if not trimmed:
        return "(no curated surface map available — fall back to the mermaid diagram)"
    return json.dumps(trimmed, ensure_ascii=False, indent=2)


def clarification_questions(
    arch_text: str,
    surface_map: Optional[Dict[str, Any]] = None,
    assessment_id: Optional[str] = None,
) -> Dict[str, List[str]]:
    response_obj = get_llm_client().call(
        get_skill("clarification_questions").render(
            arch_text=arch_text,
            surface_map=format_surface_map_for_prompt(surface_map),
        ),
        QuestionsResponse,
        assessment_id=assessment_id,
        purpose="clarification",
    )
    return response_obj.model_dump()


def surface_discovery(
    image_path: Optional[str] = None,
    diagram_type: str = "flowchart TD",
    mermaid_context: str = "",
    assessment_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Run the Surface Discovery skill against a Mermaid diagram.

    Returns a dict matching :class:`SurfaceMapPayload` (components,
    environments, trust_boundaries).

    Modes:
        * **Text mode (default)** — ``mermaid_context`` is the sole input.
          The LLM parses the Mermaid syntax to enumerate participants /
          nodes / subgraphs. This is the recommended path because it is
          deterministic w.r.t. the diagram source (no vision noise from
          rendered images).
        * **Vision-assisted mode** — pass a non-empty ``image_path`` to
          additionally attach the rendered image. The Mermaid still drives
          structural extraction; the image only adds visual cues.

    Raises ``ValueError`` when both ``mermaid_context`` and ``image_path``
    are empty — there would be nothing for the model to read.
    """
    has_mermaid = bool((mermaid_context or "").strip())
    has_image = bool(image_path)
    if not has_mermaid and not has_image:
        raise ValueError(
            "surface_discovery requires either mermaid_context or image_path"
        )

    prompt = get_skill("surface_discovery").render(
        diagram_type=diagram_type,
        mermaid_context=mermaid_context if has_mermaid else "(no mermaid context available)",
    )
    call_kwargs: Dict[str, Any] = {
        "assessment_id": assessment_id,
        "purpose": "vision" if has_image else "surface_discovery",
    }
    if has_image:
        call_kwargs["image_path"] = image_path
        call_kwargs["image_detail"] = "high"

    response_obj = get_llm_client().call(prompt, SurfaceMapPayload, **call_kwargs)
    # by_alias=False → snake_case keys (trust_level, threat_level) on the wire.
    return response_obj.model_dump(by_alias=False, exclude_none=False)


# ── Known Mermaid diagram syntaxes the Surface Discovery skill keys its
#    extraction rules off of. Kept in sync with the rules block in
#    blanc/skills/definitions/surface_discovery.md.
_KNOWN_MERMAID_SYNTAXES = (
    "sequenceDiagram", "C4Context", "C4Container", "C4Component",
    "classDiagram", "stateDiagram", "erDiagram",
)


def _sniff_diagram_type(mermaid_context: str, fallback: str = "flowchart TD") -> str:
    """Trust the mermaid header over any stored ``diagram_type``.

    Example: the assessment was created with the default ``flowchart TD`` but
    the actual source pasted by the LLM is a ``sequenceDiagram``. The skill
    rules differ per syntax, so we read the first non-empty line.
    """
    if not mermaid_context:
        return fallback
    first_line = next((ln.strip() for ln in mermaid_context.splitlines() if ln.strip()), "")
    if not first_line:
        return fallback
    for known in _KNOWN_MERMAID_SYNTAXES:
        if first_line.startswith(known):
            return known
    if first_line.startswith(("flowchart", "graph")):
        tokens = first_line.split()
        return tokens[0] + (" " + tokens[1] if len(tokens) > 1 else "")
    return fallback


def auto_populate_surface_map(
    db: Session,
    assessment_id: str,
    image_id: str,
    mermaid_context: str,
    diagram_type: Optional[str] = None,
) -> None:
    """Seed the ``surface_map`` row (if missing) and then run external
    integrations to hydrate it.

    Runs in two independent phases:

      1. **Seed** — if no ``surface_map`` row exists for this
         (assessment, image) yet, call ``surface_discovery`` to
         populate the initial component / boundary / environment
         inventory from the mermaid diagram. Skipped when the row is
         already there — we never overwrite the LLM-extracted or
         user-edited inventory.

      2. **Hydrate** — regardless of whether we just seeded or the
         row already existed, run the configured integrations
         dispatcher to enrich per-field values via configured connectors
         like ``desc`` / ``exposure`` / ``environment``.  The
         dispatcher's ``update_surface_field`` helper respects the
         user-lock (``sources[<field>].provider == "user"`` is
         immutable), so this is idempotent and safe on every replay.

    Failures in either phase are logged and swallowed — surface map
    enrichment is an enhancement, never a blocker for the main
    analysis pipeline.
    """
    if not (mermaid_context or "").strip():
        logging.info(
            f"[{assessment_id}][img:{image_id}] Skipping surface_map auto-populate: empty mermaid."
        )
        return

    from blanc.crud import surface_map_crud  # local import: avoid cycles

    # ── Phase 1: seed the row if missing ──────────────────────────
    existing = surface_map_crud.get_surface_map(db, assessment_id, image_id)
    if existing:
        logging.info(
            f"[{assessment_id}][img:{image_id}] surface_map already exists, "
            f"skipping surface_discovery — proceeding to integrations hydration."
        )
    else:
        resolved_diagram_type = _sniff_diagram_type(
            mermaid_context, fallback=diagram_type or "flowchart TD",
        )

        try:
            generated = surface_discovery(
                image_path=None,
                diagram_type=resolved_diagram_type,
                mermaid_context=mermaid_context,
                assessment_id=assessment_id,
            )
        except Exception:
            logging.exception(
                f"[{assessment_id}][img:{image_id}] surface_discovery failed "
                f"during auto-populate; continuing without seed."
            )
            # Fall through to hydration only if we can't seed — a
            # partial hydration on an empty row is a no-op anyway.
            return

        if mermaid_context and not generated.get("mermaid"):
            generated["mermaid"] = mermaid_context

        try:
            payload = SurfaceMapPayload.model_validate(generated)
            surface_map_crud.upsert_surface_map(db, assessment_id, image_id, payload)
            logging.info(
                f"[{assessment_id}][img:{image_id}] surface_map auto-populated "
                f"({len(payload.components)} components, "
                f"{len(payload.environments)} environments, "
                f"{len(payload.trust_boundaries)} trust boundaries)."
            )
        except Exception:
            logging.exception(
                f"[{assessment_id}][img:{image_id}] Failed to persist "
                f"auto-populated surface_map; continuing."
            )
            return

    # ── Phase 2: integrations hydration (runs every call) ─────────
    # User-lock in db_helpers.update_surface_field prevents connectors
    # from overwriting fields whose sources[<field>].provider == "user".
    # HttpRunner's TTL cache (cache_ttl_s in config.yml) prevents
    # repeated Phase-A runs from hammering the upstream.
    try:
        import asyncio

        dispatcher = _integrations_dispatcher()
        row = surface_map_crud.get_surface_map(db, assessment_id, image_id)
        if not row or not row.surface_map:
            logging.info(
                f"[{assessment_id}][img:{image_id}] no surface_map row to hydrate; skipping."
            )
            return

        asyncio.run(dispatcher.hydrate(
            SurfaceMapPayload(**row.surface_map),
            assessment_id=assessment_id,
            image_id=image_id,
        ))
        logging.info(
            f"[{assessment_id}][img:{image_id}] integrations hydration complete."
        )
    except Exception:
        logging.exception(
            f"[{assessment_id}][img:{image_id}] integrations hydration failed "
            f"during Phase A; continuing."
        )


def _ensure_analysis_record(
    db: Session,
    assessment_id: str,
    image_id: str,
    image_path: str,
    diagram_type: str,
) -> DocumentAnalysis:
    analysis_record = (
        db.query(DocumentAnalysis)
        .filter_by(assessment_id=assessment_id, image_id=image_id)
        .first()
    )
    if not analysis_record:
        analysis_record = DocumentAnalysis(
            assessment_id=assessment_id,
            image_id=image_id,
            image_path=image_path,
            diagram_type=diagram_type,
            state=AssessmentState.PENDING,
            stage=AssessmentStage.INITIALIZING,
        )
        db.add(analysis_record)
    else:
        analysis_record.image_path = image_path
        analysis_record.diagram_type = diagram_type

    db.commit()
    db.refresh(analysis_record)
    return analysis_record


def analyze_single_image_phase_a(
    assessment_id: str,
    image_id: str,
    image_path: str,
    diagram_type: str = "flowchart TD",
):
    """Phase A: image → mermaid → components.

    Runs IMAGE_PROCESSING and COMPONENT_ANALYSIS stages, then parks the
    image in AWAITING_REVIEW so the user can inspect the extracted diagram
    and components before paying for the second LLM round-trip.
    """
    logging.info(f"[{assessment_id}][img:{image_id}] Phase A start: {image_path}")
    set_assessment_context(assessment_id)

    with get_db_session() as db:
        try:
            assessment = db.query(Assessment).filter_by(assessment_id=assessment_id).first()
            if not assessment:
                raise ValueError(f"Assessment {assessment_id} not found.")

            analysis_record = _ensure_analysis_record(db, assessment_id, image_id, image_path, diagram_type)

            if analysis_record.state == AssessmentState.FAILED:
                transition_image(db, assessment_id, image_id, AssessmentState.PENDING, AssessmentStage.INITIALIZING, error_message="")
                analysis_record = _ensure_analysis_record(db, assessment_id, image_id, image_path, diagram_type)
            elif analysis_record.state != AssessmentState.PENDING:
                logging.info(
                    f"[{assessment_id}][img:{image_id}] Already in state {analysis_record.state.value}, skipping Phase A."
                )
                return None

            transition_image(db, assessment_id, image_id, AssessmentState.PROCESSING, AssessmentStage.INITIALIZING)
            transition_image(db, assessment_id, image_id, AssessmentState.PROCESSING, AssessmentStage.IMAGE_PROCESSING)

            mermaid_data = image_to_mermaid(image_path, diagram_type=diagram_type, assessment_id=assessment_id)
            analysis_record = _ensure_analysis_record(db, assessment_id, image_id, image_path, diagram_type)
            analysis_record.flow_diagram = mermaid_data
            db.commit()

            mermaid_string = mermaid_data["mermaid"]

            # Seed the ThreatModeller Inventory surface_map row in the background
            # of the pipeline. Non-fatal — never aborts the analysis if it fails.
            auto_populate_surface_map(
                db,
                assessment_id=assessment_id,
                image_id=image_id,
                mermaid_context=mermaid_string,
                diagram_type=diagram_type,
            )

            transition_image(db, assessment_id, image_id, AssessmentState.PROCESSING, AssessmentStage.COMPONENT_ANALYSIS)
            components_data = component_breakdown(mermaid_string, assessment_id=assessment_id)
            analysis_record.component_details = components_data
            db.commit()

            # PAUSE — wait for the user to click "Next" in the studio.
            transition_image(
                db, assessment_id, image_id,
                AssessmentState.AWAITING_REVIEW, AssessmentStage.COMPONENT_ANALYSIS,
            )

            logging.info(f"[{assessment_id}][img:{image_id}] Phase A complete, awaiting user review.")
            return {
                "assessment_id": assessment_id,
                "image_id": image_id,
                "flow_diagram": mermaid_data,
                "components": components_data,
            }

        except Exception as e:
            # _fail_image rolls back and commits a FAILED transition
            # explicitly. The context manager's own rollback fires
            # afterwards on the (now clean) session — safe no-op.
            logging.exception(f"[{assessment_id}][img:{image_id}] Error during Phase A")
            _fail_image(db, assessment_id, image_id, AssessmentStage.IMAGE_PROCESSING, str(e))
            raise


def analyze_single_image_phase_a_from_mermaid(
    assessment_id: str,
    image_id: str,
    mermaid_text: str,
    diagram_type: str = "flowchart TD",
):
    """Phase A variant used when the caller supplies Mermaid directly
    (Blanc Studio "Create Assessment" flow).

    Skips the image_to_mermaid vision LLM step — persists the provided
    Mermaid as the flow_diagram, then runs the same
    ``auto_populate_surface_map`` + ``component_breakdown`` inventory
    generation, then parks the row in AWAITING_REVIEW. Downstream
    Phase B / threat-modeling behave identically to the image path.
    """
    logging.info(f"[{assessment_id}][img:{image_id}] Phase A (from mermaid) start.")
    set_assessment_context(assessment_id)

    with get_db_session() as db:
        try:
            assessment = db.query(Assessment).filter_by(assessment_id=assessment_id).first()
            if not assessment:
                raise ValueError(f"Assessment {assessment_id} not found.")

            mermaid_string = (mermaid_text or "").strip()
            if not mermaid_string:
                raise ValueError("Cannot run Phase A (from mermaid) with empty mermaid_text.")

            # `image_path` is unused in this flow but the DocumentAnalysis
            # schema requires a non-null value — stamp a sentinel so lookups
            # and admin tooling stay predictable.
            analysis_record = _ensure_analysis_record(
                db, assessment_id, image_id, image_path="", diagram_type=diagram_type
            )

            if analysis_record.state == AssessmentState.FAILED:
                transition_image(db, assessment_id, image_id, AssessmentState.PENDING, AssessmentStage.INITIALIZING, error_message="")
                analysis_record = _ensure_analysis_record(db, assessment_id, image_id, image_path="", diagram_type=diagram_type)
            elif analysis_record.state != AssessmentState.PENDING:
                logging.info(
                    f"[{assessment_id}][img:{image_id}] Already in state {analysis_record.state.value}, "
                    "skipping Phase A (from mermaid)."
                )
                return None

            transition_image(db, assessment_id, image_id, AssessmentState.PROCESSING, AssessmentStage.INITIALIZING)

            # Persist the caller-provided mermaid as the flow diagram.
            analysis_record.flow_diagram = {"mermaid": mermaid_string}
            db.commit()

            # From here on, behave exactly like the image path from line 511
            # onward: surface map, components, AWAITING_REVIEW.
            auto_populate_surface_map(
                db,
                assessment_id=assessment_id,
                image_id=image_id,
                mermaid_context=mermaid_string,
                diagram_type=diagram_type,
            )

            transition_image(db, assessment_id, image_id, AssessmentState.PROCESSING, AssessmentStage.COMPONENT_ANALYSIS)
            components_data = component_breakdown(mermaid_string, assessment_id=assessment_id)
            analysis_record.component_details = components_data
            db.commit()

            transition_image(
                db, assessment_id, image_id,
                AssessmentState.AWAITING_REVIEW, AssessmentStage.COMPONENT_ANALYSIS,
            )

            logging.info(f"[{assessment_id}][img:{image_id}] Phase A (from mermaid) complete, awaiting user review.")
            return {
                "assessment_id": assessment_id,
                "image_id": image_id,
                "flow_diagram": {"mermaid": mermaid_string},
                "components": components_data,
            }

        except Exception as e:
            logging.exception(f"[{assessment_id}][img:{image_id}] Error during Phase A (from mermaid)")
            _fail_image(db, assessment_id, image_id, AssessmentStage.COMPONENT_ANALYSIS, str(e))
            raise


def analyze_single_image_phase_b(
    assessment_id: str,
    image_id: str,
):
    """Phase B: summary + clarification questions.

    Resumes a DocumentAnalysis row from AWAITING_REVIEW. Uses the Mermaid
    text already persisted in ``flow_diagram`` as the LLM input — no need
    to re-OCR the image.
    """
    logging.info(f"[{assessment_id}][img:{image_id}] Phase B start.")
    set_assessment_context(assessment_id)

    with get_db_session() as db:
        try:
            analysis_record = (
                db.query(DocumentAnalysis)
                .filter_by(assessment_id=assessment_id, image_id=image_id)
                .first()
            )
            if not analysis_record:
                logging.warning(f"[{assessment_id}][img:{image_id}] DocumentAnalysis row missing, skipping Phase B.")
                return None

            if analysis_record.state != AssessmentState.AWAITING_REVIEW:
                logging.info(
                    f"[{assessment_id}][img:{image_id}] State is {analysis_record.state.value}, "
                    "expected AWAITING_REVIEW. Skipping Phase B."
                )
                return None

            mermaid_string = ""
            if analysis_record.flow_diagram and isinstance(analysis_record.flow_diagram, dict):
                mermaid_string = analysis_record.flow_diagram.get("mermaid", "") or ""

            if not mermaid_string.strip():
                raise ValueError("Cannot run Phase B without a stored Mermaid diagram from Phase A.")

            transition_image(db, assessment_id, image_id, AssessmentState.PROCESSING, AssessmentStage.SUMMARIZING)
            summary_data = high_level_summary(mermaid_string, assessment_id=assessment_id)
            analysis_record.analysis_summary = summary_data
            db.commit()

            transition_image(db, assessment_id, image_id, AssessmentState.PROCESSING, AssessmentStage.CLARIFICATION)

            # Fold the analyst-curated surface map into the prompt so questions
            # target *edited* trust boundaries / exposure levels, not the raw
            # vision-model output. Non-fatal if the row is missing — the skill
            # has a sentinel path for that.
            from blanc.crud import surface_map_crud  # local import: avoid cycles
            surface_map_blob: Optional[Dict[str, Any]] = None
            try:
                sm_row = surface_map_crud.get_surface_map(db, assessment_id, image_id)
                if sm_row and sm_row.surface_map:
                    surface_map_blob = sm_row.surface_map
            except Exception as sm_err:
                logging.warning(
                    f"[{assessment_id}][img:{image_id}] surface_map fetch for "
                    f"clarification failed: {sm_err}"
                )

            questions_data = clarification_questions(
                mermaid_string,
                surface_map=surface_map_blob,
                assessment_id=assessment_id,
            )
            analysis_record.clarification = questions_data
            db.commit()

            final_state = AssessmentState.NEEDS_INPUT if questions_data.get("questions") else AssessmentState.COMPLETED
            transition_image(db, assessment_id, image_id, final_state, AssessmentStage.CLARIFICATION)

            logging.info(f"[{assessment_id}][img:{image_id}] Phase B complete.")
            return {
                "assessment_id": assessment_id,
                "image_id": image_id,
                "summary": summary_data,
                "clarifications": questions_data,
            }

        except Exception as e:
            logging.exception(f"[{assessment_id}][img:{image_id}] Error during Phase B")
            _fail_image(db, assessment_id, image_id, AssessmentStage.SUMMARIZING, str(e))
            raise


def _sanitize_error(error: str) -> str:
    """Trim a raw exception string into something safe to surface to end users.

    We call this before storing on the FAILED transition so the frontend
    modal (which now shows the error verbatim) never leaks a full
    traceback, an SDK error body, or a connection string.
    """
    if not error:
        return ""
    # Only keep the first line (drops multi-line tracebacks + repr'd JSON).
    first_line = error.strip().splitlines()[0]
    # Scrub anything that looks like a URL query string or a `key=value`
    # secret. Cheap heuristic — not a full DLP, but blocks the common
    # foot-guns (Bearer tokens in error bodies, DB URIs, etc.).
    for marker in ("Bearer ", "://", "password=", "api_key=", "token="):
        if marker in first_line:
            idx = first_line.find(marker)
            first_line = first_line[:idx].rstrip() + " [redacted]"
            break
    return first_line[:200]


def _fail_image(db: Session, assessment_id: str, image_id: str, stage: AssessmentStage, error: str) -> None:
    """Centralised FAILED-transition helper used by both phases."""
    safe_error = _sanitize_error(error)
    try:
        db.rollback()
        transition_image(
            db, assessment_id, image_id,
            AssessmentState.FAILED, stage, error_message=safe_error,
        )
    except Exception as transition_err:
        logging.error(
            f"[{assessment_id}][img:{image_id}] Failed to transition image to FAILED: {transition_err}"
        )
        assessment = db.query(Assessment).filter_by(assessment_id=assessment_id).first()
        if assessment:
            assessment.state = AssessmentState.FAILED
            assessment.stage = stage
            assessment.error_message = safe_error
            db.commit()


