import fitz  # PyMuPDF
import io
import logging
from typing import List, Dict, Any, Tuple

logger = logging.getLogger(__name__)

def extract_text_from_pdf_bytes(file_bytes: bytes) -> List[Dict[str, Any]]:
    """Extracts text from an in-memory PDF securely."""
    pages_data = []
    try:
        with fitz.open("pdf", file_bytes) as doc:
            for page_num, page in enumerate(doc):
                text = page.get_text("text").strip()
                if text:
                    pages_data.append({"text": text, "page_number": page_num + 1})
        return pages_data
    except Exception as e:
        logger.error(f"PDF Parsing Error: {str(e)}")
        raise ValueError("Invalid or corrupted PDF file.")


def extract_images_from_pdf_bytes(file_bytes: bytes, min_size: int = 100) -> List[Dict[str, Any]]:
    """
    Extracts embedded images from a PDF.
    Returns list of dicts with keys: page, index, ext, width, height, image_bytes.
    Skips images smaller than min_size pixels on either dimension.
    """
    images = []
    try:
        with fitz.open("pdf", file_bytes) as doc:
            for page_num, page in enumerate(doc):
                image_list = page.get_images(full=True)
                for img_idx, img_info in enumerate(image_list):
                    xref = img_info[0]
                    try:
                        base_image = doc.extract_image(xref)
                        if not base_image:
                            continue
                        width = base_image.get("width", 0)
                        height = base_image.get("height", 0)
                        if width < min_size or height < min_size:
                            continue
                        images.append({
                            "page": page_num + 1,
                            "index": img_idx,
                            "ext": base_image.get("ext", "png"),
                            "width": width,
                            "height": height,
                            "image_bytes": base_image["image"],
                        })
                    except Exception as e:
                        logger.warning(f"Failed to extract image xref={xref} on page {page_num + 1}: {e}")
                        continue
        return images
    except Exception as e:
        logger.error(f"PDF Image Extraction Error: {str(e)}")
        raise ValueError("Could not extract images from PDF.")