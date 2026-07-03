from pydantic import BaseModel, Field
from fastapi import Form
from typing import Optional, List
from enum import Enum

# --- Aligned Enums ---

class AssessmentType(str, Enum):
    SECURITY = "SECURITY"
    COMPLIANCE = "COMPLIANCE"

class Framework(str, Enum):
    STRIDE = "STRIDE"
    BUSINESS_LOGIC = "BUSINESS_LOGIC"

class AssessmentState(str, Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    AWAITING_REVIEW = "AWAITING_REVIEW"
    NEEDS_INPUT = "NEEDS_INPUT"
    COMPLETED = "COMPLETED"
    REVIEW = "REVIEW"
    FAILED = "FAILED"
    APPROVED = "APPROVED"

class AssessmentStage(str, Enum):
    INITIALIZING = "INITIALIZING"
    IMAGE_PROCESSING = "IMAGE_PROCESSING"
    SUMMARIZING = "SUMMARIZING"
    COMPONENT_ANALYSIS = "COMPONENT_ANALYSIS"
    CLARIFICATION = "CLARIFICATION"
    THREAT_MODELING = "THREAT_MODELING"

class DiagramType(str, Enum):
    SEQUENCE = "sequenceDiagram"
    FLOWCHART = "flowchart TD"
    C4CONTEXT = "C4Context"

# --- Schemas ---

class AssessmentCreate(BaseModel):
    assessment_type: AssessmentType = Field(..., description="Type of assessment")
    framework: Framework = Field(Framework.STRIDE, description="Framework used for assessment")
    team: Optional[str] = Field(None, description="Team name")
    app_name: Optional[str] = Field(None, description="Application name")
    org_name: Optional[str] = Field(None, description="Organization name")
    interface: Optional[str] = Field(None, description="Interface (Web/Mobile)")
    operating_system: Optional[str] = Field(None, description="OS name")
    feature_name: Optional[str] = Field(None, description="Feature name")
    feature_version: Optional[str] = Field(None, description="Feature version")
    diagram_type: DiagramType = Field(DiagramType.FLOWCHART, description="Mermaid diagram type: sequenceDiagram, flowchart TD, or C4Context")

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
    assessment_id: str
    state: AssessmentState
    stage: AssessmentStage

class ClarificationQuestion(BaseModel):
    question: Optional[str] = None
    answer: Optional[str] = None
    auto_answered: Optional[bool] = None

class AnswerSubmission(BaseModel):
    # When the Dev answers questions to move out of NEEDS_INPUT
    clarification_questions: List[ClarificationQuestion]
    mermaid_code: Optional[str] = Field(None, description="Updated Mermaid diagram if needed")