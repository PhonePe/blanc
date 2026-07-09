"""Production PaddleOCR runner.

Library wrapper around :mod:`blanc.core.ocr.paddle_cli` (the CLI tool that
ships in the same package). Exposes a single entry point,
:func:`extract_ocr_context`, which returns the same JSON payload the CLI
would write to disk — but in-memory, so the pipeline never touches the
filesystem on the request path.

PaddleOCR is imported lazily by :mod:`blanc.core.ocr.paddle_cli` itself
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
from blanc.core.ocr import paddle_cli as _cli

logger = logging.getLogger(__name__)


DEFAULT_MODELS_DIR = _cli.DEFAULT_MODELS_DIR
DEFAULT_OUTPUT_DIR = _cli.DEFAULT_OUTPUT_DIR

# Env-var override for the weights directory. Lets ops point the worker
# at any pre-populated PaddleOCR models dir (baked into a container,
# mounted volume, or a local clone of test_folder/models) without
# touching code or symlinking. Falls back to DEFAULT_MODELS_DIR.
_MODELS_DIR_ENV = "BLANC_OCR_MODELS_DIR"


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

    Also honours the ``BLANC_DISABLE_OCR`` env-var opt-out so callers
    don't emit the confusing "routing through PaddleOCR" log line
    immediately followed by "PaddleOCR disabled". Set the env var when
    running on Docker arm64 (paddle SIGSEGV) or any environment where
    you'd rather not pay the subprocess cost.

    Any IO / decode failure returns ``False`` — we never want a broken
    image to crash the pipeline before the LLM even sees it; let the
    existing path surface the actual error.
    """
    if os.environ.get("BLANC_DISABLE_OCR", "").strip() in ("1", "true", "yes"):
        return False
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


class _OCRSubprocessFailure(RuntimeError):
    """Raised when the paddle_cli subprocess exits abnormally.

    Includes returncode + stderr tail so callers can decide whether to
    surface a warning or a hard error. The pipeline treats this as a
    soft failure and continues with vision-LLM-only extraction.
    """


