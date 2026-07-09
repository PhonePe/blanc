"""Assessment DTOs — request / response shapes for the assessment router.

Enums (``AssessmentType``, ``Framework``, ``DiagramType``,
``AssessmentState``, ``AssessmentStage``) live in
:mod:`blanc.domain.enums`. Import them from there.
"""
from typing import List, Optional

from fastapi import Form
from pydantic import BaseModel, Field

from blanc.domain.enums import (
    AssessmentStage,
    AssessmentState,
    AssessmentType,
    DiagramType,
    Framework,
)


class AssessmentCreate(BaseModel):
    """JSON body for ``POST /assessment/new``.

    The API route takes multipart form data (uploads accompany the
    metadata), so callers usually reach for :class:`AssessmentCreate`
    via the :meth:`as_form` classmethod. See the router for the actual
    dependency injection.
    """
    assessment_type: AssessmentType = Field(..., description="Type of assessment")
    framework: Framework = Field(Framework.STRIDE, description="Framework used for assessment")
    team: Optional[str] = Field(None, description="Team name")
    app_name: Optional[str] = Field(None, description="Application name")
    org_name: Optional[str] = Field(None, description="Organization name")
    interface: Optional[str] = Field(None, description="Interface (Web/Mobile)")
    operating_system: Optional[str] = Field(None, description="OS name")
    feature_name: Optional[str] = Field(None, description="Feature name")
    feature_version: Optional[str] = Field(None, description="Feature version")
    diagram_type: DiagramType = Field(
        DiagramType.FLOWCHART,
        description="Mermaid diagram type: sequenceDiagram, flowchart TD, or C4Context",
    )

    @classmethod
    def as_form(
        cls,
        assessment_type: AssessmentType = Form(...),
        framework: Framework = Form(Framework.STRIDE),
        team: Optional[str] = Form(None),
        app_name: Optional[str] = Form(None),
        org_name: Optional[str] = Form(None),
        interface: Optional[str] = Form(None),
        operating_system: Optional[str] = Form(None),
        feature_name: Optional[str] = Form(None),
        feature_version: Optional[str] = Form(None),
        diagram_type: DiagramType = Form(DiagramType.FLOWCHART),
    ):
        """FastAPI dependency — parses multipart form data into an
        :class:`AssessmentCreate`. Kept on the model for import
        convenience even though it couples this schema to FastAPI's
        ``Form``. If you ever grow a second frontend that posts JSON,
        that consumer can construct :class:`AssessmentCreate` directly
        and skip this helper.
        """
        return cls(
            assessment_type=assessment_type,
            framework=framework,
            team=team,
            app_name=app_name,
            org_name=org_name,
            interface=interface,
            operating_system=operating_system,
            feature_name=feature_name,
            feature_version=feature_version,
            diagram_type=diagram_type,
        )


class AssessmentResponse(BaseModel):
    """Bare-minimum response returned by state-transition endpoints."""
    assessment_id: str
    state: AssessmentState
    stage: AssessmentStage


class ClarificationQuestion(BaseModel):
    """One row in the clarification-questions block on a DocumentAnalysis."""
    question: Optional[str] = None
    answer: Optional[str] = None
    auto_answered: Optional[bool] = None


class AnswerSubmission(BaseModel):
    """Payload sent by the dev to move an assessment out of ``NEEDS_INPUT``."""
    clarification_questions: List[ClarificationQuestion]
    mermaid_code: Optional[str] = Field(
        None, description="Updated Mermaid diagram if the user edited it"
    )
