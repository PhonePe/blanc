import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class StorageResult:
    """Result of a file storage operation."""
    stored_path: str          # local path or remote document id
    absolute_path: str        # absolute local path or remote public URL
    backend: str              # "local" or "s3"
    public_url: Optional[str] = None   # remote public URL, if the backend exposes one
    document_id: Optional[str] = None  # remote backend document id


class StorageBackend(ABC):
    """Abstract interface for file storage."""

    @abstractmethod
    def save(self, content: bytes, assessment_id: str,
             filename: str, original_filename: str = "") -> StorageResult:
        """
        Save file content and return storage result.

        Args:
            content: raw file bytes
            assessment_id: owning assessment UUID
            filename: target filename (usually uuid-based)
            original_filename: original user-provided filename
        """
        ...

    @abstractmethod
    def read(self, stored_path: str) -> bytes:
        """Read file content from storage."""
        ...

    @abstractmethod
    def exists(self, stored_path: str) -> bool:
        """Check if a file exists in storage."""
        ...

    def ensure_dirs(self, assessment_id: str) -> None:
        """Create required directory structure (no-op for remote backends)."""
        pass

    def cleanup_local_cache(self, file_path: str) -> None:
        """Remove a locally cached file after processing. No-op for local-only backends."""
        pass

    def cleanup_assessment_cache(self, assessment_id: str) -> None:
        """Remove entire local cache directory for an assessment. No-op for local-only backends."""
        pass
