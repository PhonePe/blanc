"""Example connector — reference integration that hydrates
``SurfaceComponent`` fields via a generic "ask-a-question" HTTP API.

This is a working reference implementation you can copy and adapt.
To wire your own integration:

  1. Copy this file to ``blanc/modules/<YourConnector>.py``.
  2. Rename the class and set ``name = "<YourConnector>"``.
  3. Update ``FIELDS`` to declare which surface-map targets your
     upstream can answer for and how to parse each response.
  4. Adjust :meth:`Example.get_api_calls` / :meth:`Example.parse_response`
     to match your upstream's request/response shape.
  5. Add a matching entry under ``integrations.connectors`` in
     ``config.yml`` (see ``config.yml.example`` for the full shape).

Wire format
-----------
The example assumes a simple JSON-over-HTTP endpoint::

    POST  {url}
    Authorization: Bearer <token>          (from ``auth`` profile)
    Content-Type: application/json

    Request body:
        {
          "prompt":     "What is Kafka?",
          "model":      "example-model",   // optional override from YAML
          "max_tokens": 400
        }

    Response body (200 OK):
        {
          "id":    "resp_a1b2c3d4",        // stamped into `source_ref`
          "text":  "Kafka is a distributed streaming platform ...",
          "usage": {                       // optional; ignored by default
            "input_tokens":  42,
            "output_tokens": 87
          }
        }

If your real upstream uses different field names, adjust the two
methods below — the framework itself is agnostic.

Design note
-----------
Prompt strings and model aliases live in code, not YAML. Only
transport concerns (URL, timeouts, cache, host allow-list, auth)
belong in YAML. The ``model`` alias can still be overridden per
deployment via ``connectors.<Name>.model``.
"""
from __future__ import annotations

import re
from typing import Any, Callable, ClassVar, Dict, List, Optional

import httpx

from blanc.core.integrations.base import ConnectorResult, SurfaceMapConnector
from blanc.core.integrations.registry import connector


# ── Defaults (NOT config) ─────────────────────────────────────────

# Default upstream model alias. Override per deployment via
# ``connectors.<Name>.model`` in config so this file stays free of
# environment-specific strings.
_DEFAULT_MODEL = "example-model"

# Cap on the per-request response length we ask the upstream for.
_DEFAULT_MAX_TOKENS = 400


# Answers that mean "the docs don't cover this component" — do NOT
# write them into surface_map (the base default / current value is a
# better answer than a sentinel).
_NO_INFO_MARKERS = frozenset({
    "no information found",
    "no relevant documentation found",
    "no relevant internal documentation",
    "i don't have information",
    "i do not have information",
})


# ── Answer normalisation ─────────────────────────────────────────
#
# Many LLM-proxy backends emit Markdown by default (asterisks for bold,
# hyphens for lists, hard line breaks with trailing "  ") and often tack
# on a "Sources:" section with citation links. Neither belongs in a
# SurfaceComponent field:
#
#   • `desc` is rendered as plain text — markdown would show as literal
#     `**bold**`.
#   • enum fields (`authn`, `exposure`, …) need the raw literal, and
#     something like "**Internal** — because Kafka is deployed…" must
#     still resolve to "internal".
#   • the citation URLs are already captured in `source_ref`
#     (response `id`) — duplicating them into desc bloats surface_map.

_SOURCES_HEADER_RE = re.compile(
    r"(?ims)^\s*(?:\*+\s*)?(?:sources?|references?|citations?)\s*:?\s*\*+?.*\Z",
)
_MARKDOWN_EMPHASIS_RE = re.compile(r"(\*{1,3}|_{1,3})(.+?)\1")
_MARKDOWN_HEADING_RE = re.compile(r"^#{1,6}\s*", re.MULTILINE)
_MARKDOWN_CODE_RE = re.compile(r"`([^`]*)`")
_MARKDOWN_LIST_BULLET_RE = re.compile(r"^\s*[-*+\u2022]\s+", re.MULTILINE)
_MULTIPLE_BLANKS_RE = re.compile(r"[ \t]{2,}")
_MULTIPLE_NEWLINES_RE = re.compile(r"\n{2,}")


