"""Pydantic request / response DTOs at the HTTP boundary.

The commonly used DTOs are re-exported here so callers can write::

    from blanc.schemas import AssessmentCreate, UserOut

instead of the longer per-module import. Sub-modules (auth, org, app,
onboarding, assessment, rag, surface_map, llm.analysis, llm.threats)
remain available for anything the re-export list doesn't cover.

Domain enums (``AssessmentState``, ``Framework``, ...) live in
:mod:`blanc.domain.enums` — import them from there. The schema
sub-modules do not re-export them.
"""
from blanc.schemas.assessment import (
    AnswerSubmission,
    AssessmentCreate,
    AssessmentResponse,
    ClarificationQuestion,
)
from blanc.schemas.app import AppOnboardRequest, AppOnboardResponse
from blanc.schemas.auth import Token, UserCreate, UserOut
from blanc.schemas.onboarding import (
    AppCategoryProgress,
    AppOnboardingProgressResponse,
    AppOnboardingRequest,
    AppResponseItem,
    CategoryProgress,
    OnboardingProgressResponse,
    OnboardingRequest,
    ResponseItem,
)
from blanc.schemas.org import OrgCreate
from blanc.schemas.rag import IngestResponse, SearchRequest
from blanc.schemas.surface_map import (
    SurfaceBoundary,
    SurfaceComponent,
    SurfaceEnvironment,
    SurfaceMapPayload,
    SurfaceMapResponse,
)

__all__ = [
    # assessment
    "AnswerSubmission",
    "AssessmentCreate",
    "AssessmentResponse",
    "ClarificationQuestion",
    # app
    "AppOnboardRequest",
    "AppOnboardResponse",
    # auth
    "Token",
    "UserCreate",
    "UserOut",
    # onboarding
    "AppCategoryProgress",
    "AppOnboardingProgressResponse",
    "AppOnboardingRequest",
    "AppResponseItem",
    "CategoryProgress",
    "OnboardingProgressResponse",
    "OnboardingRequest",
    "ResponseItem",
    # org
    "OrgCreate",
    # rag
    "IngestResponse",
    "SearchRequest",
    # surface_map
    "SurfaceBoundary",
    "SurfaceComponent",
    "SurfaceEnvironment",
    "SurfaceMapPayload",
    "SurfaceMapResponse",
]
