"""
LLMClient facade.

Bundles a transport-only :class:`LLMProvider` with application-level concerns:
attachment loading, usage tracking, per-purpose model selection, and a
thread-local assessment context.
"""
from __future__ import annotations

import asyncio
import contextvars
import logging
import mimetypes
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Type, TypeVar

from pydantic import BaseModel

from .attachments import (
    AttachmentLoader,
    LocalAttachmentLoader,
    guess_mime_type,
    is_remote_location,
)
from .base import ContentBlock, LLMMessage, LLMProvider, LLMResponse
from .usage import NullUsageSink, UsageRecord, UsageSink

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

# Per-async-task / per-thread assessment id propagation. ContextVar covers
# both sync and async call paths cleanly.
_assessment_ctx: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "blanc_llm_assessment_id", default=None
)


def set_assessment_context(assessment_id: Optional[str]) -> None:
    """Bind the current assessment id for downstream usage logging.

    Also mirrors the value into the ambient log context (via
    :mod:`blanc.util.logging_context`) so every subsequent ``logger``
    call inside the same task or thread carries ``aid=<id>`` in its
    log line automatically — no more f-string ``[{assessment_id}]``
    prefixes.
    """
    _assessment_ctx.set(assessment_id)
    # Late import — llm_client is imported very early in the app graph
    # and we don't want to pull util in until the logging bootstrap has
    # had a chance to run.
    from blanc.util.logging_context import bind_log_context
    bind_log_context(assessment_id=assessment_id or "")


def get_assessment_context() -> Optional[str]:
    return _assessment_ctx.get()


@dataclass
class ModelSpec:
    name: str
    prompt_cost_per_million: float = 0.0
    completion_cost_per_million: float = 0.0


class ModelResolver:
    """Maps a logical ``purpose`` ("vision", "threat_modeling", ...) to a
    concrete model name and per-million pricing. Defaults to a single model
    with flat pricing — callers needing per-purpose routing supply their own
    resolver.
    """

    def __init__(
        self,
        default_model: str,
        default_prompt_cost: float = 0.0,
        default_completion_cost: float = 0.0,
        purpose_map: Optional[Dict[str, "ModelSpec"]] = None,
    ):
        self.default_model = default_model
        self.default_prompt_cost = default_prompt_cost
        self.default_completion_cost = default_completion_cost
        self.purpose_map = purpose_map or {}

    def resolve(
        self,
        *,
        purpose: Optional[str] = None,
        model: Optional[str] = None,
    ) -> "ModelSpec":
        if model:
            return ModelSpec(
                name=model,
                prompt_cost_per_million=self.default_prompt_cost,
                completion_cost_per_million=self.default_completion_cost,
            )
        if purpose and purpose in self.purpose_map:
            return self.purpose_map[purpose]
        return ModelSpec(
            name=self.default_model,
            prompt_cost_per_million=self.default_prompt_cost,
            completion_cost_per_million=self.default_completion_cost,
        )


