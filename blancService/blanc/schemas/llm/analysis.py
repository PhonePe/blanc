"""Phase A / Phase B LLM output schemas.

Each schema here is fed to the LLM client's ``response_model=`` slot so
the SDK forces valid JSON that matches the shape.
"""
from typing import List

from pydantic import BaseModel, Field


class Component(BaseModel):
    """One component row in the ``ComponentsResponse`` inventory."""
    component: str = Field(
        ...,
        description="Name and identifier of the component (e.g., 'NGINX (A)')",
    )
    purpose: str = Field(
        ...,
        description="The primary function and responsibility of the component",
    )
    data: List[str] = Field(
        ...,
        description="List of data assets processed, stored, or transmitted",
    )
    trust_level: str = Field(
        ...,
        description="The security classification or trust boundary of the component",
    )


class MermaidResponse(BaseModel):
    mermaid: str = Field(
        ...,
        description=(
            "Valid Mermaid.js definition string that must never contain "
            "natural-language refusal text."
        ),
    )


class SummaryResponse(BaseModel):
    summary: str = Field(
        ...,
        description="High-level textual summary of the system architecture",
    )


class ComponentsResponse(BaseModel):
    components: List[Component] = Field(
        ...,
        description="Detailed breakdown of system components",
    )


class QuestionsResponse(BaseModel):
    questions: List[str] = Field(
        ...,
        description="List of threat modeling and security assessment questions",
    )
