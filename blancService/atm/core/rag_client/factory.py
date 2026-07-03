"""
RAG backend factory.

Resolution order when :func:`get_rag_client` is called:

1. ``ATM_RAG_BACKEND`` env var (overrides config).
2. ``config.rag_config.backend`` from application config (default ``"local"``).

The resolved name is looked up against:

A. Builders registered at runtime via :func:`register_rag_backend`
   (highest priority — overrides everything; useful in tests / DI).
B. Third-party plugins registered under the ``atm.rag_backends`` entry-point
   group.
C. Built-in backends: ``local`` (Chroma-backed :class:`LocalVectorDB`) and
   ``http`` (remote :class:`VectorDBClient`).

Plugin authors expose a callable with the signature
``(config: AppConfig) -> RAGBackend`` so the factory can construct it without
knowing each backend's constructor shape::

    # myorg/pyproject.toml
    [project.entry-points."atm.rag_backends"]
    qdrant = "myorg.qdrant_rag:build_backend"

    # myorg/qdrant_rag.py
    def build_backend(config):
        cfg = config.rag_config.qdrant
        return QdrantRAGBackend(url=cfg.url, ...)

A "RAG backend" here is any object exposing the async surface of
:class:`~atm.core.rag_client.vector_db.VectorDBClient`:
``ingest_batch``, ``search``, ``search_by_assessment``.
"""
from __future__ import annotations

import logging
import os
import sys
import threading
from functools import lru_cache
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)

_ENTRY_POINT_GROUP = "atm.rag_backends"

# A "builder" takes the resolved AppConfig and returns a constructed backend.
RAGBuilder = Callable[[object], Any]

_builtin_builders: Dict[str, RAGBuilder] = {}
_user_builders: Dict[str, RAGBuilder] = {}


# ---------------------------------------------------------------------------
# Built-in builders
# ---------------------------------------------------------------------------

def _build_local(config):
    from atm.core.rag_client.local_vector_db import LocalVectorDB

    backend = LocalVectorDB(config)
    logger.info(
        "RAG backend: local (persist_dir=%s)", config.rag_config.local.persist_dir
    )
    return backend


def _build_http(config):
    from atm.core.rag_client.vector_db import VectorDBClient

    if not config.rag_config.api_url:
        raise ValueError(
            "rag_config.api_url must be set when rag_config.backend is 'http'"
        )
    backend = VectorDBClient(config)
    logger.info("RAG backend: http (api_url=%s)", config.rag_config.api_url)
    return backend


_builtin_builders["local"] = _build_local
_builtin_builders["http"] = _build_http


# ---------------------------------------------------------------------------
# Public registration API
# ---------------------------------------------------------------------------

def register_rag_backend(name: str, builder: RAGBuilder) -> None:
    """Register a backend builder at runtime.

    Useful for tests / DI containers / scripts that don't want to ship a
    full entry-point. Names registered here take precedence over both
    built-ins and entry-points.
    """
    if not name:
        raise ValueError("RAG backend name must be non-empty")
    _user_builders[name.lower()] = builder


def unregister_rag_backend(name: str) -> None:
    _user_builders.pop(name.lower(), None)


@lru_cache(maxsize=1)
def _entry_point_builders() -> Dict[str, RAGBuilder]:
    discovered: Dict[str, RAGBuilder] = {}
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
                    "Failed to load RAG backend entry point %s: %s", ep.name, e
                )
                continue
            if not callable(builder):
                logger.warning(
                    "RAG backend entry point %s did not resolve to a callable (got %r)",
                    ep.name,
                    builder,
                )
                continue
            discovered[ep.name.lower()] = builder
    except Exception as e:  # pragma: no cover
        logger.warning("Entry-point discovery for RAG backends failed: %s", e)
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


def _resolve_builder(name: str) -> RAGBuilder:
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
        f"Unknown RAG backend {name!r}. Available: {available}. "
        f"Register custom backends under the {_ENTRY_POINT_GROUP!r} entry-point group, "
        f"or call register_rag_backend() at startup."
    )


# ---------------------------------------------------------------------------
# Singleton accessor
# ---------------------------------------------------------------------------

_lock = threading.Lock()
_backend_instance = None


def get_rag_client(config=None):
    """Return the configured RAG backend (lazy, thread-safe singleton).

    ``config`` is accepted for parity with existing call sites that pass it
    positionally; if omitted, the shared :func:`get_settings` config is
    used.
    """
    global _backend_instance
    if _backend_instance is not None:
        return _backend_instance
    with _lock:
        if _backend_instance is not None:
            return _backend_instance

        if config is None:
            from atm.config_parsers.settings import get_settings

            config = get_settings()

        backend_name = (
            os.environ.get("ATM_RAG_BACKEND")
            or config.rag_config.backend
            or "local"
        )
        builder = _resolve_builder(backend_name)
        _backend_instance = builder(config)
    return _backend_instance


def set_rag_client(backend) -> None:
    """Override or clear the singleton. Primarily for tests and DI."""
    global _backend_instance
    with _lock:
        _backend_instance = backend


__all__ = [
    "RAGBuilder",
    "get_rag_client",
    "list_backends",
    "register_rag_backend",
    "set_rag_client",
    "unregister_rag_backend",
]