def _clean_answer(raw: str) -> str:
    """Strip markdown, drop the trailing sources block, normalise whitespace.

    Idempotent — safe to call on already-clean text.
    """
    if not raw:
        return ""
    text = raw

    # 1. Drop the "Sources: ..." / "References: ..." block at the end.
    #    Matches whether it's introduced by `**Sources:**`, `Sources:`,
    #    `## Sources`, etc.
    text = _SOURCES_HEADER_RE.sub("", text).rstrip()

    # 2. Strip markdown formatting — bold/italic emphasis, headings,
    #    inline code, list bullets.
    #    We do emphasis in a loop because nested emphasis (`***bold*italic***`)
    #    can require multiple passes.
    for _ in range(3):
        new = _MARKDOWN_EMPHASIS_RE.sub(r"\2", text)
        if new == text:
            break
        text = new
    text = _MARKDOWN_HEADING_RE.sub("", text)
    text = _MARKDOWN_CODE_RE.sub(r"\1", text)
    text = _MARKDOWN_LIST_BULLET_RE.sub("", text)

    # 3. Normalise whitespace — collapse double-spaces (markdown hard
    #    breaks) and squash triple+ newlines to double.
    text = _MULTIPLE_BLANKS_RE.sub(" ", text)
    text = _MULTIPLE_NEWLINES_RE.sub("\n\n", text)

    return text.strip()


# ── Per-target helpers ────────────────────────────────────────────

def _text(*, max_chars: int, drop_markers: frozenset[str]) -> Callable[[str], Optional[str]]:
    """Free-text parser. Clean markdown, drop the sources block, cap length."""
    lowered = {m.lower() for m in drop_markers}

    def parse(raw: str) -> Optional[str]:
        if not raw:
            return None
        cleaned = _clean_answer(raw)
        if not cleaned or cleaned.lower() in lowered:
            return None
        # Also catch the sentinel when it appears anywhere in the first
        # 200 chars (the LLM sometimes prefixes it with `Note:`).
        head = cleaned[:200].lower()
        if any(m in head for m in lowered):
            return None
        return cleaned[:max_chars]

    return parse


def _enum(
    mapping: Dict[str, str],
    *,
    drop: Optional[set[str]] = None,
) -> Callable[[str], Optional[str]]:
    """Enum parser — robust to markdown wrappers and explanation prose.

    Strategy:
      1. Clean markdown / sources first (so `**Internal**` → `Internal`).
      2. Scan the cleaned text for ANY known key in the mapping (word
         boundary match). First one wins.
      3. Fall back to first-token match for terse answers.

    Returns ``None`` on empty, sentinel, or unmapped — that tells the
    dispatcher to fall through to the next connector in the chain
    rather than write an invalid enum.
    """
    drop_set = drop or {"unknown", "unspecified", "n/a", "na", "none", ""}
    # Pre-compile a word-boundary regex covering every mapping key so we
    # can find the answer word even if it's buried in prose. Sort by
    # length descending so "internet-facing" matches before "internet".
    keys_sorted = sorted(mapping.keys(), key=len, reverse=True)
    key_pattern = re.compile(
        r"(?<![a-z0-9-])(" + "|".join(re.escape(k) for k in keys_sorted) + r")(?![a-z0-9-])",
        re.IGNORECASE,
    )

    def parse(raw: str) -> Optional[str]:
        if not raw:
            return None
        cleaned = _clean_answer(raw).lower().strip()
        if not cleaned or cleaned in drop_set:
            return None

        # First pass: find any known key anywhere in the (cleaned) answer.
        m = key_pattern.search(cleaned)
        if m:
            return mapping.get(m.group(1).lower())

        # Fallback: first-token match (handles terse `internal.` etc.).
        token = re.split(r"[\s,;/]", cleaned, maxsplit=1)[0]
        token = token.rstrip(".!?, ")
        if token in drop_set:
            return None
        return mapping.get(token)

    return parse


# ── Per-target specs — prompt + parser ────────────────────────────

