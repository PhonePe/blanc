import os
import logging

from atm.core.storage.base import StorageBackend, StorageResult


class LocalStorageBackend(StorageBackend):
    """Saves files to the local filesystem under an upload directory."""

    _IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".tif", ".tiff"}

    def __init__(self, upload_dir: str = "uploads"):
        self.upload_dir = upload_dir

    def ensure_dirs(self, assessment_id: str) -> None:
        os.makedirs(os.path.join(self.upload_dir, assessment_id), exist_ok=True)

    def save(self, content: bytes, assessment_id: str,
             filename: str, original_filename: str = "") -> StorageResult:
        stored_filename = self._build_stored_filename(filename)
        folder = os.path.join(self.upload_dir, assessment_id)
        os.makedirs(folder, exist_ok=True)
        file_path = os.path.join(folder, stored_filename)

        with open(file_path, "wb") as f:
            f.write(content)

        absolute_path = os.path.join(os.getcwd(), file_path)
        logging.info(f"[LocalStorage] Saved {original_filename or filename} -> {file_path}")

        return StorageResult(
            stored_path=file_path,
            absolute_path=absolute_path,
            backend="local",
        )

    def read(self, stored_path: str) -> bytes:
        with open(stored_path, "rb") as f:
            return f.read()

    def exists(self, stored_path: str) -> bool:
        return os.path.exists(stored_path)

    def _build_stored_filename(self, filename: str) -> str:
        ext = os.path.splitext(filename)[1].lower()
        stem = os.path.splitext(filename)[0]
        prefix = "input" if ext in self._IMAGE_EXTENSIONS else "supporting"
        return f"{prefix}_{stem}{ext}"

    def cleanup_assessment_cache(self, assessment_id: str) -> None:
        """No-op for the local backend.

        Unlike S3/DocStore, ``uploads/<assessment_id>/`` is the *primary*
        store here — not a mirror cache — so we deliberately keep the
        files on disk after pipeline completion. Users can inspect,
        re-download, or re-run the assessment against the original bytes.
        """
        folder = os.path.join(self.upload_dir, assessment_id)
        if os.path.isdir(folder):
            logging.info(
                "[LocalStorage] Skipping cleanup for %s — files preserved in %s",
                assessment_id, folder,
            )
