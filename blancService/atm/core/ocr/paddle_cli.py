from __future__ import annotations

import argparse
import json
import logging
import math
import os
import re
import sys
import tempfile
import urllib.parse
from pathlib import Path
from typing import Any

try:
    import cv2
    import numpy as np
except ImportError:
    cv2 = None
    np = None

from PIL import Image
from paddleocr import PaddleOCR


# blancService/atm/core/ocr/paddle_cli.py
#   parents[0] = ocr/
#   parents[1] = core/
#   parents[2] = atm/
#   parents[3] = blancService/        ← SERVICE_ROOT
HERE = Path(__file__).resolve().parent
SERVICE_ROOT = HERE.parents[2]
DEFAULT_IMAGE = SERVICE_ROOT / "uploads" / "arch.png"
# PP-OCRv6 weights ship with the package under atm/core/ocr/ocr_models/.
# No download at runtime — if the folder is missing, we fail fast with a
# clear error rather than silently reaching for the internet.
DEFAULT_MODELS_DIR = HERE / "ocr_models"
DEFAULT_OUTPUT_DIR = SERVICE_ROOT / "ocr_output"

# CLI-only safety net: atm.config_parsers reads ENV at import time.
# Library callers (via paddle_runner) set ENV themselves before importing.
os.environ.setdefault("ENV", "local")

# PaddleOCR release line (PP-OCRv6, requires paddleocr>=3.7.0). Weights are
# shipped in-tree at ``DEFAULT_MODELS_DIR``; there is no download fallback.
MODEL_SPECS = {
    "det": "PP-OCRv6_medium_det_infer",
    "rec": "PP-OCRv6_medium_rec_infer",
}

OVERLAY_HINT_PATTERNS = (
    "move canvas",
    "spacebar while dragging",
    "hand tool",
)

REGION_LABEL_KEYS = (
    "edgelayer",
    "privatesubnet",
    "dmzvrf",
    "noncde",
    "cde",
)

CONNECTOR_LABEL_KEYS = (
    "sslenabled",
    "carddata",
    "noncarddata",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract OCR/CV context from an image and write a JSON file."
    )
    parser.add_argument(
        "image",
        nargs="?",
        default=str(DEFAULT_IMAGE),
        help="Path to the input image. Defaults to blancService/uploads/arch.png.",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Directory for OCR output files.",
    )
    parser.add_argument(
        "--models-dir",
        default=str(DEFAULT_MODELS_DIR),
        help="Directory used to cache PaddleOCR model files.",
    )
    parser.add_argument(
        "--tile-size",
        type=int,
        default=1280,
        help="Tile size in original image pixels. Use 0 to disable tiling.",
    )
    parser.add_argument(
        "--tile-overlap",
        type=int,
        default=160,
        help="Overlap between adjacent OCR tiles.",
    )
    parser.add_argument(
        "--scale",
        type=float,
        default=1.0,
        help="Upscale factor applied to each OCR tile.",
    )
    parser.add_argument(
        "--min-score",
        type=float,
        default=0.35,
        help="Minimum recognition score to keep in the exported text.",
    )
    parser.add_argument(
        "--det-limit-side-len",
        type=int,
        default=2048,
        help="Maximum side length fed into PaddleOCR text detection.",
    )
    parser.add_argument(
        "--diagram-type",
        default="arch",
        choices=("auto", "arch", "architecture", "flowchart", "sequence", "sequenceDiagram"),
        help="Diagram kind. arch/architecture/flowchart emit Mermaid flowchart; sequence emits sequenceDiagram; auto detects.",
    )
    return parser.parse_args()


def ensure_image_path(image_path: Path) -> Path:
    if not image_path.exists():
        raise FileNotFoundError(f"Input image not found: {image_path}")
    return image_path.resolve()


def resolve_diagram_type(diagram_type: str, image_path: Path | None = None) -> str:
    normalized = normalize_text_key(diagram_type)
    if normalized in {"arch", "architecture", "flowchart"}:
        return "flowchart"
    if normalized in {"sequence", "sequencediagram"}:
        return "sequenceDiagram"
    if normalized == "auto":
        return detect_diagram_kind(image_path) if image_path else "flowchart"
    raise ValueError(f"Unsupported diagram type: {diagram_type}")


def model_files_ready(model_dir: Path) -> bool:
    return (
        any(model_dir.glob("*.pdmodel"))
        or (model_dir / "inference.json").exists()
        or (model_dir / "inference.yml").exists()
    )


def ensure_model(model_key: str, models_dir: Path) -> Path:
    """Return the on-disk directory for a PP-OCRv6 model.

    Weights are shipped in-tree. If the expected folder is missing or empty
    we fail loudly — this replaces the older behaviour of silently reaching
    out to Baidu's CDN to fetch a tarball.
    """
    folder = MODEL_SPECS[model_key]
    model_dir = models_dir / folder
    if not model_files_ready(model_dir):
        raise FileNotFoundError(
            f"PP-OCRv6 {model_key!r} weights not found at {model_dir}. "
            f"Expected files (inference.json / inference.yml / *.pdmodel) are "
            f"missing. This build does not auto-download weights; ship the "
            f"model directory in-tree or point --models-dir at a populated "
            f"folder."
        )
    return model_dir


def _model_name_from_folder(folder: str) -> str:
    # PaddleOCR/PaddleX expect the model_name to match the inference config in
    # the model directory (e.g. "PP-OCRv6_medium_det", "PP-OCRv5_server_det").
    # Our folder names are "<model_name>_infer", so strip the trailing suffix.
    return folder[:-6] if folder.endswith("_infer") else folder


def build_ocr(
    models_dir: Path,
    det_limit_side_len: int,
    cpu_threads: int | None = None,
) -> PaddleOCR:
    det_model_dir = ensure_model("det", models_dir)
    rec_model_dir = ensure_model("rec", models_dir)
    det_model_name = _model_name_from_folder(det_model_dir.name)
    rec_model_name = _model_name_from_folder(rec_model_dir.name)
    print(f"Using det model: {det_model_name} ({det_model_dir})")
    print(f"Using rec model: {rec_model_name} ({rec_model_dir})")
    kwargs: dict[str, Any] = dict(
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        text_detection_model_name=det_model_name,
        text_recognition_model_name=rec_model_name,
        text_detection_model_dir=str(det_model_dir),
        text_recognition_model_dir=str(rec_model_dir),
        text_det_limit_side_len=det_limit_side_len,
        text_det_limit_type="max",
        text_recognition_batch_size=8,
        text_rec_score_thresh=0.0,
    )
    if cpu_threads is not None:
        kwargs["cpu_threads"] = cpu_threads
    return PaddleOCR(**kwargs)


