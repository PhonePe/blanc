"""
ATM LLM client package.

Public surface:

* :class:`LLMClient` — the high-level facade everything in the app uses.
* :class:`LLMProvider`, :class:`LLMMessage`, :class:`LLMResponse`, etc. — the
  vendor-neutral types external orgs implement against.
* :func:`get_llm_client` — module-level singleton wired up from app config.
* :func:`get_provider` — provider factory that supports built-in names
  (``openai``, ``litellm``) plus any third-party providers registered under
  the ``blanc.llm_providers`` entry-point group.

Plugging in a new provider from another package::

    # myorg/atm_anthropic/__init__.py
    from blanc.core.llm_client import LLMProvider

    class AnthropicProvider(LLMProvider):
        ...

    # myorg/pyproject.toml
    # [project.entry-points."blanc.llm_providers"]
    # anthropic = "myorg.atm_anthropic:AnthropicProvider"

Then set ``BLANC_LLM_PROVIDER=anthropic`` (or override
``openaiconfig.provider`` in config) and the factory will pick it up.
"""
from __future__ import annotations

import logging
import os
import sys
import threading
from functools import lru_cache
from typing import Callable, Dict, Optional, Type

from .attachments import (
    AttachmentLoader,
    CompositeAttachmentLoader,
    HttpAttachmentLoader,
    LocalAttachmentLoader,
)
from .auth import (
    CallableTokenProvider,
    EnvTokenProvider,
    StaticTokenProvider,
    TokenProvider,
)
from .base import (
    ContentBlock,
    LLMMessage,
    LLMProvider,
    LLMResponse,
    LLMUsage,
)
from .client import (
    LLMClient,
    ModelResolver,
    ModelSpec,
    get_assessment_context,
    set_assessment_context,
)
from .usage import (
    LoggingUsageSink,
    NullUsageSink,
    SqlAlchemyUsageSink,
    UsageRecord,
    UsageSink,
)

logger = logging.getLogger(__name__)

_ENTRY_POINT_GROUP = "blanc.llm_providers"

# Built-in providers — lazy factories so missing optional deps don't
# blow up the import.
_BUILTIN_PROVIDERS: Dict[str, Callable[[], Type[LLMProvider]]] = {}


def _register_builtin(name: str, loader: Callable[[], Type[LLMProvider]]) -> None:
    _BUILTIN_PROVIDERS[name] = loader


def _openai_loader() -> Type[LLMProvider]:
    from .providers.openai_provider import OpenAIProvider
    return OpenAIProvider


def _litellm_loader() -> Type[LLMProvider]:
    from .providers.litellm_provider import LiteLLMProvider
    return LiteLLMProvider


_register_builtin("openai", _openai_loader)
_register_builtin("litellm", _litellm_loader)


@lru_cache(maxsize=1)
def _entry_point_providers() -> Dict[str, Type[LLMProvider]]:
    """Discover third-party providers via importlib.metadata."""
    discovered: Dict[str, Type[LLMProvider]] = {}
    try:
        from importlib.metadata import entry_points

        if sys.version_info >= (3, 10):
            eps = entry_points(group=_ENTRY_POINT_GROUP)
        else:  # pragma: no cover - py3.9 fallback
            eps = entry_points().get(_ENTRY_POINT_GROUP, [])

        for ep in eps:
            try:
                cls = ep.load()
            except Exception as e:  # pragma: no cover
                logger.warning("Failed to load LLM provider entry point %s: %s", ep.name, e)
                continue
            if not isinstance(cls, type) or not issubclass(cls, LLMProvider):
                logger.warning(
                    "Entry point %s did not resolve to LLMProvider subclass (got %r)",
                    ep.name,
                    cls,
                )
                continue
            discovered[ep.name] = cls
    except Exception as e:  # pragma: no cover
        logger.warning("Entry-point discovery for LLM providers failed: %s", e)
    return discovered


def get_provider_class(name: str) -> Type[LLMProvider]:
    """Resolve a provider class by name. Third-party entry points take
    precedence over built-ins so downstream packages can override defaults."""
    discovered = _entry_point_providers()
    if name in discovered:
        return discovered[name]
    if name in _BUILTIN_PROVIDERS:
        return _BUILTIN_PROVIDERS[name]()
    available = sorted(set(discovered) | set(_BUILTIN_PROVIDERS))
    raise ValueError(
        f"Unknown LLM provider {name!r}. Available: {available}. "
        f"Register custom providers under the {_ENTRY_POINT_GROUP!r} entry-point group."
    )


# ---------------------------------------------------------------------------
# Singleton factory wired from application config
# ---------------------------------------------------------------------------

_client_lock = threading.Lock()
_client_singleton: Optional[LLMClient] = None


