"""
LiteLLM provider — multi-vendor support (OpenAI, Anthropic, Bedrock, Vertex,
Azure, Ollama, ...) via a single SDK.

Install the optional extra to use it::

    pip install blanc[litellm]

This is a thin transport adapter. Structured outputs still go through
``instructor.from_litellm`` so behavior stays consistent with
:class:`OpenAIProvider`.
"""
from __future__ import annotations

import logging
import time
from typing import Any, List, Optional, Type

from pydantic import BaseModel

from ..auth import TokenProvider
from ..base import ContentBlock, LLMMessage, LLMProvider, LLMResponse, LLMUsage

logger = logging.getLogger(__name__)


class LiteLLMProvider(LLMProvider):
    """LiteLLM-backed provider.

    ``model`` strings follow LiteLLM conventions::

        gpt-4o
        anthropic/claude-3-5-sonnet-20240620
        bedrock/anthropic.claude-3-haiku-20240307-v1:0
        vertex_ai/gemini-1.5-pro
        ollama/llama3

    The optional ``token_provider`` lets you inject auth dynamically. For
    providers that need multiple env vars (AWS Bedrock, Vertex), prefer
    setting them at process startup and leave ``token_provider`` as ``None``.
    """

    name = "litellm"

    def __init__(
        self,
        *,
        token_provider: Optional[TokenProvider] = None,
        api_base: Optional[str] = None,
        api_key_env: str = "OPENAI_API_KEY",
        default_provider_kwargs: Optional[dict] = None,
    ):
        self._token_provider = token_provider
        self._api_base = api_base
        self._api_key_env = api_key_env
        self._default_kwargs = default_provider_kwargs or {}

    def chat(
        self,
        *,
        messages: List[LLMMessage],
        model: str,
        response_model: Optional[Type[BaseModel]] = None,
        **kwargs: Any,
    ) -> LLMResponse:
        import litellm  # lazy import

        wire_messages = [self._to_wire_message(m) for m in messages]
        request_kwargs: dict = {
            "model": model,
            "messages": wire_messages,
            **self._default_kwargs,
        }
        if self._api_base:
            request_kwargs["api_base"] = self._api_base
        if self._token_provider is not None:
            request_kwargs["api_key"] = self._token_provider.get_token()
        for k, v in kwargs.items():
            if v is not None:
                request_kwargs[k] = v

        t0 = time.time()
        if response_model is not None:
            import instructor  # lazy import

            client = instructor.from_litellm(litellm.completion)
            parsed, completion = client.chat.completions.create_with_completion(
                **request_kwargs,
                response_model=response_model,
            )
            duration_ms = int((time.time() - t0) * 1000)
            return LLMResponse(
                model=model,
                parsed=parsed,
                usage=self._extract_usage(completion),
                duration_ms=duration_ms,
                raw=completion,
            )

        completion = litellm.completion(**request_kwargs)
        duration_ms = int((time.time() - t0) * 1000)
        text = ""
        try:
            text = completion["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError):
            text = getattr(getattr(completion, "choices", [None])[0], "message", None)
            text = getattr(text, "content", "") if text else ""

        return LLMResponse(
            model=model,
            text=text,
            usage=self._extract_usage(completion),
            duration_ms=duration_ms,
            raw=completion,
        )

    # LiteLLM has no unified Files API — non-image attachments fall back to
    # inline text (handled by LLMClient when upload_file returns None).
    def upload_file(self, file_path: str) -> Optional[str]:
        return None

    # ------------------------------------------------------------------
    # Wire-format conversion (OpenAI-compatible shape, which LiteLLM accepts)
    # ------------------------------------------------------------------

    @classmethod
    def _to_wire_message(cls, msg: LLMMessage) -> dict:
        if isinstance(msg.content, str):
            return {"role": msg.role, "content": msg.content}
        return {
            "role": msg.role,
            "content": [cls._to_wire_block(b) for b in msg.content],
        }

    @staticmethod
    def _to_wire_block(block: ContentBlock) -> dict:
        if block.type == "text":
            return {"type": "text", "text": block.text or ""}
        if block.type == "image":
            import base64

            data = block.data or b""
            mime = block.mime_type or "image/png"
            b64 = base64.b64encode(data).decode("utf-8")
            return {
                "type": "image_url",
                "image_url": {"url": f"data:{mime};base64,{b64}"},
            }
        if block.type == "file":
            # LiteLLM doesn't define a portable file block; this should have
            # been inlined by LLMClient. Defensive fallback:
            return {"type": "text", "text": f"[attachment omitted: {block.file_path}]"}
        raise ValueError(f"Unknown ContentBlock type: {block.type}")

    @staticmethod
    def _extract_usage(completion: Any) -> LLMUsage:
        u = None
        if isinstance(completion, dict):
            u = completion.get("usage")
        if u is None:
            u = getattr(completion, "usage", None)

        def _get(obj: Any, key: str) -> int:
            if obj is None:
                return 0
            if isinstance(obj, dict):
                return int(obj.get(key, 0) or 0)
            return int(getattr(obj, key, 0) or 0)

        input_tokens = _get(u, "prompt_tokens")
        output_tokens = _get(u, "completion_tokens")
        total_tokens = _get(u, "total_tokens") or (input_tokens + output_tokens)

        return LLMUsage(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
            tokens_billed=total_tokens,
        )


__all__ = ["LiteLLMProvider"]
