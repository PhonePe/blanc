"""Auth for outbound HTTP calls.

Two placeholder patterns are supported in the header value template:

* ``${env:VAR}``   — resolved from ``os.environ`` on every call. Cheap;
  the caller is responsible for populating / rotating the env var.
* ``${token:NAME}`` — resolved from a token source registered at app
  startup via :func:`register_token_source`. The source callable can
  return either a bare ``str`` (5-minute default TTL) or a
  ``(token, expires_at_epoch)`` tuple (explicit TTL). The token is
  cached with a 60 s refresh margin, thread-safely.

Register the token source once — typically inside ``create_app``::

    from myapp.clients.my_token_client import my_token_client
    from blanc.core.integrations.auth import register_token_source
    register_token_source("my_token_source", my_token_client.get_token)

Secrets never appear in the YAML file itself — only their env-var name
or token-source name does.
"""
from __future__ import annotations

import logging
import os
import re
import threading
import time
from typing import Callable, Dict, Tuple, Union

import httpx

logger = logging.getLogger(__name__)

# ── Token source registry ─────────────────────────────────────────

TokenReturn = Union[str, Tuple[str, float]]
TokenSource = Callable[[], TokenReturn]

_token_sources: Dict[str, TokenSource] = {}


def register_token_source(name: str, fn: TokenSource) -> None:
    """Called once at app startup. See module docstring for shape."""
    if not callable(fn):
        raise ValueError(f"token source {name!r} must be callable")
    _token_sources[name] = fn


def registered_token_sources() -> Dict[str, TokenSource]:
    return dict(_token_sources)


# ── Placeholder resolution ────────────────────────────────────────

_PLACEHOLDER = re.compile(r"\$\{(env|token):([A-Za-z_][A-Za-z0-9_]*)\}")


class AuthProvider:
    """Materialises a header value template on every outbound request.

    One instance per YAML ``auth`` profile; shared across every request
    the framework sends via any connector referencing that profile.
    """

    _REFRESH_MARGIN_S = 60

    def __init__(self, header: str, value_template: str):
        if not header:
            raise ValueError("auth profile is missing `header`")
        if not value_template:
            raise ValueError("auth profile is missing `value`")
        self._header = header
        self._template = value_template
        self._cache: Dict[str, Tuple[float, str]] = {}
        self._lock = threading.Lock()

    def apply(self, request: httpx.Request) -> None:
        request.headers[self._header] = self._resolve()

    # ── internals ─────────────────────────────────────────────────
    def _resolve(self) -> str:
        def substitute(match: "re.Match[str]") -> str:
            kind, name = match.group(1), match.group(2)
            if kind == "env":
                val = os.environ.get(name, "")
                if not val:
                    raise RuntimeError(
                        f"env var {name!r} required by an auth profile "
                        f"is unset. Set it before starting Blanc."
                    )
                return val
            # kind == "token"
            return self._resolve_token(name)

        return _PLACEHOLDER.sub(substitute, self._template)

    def _resolve_token(self, name: str) -> str:
        now = time.time()
        cached = self._cache.get(name)
        if cached and now < cached[0] - self._REFRESH_MARGIN_S:
            return cached[1]
        with self._lock:
            # Re-check inside the lock so we mint the token exactly once
            # across concurrent connectors.
            cached = self._cache.get(name)
            if cached and now < cached[0] - self._REFRESH_MARGIN_S:
                return cached[1]

            source = _token_sources.get(name)
            if source is None:
                raise RuntimeError(
                    f"no token source registered for {name!r}. Call "
                    f"register_token_source({name!r}, fn) at app startup."
                )
            raw = source()
            if isinstance(raw, tuple):
                token, exp = raw
            else:
                token, exp = raw, now + 300.0  # 5-min default
            if not token:
                raise RuntimeError(f"token source {name!r} returned an empty token")
            self._cache[name] = (float(exp), str(token))
            return str(token)


def build_auth(profile_cfg) -> AuthProvider:
    """Build an :class:`AuthProvider` from a ``AuthProfileConfig`` model
    or an equivalent dict. Accepts both so tests can pass literals.
    """
    if hasattr(profile_cfg, "header"):
        return AuthProvider(profile_cfg.header, profile_cfg.value)
    return AuthProvider(profile_cfg["header"], profile_cfg["value"])


__all__ = [
    "AuthProvider",
    "build_auth",
    "register_token_source",
    "registered_token_sources",
]
