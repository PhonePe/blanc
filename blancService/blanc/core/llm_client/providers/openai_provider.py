"""
OpenAI-compatible provider (works with any OpenAI Chat Completions endpoint
including Azure OpenAI deployments that expose the same API shape).

Structured outputs are produced via ``instructor`` so external orgs can swap
the wire format without changing call sites.
"""
from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any, List, Optional, Type

from pydantic import BaseModel

from ..auth import TokenProvider
from ..base import ContentBlock, LLMMessage, LLMProvider, LLMResponse, LLMUsage

logger = logging.getLogger(__name__)


class OpenAIProvider(LLMProvider):
    """OpenAI / Azure-OpenAI / any OpenAI-compatible endpoint.

    Parameters
    ----------
    base_url:
        Base URL of the Chat Completions endpoint. ``None`` uses the SDK's
        default (``https://api.openai.com/v1``).
    token_provider:
        Returns the bearer token / API key on each request. Allows token
        rotation without rebuilding the client.
    timeout:
        Request timeout in seconds, forwarded to the SDK.
    extra_headers:
        Optional headers added to every request.
    """

    name = "openai"

    def __init__(
        self,
        *,
        token_provider: TokenProvider,
        base_url: Optional[str] = None,
        timeout: Optional[float] = None,
        extra_headers: Optional[dict] = None,
    ):
        self._token_provider = token_provider
        self._base_url = base_url
        self._timeout = timeout
        self._extra_headers = extra_headers or {}

    # ------------------------------------------------------------------
    # SDK client construction
    # ------------------------------------------------------------------

    def _raw_client(self):
        from openai import OpenAI  # imported lazily so the core package is SDK-free

        kwargs: dict = {"api_key": self._token_provider.get_token()}
        if self._base_url:
            kwargs["base_url"] = self._base_url
        if self._timeout is not None:
            kwargs["timeout"] = self._timeout
        if self._extra_headers:
            kwargs["default_headers"] = dict(self._extra_headers)
        return OpenAI(**kwargs)

    # ------------------------------------------------------------------
    # LLMProvider API
    # ------------------------------------------------------------------

    def chat(
        self,
        *,
        messages: List[LLMMessage],
        model: str,
        response_model: Optional[Type[BaseModel]] = None,
        **kwargs: Any,
    ) -> LLMResponse:
        raw_client = self._raw_client()
        wire_messages = [self._to_openai_message(m) for m in messages]
        request_kwargs: dict = {"model": model, "messages": wire_messages}
        # Pass-through provider knobs (reasoning_effort, temperature, ...).
        for k, v in kwargs.items():
            if v is not None:
                request_kwargs[k] = v

        t0 = time.time()
        if response_model is not None:
            import instructor  # lazy import

            client = instructor.from_openai(raw_client)
            parsed, completion = client.chat.completions.create_with_completion(
                **request_kwargs,
                response_model=response_model,
            )
            duration_ms = int((time.time() - t0) * 1000)
            usage = self._extract_usage(completion)
            return LLMResponse(
                model=model,
                parsed=parsed,
                usage=usage,
                duration_ms=duration_ms,
                raw=completion,
            )

        completion = raw_client.chat.completions.create(**request_kwargs)
        duration_ms = int((time.time() - t0) * 1000)
        text = (completion.choices[0].message.content or "") if completion.choices else ""
        usage = self._extract_usage(completion)
        return LLMResponse(
            model=model,
            text=text,
            usage=usage,
            duration_ms=duration_ms,
            raw=completion,
        )

    def upload_file(self, file_path: str) -> Optional[str]:
        path = Path(file_path)
        if not path.is_file():
            raise FileNotFoundError(f"Attachment not found: {file_path}")
        client = self._raw_client()
        with path.open("rb") as f:
            uploaded = client.files.create(file=f, purpose="user_data")
        logger.info("Uploaded attachment %s as file_id=%s", path.name, uploaded.id)
        return uploaded.id

    def delete_file(self, file_id: str) -> None:
        try:
            self._raw_client().files.delete(file_id)
        except Exception as e:
            logger.warning("Failed to delete uploaded file %s: %s", file_id, e)

    # ------------------------------------------------------------------
    # Wire-format conversion
    # ------------------------------------------------------------------

    @classmethod
    def _to_openai_message(cls, msg: LLMMessage) -> dict:
        if isinstance(msg.content, str):
            return {"role": msg.role, "content": msg.content}
        return {
            "role": msg.role,
            "content": [cls._to_openai_block(b) for b in msg.content],
        }

    @staticmethod
    def _to_openai_block(block: ContentBlock) -> dict:
        if block.type == "text":
            return {"type": "text", "text": block.text or ""}
        if block.type == "image":
            import base64

            data = block.data or b""
            mime = block.mime_type or "image/png"
            b64 = base64.b64encode(data).decode("utf-8")
            image_url: dict = {"url": f"data:{mime};base64,{b64}"}
            if block.detail:
                image_url["detail"] = block.detail
            return {"type": "image_url", "image_url": image_url}
        if block.type == "file":
            if not block.file_id:
                raise RuntimeError(
                    "File block missing file_id — should have been uploaded by "
                    "the client before being sent to the provider"
                )
            return {"type": "file", "file": {"file_id": block.file_id}}
        raise ValueError(f"Unknown ContentBlock type: {block.type}")

    @staticmethod
    def _extract_usage(completion: Any) -> LLMUsage:
        u = getattr(completion, "usage", None)
        input_tokens = int(getattr(u, "prompt_tokens", 0) or 0) if u else 0
        output_tokens = int(getattr(u, "completion_tokens", 0) or 0) if u else 0
        total_tokens = int(getattr(u, "total_tokens", 0) or 0) if u else 0

        tokens_billed = 0
        raw = getattr(completion, "_raw_response", completion)
        headers = getattr(raw, "headers", None)
        if headers is not None:
            try:
                hb = headers.get("tokens-billed")
                if hb is not None:
                    tokens_billed = int(hb)
            except (ValueError, AttributeError, TypeError):
                pass
        if not tokens_billed:
            tokens_billed = total_tokens

        return LLMUsage(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
            tokens_billed=tokens_billed,
        )


__all__ = ["OpenAIProvider"]