def iter_tiles(
    image_path: Path,
    tile_size: int,
    overlap: int,
    scale: float,
) -> list[dict[str, Any]]:
    with Image.open(image_path) as source:
        image = source.convert("RGB")

    width, height = image.size
    if tile_size <= 0:
        return [{"crop": image, "origin": (0, 0), "scale": scale, "index": 0}]

    tiles: list[dict[str, Any]] = []
    step = max(1, tile_size - overlap)
    tile_index = 0
    y = 0
    while True:
        x = 0
        bottom = min(height, y + tile_size)
        while True:
            right = min(width, x + tile_size)
            crop = image.crop((x, y, right, bottom)).copy()
            tiles.append(
                {
                    "crop": crop,
                    "origin": (x, y),
                    "scale": scale,
                    "index": tile_index,
                }
            )
            tile_index += 1
            if right >= width:
                break
            x += step
        if bottom >= height:
            break
        y += step
    return tiles


def scale_image(image: Image.Image, scale: float) -> Image.Image:
    if math.isclose(scale, 1.0):
        return image
    width, height = image.size
    scaled_size = (max(1, int(width * scale)), max(1, int(height * scale)))
    return image.resize(scaled_size, Image.Resampling.LANCZOS)


def as_serializable_result(page_result: Any) -> dict[str, Any]:
    if hasattr(page_result, "json"):
        json_payload = page_result.json
        if isinstance(json_payload, dict):
            return json_payload.get("res", json_payload)
    if isinstance(page_result, dict):
        return page_result
    if hasattr(page_result, "items"):
        return dict(page_result.items())
    return dict(page_result)


def bbox_from_polygon(polygon: list[list[float]]) -> list[float]:
    xs = [point[0] for point in polygon]
    ys = [point[1] for point in polygon]
    return [min(xs), min(ys), max(xs), max(ys)]