def _build_default_client() -> LLMClient:
    """Construct the application-default :class:`LLMClient` from
    :class:`AppConfig` and environment variables.

    Resolution order for provider name:
        1. ``BLANC_LLM_PROVIDER`` env var
        2. ``config.openaiconfig.provider`` if defined
        3. ``"openai"``
    """
    from blanc.config_parsers.settings import get_settings

    config = get_settings()
    oa = config.openaiconfig

    provider_name = (
        os.environ.get("BLANC_LLM_PROVIDER")
        or getattr(oa, "provider", None)
        or "openai"
    ).lower()
    provider_cls = get_provider_class(provider_name)

    token_provider = _build_default_token_provider(config, provider_name)
    provider_kwargs: dict = {}
    if token_provider is not None:
        provider_kwargs["token_provider"] = token_provider
    if provider_name == "openai":
        base_url = getattr(oa, "openai_url", None)
        if base_url:
            provider_kwargs["base_url"] = base_url

    provider = provider_cls(**provider_kwargs)

    # Build per-purpose model map from config.
    purpose_map: Dict[str, ModelSpec] = {}
    for purpose, model_cfg in getattr(oa, "models", {}).items():
        purpose_map[purpose] = ModelSpec(
            name=model_cfg.model_name,
            prompt_cost_per_million=model_cfg.prompt_cost_per_million,
            completion_cost_per_million=model_cfg.completion_cost_per_million,
        )
    pricing = getattr(config, "pricing", None)
    resolver = ModelResolver(
        default_model=oa.model_name,
        default_prompt_cost=getattr(pricing, "prompt_cost_per_million", 0.0) if pricing else 0.0,
        default_completion_cost=getattr(pricing, "completion_cost_per_million", 0.0) if pricing else 0.0,
        purpose_map=purpose_map,
    )

    attachment_loader = _build_default_attachment_loader(config)
    return LLMClient(
        provider=provider,
        model_resolver=resolver,
        attachment_loader=attachment_loader,
        usage_sink=SqlAlchemyUsageSink(),
    )


def _build_default_token_provider(config, provider_name: str) -> Optional[TokenProvider]:
    oa = getattr(config, "openaiconfig", None)
    configured_api_key = getattr(oa, "api_key", "") if oa else ""
    if configured_api_key:
        return StaticTokenProvider(configured_api_key)

    if os.environ.get("BLANC_LLM_API_KEY"):
        return EnvTokenProvider("BLANC_LLM_API_KEY")

    # Environment-variable fallback for vanilla OpenAI / LiteLLM usage.
    env_var = "OPENAI_API_KEY" if provider_name in ("openai", "litellm") else None
    if env_var and os.environ.get(env_var):
        return EnvTokenProvider(env_var)
    if provider_name == "openai":
        raise RuntimeError(
            "OpenAI provider requires an API key. Set OPENAI_API_KEY, "
            "BLANC_LLM_API_KEY, or openaiconfig.api_key."
        )
    return None


def _build_default_attachment_loader(config) -> AttachmentLoader:
    from pathlib import Path

    repo_root = Path(__file__).resolve().parents[3]
    uploads_dir = repo_root / "uploads"
    paths_cfg = getattr(config, "paths", None)
    if paths_cfg and getattr(paths_cfg, "base_dir", None):
        uploads_dir = Path(paths_cfg.base_dir) / "uploads"

    local = LocalAttachmentLoader(search_dirs=[uploads_dir, repo_root])
    http = HttpAttachmentLoader()
    return CompositeAttachmentLoader([http, local])


def get_llm_client() -> LLMClient:
    """Thread-safe lazy singleton accessor.

    Prefer injecting :class:`LLMClient` via FastAPI ``Depends`` in new code;
    this helper exists for legacy module-level call sites.
    """
    global _client_singleton
    if _client_singleton is not None:
        return _client_singleton
    with _client_lock:
        if _client_singleton is None:
            _client_singleton = _build_default_client()
    return _client_singleton


def set_llm_client(client: Optional[LLMClient]) -> None:
    """Override or clear the singleton (useful for tests and DI containers)."""
    global _client_singleton
    with _client_lock:
        _client_singleton = client


__all__ = [
    # Core types
    "ContentBlock",
    "LLMClient",
    "LLMMessage",
    "LLMProvider",
    "LLMResponse",
    "LLMUsage",
    "ModelResolver",
    "ModelSpec",
    # Auth
    "CallableTokenProvider",
    "EnvTokenProvider",
    "StaticTokenProvider",
    "TokenProvider",
    # Usage
    "LoggingUsageSink",
    "NullUsageSink",
    "SqlAlchemyUsageSink",
    "UsageRecord",
    "UsageSink",
    # Attachments
    "AttachmentLoader",
    "CompositeAttachmentLoader",
    "HttpAttachmentLoader",
    "LocalAttachmentLoader",
    # Helpers
    "get_assessment_context",
    "set_assessment_context",
    "get_llm_client",
    "set_llm_client",
    "get_provider_class",
]
