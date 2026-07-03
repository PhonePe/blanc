"""
Tiny content-based file-type sniffer.

We do NOT trust the client-declared MIME type on uploads — an attacker can
send ``Content-Type: image/png`` with a full HTML+SVG payload and the
router will happily accept it. Sniffing the first few bytes closes that
hole for the common formats we care about (images + PDF) without pulling
in ``python-magic`` and its libmagic native dep.

Usage::

    from atm.util.file_sniff import detect_mime, is_image_bytes

    mime = detect_mime(file_bytes)      # -> "image/png" | "application/pdf" | None
    is_image_bytes(file_bytes)          # -> bool
"""
from __future__ import annotations

from typing import Optional

_IMAGE_MIMES = {
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/tiff",
}

# Magic-byte prefixes, ordered longest-first for prefixes that share a
# common start.
_SIGNATURES: list[tuple[bytes, str]] = [
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"BM", "image/bmp"),
    (b"II*\x00", "image/tiff"),
    (b"MM\x00*", "image/tiff"),
    (b"%PDF-", "application/pdf"),
]


def detect_mime(data: bytes) -> Optional[str]:
    """Return a MIME type inferred from magic bytes, or ``None`` if unknown.

    Only recognises the small allow-list we accept as upload input:
    common raster images and PDF. Everything else returns ``None``.
    """
    if not data:
        return None

    # WEBP is `RIFF....WEBP` — needs a byte-slice check, not a prefix.
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"

    for sig, mime in _SIGNATURES:
        if data.startswith(sig):
            return mime
    return None


def is_image_bytes(data: bytes) -> bool:
    return detect_mime(data) in _IMAGE_MIMES


def is_pdf_bytes(data: bytes) -> bool:
    return detect_mime(data) == "application/pdf"


def safe_filename(name: str) -> str:
    """Return a filename safe for logging + DB persistence.

    Strips path separators, control chars, and newlines (the last is the
    log-injection vector — a filename of ``foo.pdf\\nFAKE LOG LINE``
    would otherwise inject fabricated entries into every log we write
    from user filenames). Caps length to keep DB columns predictable.
    """
    if not name:
        return "upload"
    # Take just the leaf — no dirs
    leaf = name.replace("\\", "/").split("/")[-1]
    # Drop control chars (including \n, \r, \x00) and any non-printable
    cleaned = "".join(c for c in leaf if c.isprintable() and c not in "\r\n\t")
    return cleaned[:200] or "upload"