def center_from_bbox(bbox: list[float]) -> list[float]:
    return [(bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0]


def iou(left: list[float], right: list[float]) -> float:
    x1 = max(left[0], right[0])
    y1 = max(left[1], right[1])
    x2 = min(left[2], right[2])
    y2 = min(left[3], right[3])
    if x2 <= x1 or y2 <= y1:
        return 0.0
    intersection = (x2 - x1) * (y2 - y1)
    left_area = (left[2] - left[0]) * (left[3] - left[1])
    right_area = (right[2] - right[0]) * (right[3] - right[1])
    union = left_area + right_area - intersection
    if union <= 0:
        return 0.0
    return intersection / union


def clean_text(text: str) -> str:
    return " ".join(text.split()).strip()


def prettify_text(text: str) -> str:
    cleaned = clean_text(text)
    cleaned = re.sub(r"(\d+)\.(?=[A-Za-z])", r"\1. ", cleaned)
    cleaned = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", cleaned)
    return clean_text(cleaned)


def normalize_text_key(text: str) -> str:
    return "".join(character for character in clean_text(text).casefold() if character.isalnum())


def is_probable_overlay_text(text: str) -> bool:
    normalized = clean_text(text).casefold()
    if any(pattern in normalized for pattern in OVERLAY_HINT_PATTERNS):
        return True
    return normalized.startswith("to move canvas") or normalized.startswith("ve canvas")


def extract_entries(
    page_result: dict[str, Any],
    origin: tuple[int, int],
    scale: float,
) -> list[dict[str, Any]]:
    texts = page_result.get("rec_texts") or []
    scores = page_result.get("rec_scores") or []
    polygons = page_result.get("rec_polys") or page_result.get("dt_polys") or []
    entries: list[dict[str, Any]] = []
    for text, score, polygon in zip(texts, scores, polygons):
        normalized_text = clean_text(str(text))
        if not normalized_text:
            continue
        remapped_polygon: list[list[float]] = []
        for point in polygon:
            point_x = origin[0] + (float(point[0]) / scale)
            point_y = origin[1] + (float(point[1]) / scale)
            remapped_polygon.append([round(point_x, 2), round(point_y, 2)])
        bbox = bbox_from_polygon(remapped_polygon)
        center = center_from_bbox(bbox)
        entries.append(
            {
                "text": normalized_text,
                "score": round(float(score), 4),
                "polygon": remapped_polygon,
                "bbox": [round(value, 2) for value in bbox],
                "center": [round(value, 2) for value in center],
            }
        )
    return entries


def dedupe_entries(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    for entry in sorted(
        entries,
        key=lambda item: (item["center"][1], item["center"][0], -item["score"]),
    ):
        duplicate_index = None
        for index, existing in enumerate(deduped):
            if clean_text(existing["text"]).lower() != clean_text(entry["text"]).lower():
                continue
            center_distance = math.dist(existing["center"], entry["center"])
            if center_distance <= 28 or iou(existing["bbox"], entry["bbox"]) >= 0.3:
                duplicate_index = index
                break
        if duplicate_index is None:
            deduped.append(entry)
        elif entry["score"] > deduped[duplicate_index]["score"]:
            deduped[duplicate_index] = entry
    return deduped


def filter_entries(entries: list[dict[str, Any]], min_score: float) -> list[dict[str, Any]]:
    filtered_entries = [
        entry
        for entry in entries
        if entry["score"] >= min_score and not is_probable_overlay_text(entry["text"])
    ]
    filtered_entries.sort(key=lambda item: (item["center"][1], item["center"][0]))
    return filtered_entries


def run_ocr(
    ocr: PaddleOCR,
    image_path: Path,
    tile_size: int,
    overlap: int,
    scale: float,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    raw_pages: list[dict[str, Any]] = []
    extracted_entries: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="paddleocr_tiles_") as tmp_dir_name:
        tmp_dir = Path(tmp_dir_name)
        for tile in iter_tiles(image_path, tile_size, overlap, scale):
            scaled_crop = scale_image(tile["crop"], tile["scale"])
            tile_path = tmp_dir / f"tile_{tile['index']:03d}.png"
            scaled_crop.save(tile_path)
            print(f"OCR tile {tile['index'] + 1} at origin {tile['origin']} ...")
            for page_result in ocr.predict(str(tile_path)):
                serializable = as_serializable_result(page_result)
                raw_pages.append(
                    {
                        "tile_index": tile["index"],
                        "origin": list(tile["origin"]),
                        "scale": tile["scale"],
                        "result": serializable,
                    }
                )
                extracted_entries.extend(
                    extract_entries(serializable, tile["origin"], tile["scale"])
                )
    return raw_pages, dedupe_entries(extracted_entries)


def group_entries_into_blocks(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sorted_entries = sorted(entries, key=lambda item: (item["center"][1], item["center"][0]))
    used: set[int] = set()
    blocks: list[dict[str, Any]] = []

    for index, entry in enumerate(sorted_entries):
        if index in used:
            continue

        group = [entry]
        used.add(index)

        for other_index, other in enumerate(sorted_entries[index + 1 :], start=index + 1):
            if other_index in used:
                continue

            y_gap = other["center"][1] - group[-1]["center"][1]
            if y_gap > 70:
                break

            overlap = min(group[-1]["bbox"][2], other["bbox"][2]) - max(
                group[-1]["bbox"][0], other["bbox"][0]
            )
            min_width = min(
                group[-1]["bbox"][2] - group[-1]["bbox"][0],
                other["bbox"][2] - other["bbox"][0],
            )
            overlaps = overlap > min_width * 0.55
            same_line = (
                abs(other["center"][1] - group[-1]["center"][1]) <= 18
                and abs(other["bbox"][0] - group[-1]["bbox"][2]) <= 18
            )

            if (0 < y_gap <= 38 and overlaps) or same_line:
                group.append(other)
                used.add(other_index)

        line_groups: list[dict[str, Any]] = []
        for item in sorted(group, key=lambda current: (current["center"][1], current["bbox"][0])):
            assigned = False
            for line_group in line_groups:
                if abs(item["center"][1] - line_group["y"]) <= 18:
                    line_group["items"].append(item)
                    line_group["y"] = (
                        line_group["y"] * (len(line_group["items"]) - 1) + item["center"][1]
                    ) / len(line_group["items"])
                    assigned = True
                    break
            if not assigned:
                line_groups.append({"y": item["center"][1], "items": [item]})

        rendered_lines: list[str] = []
        for line_group in line_groups:
            kept: list[dict[str, Any]] = []
            for item in sorted(line_group["items"], key=lambda current: current["bbox"][0]):
                if kept:
                    previous = kept[-1]
                    previous_text = prettify_text(previous["text"])
                    current_text = prettify_text(item["text"])
                    previous_key = normalize_text_key(previous_text)
                    current_key = normalize_text_key(current_text)
                    overlap = min(previous["bbox"][2], item["bbox"][2]) - max(
                        previous["bbox"][0], item["bbox"][0]
                    )
                    min_width = min(
                        previous["bbox"][2] - previous["bbox"][0],
                        item["bbox"][2] - item["bbox"][0],
                    )
                    if previous_key and previous_key in current_key:
                        kept[-1] = item
                        continue
                    if current_key and current_key in previous_key:
                        continue
                    if overlap > min_width * 0.45:
                        if item["score"] > previous["score"]:
                            kept[-1] = item
                        continue
                kept.append(item)
            rendered_lines.append(" ".join(prettify_text(item["text"]) for item in kept))

        bbox = [
            min(item["bbox"][0] for item in group),
            min(item["bbox"][1] for item in group),
            max(item["bbox"][2] for item in group),
            max(item["bbox"][3] for item in group),
        ]
        blocks.append(
            {
                "items": group,
                "lines": rendered_lines,
                "text": "<br/>".join(rendered_lines),
                "plain_text": " ".join(rendered_lines),
                "bbox": bbox,
                "center": center_from_bbox(bbox),
            }
        )

    blocks.sort(key=lambda item: (item["center"][1], item["center"][0]))
    return blocks


def block_step_number(block: dict[str, Any]) -> int | None:
    match = re.match(r"^(\d+)\.", block["plain_text"])
    if not match:
        return None
    return int(match.group(1))


def is_probable_overlay_block(block: dict[str, Any]) -> bool:
    text = clean_text(block["plain_text"]).casefold()
    if any(pattern in text for pattern in OVERLAY_HINT_PATTERNS):
        return True
    return block["center"][1] <= 90 and len(text.split()) >= 8


def filter_relevant_blocks(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [block for block in blocks if not is_probable_overlay_block(block)]


def is_probable_region_label(block: dict[str, Any]) -> bool:
    if block_step_number(block) is not None:
        return False
    text_key = normalize_text_key(block["plain_text"])
    if text_key == "cde":
        return True
    return any(key in text_key for key in REGION_LABEL_KEYS if key != "cde")


def is_probable_connector_label(block: dict[str, Any]) -> bool:
    if block_step_number(block) is not None:
        return True
    text_key = normalize_text_key(block["plain_text"])
    if text_key in CONNECTOR_LABEL_KEYS:
        return True
    words = block["plain_text"].split()
    return len(words) <= 3 and (text_key.endswith("data") or "enabled" in text_key)


def is_probable_fragment_block(
    block: dict[str, Any],
    blocks: list[dict[str, Any]],
) -> bool:
    text_key = normalize_text_key(block["plain_text"])
    if not text_key:
        return True
    if len(text_key) == 1:
        return True

    for other in blocks:
        if other is block:
            continue
        other_key = normalize_text_key(other["plain_text"])
        if len(other_key) <= len(text_key):
            continue
        if text_key in other_key and math.dist(block["center"], other["center"]) <= 140:
            return True

    return False


def is_probable_title_block(block: dict[str, Any], blocks: list[dict[str, Any]]) -> bool:
    if block_step_number(block) is not None:
        return False
    if is_probable_region_label(block):
        return False
    words = block["plain_text"].split()
    if not words or len(words) > 4:
        return False
    min_x = min(current["bbox"][0] for current in blocks)
    min_y = min(current["bbox"][1] for current in blocks)
    max_x = max(current["bbox"][2] for current in blocks)
    max_y = max(current["bbox"][3] for current in blocks)
    diagram_width = max(max_x - min_x, 1)
    diagram_height = max(max_y - min_y, 1)
    diagram_center_x = min_x + diagram_width / 2.0
    top_band_matches = sum(
        1
        for current in blocks
        if current is not block and abs(current["center"][1] - block["center"][1]) <= 40
    )
    return (
        top_band_matches == 0
        and block["center"][1] <= min_y + diagram_height * 0.12
        and abs(block["center"][0] - diagram_center_x) <= diagram_width * 0.08
    )


def strip_step_prefix(text: str) -> str:
    return re.sub(r"^\d+\.\s*", "", prettify_text(text))


def detect_region_bbox(image_path: Path, title_block: dict[str, Any]) -> list[float] | None:
    if cv2 is None or np is None:
        return None

    image = cv2.imread(str(image_path))
    if image is None:
        return None

    height, width = image.shape[:2]
    center_x = int(title_block["center"][0])
    bottom_y = int(title_block["bbox"][3])
    best_bbox = None
    best_pixels = 0

    for dx, dy in ((0, 12), (0, 24), (0, 40), (-20, 24), (20, 24), (-40, 30), (40, 30)):
        seed_x = min(max(center_x + dx, 0), width - 1)
        seed_y = min(max(bottom_y + dy, 0), height - 1)
        bgr = image[seed_y, seed_x]
        if int(bgr.max()) < 50 or int(bgr.min()) > 245:
            continue

        mask = np.zeros((height + 2, width + 2), dtype=np.uint8)
        _, _, _, rect = cv2.floodFill(
            image.copy(),
            mask,
            (seed_x, seed_y),
            (0, 0, 255),
            loDiff=(24, 24, 24),
            upDiff=(24, 24, 24),
            flags=4,
        )
        x, y, box_width, box_height = rect
        filled_pixels = int(np.count_nonzero(mask[1:-1, 1:-1]))
        if filled_pixels < 8_000:
            continue
        title_cx, title_cy = title_block["center"]
        if not (x <= title_cx <= x + box_width and y <= title_cy <= y + box_height):
            continue
        if title_cy > y + box_height * 0.35:
            continue
        if filled_pixels > best_pixels:
            best_pixels = filled_pixels
            best_bbox = [float(x), float(y), float(x + box_width), float(y + box_height)]

    return best_bbox


def build_region_specs(
    image_path: Path,
    region_blocks: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    specs: list[dict[str, Any]] = []
    seen_labels: set[str] = set()
    for block in region_blocks:
        label = escape_mermaid_label(block["plain_text"])
        label_key = normalize_text_key(label)
        if label_key in seen_labels:
            continue
        seen_labels.add(label_key)
        bbox = detect_region_bbox(image_path, block)
        if bbox is None:
            continue
        specs.append({"label": label, "bbox": bbox})
    specs.sort(key=lambda spec: ((spec["bbox"][2] - spec["bbox"][0]) * (spec["bbox"][3] - spec["bbox"][1]), spec["bbox"][1], spec["bbox"][0]))
    return specs


def point_in_bbox(point: list[float], bbox: list[float]) -> bool:
    return bbox[0] <= point[0] <= bbox[2] and bbox[1] <= point[1] <= bbox[3]


def escape_mermaid_label(text: str) -> str:
    return prettify_text(text).replace('"', "'").replace("`", "'")


def point_to_bbox_distance(point: tuple[float, float], bbox: list[float]) -> float:
    px, py = point
    left, top, right, bottom = bbox
    dx = max(left - px, 0.0, px - right)
    dy = max(top - py, 0.0, py - bottom)
    return math.hypot(dx, dy)


def point_to_segment_distance(
    point: tuple[float, float],
    start: tuple[float, float],
    end: tuple[float, float],
) -> float:
    px, py = point
    x1, y1 = start
    x2, y2 = end
    dx = x2 - x1
    dy = y2 - y1
    if dx == 0 and dy == 0:
        return math.dist(point, start)
    t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    proj = (x1 + t * dx, y1 + t * dy)
    return math.dist(point, proj)


CONNECTOR_COLORS = ("red", "green", "blue", "black")


def build_color_mask(image_bgr: Any, color_name: str) -> Any:
    """HSV color mask for common diagram connector colors. Returns None if cv2 missing."""
    if cv2 is None or np is None:
        return None
    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    if color_name == "red":
        lower1 = cv2.inRange(hsv, np.array([0, 80, 60]), np.array([10, 255, 255]))
        lower2 = cv2.inRange(hsv, np.array([170, 80, 60]), np.array([179, 255, 255]))
        return cv2.bitwise_or(lower1, lower2)
    if color_name == "green":
        return cv2.inRange(hsv, np.array([40, 60, 60]), np.array([85, 255, 255]))
    if color_name == "blue":
        return cv2.inRange(hsv, np.array([95, 80, 60]), np.array([130, 255, 255]))
    if color_name == "black":
        return cv2.inRange(hsv, np.array([0, 0, 0]), np.array([180, 80, 90]))
    return np.zeros(image_bgr.shape[:2], dtype=np.uint8)


def label_inside_node_region(label_block: dict[str, Any], node: dict[str, Any]) -> bool:
    """True when the OCR label sits inside or just under the node's bbox column.

    Architecture icons almost always have their label inside or directly under
    the icon. This avoids merging far-away OCR text into the wrong node.
    """
    lcx, lcy = label_block["center"]
    x1, y1, x2, y2 = node["bbox"]
    horizontal_overlap = (x1 - 30) <= lcx <= (x2 + 30)
    vertical_ok = (y1 - 20) <= lcy <= (y2 + 60)
    return horizontal_overlap and vertical_ok


def detect_diagram_kind(image_path: Path) -> str:
    """Return 'sequenceDiagram' if vertical lifelines dominate, else 'flowchart'."""
    if cv2 is None or np is None:
        return "flowchart"
    image = cv2.imread(str(image_path))
    if image is None:
        return "flowchart"
    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 60, 180)
    min_line_length = max(50, int(height * 0.55))
    segments = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=np.pi / 180,
        threshold=80,
        minLineLength=min_line_length,
        maxLineGap=10,
    )
    if segments is None:
        return "flowchart"
    bucket_size = max(30, width // 40)
    vertical_buckets: set[int] = set()
    for x1, y1, x2, y2 in segments[:, 0]:
        if abs(x2 - x1) <= 5 and abs(y2 - y1) >= min_line_length:
            vertical_buckets.add(int(round(x1 / bucket_size)))
    return "sequenceDiagram" if len(vertical_buckets) >= 3 else "flowchart"


def detect_visual_nodes(
    image_path: Path,
    all_blocks: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if cv2 is None or np is None:
        return []

    image = cv2.imread(str(image_path))
    if image is None:
        return []
    height, width = image.shape[:2]

    non_black = (np.max(image, axis=2) > 35).astype(np.uint8) * 255

    connector_mask = np.zeros((height, width), dtype=np.uint8)
    for color_name in CONNECTOR_COLORS:
        mask = build_color_mask(image, color_name)
        if mask is None:
            continue
        connector_mask = cv2.bitwise_or(connector_mask, mask)
    connector_mask = cv2.dilate(connector_mask, np.ones((3, 3), np.uint8), iterations=1)

    text_mask = np.zeros((height, width), dtype=np.uint8)
    for block in all_blocks:
        x1, y1, x2, y2 = block["bbox"]
        left = max(0, int(x1) - 3)
        top = max(0, int(y1) - 3)
        right = min(width - 1, int(x2) + 3)
        bottom = min(height - 1, int(y2) + 3)
        cv2.rectangle(text_mask, (left, top), (right, bottom), 255, -1)

    candidate_mask = cv2.bitwise_and(non_black, cv2.bitwise_not(connector_mask))
    candidate_mask = cv2.bitwise_and(candidate_mask, cv2.bitwise_not(text_mask))
    candidate_mask = cv2.morphologyEx(candidate_mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    candidate_mask = cv2.morphologyEx(candidate_mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))

    component_count, labels, stats, _ = cv2.connectedComponentsWithStats(candidate_mask, 8)
    visual_nodes: list[dict[str, Any]] = []
    for index in range(1, component_count):
        x, y, box_width, box_height, area = stats[index]
        if area < 90 or area > 120000:
            continue
        if box_width < 8 or box_height < 8:
            continue
        if box_width > width * 0.65 or box_height > height * 0.65:
            continue

        component_pixels = image[labels == index]
        if component_pixels.size == 0:
            continue
        mean_bgr = component_pixels.mean(axis=0)
        if mean_bgr[2] > mean_bgr[1] + 25 and mean_bgr[2] > mean_bgr[0] + 25:
            kind = "firewall"
        elif mean_bgr[1] > mean_bgr[2] + 20 and mean_bgr[1] > mean_bgr[0] + 20:
            kind = "service"
        else:
            kind = "icon"

        bbox = [float(x), float(y), float(x + box_width), float(y + box_height)]
        visual_nodes.append(
            {
                "bbox": bbox,
                "center": center_from_bbox(bbox),
                "kind": kind,
                "labels": [],
            }
        )

    visual_nodes.sort(key=lambda node: (node["center"][1], node["center"][0]))
    return visual_nodes


def attach_labels_to_visual_nodes(
    visual_nodes: list[dict[str, Any]],
    label_blocks: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if not visual_nodes:
        return [], label_blocks

    assigned_label_ids: set[int] = set()
    for label_block in label_blocks:
        best_node = None
        best_distance = float("inf")
        for node in visual_nodes:
            if not label_inside_node_region(label_block, node):
                continue
            distance = point_to_bbox_distance(tuple(label_block["center"]), node["bbox"])
            if distance < best_distance:
                best_distance = distance
                best_node = node
        if best_node is not None:
            best_node["labels"].append(label_block)
            assigned_label_ids.add(id(label_block))

    nodes: list[dict[str, Any]] = []
    unnamed_counter = 1
    for node in visual_nodes:
        label_items = sorted(
            node["labels"],
            key=lambda item: (item["center"][1], item["center"][0]),
        )
        if label_items:
            lines = [escape_mermaid_label(item["plain_text"]) for item in label_items]
            plain_text = " ".join(item["plain_text"] for item in label_items)
        elif node["kind"] == "firewall":
            lines = ["Firewall"]
            plain_text = "Firewall"
        else:
            lines = [f"Unlabeled Node {unnamed_counter}"]
            plain_text = lines[0]
            unnamed_counter += 1

        text = "<br/>".join(lines)
        nodes.append(
            {
                "lines": lines,
                "text": text,
                "plain_text": plain_text,
                "bbox": node["bbox"],
                "center": node["center"],
            }
        )

    unassigned = [block for block in label_blocks if id(block) not in assigned_label_ids]
    return nodes, unassigned


def detect_arrow_tips(mask: Any) -> list[tuple[float, float]]:
    tips: list[tuple[float, float]] = []
    contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < 12 or area > 900:
            continue
        perimeter = cv2.arcLength(contour, True)
        if perimeter <= 0:
            continue
        approximation = cv2.approxPolyDP(contour, 0.06 * perimeter, True)
        if len(approximation) < 3 or len(approximation) > 6:
            continue
        moments = cv2.moments(contour)
        if abs(moments["m00"]) < 1e-6:
            continue
        centroid = (moments["m10"] / moments["m00"], moments["m01"] / moments["m00"])
        vertices = [tuple(point[0]) for point in approximation]
        tip = max(vertices, key=lambda point: math.dist(point, centroid))
        tips.append((float(tip[0]), float(tip[1])))
    return tips


def trace_colored_edges(
    image_path: Path,
    nodes: list[dict[str, Any]],
    connector_labels: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if cv2 is None or np is None or not nodes:
        return []

    image = cv2.imread(str(image_path))
    if image is None:
        return []

    edges: list[dict[str, Any]] = []

    def nearest_node(point: tuple[float, float]) -> dict[str, Any] | None:
        best = None
        best_distance = float("inf")
        for node in nodes:
            distance = point_to_bbox_distance(point, node["bbox"])
            if distance < best_distance:
                best_distance = distance
                best = node
        # Tightened from 55 -> 22 to stop arrows binding to far-away nodes
        if best_distance > 22:
            return None
        return best

    for color_name in CONNECTOR_COLORS:
        mask = build_color_mask(image, color_name)
        if mask is None:
            continue
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        arrow_tips = detect_arrow_tips(mask)
        segments = cv2.HoughLinesP(
            mask,
            rho=1,
            theta=np.pi / 180,
            threshold=20,
            minLineLength=24,
            maxLineGap=7,
        )
        if segments is None:
            continue

        for segment in segments[:, 0]:
            x1, y1, x2, y2 = segment
            start = (float(x1), float(y1))
            end = (float(x2), float(y2))
            source_node = nearest_node(start)
            target_node = nearest_node(end)
            if source_node is None or target_node is None or source_node is target_node:
                continue

            start_tip = any(math.dist(start, tip) <= 18 for tip in arrow_tips)
            end_tip = any(math.dist(end, tip) <= 18 for tip in arrow_tips)
            directed = start_tip ^ end_tip
            if directed and start_tip:
                source_node, target_node = target_node, source_node

            midpoint = ((start[0] + end[0]) / 2.0, (start[1] + end[1]) / 2.0)
            edges.append(
                {
                    "source": source_node,
                    "target": target_node,
                    "directed": directed,
                    "color": color_name,
                    "segment": (start, end),
                    "midpoint": midpoint,
                    "length": math.dist(start, end),
                    "label": None,
                }
            )

    for connector_label in connector_labels:
        label_point = tuple(connector_label["center"])
        best_edge = None
        best_distance = float("inf")
        for edge in edges:
            distance = point_to_segment_distance(label_point, edge["segment"][0], edge["segment"][1])
            if distance < best_distance:
                best_distance = distance
                best_edge = edge
        if best_edge is not None and best_distance <= 48 and best_edge["label"] is None:
            best_edge["label"] = escape_mermaid_label(strip_step_prefix(connector_label["plain_text"]))

    # Collapse opposite-direction and duplicate edges on the same node pair.
    # Preference order: labeled > directed > longer segment.
    by_pair: dict[tuple[int, int], dict[str, Any]] = {}
    for edge in edges:
        pair = tuple(sorted((id(edge["source"]), id(edge["target"]))))
        existing = by_pair.get(pair)
        score_new = (1 if edge["label"] else 0, 1 if edge["directed"] else 0, edge["length"])
        if existing is None:
            by_pair[pair] = edge
            continue
        score_old = (
            1 if existing["label"] else 0,
            1 if existing["directed"] else 0,
            existing["length"],
        )
        if score_new > score_old:
            by_pair[pair] = edge
    return list(by_pair.values())


def edge_segment_points(edge: dict[str, Any]) -> tuple[tuple[int, int], tuple[int, int]]:
    start, end = edge["segment"]
    start_point = (int(start[0]), int(start[1]))
    end_point = (int(end[0]), int(end[1]))
    if not edge.get("directed"):
        return start_point, end_point

    source_bbox = edge["source"]["bbox"]
    target_bbox = edge["target"]["bbox"]
    start_to_source = point_to_bbox_distance(start, source_bbox)
    end_to_source = point_to_bbox_distance(end, source_bbox)
    start_to_target = point_to_bbox_distance(start, target_bbox)
    end_to_target = point_to_bbox_distance(end, target_bbox)
    if start_to_source + end_to_target <= end_to_source + start_to_target:
        return start_point, end_point
    return end_point, start_point


def build_text_mask(
    image_shape: tuple[int, int] | tuple[int, int, int],
    blocks: list[dict[str, Any]],
    padding: int = 3,
) -> Any:
    if np is None or cv2 is None:
        return None
    height, width = image_shape[:2]
    mask = np.zeros((height, width), dtype=np.uint8)
    for block in blocks:
        x1, y1, x2, y2 = block["bbox"]
        left = max(0, int(x1) - padding)
        top = max(0, int(y1) - padding)
        right = min(width - 1, int(x2) + padding)
        bottom = min(height - 1, int(y2) + padding)
        cv2.rectangle(mask, (left, top), (right, bottom), 255, -1)
    return mask


def line_axis_coverage(mask: Any, axis: str) -> float:
    if mask.size == 0:
        return 0.0
    if axis == "x":
        return float(np.count_nonzero(np.any(mask > 0, axis=0))) / max(mask.shape[1], 1)
    return float(np.count_nonzero(np.any(mask > 0, axis=1))) / max(mask.shape[0], 1)


def summarize_box_contents(
    bbox: list[float],
    blocks: list[dict[str, Any]],
    limit: int = 6,
) -> list[str]:
    contents = [
        clean_text(block["plain_text"])
        for block in blocks
        if point_in_bbox(block["center"], bbox)
        and not is_probable_region_label(block)
        and not is_probable_connector_label(block)
    ]
    deduped: list[str] = []
    seen: set[str] = set()
    for text in contents:
        key = normalize_text_key(text)
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(text)
        if len(deduped) >= limit:
            break
    return deduped


def detect_dashed_boxes(
    image_path: Path,
    blocks: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if cv2 is None or np is None:
        return []

    image = cv2.imread(str(image_path))
    if image is None:
        return []

    height, width = image.shape[:2]
    dark_mask = build_color_mask(image, "black")
    if dark_mask is None:
        return []

    text_mask = build_text_mask(image.shape, blocks, padding=2)
    if text_mask is not None:
        dark_mask = cv2.bitwise_and(dark_mask, cv2.bitwise_not(text_mask))

    horizontal_bridge = max(22, min(90, width // 35))
    vertical_bridge = max(18, min(80, height // 25))
    horizontal_kernel = np.ones((1, horizontal_bridge), dtype=np.uint8)
    vertical_kernel = np.ones((vertical_bridge, 1), dtype=np.uint8)
    horizontal_keep = np.ones((1, max(14, horizontal_bridge // 2)), dtype=np.uint8)
    vertical_keep = np.ones((max(12, vertical_bridge // 2), 1), dtype=np.uint8)

    horizontal = cv2.morphologyEx(dark_mask, cv2.MORPH_CLOSE, horizontal_kernel)
    horizontal = cv2.morphologyEx(horizontal, cv2.MORPH_OPEN, horizontal_keep)
    vertical = cv2.morphologyEx(dark_mask, cv2.MORPH_CLOSE, vertical_kernel)
    vertical = cv2.morphologyEx(vertical, cv2.MORPH_OPEN, vertical_keep)
    box_mask = cv2.bitwise_or(horizontal, vertical)
    box_mask = cv2.morphologyEx(box_mask, cv2.MORPH_CLOSE, np.ones((7, 7), dtype=np.uint8))

    contours, _ = cv2.findContours(box_mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    candidates: list[dict[str, Any]] = []
    for contour in contours:
        x, y, box_width, box_height = cv2.boundingRect(contour)
        if box_width < 70 or box_height < 45:
            continue
        if box_width > width * 0.96 or box_height > height * 0.96:
            continue

        bbox = [float(x), float(y), float(x + box_width), float(y + box_height)]
        side_band = max(5, min(18, int(min(box_width, box_height) * 0.12)))
        top = horizontal[y : y + side_band, x : x + box_width]
        bottom = horizontal[y + box_height - side_band : y + box_height, x : x + box_width]
        left = vertical[y : y + box_height, x : x + side_band]
        right = vertical[y : y + box_height, x + box_width - side_band : x + box_width]
        top_coverage = line_axis_coverage(top, "x")
        bottom_coverage = line_axis_coverage(bottom, "x")
        left_coverage = line_axis_coverage(left, "y")
        right_coverage = line_axis_coverage(right, "y")
        if min(top_coverage, bottom_coverage, left_coverage, right_coverage) < 0.22:
            continue

        line_pixels = int(np.count_nonzero(box_mask[y : y + box_height, x : x + box_width]))
        pixel_ratio = line_pixels / max(box_width * box_height, 1)
        if pixel_ratio < 0.006 or pixel_ratio > 0.45:
            continue

        contents = summarize_box_contents(bbox, blocks)
        if not contents:
            continue
        candidates.append(
            {
                "bbox": bbox,
                "center": center_from_bbox(bbox),
                "contents": contents,
                "coverage": {
                    "top": round(top_coverage, 3),
                    "bottom": round(bottom_coverage, 3),
                    "left": round(left_coverage, 3),
                    "right": round(right_coverage, 3),
                },
            }
        )

    horizontal_lines: list[dict[str, float]] = []
    horizontal_contours, _ = cv2.findContours(horizontal, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    for contour in horizontal_contours:
        x, y, line_width, line_height = cv2.boundingRect(contour)
        if line_width < 70 or line_height > 20:
            continue
        if line_width > width * 0.85:
            continue
        horizontal_lines.append(
            {
                "x1": float(x),
                "y1": float(y),
                "x2": float(x + line_width),
                "y2": float(y + line_height),
                "cx": float(x + line_width / 2.0),
                "cy": float(y + line_height / 2.0),
                "width": float(line_width),
            }
        )

    vertical_lines: list[dict[str, float]] = []
    vertical_contours, _ = cv2.findContours(vertical, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    for contour in vertical_contours:
        x, y, line_width, line_height = cv2.boundingRect(contour)
        if line_height < 40 or line_width > 20:
            continue
        if line_height > height * 0.6:
            continue
        vertical_lines.append(
            {
                "x1": float(x),
                "y1": float(y),
                "x2": float(x + line_width),
                "y2": float(y + line_height),
                "cx": float(x + line_width / 2.0),
                "cy": float(y + line_height / 2.0),
                "height": float(line_height),
            }
        )

    def vertical_overlap_ratio(line: dict[str, float], top_y: float, bottom_y: float) -> float:
        box_height = max(bottom_y - top_y, 1.0)
        overlap = min(line["y2"], bottom_y) - max(line["y1"], top_y)
        return max(0.0, overlap) / box_height

    for top_line in horizontal_lines:
        for bottom_line in horizontal_lines:
            if bottom_line["cy"] <= top_line["cy"] + 35:
                continue
            box_height = bottom_line["cy"] - top_line["cy"]
            if box_height > min(280, height * 0.35):
                continue

            overlap_left = max(top_line["x1"], bottom_line["x1"])
            overlap_right = min(top_line["x2"], bottom_line["x2"])
            overlap_width = max(0.0, overlap_right - overlap_left)
            min_width = max(min(top_line["width"], bottom_line["width"]), 1.0)
            endpoints_match = (
                abs(top_line["x1"] - bottom_line["x1"]) <= 85
                and abs(top_line["x2"] - bottom_line["x2"]) <= 85
            )
            if overlap_width / min_width < 0.55 and not endpoints_match:
                continue

            left_edge_x = min(top_line["x1"], bottom_line["x1"])
            right_edge_x = max(top_line["x2"], bottom_line["x2"])
            top_y = min(top_line["y1"], bottom_line["y1"])
            bottom_y = max(top_line["y2"], bottom_line["y2"])
            if right_edge_x - left_edge_x < 90:
                continue

            left_sides = [
                line
                for line in vertical_lines
                if abs(line["cx"] - left_edge_x) <= 55
                and vertical_overlap_ratio(line, top_y, bottom_y) >= 0.35
            ]
            right_sides = [
                line
                for line in vertical_lines
                if abs(line["cx"] - right_edge_x) <= 55
                and vertical_overlap_ratio(line, top_y, bottom_y) >= 0.35
            ]
            if not left_sides or not right_sides:
                continue

            left_side = min(left_sides, key=lambda line: abs(line["cx"] - left_edge_x))
            right_side = min(right_sides, key=lambda line: abs(line["cx"] - right_edge_x))
            bbox = [
                min(left_edge_x, left_side["x1"]),
                min(top_y, left_side["y1"], right_side["y1"]),
                max(right_edge_x, right_side["x2"]),
                max(bottom_y, left_side["y2"], right_side["y2"]),
            ]
            contents = summarize_box_contents(bbox, blocks)
            if not contents:
                continue
            candidates.append(
                {
                    "bbox": bbox,
                    "center": center_from_bbox(bbox),
                    "contents": contents,
                    "coverage": {
                        "top": 1.0,
                        "bottom": 1.0,
                        "left": round(vertical_overlap_ratio(left_side, top_y, bottom_y), 3),
                        "right": round(vertical_overlap_ratio(right_side, top_y, bottom_y), 3),
                    },
                    "source": "line_pair",
                }
            )

    candidates.sort(
        key=lambda box: (
            (box["bbox"][2] - box["bbox"][0]) * (box["bbox"][3] - box["bbox"][1]),
            box["bbox"][1],
            box["bbox"][0],
        )
    )
    deduped: list[dict[str, Any]] = []
    for candidate in candidates:
        candidate_area = (candidate["bbox"][2] - candidate["bbox"][0]) * (
            candidate["bbox"][3] - candidate["bbox"][1]
        )
        duplicate = False
        for existing in deduped:
            existing_area = (existing["bbox"][2] - existing["bbox"][0]) * (
                existing["bbox"][3] - existing["bbox"][1]
            )
            same_box = iou(candidate["bbox"], existing["bbox"]) >= 0.72
            same_center = math.dist(candidate["center"], existing["center"]) <= 24
            similar_area = min(candidate_area, existing_area) / max(candidate_area, existing_area) >= 0.72
            if same_box or (same_center and similar_area):
                duplicate = True
                break
        if not duplicate:
            deduped.append(candidate)

    return deduped


def relative_href(source_path: Path, output_dir: Path) -> str:
        relative_path = Path(os.path.relpath(source_path, output_dir)).as_posix()
        return urllib.parse.quote(relative_path, safe="/:.")


def edge_color_hex(color_name: str | None) -> str:
        return {
                "red": "#d12f2f",
                "green": "#168a35",
                "blue": "#1f6feb",
                "black": "#2b2f36",
        }.get(color_name or "", "#6f42c1")


def rounded_bbox(bbox: list[float]) -> list[float]:
        return [round(float(value), 2) for value in bbox]


def build_detection_sets(
        image_path: Path,
        entries: list[dict[str, Any]],
) -> dict[str, Any]:
        blocks = filter_relevant_blocks(group_entries_into_blocks(entries))
        title_blocks = {
                id(block)
                for block in blocks
                if is_probable_title_block(block, blocks) or is_probable_region_label(block)
        }
        edge_blocks = [block for block in blocks if is_probable_connector_label(block)]
        fragment_blocks = {id(block) for block in blocks if is_probable_fragment_block(block, blocks)}
        text_label_blocks = [
                block
                for block in blocks
                if id(block) not in title_blocks and id(block) not in fragment_blocks and block not in edge_blocks
        ]

        visual_nodes = detect_visual_nodes(image_path, blocks)
        owned_nodes, unassigned_text_nodes = attach_labels_to_visual_nodes(visual_nodes, text_label_blocks)
        node_blocks = owned_nodes + unassigned_text_nodes
        if len(node_blocks) < 3:
                node_blocks = text_label_blocks

        region_blocks = [block for block in blocks if is_probable_region_label(block)]
        region_specs = build_region_specs(image_path, region_blocks)
        dashed_boxes = detect_dashed_boxes(image_path, blocks)
        traced_edges = trace_colored_edges(image_path, node_blocks, edge_blocks)
        return {
                "blocks": blocks,
                "edge_blocks": edge_blocks,
                "node_blocks": node_blocks,
                "region_specs": region_specs,
                "dashed_boxes": dashed_boxes,
                "traced_edges": traced_edges,
                "unassigned_text_nodes": unassigned_text_nodes,
        }


def build_diagram_model(
        image_path: Path,
        output_dir: Path,
        entries: list[dict[str, Any]],
) -> dict[str, Any]:
        with Image.open(image_path) as source:
                image_width, image_height = source.size

        detection_sets = build_detection_sets(image_path, entries)
        node_blocks = detection_sets["node_blocks"]
        node_ids: dict[int, str] = {
                id(block): f"n{index}" for index, block in enumerate(node_blocks, start=1)
        }

        nodes = []
        unassigned_ids = {id(block) for block in detection_sets["unassigned_text_nodes"]}
        for index, block in enumerate(node_blocks, start=1):
                label = clean_text(block.get("plain_text", f"Node {index}"))
                nodes.append(
                        {
                                "id": node_ids[id(block)],
                                "label": label,
                                "lines": [clean_text(line) for line in block.get("lines", [label])],
                                "bbox": rounded_bbox(block["bbox"]),
                                "center": rounded_bbox(block["center"]),
                                "source": "ocr_text" if id(block) in unassigned_ids else "visual_shape",
                        }
                )

        regions = []
        for index, region in enumerate(detection_sets["region_specs"], start=1):
                regions.append(
                        {
                                "id": f"region{index}",
                                "label": clean_text(region["label"]),
                                "bbox": rounded_bbox(region["bbox"]),
                                "style": "solid",
                                "source": "flood_fill",
                                "contents": [],
                        }
                )
        for index, dashed_box in enumerate(detection_sets["dashed_boxes"], start=1):
                regions.append(
                        {
                                "id": f"dashed{index}",
                                "label": f"Dashed Group {index}",
                                "bbox": rounded_bbox(dashed_box["bbox"]),
                                "style": "dashed",
                                "source": dashed_box.get("source", "dashed_box"),
                                "contents": dashed_box.get("contents", []),
                                "coverage": dashed_box.get("coverage", {}),
                        }
                )

        edges = []
        for index, edge in enumerate(detection_sets["traced_edges"], start=1):
                source_id = node_ids.get(id(edge["source"]))
                target_id = node_ids.get(id(edge["target"]))
                if not source_id or not target_id:
                        continue
                start_point, end_point = edge_segment_points(edge)
                edges.append(
                        {
                                "id": f"e{index}",
                                "source": source_id,
                                "target": target_id,
                                "label": edge.get("label") or "",
                                "color": edge.get("color") or "black",
                                "stroke": edge_color_hex(edge.get("color")),
                                "directed": bool(edge.get("directed")),
                                "points": [[start_point[0], start_point[1]], [end_point[0], end_point[1]]],
                                "midpoint": rounded_bbox(list(edge.get("midpoint", []))) if edge.get("midpoint") else [],
                        }
                )

        return {
                "schema": "atm.diagram-model.v1",
                "image": {
                        "path": str(image_path),
                        "href": relative_href(image_path, output_dir),
                        "width": image_width,
                        "height": image_height,
                },
                "counts": {
                        "nodes": len(nodes),
                        "regions": len(regions),
                        "edges": len(edges),
                        "ocrBlocks": len(detection_sets["blocks"]),
                },
                "nodes": nodes,
                "regions": regions,
                "edges": edges,
        }


def cleanup_generated_outputs(output_dir: Path, stem: str) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    json_name = f"{stem}.json"
    for path in output_dir.glob(f"{stem}*"):
        if path.name != json_name and path.is_file():
            path.unlink()


def write_outputs(
    image_path: Path,
    output_dir: Path,
    raw_pages: list[dict[str, Any]],
    filtered_entries: list[dict[str, Any]],
    min_score: float,
    diagram_type: str,
    diagram_model: dict[str, Any],
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = image_path.stem
    json_path = output_dir / f"{stem}.json"
    payload = {
        "image": str(image_path),
        "diagram_type": diagram_type,
        "count": len(filtered_entries),
        "min_score": min_score,
        "entries": filtered_entries,
        "raw_pages": raw_pages,
        "diagram_model": diagram_model,
    }
    json_path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return json_path


def main() -> None:
    args = parse_args()
    image_path = ensure_image_path(Path(args.image).expanduser())
    output_dir = Path(args.output_dir).expanduser().resolve()
    models_dir = Path(args.models_dir).expanduser().resolve()

    print(f"Using input image: {image_path}")
    print(f"Caching models in: {models_dir}")
    print("Generating OCR/CV JSON output")
    ocr = build_ocr(models_dir, args.det_limit_side_len)
    raw_pages, entries = run_ocr(
        ocr=ocr,
        image_path=image_path,
        tile_size=args.tile_size,
        overlap=args.tile_overlap,
        scale=args.scale,
    )
    filtered_entries = filter_entries(entries, args.min_score)
    resolved_diagram_type = resolve_diagram_type(args.diagram_type, image_path)
    cleanup_generated_outputs(output_dir, image_path.stem)
    diagram_model = build_diagram_model(
        image_path=image_path,
        output_dir=output_dir,
        entries=filtered_entries,
    )
    json_path = write_outputs(
        image_path=image_path,
        output_dir=output_dir,
        raw_pages=raw_pages,
        filtered_entries=filtered_entries,
        min_score=args.min_score,
        diagram_type=resolved_diagram_type,
        diagram_model=diagram_model,
    )

    print(f"Saved JSON output to: {json_path}")
    print(f"Detected {len(entries)} text regions before score filtering.")


if __name__ == "__main__":
    main()
