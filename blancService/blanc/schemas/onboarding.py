"""Onboarding question-answer DTOs, shared across the org and app flows.

The two flows have the same shape:

* A ``ResponseItem`` is a single ``(questionId, question, answer)`` triple.
* An onboarding request bundles a list of those under one category, scoped
  to either an org (``OnboardingRequest.orgId``) or an app
  (``AppOnboardingRequest.appId``).
* A progress response is a list of ``CategoryProgress`` blocks with per-
  category answered/total counts.

The org and app variants used to be full copies with slightly different
field names (``ResponseItem`` vs ``AppResponseItem``, etc.). They're now
thin subclasses of common bases.
"""
from typing import List, Optional

from pydantic import BaseModel


# ── Base building blocks (shared) ──────────────────────────────────

class ResponseItem(BaseModel):
    """One answered question. ``question`` text is optional on write
    (the router only needs the id) but useful for read-back parity."""
    questionId: str
    question: Optional[str] = None
    answer: str


class CategoryProgress(BaseModel):
    """Per-category answered / total roll-up.

    ``status`` is a short string — usually ``"IN_PROGRESS"`` or
    ``"COMPLETED"``. Left as ``str`` (not an enum) because it is a UI
    convenience field, not a domain lifecycle state.
    """
    category: str
    responses: List[ResponseItem]
    answered_questions: int
    total_questions: int
    status: str


# ── Org variant ────────────────────────────────────────────────────

class OnboardingRequest(BaseModel):
    """Payload for ``POST /onboarding`` — save one org category."""
    orgId: str
    category: str
    response: List[ResponseItem]


class OnboardingProgressResponse(BaseModel):
    """Response for ``GET /onboarding/{orgId}``."""
    organization_id: str
    categories: List[CategoryProgress]


# ── App variant ────────────────────────────────────────────────────
# Same shape as the org variant, just scoped to an app. Kept as
# distinct classes rather than an ``entity_type`` discriminator so
# router signatures stay obvious.

class AppResponseItem(ResponseItem):
    """Alias — kept for clients still expecting the old name."""


class AppCategoryProgress(CategoryProgress):
    """Alias — kept for clients still expecting the old name."""


class AppOnboardingRequest(BaseModel):
    """Payload for ``POST /app/onboarding`` — save one app category."""
    appId: str
    category: str
    response: List[AppResponseItem]


class AppOnboardingProgressResponse(BaseModel):
    """Response for ``GET /app/onboarding/{appId}``."""
    app_id: str
    categories: List[AppCategoryProgress]


__all__ = [
    "ResponseItem",
    "CategoryProgress",
    "OnboardingRequest",
    "OnboardingProgressResponse",
    "AppResponseItem",
    "AppCategoryProgress",
    "AppOnboardingRequest",
    "AppOnboardingProgressResponse",
]
