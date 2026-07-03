# atm/api_schemas/api_v1/onboarding.py
from pydantic import BaseModel
from typing import List, Optional


# -------------------------
# Request Schema
# -------------------------
class ResponseItem(BaseModel):
    questionId: str
    question: str
    answer: str


class OnboardingRequest(BaseModel):
    orgId: str
    category: str
    response: List[ResponseItem]


# -------------------------
# Response Schema
# -------------------------
class CategoryResponseItem(BaseModel):
    questionId: str
    question: str
    answer: str


class CategoryProgress(BaseModel):
    category: str
    responses: List[CategoryResponseItem]
    answered_questions: int
    total_questions: int
    status: str


class OnboardingProgressResponse(BaseModel):
    organization_id: str
    categories: List[CategoryProgress]


# -------------------------
# Request Schema
# -------------------------
class AppResponseItem(BaseModel):
    questionId: str
    # optional human-readable question text (router doesn't require it for writes,
    # but including it keeps parity with the org schema and is useful for clients)
    question: Optional[str] = None
    answer: str


class AppOnboardingRequest(BaseModel):
    appId: str
    category: str
    response: List[AppResponseItem]


# -------------------------
# Response / Progress Schema
# -------------------------
class AppCategoryResponseItem(BaseModel):
    questionId: str
    question: Optional[str] = None
    answer: str


class AppCategoryProgress(BaseModel):
    category: str
    responses: List[AppCategoryResponseItem]
    answered_questions: int
    total_questions: int
    status: str  # "IN_PROGRESS" | "COMPLETED"


class AppOnboardingProgressResponse(BaseModel):
    app_id: str
    categories: List[AppCategoryProgress]
