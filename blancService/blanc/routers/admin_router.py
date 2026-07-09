"""Admin-only operational endpoints.

Kept separate from ``auth_router`` so it's obvious what needs the
``ADMIN`` role guard. Currently just a config-reload endpoint used by
operators after editing ``config.yml`` in place — without this, they
have to restart the whole process because :func:`get_settings` is
``@lru_cache``d for the process lifetime.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from blanc.config_parsers.settings import reload_settings
from blanc.core.auth.auth import require_roles

logger = logging.getLogger(__name__)


admin_router = APIRouter(
    prefix="/admin",
    tags=["Admin"],
    dependencies=[Depends(require_roles(["ADMIN"]))],
)


@admin_router.post("/reload_config")
def reload_config() -> dict:
    """Re-read ``config.yml`` from disk and re-populate the ``@lru_cache``.

    Useful when an operator has edited the YAML in place and doesn't
    want to restart the whole process. Note that some subsystems
    (LLM client, RAG client, RMQ) also cache values off the config at
    construction time — they won't pick up the change until the next
    call site rebuilds the singleton.
    """
    settings = reload_settings()
    logger.info("Config reloaded via /admin/reload_config")
    return {
        "status": "ok",
        "reloaded": {
            "llm_provider": settings.openaiconfig.provider,
            "llm_model": settings.openaiconfig.model_name,
            "rag_backend": settings.rag_config.backend,
        },
    }


__all__ = ["admin_router"]
