"""
Token providers for LLM authentication.

External integrators can plug their own auth or secret manager by implementing
:class:`TokenProvider`.
"""
from __future__ import annotations

import os
from abc import ABC, abstractmethod
from typing import Callable, Optional


class TokenProvider(ABC):
    """Returns a bearer token / API key for the LLM provider."""

    @abstractmethod
    def get_token(self) -> str: ...


class StaticTokenProvider(TokenProvider):
    """Wraps a literal token string."""

    def __init__(self, token: str):
        if not token:
            raise ValueError("StaticTokenProvider requires a non-empty token")
        self._token = token

    def get_token(self) -> str:
        return self._token


class EnvTokenProvider(TokenProvider):
    """Reads a token from an environment variable on every call.

    Useful when secrets are rotated by an external sidecar.
    """

    def __init__(self, env_var: str, default: Optional[str] = None):
        self._env_var = env_var
        self._default = default

    def get_token(self) -> str:
        token = os.environ.get(self._env_var, self._default)
        if not token:
            raise RuntimeError(
                f"Environment variable {self._env_var!r} is not set and no "
                "default was provided"
            )
        return token


class CallableTokenProvider(TokenProvider):
    """Delegates to an arbitrary callable. Handy for wiring legacy clients
    without forcing them to implement the ABC."""

    def __init__(self, fn: Callable[[], str]):
        self._fn = fn

    def get_token(self) -> str:
        return self._fn()


__all__ = [
    "CallableTokenProvider",
    "EnvTokenProvider",
    "StaticTokenProvider",
    "TokenProvider",
]
