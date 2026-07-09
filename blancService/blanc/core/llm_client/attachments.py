"""
Pluggable attachment loaders.

The :class:`LLMClient` reads attachment paths/URLs and passes raw bytes +
mime types to providers. Loaders abstract *where* those bytes come from
(local filesystem, HTTP, S3, object storage, ...).
"""
from __future__ import annotations

import logging
import mimetypes
from abc import ABC, abstractmethod
from pathlib import Path
from typing import List, Optional, Tuple
from urllib.parse import urlparse

logger = logging.getLogger(__name__)


def is_remote_location(path_or_url: str) -> bool:
    parsed = urlparse(path_or_url)
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def guess_mime_type(path_or_url: str, response_content_type: Optional[str] = None) -> str:
    if response_content_type:
        mime_type = response_content_type.split(";", 1)[0].strip()
        if mime_type:
            return mime_type
    guess_target = urlparse(path_or_url).path if is_remote_location(path_or_url) else path_or_url
    mime_type, _ = mimetypes.guess_type(guess_target)
    return mime_type or "application/octet-stream"


class AttachmentLoader(ABC):
    """Resolves an opaque path/URL into bytes + mime type."""

    @abstractmethod
    def can_handle(self, path_or_url: str) -> bool: ...

    @abstractmethod
    def load(self, path_or_url: str) -> Tuple[bytes, str]:
        """Return ``(content_bytes, mime_type)``."""


class LocalAttachmentLoader(AttachmentLoader):
    """Reads from the local filesystem.

    ``search_dirs`` are additional fallback directories. If a relative path
    doesn't resolve directly, each search dir is tried (with both the full
    path and ``path.name``).
    """

    def __init__(self, search_dirs: Optional[List[Path]] = None):
        self._search_dirs = [Path(d) for d in (search_dirs or [])]

    def can_handle(self, path_or_url: str) -> bool:
        return not is_remote_location(path_or_url)

    def resolve(self, path_or_url: str) -> Path:
        path = Path(path_or_url).expanduser()
        if path.is_file():
            return path.resolve()
        for d in self._search_dirs:
            candidate = (d / path).resolve()
            if candidate.is_file():
                return candidate
            candidate = (d / path.name).resolve()
            if candidate.is_file():
                return candidate
        raise FileNotFoundError(
            f"Attachment not found: {path_or_url}. Searched: "
            f"{[str(d) for d in self._search_dirs]}"
        )

    def load(self, path_or_url: str) -> Tuple[bytes, str]:
        local = self.resolve(path_or_url)
        return local.read_bytes(), guess_mime_type(str(local))


class HttpAttachmentLoader(AttachmentLoader):
    """Fetches via httpx. Optional ``ssl_verify_resolver`` lets callers tune
    verification on a per-host basis (e.g. allowing self-signed certs for an
    internal document store while keeping the default strict elsewhere)."""

    def __init__(
        self,
        timeout: float = 60.0,
        default_verify: bool = True,
        ssl_verify_resolver=None,
    ):
        self._timeout = timeout
        self._default_verify = default_verify
        self._resolver = ssl_verify_resolver

    def can_handle(self, path_or_url: str) -> bool:
        return is_remote_location(path_or_url)

    def load(self, path_or_url: str) -> Tuple[bytes, str]:
        import httpx  # local import — keep stdlib-only at module level

        verify = self._default_verify
        if self._resolver is not None:
            try:
                verify = bool(self._resolver(path_or_url))
            except Exception as e:  # pragma: no cover - resolver bugs shouldn't break load
                logger.warning("ssl_verify_resolver raised %s; using default", e)

        with httpx.Client(
            timeout=self._timeout,
            follow_redirects=True,
            verify=verify,
            trust_env=False,
        ) as client:
            response = client.get(path_or_url)
            response.raise_for_status()
            return response.content, guess_mime_type(
                path_or_url, response.headers.get("content-type")
            )


class CompositeAttachmentLoader(AttachmentLoader):
    """Tries each loader in order and uses the first that ``can_handle`` the
    input. Construct with ``[HttpAttachmentLoader(), LocalAttachmentLoader()]``
    to support both at once."""

    def __init__(self, loaders: List[AttachmentLoader]):
        if not loaders:
            raise ValueError("CompositeAttachmentLoader requires at least one loader")
        self._loaders = loaders

    def can_handle(self, path_or_url: str) -> bool:
        return any(l.can_handle(path_or_url) for l in self._loaders)

    def load(self, path_or_url: str) -> Tuple[bytes, str]:
        for loader in self._loaders:
            if loader.can_handle(path_or_url):
                return loader.load(path_or_url)
        raise ValueError(f"No attachment loader can handle: {path_or_url}")


__all__ = [
    "AttachmentLoader",
    "CompositeAttachmentLoader",
    "HttpAttachmentLoader",
    "LocalAttachmentLoader",
    "guess_mime_type",
    "is_remote_location",
]
