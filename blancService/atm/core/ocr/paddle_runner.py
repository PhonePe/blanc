"""Production PaddleOCR runner.

Library wrapper around :mod:`atm.core.ocr.paddle_cli` (the CLI tool that
ships in the same package). Exposes a single entry point,
:func:`extract_ocr_context`, which returns the same JSON payload the CLI
would write to disk — but in-memory, so the pipeline never touches the
filesystem on the request path.

PaddleOCR is imported lazily by :mod:`atm.core.ocr.paddle_cli` itself
(import happens the first time we call into it), which keeps service
cold-start cost off the small-image flows that never trigger this branch.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from PIL import Image

# Defaults are sourced from the CLI module so there's exactly one place
# to tune them. Importing :mod:`paddle_cli` here is cheap — paddleocr
# itself is only imported when the CLI's ``build_ocr`` actually runs.
from atm.core.ocr import paddle_cli as _cli

logger = logging.getLogger(__name__)


DEFAULT_MODELS_DIR = _cli.DEFAULT_MODELS_DIR
DEFAULT_OUTPUT_DIR = _cli.DEFAULT_OUTPUT_DIR

# Env-var override for the weights directory. Lets ops point the worker
# at any pre-populated PaddleOCR models dir (baked into a container,
# mounted volume, or a local clone of test_folder/models) without
# touching code or symlinking. Falls back to DEFAULT_MODELS_DIR.
_MODELS_DIR_ENV = "ATM_OCR_MODELS_DIR"


def _resolve_models_dir(models_dir: Path | None) -> Path:
    """Pick the PaddleOCR weights dir: explicit arg > env var > default."""
    if models_dir is not None:
        return models_dir.expanduser().resolve()
    env_value = os.environ.get(_MODELS_DIR_ENV, "").strip()
    if env_value:
        return Path(env_value).expanduser().resolve()
    return DEFAULT_MODELS_DIR.expanduser().resolve()

# If EITHER dimension reaches this threshold, route through PaddleOCR.
# 2048 px matches MAX_IMAGE_EDGE_PX_FOR_LLM in document_analysis — above
# that we have to downscale before sending to the vision endpoint, which
# is exactly when tiny labels get unreadable and OCR earns its keep.
PADDLE_OCR_THRESHOLD_PX = 2048


def should_run_paddle_ocr(image_path: str | Path) -> bool:
    """Return True when the image is large enough to justify PaddleOCR.

    Gate fires when EITHER width or height is at least
    :data:`PADDLE_OCR_THRESHOLD_PX`. Anything that needs downscaling for
    the vision endpoint benefits from the OCR round-trip; smaller images
    are handled fine by the vanilla ``image_to_mermaid`` path.

    Any IO / decode failure returns ``False`` — we never want a broken
    image to crash the pipeline before the LLM even sees it; let the
    existing path surface the actual error.
    """
    try:
        with Image.open(image_path) as im:
            width, height = im.size
    except Exception as err:  # noqa: BLE001 — gate must not raise
        logger.debug(
            "should_run_paddle_ocr: failed to read %s (%s); skipping OCR branch",
            image_path,
            err,
        )
        return False
    return max(width, height) >= PADDLE_OCR_THRESHOLD_PX


def extract_ocr_context(
    image_path: str | Path,
    *,
    models_dir: Path | None = None,
    output_dir: Path | None = None,
    tile_size: int = 1280,
    tile_overlap: int = 160,
    scale: float = 1.0,
    min_score: float = 0.35,
    det_limit_side_len: int = 2048,
    diagram_type: str = "auto",
) -> dict[str, Any]:
    """Run PaddleOCR + shape detection and return the prompt-ready payload.

    Mirrors the JSON written by :mod:`atm.core.ocr.paddle_cli` (the file
    at ``ocr_output/<stem>.json``) but returns it in-memory. Pass the
    result as the ``ocr_context`` template var on the
    ``image_to_mermaid_auto`` skill.

    Parameters
    ----------
    image_path:
        Path to the source image on disk.
    models_dir:
        Where to cache PaddleOCR weights. Defaults to the value of the
        ``ATM_OCR_MODELS_DIR`` env var, falling back to
        ``blancService/ocr_models``. Override via config in containerised
        environments where the weights are baked into the image.
    output_dir:
        Only used internally by ``build_diagram_model`` to compute
        relative hrefs for the diagram model. Defaults to
        ``blancService/ocr_output``; the dir is created if missing but
        no files are written there by this function.
    tile_size, tile_overlap, scale, min_score, det_limit_side_len,
    diagram_type:
        Forwarded straight to the underlying CLI helpers — see
        :mod:`atm.core.ocr.paddle_cli` for tuning notes.
    """
    resolved_image = _cli.ensure_image_path(Path(image_path).expanduser())
    resolved_models = _resolve_models_dir(models_dir)
    resolved_output = (output_dir or DEFAULT_OUTPUT_DIR).expanduser().resolve()
    resolved_output.mkdir(parents=True, exist_ok=True)

    logger.info(
        "PaddleOCR: image=%s models=%s tile=%dpx overlap=%dpx scale=%.2f",
        resolved_image,
        resolved_models,
        tile_size,
        tile_overlap,
        scale,
    )

    ocr = _cli.build_ocr(resolved_models, det_limit_side_len)
    raw_pages, entries = _cli.run_ocr(
        ocr=ocr,
        image_path=resolved_image,
        tile_size=tile_size,
        overlap=tile_overlap,
        scale=scale,
    )
    filtered_entries = _cli.filter_entries(entries, min_score)
    resolved_type = _cli.resolve_diagram_type(diagram_type, resolved_image)
    diagram_model = _cli.build_diagram_model(
        image_path=resolved_image,
        output_dir=resolved_output,
        entries=filtered_entries,
    )

    return {
        "image": str(resolved_image),
        "diagram_type": resolved_type,
        "count": len(filtered_entries),
        "min_score": min_score,
        "entries": filtered_entries,
        "raw_pages": raw_pages,
        "diagram_model": diagram_model,
    }