def _empty_ocr_result(image_path: Path, diagram_type: str, reason: str) -> dict[str, Any]:
    """Sentinel payload returned when the OCR subprocess crashes.

    Same shape as a real result — empty lists — so callers don't have
    to special-case ``None``. ``reason`` is stashed on the payload for
    debug logging in the caller.
    """
    return {
        "image": str(image_path),
        "diagram_type": diagram_type,
        "count": 0,
        "min_score": 0.0,
        "entries": [],
        "raw_pages": [],
        "diagram_model": {"nodes": [], "edges": []},
        "_ocr_skipped_reason": reason,
    }


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

    Mirrors the JSON written by :mod:`blanc.core.ocr.paddle_cli` (the file
    at ``ocr_output/<stem>.json``) but returns it in-memory. Pass the
    result as the ``ocr_context`` template var on the
    ``image_to_mermaid_auto`` skill.

    Parameters
    ----------
    image_path:
        Path to the source image on disk.
    models_dir:
        Where to cache PaddleOCR weights. Defaults to the value of the
        ``BLANC_OCR_MODELS_DIR`` env var, falling back to
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
        :mod:`blanc.core.ocr.paddle_cli` for tuning notes.
    """
    import json
    import subprocess
    import sys
    import time

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

    # Run paddle_cli.py as a subprocess. PaddlePaddle's C++ predictor
    # occasionally SIGSEGVs during PIR parameter loading on ARM Linux
    # (Docker on Apple Silicon is the canonical repro). If we invoked
    # `_cli.build_ocr(...)` in-process, that segfault would take down
    # the api worker with it. Isolating in a subprocess means the crash
    # is captured as a non-zero returncode we can handle.
    cli_path = Path(_cli.__file__).resolve()
    cmd = [
        sys.executable,
        str(cli_path),
        str(resolved_image),                      # positional
        "--models-dir", str(resolved_models),
        "--output-dir", str(resolved_output),
        "--tile-size", str(tile_size),
        "--tile-overlap", str(tile_overlap),
        "--scale", str(scale),
        "--min-score", str(min_score),
        "--det-limit-side-len", str(det_limit_side_len),
        "--diagram-type", diagram_type,
    ]

    # Hard opt-out — set BLANC_DISABLE_OCR=1 to skip PaddleOCR entirely and
    # short-circuit to the vision LLM. Useful when running under
    # environments where PaddlePaddle is known-broken (Docker on Apple
    # Silicon before the arm64 wheel stabilised).
    if os.environ.get("BLANC_DISABLE_OCR", "").strip() in ("1", "true", "yes"):
        logger.info(
            "PaddleOCR disabled via BLANC_DISABLE_OCR — proceeding with "
            "vision-LLM only for %s", resolved_image,
        )
        return _empty_ocr_result(resolved_image, diagram_type, "disabled by env")

    # Pass paddle flags that reduce the chance of the PIR-loader SIGSEGV
    # we see on some ARM Linux builds. `FLAGS_enable_new_ir_api=false`
    # forces Paddle to use the legacy IR path when loading `.pdiparams`,
    # bypassing the PIR code path where the crash happens.
    subprocess_env = os.environ.copy()
    subprocess_env.setdefault("FLAGS_enable_new_ir_api", "false")
    subprocess_env.setdefault("FLAGS_enable_pir_api", "0")
    subprocess_env.setdefault("FLAGS_use_stride_kernel", "false")
    # Paddle sometimes crashes when there are too few threads; give it
    # a reasonable default.
    subprocess_env.setdefault("OMP_NUM_THREADS", "2")

    logger.info(
        "PaddleOCR: spawning subprocess (cmd=%s)",
        " ".join(cmd[:2]) + " " + resolved_image.name + " …",
    )
    t0 = time.monotonic()
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=False,
            env=subprocess_env,
            # Paddle can spin for a while on the first-ever inference —
            # even a small image can take 30+ s cold. Cap at 5 min so a
            # stuck subprocess doesn't wedge the worker forever.
            timeout=300,
        )
    except subprocess.TimeoutExpired:
        logger.warning(
            "PaddleOCR subprocess timed out after 300s for %s — pipeline "
            "will proceed with vision-LLM only",
            resolved_image,
        )
        return _empty_ocr_result(resolved_image, diagram_type, "timeout")

    if proc.returncode != 0:
        # Segfault returns -SIGSEGV (i.e. -11 on POSIX). Any nonzero exit
        # from paddle_cli means we didn't get a usable OCR result; degrade
        # gracefully rather than fail the whole Phase A.
        crash_hint = "SIGSEGV (paddle crash)" if proc.returncode in (-11, 139) else f"exit {proc.returncode}"
        logger.warning(
            "PaddleOCR subprocess failed (%s) for %s — pipeline will proceed "
            "with vision-LLM only. stderr tail:\n%s",
            crash_hint,
            resolved_image,
            (proc.stderr or "")[-800:],
        )
        return _empty_ocr_result(resolved_image, diagram_type, crash_hint)

    elapsed = time.monotonic() - t0

    # Success — the CLI wrote its payload to `<output_dir>/<stem>.json`.
    json_path = resolved_output / f"{resolved_image.stem}.json"
    if not json_path.is_file():
        logger.warning(
            "PaddleOCR subprocess returned 0 in %.1fs but no JSON at %s — "
            "proceeding with vision-LLM only",
            elapsed, json_path,
        )
        return _empty_ocr_result(resolved_image, diagram_type, "no output json")

    try:
        payload: dict[str, Any] = json.loads(json_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        logger.warning(
            "PaddleOCR JSON parse failed for %s: %s — proceeding with "
            "vision-LLM only",
            json_path, e,
        )
        return _empty_ocr_result(resolved_image, diagram_type, f"bad json: {e}")

    entry_count = payload.get("count", len(payload.get("entries", []) or []))
    logger.info(
        "PaddleOCR: subprocess done in %.1fs — %d text region(s) after "
        "score filter — output=%s",
        elapsed, entry_count, json_path,
    )
    # Surface the subprocess's own stdout at DEBUG so you can inspect the
    # per-tile timings / model creation lines when you actually want them.
    # Without this, `Creating model:` / `Saved JSON output to:` /
    # `Detected N text regions before score filtering` are lost entirely.
    if proc.stdout:
        for line in proc.stdout.rstrip().splitlines():
            logger.debug("PaddleOCR[stdout]: %s", line)
    return payload
