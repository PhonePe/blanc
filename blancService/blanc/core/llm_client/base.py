"""
Vendor-neutral LLM provider interface.

External orgs implement :class:`LLMProvider` and register their class under the
``blanc.llm_providers`` entry-point group. Core stays free of any specific LLM
SDK so that ``pip install atm`` does not pull openai/anthropic/litellm/etc.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional, Type, Union

from pydantic import BaseModel

Role = Literal["system", "user", "assistant"]
BlockType = Literal["text", "image", "file"]


@dataclass
class ContentBlock:
    """A single piece of a multimodal message.

    For ``type="text"``: ``text`` holds the literal string.
    For ``type="image"``: ``data`` holds the raw bytes and ``mime_type`` the
    media type; ``detail`` is an optional provider-specific hint (e.g. "high").
    For ``type="file"``: either ``file_id`` (after upload) **or** ``file_path``
    plus ``mime_type`` (for providers that accept inline bytes / require the
    client to upload).
    """

    type: BlockType
    text: Optional[str] = None
    data: Optional[bytes] = None
    mime_type: Optional[str] = None
    detail: Optional[str] = None
    file_id: Optional[str] = None
    file_path: Optional[str] = None


@dataclass
class LLMMessage:
    role: Role
    content: Union[str, List[ContentBlock]]


@dataclass
class LLMUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    tokens_billed: int = 0
    raw_headers: Optional[Dict[str, str]] = None


@dataclass
class LLMResponse:
    """Normalized response from any provider."""

    model: str
    text: Optional[str] = None
    parsed: Optional[BaseModel] = None
    usage: LLMUsage = field(default_factory=LLMUsage)
    duration_ms: int = 0
    raw: Any = None  # provider-native object for debugging only


class LLMProvider(ABC):
    """Abstract LLM provider.

    A provider is a thin adapter over one vendor SDK (OpenAI, Anthropic,
    LiteLLM, ...). It MUST NOT depend on FastAPI, SQLAlchemy, or any other
    application concern — keep it pure transport.
    """

    name: str = "base"

    @abstractmethod
    def chat(
        self,
        *,
        messages: List[LLMMessage],
        model: str,
        response_model: Optional[Type[BaseModel]] = None,
        **kwargs: Any,
    ) -> LLMResponse:
        """Send a chat request.

        If ``response_model`` is provided, the provider MUST return an
        :class:`LLMResponse` with ``parsed`` populated (using whatever
        structured-output mechanism it has — function calling, JSON mode,
        ``instructor``, etc.). Otherwise it MUST populate ``text``.
        """

    def upload_file(self, file_path: str) -> Optional[str]:  # pragma: no cover - default
        """Optionally upload a non-image attachment via the provider's Files
        API and return a ``file_id``. Return ``None`` to signal the client
        should fall back to inlining the file as text.
        """
        return None

    def delete_file(self, file_id: str) -> None:  # pragma: no cover - default
        """Best-effort cleanup of a previously uploaded file."""
        return None


__all__ = [
    "BlockType",
    "ContentBlock",
    "LLMMessage",
    "LLMProvider",
    "LLMResponse",
    "LLMUsage",
    "Role",
]
