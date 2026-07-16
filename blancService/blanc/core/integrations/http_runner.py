"""Async HTTP runner used by every connector.

One :class:`HttpRunner` instance per configured connector — it owns the
per-connector cache, semaphore, and circuit breaker. Connectors never
touch ``httpx`` directly.

Guardrails, all opt-in via ``ConnectorConfig``:

* ``allowed_hosts``            — host allow-list (SSRF guard).
* ``timeout_s``                — per-request timeout.
* ``max_concurrent_requests``  — semaphore bound across all requests
  the connector sends during one dispatcher sweep.
* ``cache_ttl_s``              — per ``(method, url, body)`` response
  cache. Zero disables.
* ``circuit_breaker_failures`` — trip after N consecutive failures.
* ``circuit_breaker_cooldown_s`` — how long the breaker stays open.

Retries are 3 attempts with exponential backoff on transient network
errors only. 4xx responses are NOT retried — that's a client bug.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Dict, Optional, Tuple
from urllib.parse import urlparse

import httpx
from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential_jitter,
)

from blanc.core.integrations.auth import AuthProvider

logger = logging.getLogger(__name__)


class CircuitOpenError(RuntimeError):
    """Raised when the connector's circuit breaker is currently open."""


class HostNotAllowed(RuntimeError):
    """Raised when a request URL's host is not in ``allowed_hosts``."""


class HttpRunner:
    """One instance per connector."""

    def __init__(self, cfg: dict, auth: AuthProvider):
        self._cfg = cfg
        self._auth = auth
        self._allowed = {h.lower() for h in cfg.get("allowed_hosts", []) if h}
        self._timeout = float(cfg.get("timeout_s", 30.0))
        self._cache_ttl = int(cfg.get("cache_ttl_s", 300))
        self._max_bytes = int(cfg.get("max_response_bytes", 5_000_000))
        self._sem = asyncio.Semaphore(int(cfg.get("max_concurrent_requests", 10)))
        self._client: Optional[httpx.AsyncClient] = None
        self._cache: Dict[str, Tuple[float, httpx.Response]] = {}

        self._breaker_failures = int(cfg.get("circuit_breaker_failures", 5))
        self._breaker_cooldown = int(cfg.get("circuit_breaker_cooldown_s", 60))
        self._fail_count = 0
        self._open_until = 0.0

    # ── public API ────────────────────────────────────────────────
    async def send(self, request: httpx.Request) -> httpx.Response:
        # Circuit breaker: skip the whole request when tripped.
        if time.time() < self._open_until:
            raise CircuitOpenError(
                f"circuit open for {self._cfg.get('url', '<unknown>')}"
            )

        # Host allow-list — SSRF guard.
        host = (urlparse(str(request.url)).hostname or "").lower()
        if self._allowed and host not in self._allowed:
            raise HostNotAllowed(
                f"host {host!r} is not in allowed_hosts {sorted(self._allowed)}"
            )

        # Response cache (before auth, so we don't waste tokens on repeats).
        cache_key = self._cache_key(request)
        if self._cache_ttl > 0:
            hit = self._cache.get(cache_key)
            if hit and time.time() < hit[0]:
                return hit[1]

        client = self._get_client()
        async with self._sem:
            async for attempt in AsyncRetrying(
                stop=stop_after_attempt(int(self._cfg.get("max_retries", 4))),
                # Jittered exponential backoff so a batch of concurrent
                # requests to the same upstream don't retry in lockstep.
                wait=wait_exponential_jitter(initial=1.0, max=8.0, jitter=1.0),
                # httpx.TransportError is the parent of ReadError,
                # WriteError, ConnectError, ReadTimeout, WriteTimeout,
                # PoolTimeout, etc. Retrying at that level covers every
                # network-layer flake without having to enumerate each
                # class. RemoteProtocolError (mid-stream protocol error)
                # is a separate subtree.
                retry=retry_if_exception_type((
                    httpx.TransportError,
                    httpx.RemoteProtocolError,
                )),
                reraise=True,
            ):
                with attempt:
                    # Re-apply auth on every retry so short-lived tokens
                    # that expired between attempts are refreshed.
                    self._auth.apply(request)
                    resp = await client.send(request)
                    try:
                        resp.raise_for_status()
                    except httpx.HTTPStatusError:
                        self._record_failure()
                        raise
                    self._record_success()

                    if self._cache_ttl > 0:
                        self._cache[cache_key] = (
                            time.time() + self._cache_ttl,
                            resp,
                        )
                    return resp

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    # ── internals ─────────────────────────────────────────────────
    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            # Explicit pool limits with a SHORT keepalive_expiry: fragile
            # upstreams (LLM proxies, internal gateways) frequently close
            # idle keep-alive sockets from their side, and httpx will
            # cheerfully reuse a half-closed connection — which then
            # fails with ReadError on the very next request. Capping
            # keepalive_expiry at 5s means we open a fresh connection
            # for anything that arrived > 5s after the previous
            # request. Combined with retry-on-TransportError above,
            # this makes intermittent server-side connection drops
            # invisible to the caller.
            limits = httpx.Limits(
                max_connections=int(self._cfg.get("max_concurrent_requests", 10)) * 2,
                max_keepalive_connections=int(self._cfg.get("max_concurrent_requests", 10)),
                keepalive_expiry=float(self._cfg.get("keepalive_expiry_s", 5.0)),
            )

            # TLS verification. Accepts True | False | "/path/to/ca.pem".
            # Setting False is the equivalent of `curl -k` — fine for
            # internal upstreams behind a private CA. We log a WARN
            # when it's off so it's visible in the audit trail.
            verify = self._cfg.get("verify_ssl", True)
            if verify is False:
                logger.warning(
                    "http_runner: TLS verification DISABLED for %s "
                    "(verify_ssl=false)",
                    self._cfg.get("url", "<unknown>"),
                )

            self._client = httpx.AsyncClient(
                timeout=self._timeout,
                limits=limits,
                # http2=False is the default; keep it explicit so a
                # future httpx version flipping the default doesn't
                # silently change wire behaviour.
                http2=False,
                verify=verify,
            )
        return self._client

    @staticmethod
    def _cache_key(req: httpx.Request) -> str:
        body = bytes(req.content or b"")[:512]
        return f"{req.method}|{req.url}|{body!r}"

    def _record_success(self) -> None:
        self._fail_count = 0

    def _record_failure(self) -> None:
        self._fail_count += 1
        if self._fail_count >= self._breaker_failures:
            self._open_until = time.time() + self._breaker_cooldown
            logger.warning(
                "connector circuit tripped for %ds (url=%s)",
                self._breaker_cooldown, self._cfg.get("url"),
            )


__all__ = ["HttpRunner", "CircuitOpenError", "HostNotAllowed"]