class LLMClient:
    """High-level LLM facade.

    Construct once at app startup and inject (via FastAPI ``Depends`` or
    constructor) into services. The default factory wires this up from
    application config — see :func:`blanc.core.llm_client.get_llm_client`.
    """

    def __init__(
        self,
        *,
        provider: LLMProvider,
        model_resolver: ModelResolver,
        attachment_loader: Optional[AttachmentLoader] = None,
        usage_sink: Optional[UsageSink] = None,
    ):
        self._provider = provider
        self._resolver = model_resolver
        self._loader = attachment_loader or LocalAttachmentLoader()
        self._sink = usage_sink or NullUsageSink()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def call(
        self,
        prompt: str,
        response_model: Type[T],
        *,
        image_path: Optional[str] = None,
        image_detail: Optional[str] = None,
        attachment_paths: Optional[List[str]] = None,
        purpose: Optional[str] = None,
        model: Optional[str] = None,
        assessment_id: Optional[str] = None,
        cleanup_uploaded_files: bool = True,
        **provider_kwargs: Any,
    ) -> T:
        """Send a structured request. Returns the validated ``response_model``."""
        spec = self._resolver.resolve(purpose=purpose, model=model)
        blocks = self._build_user_blocks(
            prompt=prompt,
            image_path=image_path,
            image_detail=image_detail,
            attachment_paths=attachment_paths,
        )
        uploaded_ids: List[str] = []
        self._materialize_file_uploads(blocks, uploaded_ids)

        messages = [LLMMessage(role="user", content=blocks)]
        try:
            response = self._provider.chat(
                messages=messages,
                model=spec.name,
                response_model=response_model,
                **provider_kwargs,
            )
            self._record_usage(
                call_type="structured",
                spec=spec,
                response=response,
                assessment_id=assessment_id,
            )
            if response.parsed is None:
                raise RuntimeError(
                    f"Provider {self._provider.name} returned no parsed response "
                    f"for {response_model.__name__}"
                )
            logger.info(
                "LLM Response (%s):\n%s",
                response_model.__name__,
                response.parsed.model_dump_json(indent=2),
            )
            return response.parsed  # type: ignore[return-value]
        finally:
            if cleanup_uploaded_files and uploaded_ids:
                self._cleanup_uploads(uploaded_ids)

    def call_text(
        self,
        prompt: str,
        *,
        system_prompt: Optional[str] = None,
        model: Optional[str] = None,
        purpose: Optional[str] = None,
        reasoning_effort: Optional[str] = None,
        assessment_id: Optional[str] = None,
        **provider_kwargs: Any,
    ) -> str:
        """Send a plain text request and return the assistant's text response."""
        spec = self._resolver.resolve(purpose=purpose, model=model)
        messages: List[LLMMessage] = []
        if system_prompt:
            messages.append(LLMMessage(role="system", content=system_prompt))
        messages.append(LLMMessage(role="user", content=prompt))

        if reasoning_effort:
            provider_kwargs.setdefault("reasoning_effort", reasoning_effort)

        response = self._provider.chat(
            messages=messages,
            model=spec.name,
            response_model=None,
            **provider_kwargs,
        )
        self._record_usage(
            call_type="text",
            spec=spec,
            response=response,
            assessment_id=assessment_id,
        )
        return response.text or ""

    async def acall(self, *args: Any, **kwargs: Any) -> Any:
        """Async wrapper around :meth:`call` via ``asyncio.to_thread``."""
        return await asyncio.to_thread(self.call, *args, **kwargs)

    async def acall_text(self, *args: Any, **kwargs: Any) -> str:
        return await asyncio.to_thread(self.call_text, *args, **kwargs)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _build_user_blocks(
        self,
        *,
        prompt: str,
        image_path: Optional[str],
        image_detail: Optional[str],
        attachment_paths: Optional[List[str]],
    ) -> List[ContentBlock]:
        blocks: List[ContentBlock] = [ContentBlock(type="text", text=prompt)]

        if image_path:
            data, mime = self._loader.load(image_path)
            if not mime.startswith("image/"):
                mime = "image/png"
            blocks.append(
                ContentBlock(type="image", data=data, mime_type=mime, detail=image_detail)
            )

        for path in attachment_paths or []:
            mime, _ = mimetypes.guess_type(path)
            if mime and mime.startswith("image/"):
                data, real_mime = self._loader.load(path)
                blocks.append(
                    ContentBlock(type="image", data=data, mime_type=real_mime or mime)
                )
                continue

            if is_remote_location(path):
                # Inline remote non-image attachments as text — providers'
                # Files APIs typically require local upload.
                data, real_mime = self._loader.load(path)
                blocks.append(self._inline_text_attachment(path, data, real_mime))
                continue

            # Local non-image attachment: mark for provider upload in
            # _materialize_file_uploads. Keep mime_type for fallback.
            blocks.append(
                ContentBlock(
                    type="file",
                    file_path=path,
                    mime_type=guess_mime_type(path),
                )
            )
        return blocks

    def _materialize_file_uploads(
        self,
        blocks: List[ContentBlock],
        uploaded_ids: List[str],
    ) -> None:
        for i, block in enumerate(blocks):
            if block.type != "file" or block.file_id or not block.file_path:
                continue
            try:
                file_id = self._provider.upload_file(block.file_path)
            except Exception as e:
                logger.warning(
                    "Provider %s upload_file failed for %s (%s); falling back to inline text.",
                    self._provider.name,
                    block.file_path,
                    e,
                )
                file_id = None

            if file_id:
                block.file_id = file_id
                uploaded_ids.append(file_id)
            else:
                data, mime = self._loader.load(block.file_path)
                blocks[i] = self._inline_text_attachment(block.file_path, data, mime)

    @staticmethod
    def _inline_text_attachment(path: str, data: bytes, mime: str) -> ContentBlock:
        text = data.decode("utf-8", errors="replace")
        body = (
            f"\n\n--- BEGIN ATTACHMENT: {path} ({mime}) ---\n"
            f"{text}\n"
            f"--- END ATTACHMENT: {path} ---"
        )
        return ContentBlock(type="text", text=body)

    def _cleanup_uploads(self, file_ids: List[str]) -> None:
        for fid in file_ids:
            try:
                self._provider.delete_file(fid)
            except Exception as e:  # pragma: no cover
                logger.warning("Failed to delete uploaded file %s: %s", fid, e)

    def _record_usage(
        self,
        *,
        call_type: str,
        spec: ModelSpec,
        response: LLMResponse,
        assessment_id: Optional[str],
    ) -> None:
        # Explicit caller argument wins; fall back to ContextVar.
        aid = assessment_id or get_assessment_context()

        usage = response.usage
        tokens_billed = usage.tokens_billed or usage.total_tokens
        if tokens_billed <= 0 and usage.total_tokens <= 0:
            return

        cost = (
            usage.input_tokens * spec.prompt_cost_per_million / 1_000_000
            + usage.output_tokens * spec.completion_cost_per_million / 1_000_000
        )
        record = UsageRecord(
            call_type=call_type,
            model=response.model or spec.name,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            total_tokens=usage.total_tokens or tokens_billed,
            tokens_billed=tokens_billed,
            duration_ms=response.duration_ms,
            estimated_cost=cost,
            assessment_id=aid,
        )
        try:
            self._sink.record(record)
        except Exception as e:  # pragma: no cover
            logger.warning("Usage sink raised %s; dropping record", e)


__all__ = [
    "LLMClient",
    "ModelResolver",
    "ModelSpec",
    "get_assessment_context",
    "set_assessment_context",
]
