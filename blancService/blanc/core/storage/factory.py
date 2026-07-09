"""
Storage backend factory.

Resolution order when ``get_storage_backend()`` is called:

1. ``BLANC_STORAGE_BACKEND`` env var (overrides config).
2. ``config.storage.backend`` from application config.

The resolved name is looked up against:

A. Builders registered at runtime via :func:`register_storage_backend`
   (highest priority — overrides everything; useful in tests / DI).
B. Third-party plugins registered under the ``blanc.storage_backends`` entry-
   point group.
C. Built-in backends: ``local``, ``s3``.

Plugin authors expose a callable with the signature
``(config: AppConfig) -> StorageBackend`` so the factory can construct it
without knowing each backend's constructor shape::

    # myorg/pyproject.toml
    [project.entry-points."blanc.storage_backends"]
    gcs = "myorg.gcs_storage:build_backend"

    # myorg/gcs_storage.py
    def build_backend(config):
        cfg = config.storage.gcs
        return GcsStorageBackend(bucket=cfg.bucket, ...)
"""
from __future__ import annotations

import logging
import os
import sys
import threading
from functools import lru_cache
from typing import Callable, Dict, Optional

from blanc.core.storage.base import StorageBackend

logger = logging.getLogger(__name__)

_ENTRY_POINT_GROUP = "blanc.storage_backends"

# A "builder" takes the resolved AppConfig and returns a constructed backend.
# Using builders (instead of bare classes) lets each backend pull whatever
# fields it needs from config without coupling the factory to its constructor.
StorageBuilder = Callable[[object], StorageBackend]

_builtin_builders: Dict[str, StorageBuilder] = {}
_user_builders: Dict[str, StorageBuilder] = {}


# ---------------------------------------------------------------------------
# Built-in builders
# ---------------------------------------------------------------------------

def _build_local(config) -> StorageBackend:
    from blanc.core.storage.local_storage import LocalStorageBackend

    upload_dir = config.storage.local_upload_dir
    backend = LocalStorageBackend(upload_dir=upload_dir)
    logger.info("Storage backend: local (dir=%s)", upload_dir)
    return backend


def _build_s3(config) -> StorageBackend:
    from blanc.core.storage.s3_storage import S3StorageBackend

    s3 = getattr(config.storage, "s3", None)
    if s3 is None or not s3.bucket:
        raise ValueError("storage.s3.bucket must be set when backend is 's3'")
    backend = S3StorageBackend(
        bucket=s3.bucket,
        region=s3.region or None,
        endpoint_url=s3.endpoint_url or None,
        access_key=s3.access_key or None,
        secret_key=s3.secret_key or None,
        prefix=s3.prefix or "",
        presign_expiry=s3.presign_expiry,
        addressing_style=s3.addressing_style,
        ssl_verify=s3.ssl_verify,
        local_cache_dir=config.storage.local_upload_dir,
    )
    logger.info(
        "Storage backend: s3 (bucket=%s, endpoint=%s)",
        s3.bucket,
        s3.endpoint_url or "aws",
    )
    return backend


_builtin_builders["local"] = _build_local
_builtin_builders["s3"] = _build_s3


# ---------------------------------------------------------------------------
# Public registration API
# ---------------------------------------------------------------------------

def register_storage_backend(name: str, builder: StorageBuilder) -> None:
    """Register a backend builder at runtime.

    Useful for tests / DI containers / scripts that don't want to ship a
    full entry-point. Names registered here take precedence over both
    built-ins and entry-points.
    """
    if not name:
        raise ValueError("Storage backend name must be non-empty")
    _user_builders[name.lower()] = builder


def unregister_storage_backend(name: str) -> None:
    _user_builders.pop(name.lower(), None)


@lru_cache(maxsize=1)
def _entry_point_builders() -> Dict[str, StorageBuilder]:
    discovered: Dict[str, StorageBuilder] = {}
    try:
        from importlib.metadata import entry_points

        if sys.version_info >= (3, 10):
            eps = entry_points(group=_ENTRY_POINT_GROUP)
        else:  # pragma: no cover - py3.9 fallback
            eps = entry_points().get(_ENTRY_POINT_GROUP, [])

        for ep in eps:
            try:
                builder = ep.load()
            except Exception as e:  # pragma: no cover
                logger.warning(
                    "Failed to load storage backend entry point %s: %s", ep.name, e
                )
                continue
            if not callable(builder):
                logger.warning(
                    "Storage backend entry point %s did not resolve to a callable (got %r)",
                    ep.name,
                    builder,
                )
                continue
            discovered[ep.name.lower()] = builder
    except Exception as e:  # pragma: no cover
        logger.warning("Entry-point discovery for storage backends failed: %s", e)
    return discovered


def list_backends() -> Dict[str, str]:
    """Return ``{name: source}`` for every backend visible to the factory.

    ``source`` is one of ``"user"``, ``"entry_point"``, ``"builtin"``.
    Useful for ``/health`` endpoints and CLI diagnostics.
    """
    result: Dict[str, str] = {}
    for name in _builtin_builders:
        result[name] = "builtin"
    for name in _entry_point_builders():
        result[name] = "entry_point"
    for name in _user_builders:
        result[name] = "user"
    return result


def _resolve_builder(name: str) -> StorageBuilder:
    key = name.lower()
    if key in _user_builders:
        return _user_builders[key]
    discovered = _entry_point_builders()
    if key in discovered:
        return discovered[key]
    if key in _builtin_builders:
        return _builtin_builders[key]
    available = sorted(set(_user_builders) | set(discovered) | set(_builtin_builders))
    raise ValueError(
        f"Unknown storage backend {name!r}. Available: {available}. "
        f"Register custom backends under the {_ENTRY_POINT_GROUP!r} entry-point group, "
        f"or call register_storage_backend() at startup."
    )


# ---------------------------------------------------------------------------
# Singleton accessor
# ---------------------------------------------------------------------------

_lock = threading.Lock()
_backend_instance: Optional[StorageBackend] = None


def get_storage_backend() -> StorageBackend:
    """Return the configured storage backend (lazy, thread-safe singleton)."""
    global _backend_instance
    if _backend_instance is not None:
        return _backend_instance
    with _lock:
        if _backend_instance is not None:
            return _backend_instance

        from blanc.config_parsers.settings import get_settings

        config = get_settings()
        backend_name = (
            os.environ.get("BLANC_STORAGE_BACKEND")
            or config.storage.backend
            or "local"
        )
        builder = _resolve_builder(backend_name)
        _backend_instance = builder(config)
    return _backend_instance


def set_storage_backend(backend: Optional[StorageBackend]) -> None:
    """Override or clear the singleton. Primarily for tests and DI."""
    global _backend_instance
    with _lock:
        _backend_instance = backend


__all__ = [
    "StorageBuilder",
    "get_storage_backend",
    "list_backends",
    "register_storage_backend",
    "set_storage_backend",
    "unregister_storage_backend",
]