FIELDS: Dict[str, Dict[str, Any]] = {

    "component.desc": {
        # Explicit "plain text, no markdown, no sources" to reduce the
        # upstream's quality-review loop time and to give us a cleaner
        # answer. The parser will strip these anyway if the upstream
        # ignores the format constraint, but asking politely first
        # halves the wall-clock time per request.
        "prompt": (
            "What is {component}? Reply with a 4-5 sentence description "
            "in plain text only. Do not use markdown formatting (no **, "
            "no *, no #, no backticks, no bullet lists). Do not include "
            "a 'Sources' or 'References' section at the end. If there is "
            "no relevant internal documentation, reply with exactly: "
            "'No information found'."
        ),
        "parse": _text(max_chars=800, drop_markers=_NO_INFO_MARKERS),
    },

    "component.exposure": {
        "prompt": (
            "What is the network exposure of the {component} component "
            "in production? Reply with a single word from: public, "
            "partner, internal, restricted, vpn. Do not include any "
            "explanation, markdown, or sources. If unknown, reply with: "
            "unknown."
        ),
        "parse": _enum({
            # Public / internet
            "public": "Public",
            "internet": "Public",
            "internet-facing": "Public",
            "external": "Public",
            "externally-facing": "Public",
            # Partner
            "partner": "Partner",
            "b2b": "Partner",
            "third-party": "Partner",
            # Internal / corp
            "internal": "Internal",
            "internal-facing": "Internal",
            "corp": "Internal",
            "corporate": "Internal",
            "corp-facing": "Internal",
            "private": "Internal",
            "intranet": "Internal",
            # Restricted
            "restricted": "Restricted",
            "confidential": "Restricted",
            "highly-restricted": "Restricted",
            # VPN-only
            "vpn": "VPN",
            "vpn-only": "VPN",
        }),
    },

    "component.environment": {
        "prompt": (
            "Which deployment environment does {component} run in? "
            "Reply with a single word from: prod, staging, qa, dev, "
            "sandbox, dr. Do not include any explanation, markdown, or "
            "sources. If not known, reply with: unknown."
        ),
        # environment is a free-form str in the schema, but we still
        # canonicalise so 'production'/'prd'/'live' don't fragment.
        "parse": _enum({
            "prod": "prod",
            "production": "prod",
            "prd": "prod",
            "live": "prod",
            "staging": "staging",
            "stage": "staging",
            "stg": "staging",
            "preprod": "staging",
            "qa": "qa",
            "test": "qa",
            "dev": "dev",
            "development": "dev",
            "sandbox": "sandbox",
            "sbx": "sandbox",
            "dr": "dr",
            "disaster-recovery": "dr",
        }),
    },
}


# ── The connector — three methods, that's all ─────────────────────

@connector
class Example(SurfaceMapConnector):
    """Class name matches the YAML entry key under
    ``integrations.connectors``.
    """
    name: ClassVar[str] = "Example"
    supported_targets: ClassVar[List[str]] = list(FIELDS.keys())

    # 1️⃣  Build the outbound request(s) for one entity + target.
    def get_api_calls(self, entity, target: str) -> List[httpx.Request]:
        spec = FIELDS[target]
        return [httpx.Request(
            "POST",
            self.cfg["url"],
            headers={"Content-Type": "application/json"},
            json={
                "prompt":     spec["prompt"].format(component=entity.name),
                "model":      self.cfg.get("model", _DEFAULT_MODEL),
                "max_tokens": int(self.cfg.get("max_tokens", _DEFAULT_MAX_TOKENS)),
            },
        )]

    # 2️⃣  Extract a typed value from the response envelope.
    def parse_response(
        self, response: httpx.Response, entity, target: str,
    ) -> Optional[ConnectorResult]:
        try:
            payload = response.json()
        except ValueError:
            return None

        # Expected shape: {"id": "...", "text": "...", "usage": {...}}
        # A couple of common alternates are accepted so this example
        # works against upstreams with different naming conventions;
        # trim them once your real API is confirmed.
        raw = (
            payload.get("text")
            or payload.get("output")
            or payload.get("result")
            or (payload.get("data") or {}).get("text")
            or ""
        ).strip()
        value = FIELDS[target]["parse"](raw)
        if value is None:
            return None                                # fall back / no write

        return ConnectorResult(
            value=value,
            source_ref=(
                payload.get("id")
                or payload.get("request_id")
            ),
        )

    # 3️⃣  Write via framework helper — inherited from the base.
    #     Nothing to override.
