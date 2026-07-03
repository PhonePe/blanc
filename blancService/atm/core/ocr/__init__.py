"""PaddleOCR integration for the image → Mermaid pipeline.

Public API:
    extract_ocr_context(image_path, ...) -> dict
        Run PaddleOCR + shape detection on an image and return the JSON
        payload consumed by the ``image_to_mermaid_auto`` skill.

    should_run_paddle_ocr(image_path) -> bool
        Gate used by ``document_analysis.image_to_mermaid`` — only images
        larger than the configured threshold are routed through PaddleOCR.
"""

from atm.core.ocr.paddle_runner import (
    PADDLE_OCR_THRESHOLD_PX,
    extract_ocr_context,
    should_run_paddle_ocr,
)

__all__ = [
    "PADDLE_OCR_THRESHOLD_PX",
    "extract_ocr_context",
    "should_run_paddle_ocr",
]
