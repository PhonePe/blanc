"""
Pluggable embedding providers for the local RAG backend.

Two built-in providers:

* ``sentence_transformers`` (default) — runs locally, no API key. First use
  downloads the model (~90 MB for the default ``all-MiniLM-L6-v2``) and
  caches it under ``~/.cache/huggingface/hub``.
* ``openai`` — calls the OpenAI embeddings API. Requires ``OPENAI_API_KEY``
  (or whatever env var is named in ``rag_config.embedder.api_key_env``).

Heavy dependencies (``sentence_transformers``, ``openai``) are imported
lazily inside the providers so the module is safe to import when the
active backend does not need them.
"""
from __future__ import annotations

import logging
import os
from abc import ABC, abstractmethod
from typing import List, Optional

logger = logging.getLogger(__name__)


class Embedder(ABC):
    """Common interface for embedding providers."""

    #: Dimension of the vectors this embedder produces. Populated lazily
    #: on first ``embed`` call for providers that only learn it from the
    #: model at runtime.
    dimension: Optional[int] = None

    @abstractmethod
    def embed(self, texts: List[str]) -> List[List[float]]:
        """Embed a batch of texts synchronously. Must be safe to call from
        a worker thread (``asyncio.to_thread``)."""
        ...


class SentenceTransformersEmbedder(Embedder):
    """Local, CPU-friendly embeddings via the ``sentence-transformers`` library."""

    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        self.model_name = model_name
        self._model = None  # lazy-loaded

    def _load(self):
        if self._model is not None:
            return self._model
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as e:
            raise RuntimeError(
                "sentence-transformers is not installed. Install it with "
                "`pip install sentence-transformers`, or switch "
                "rag_config.embedder.provider to 'openai'."
            ) from e
        logger.info("Loading SentenceTransformer model: %s", self.model_name)
        self._model = SentenceTransformer(self.model_name)
        self.dimension = self._model.get_sentence_embedding_dimension()
        return self._model

    def embed(self, texts: List[str]) -> List[List[float]]:
        model = self._load()
        vectors = model.encode(
            texts,
            batch_size=32,
            show_progress_bar=False,
            convert_to_numpy=True,
            normalize_embeddings=True,
        )
        return vectors.tolist()


class OpenAIEmbedder(Embedder):
    """OpenAI embeddings via the official ``openai`` SDK."""

    _DIMENSIONS = {
        "text-embedding-3-small": 1536,
        "text-embedding-3-large": 3072,
        "text-embedding-ada-002": 1536,
    }

    def __init__(
        self,
        model_name: str = "text-embedding-3-small",
        api_key_env: str = "OPENAI_API_KEY",
        api_key: str = "",
    ):
        self.model_name = model_name
        self.api_key_env = self._validate_env_var_name(api_key_env)
        # Trim only — do NOT log the value. Kept private so it never
        # ends up in repr() / __dict__ dumps by accident.
        self._inline_api_key = (api_key or "").strip()
        self.dimension = self._DIMENSIONS.get(model_name)
        self._client = None  # lazy-loaded

    @staticmethod
    def _validate_env_var_name(value: str) -> str:
        """Reject config values that look like an actual API key.

        Common footgun: user reads ``api_key_env`` in the YAML,
        thinks the field wants the key itself, and pastes their
        ``sk-…`` value there. The loader then treats it as an env
        var *name*, ``os.environ.get()`` returns None, and the
        error message would leak the raw key back into logs (which
        is how three separate keys made it into this chat).
        """
        if not value:
            raise RuntimeError(
                "rag_config.embedder.api_key_env is empty. Set it to the "
                "NAME of an env var (e.g. \"OPENAI_API_KEY\"), then export "
                "the key in your shell."
            )
        if value.startswith(("sk-", "sk_")):
            raise RuntimeError(
                "rag_config.embedder.api_key_env looks like an actual API "
                "key, not the *name* of an env var. Rotate that key at "
                "https://platform.openai.com/api-keys immediately, then "
                "set `api_key_env: \"OPENAI_API_KEY\"` in your YAML and "
                "export the fresh key in your shell:\n"
                "  export OPENAI_API_KEY=\"sk-…\""
            )
        # Env-var names are ASCII uppercase-ish; reject anything with
        # whitespace or a leading digit, which are the tell-tale marks
        # of "user typed the key value in here".
        if not value.replace("_", "").isalnum() or value[0].isdigit():
            raise RuntimeError(
                f"rag_config.embedder.api_key_env = {value!r} is not a valid "
                f"env-var name. Use something like \"OPENAI_API_KEY\"."
            )
        return value

    def _load(self):
        if self._client is not None:
            return self._client
        try:
            from openai import OpenAI
        except ImportError as e:
            raise RuntimeError(
                "openai is not installed. Install it with `pip install openai`."
            ) from e
        # Precedence: inline `api_key` in the YAML wins → falls back to
        # the env var named by `api_key_env` → otherwise refuse to load.
        api_key = self._inline_api_key or os.environ.get(self.api_key_env, "")
        if not api_key:
            raise RuntimeError(
                f"OpenAI embeddings selected but neither "
                f"rag_config.embedder.api_key nor the env var "
                f"${self.api_key_env} is set. Either put the key in your "
                f"local.yml:\n"
                f"  rag_config.embedder.api_key: \"sk-...\"\n"
                f"or export it in the shell that runs the backend:\n"
                f"  export {self.api_key_env}=\"sk-...\"\n"
                f"or switch rag_config.embedder.provider to "
                f"'sentence_transformers'."
            )
        self._client = OpenAI(api_key=api_key)
        return self._client

    def embed(self, texts: List[str]) -> List[List[float]]:
        client = self._load()
        # OpenAI accepts a batch in a single call; chunk to stay well under
        # the per-request token cap.
        BATCH = 100
        out: List[List[float]] = []
        for i in range(0, len(texts), BATCH):
            batch = texts[i : i + BATCH]
            resp = client.embeddings.create(model=self.model_name, input=batch)
            out.extend(item.embedding for item in resp.data)
        if out and self.dimension is None:
            self.dimension = len(out[0])
        return out


def build_embedder(rag_config) -> Embedder:
    """Construct an Embedder from ``rag_config.embedder``."""
    cfg = rag_config.embedder
    provider = (cfg.provider or "sentence_transformers").lower()

    if provider == "sentence_transformers":
        return SentenceTransformersEmbedder(model_name=cfg.model_name or "all-MiniLM-L6-v2")
    if provider == "openai":
        return OpenAIEmbedder(
            model_name=cfg.model_name or "text-embedding-3-small",
            api_key_env=cfg.api_key_env or "OPENAI_API_KEY",
            api_key=getattr(cfg, "api_key", "") or "",
        )

    raise ValueError(
        f"Unknown embedder provider {provider!r}. "
        f"Supported: 'sentence_transformers', 'openai'."
    )


__all__ = [
    "Embedder",
    "SentenceTransformersEmbedder",
    "OpenAIEmbedder",
    "build_embedder",
]
