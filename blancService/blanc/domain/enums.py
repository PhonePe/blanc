"""Single source of truth for domain enums.

These values are stored in MariaDB (as VARCHAR via ``EnumAsString``),
serialised over the wire in API responses, and interpolated into LLM
prompts. Duplicating them across ``schemas/`` and ``db_models/models.py``
was a footgun — the DB copy had ``CHANGES_REQUESTED`` while the API copy
didn't, producing silent drift.

All enums here inherit from ``(str, Enum)`` so:

* ``json.dumps`` gives you the string value, not ``AssessmentState.PENDING``.
* SQLAlchemy's ``EnumAsString`` TypeDecorator round-trips them without
  extra converters.
* Pydantic v2 accepts them as request/response fields with no ``use_enum_values``
  gymnastics.

If you need to add a new member, do it here — not in ``db_models/models.py``
and not in a schema file.
"""
from __future__ import annotations

from enum import Enum


# ── Assessment lifecycle ────────────────────────────────────────────

class AssessmentType(str, Enum):
    """What the assessment is scoped to. Security is the default."""
    SECURITY = "SECURITY"
    COMPLIANCE = "COMPLIANCE"


class Framework(str, Enum):
    """Threat-modelling framework applied to an assessment."""
    STRIDE = "STRIDE"
    BUSINESS_LOGIC = "BUSINESS_LOGIC"


class DiagramType(str, Enum):
    """Which Mermaid dialect the client's diagram / prompt uses."""
    SEQUENCE = "sequenceDiagram"
    FLOWCHART = "flowchart TD"
    C4CONTEXT = "C4Context"


class AssessmentState(str, Enum):
    """High-level lifecycle state of an assessment (and of each image).

    Order matters for the state machine — see ``blanc/core/state_machine.py``.
    """
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    AWAITING_REVIEW = "AWAITING_REVIEW"       # Phase A done, waiting for user "Next"
    NEEDS_INPUT = "NEEDS_INPUT"               # Clarification questions unanswered
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    REVIEW = "REVIEW"                         # Threat modelling done, reviewer assigned
    APPROVED = "APPROVED"
    CHANGES_REQUESTED = "CHANGES_REQUESTED"   # Reviewer rejected


class AssessmentStage(str, Enum):
    """Sub-stage inside a state — most useful during ``PROCESSING``."""
    INITIALIZING = "INITIALIZING"
    IMAGE_PROCESSING = "IMAGE_PROCESSING"
    SUMMARIZING = "SUMMARIZING"
    COMPONENT_ANALYSIS = "COMPONENT_ANALYSIS"
    CLARIFICATION = "CLARIFICATION"
    THREAT_MODELING = "THREAT_MODELING"


# ── Review workflow ────────────────────────────────────────────────

class ReviewStatus(str, Enum):
    """Per-reviewer decision on a threat model."""
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


__all__ = [
    "AssessmentType",
    "Framework",
    "DiagramType",
    "AssessmentState",
    "AssessmentStage",
    "ReviewStatus",
]
