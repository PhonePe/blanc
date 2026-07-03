from typing import List, Literal, TypeVar, Generic, Union
from pydantic import BaseModel, Field, ConfigDict

# --- 1. Shared Model for Component Items ---
class Component(BaseModel):
    component: str = Field(
        ..., 
        description="Name and identifier of the component (e.g., 'NGINX (A)')"
    )
    purpose: str = Field(
        ..., 
        description="The primary function and responsibility of the component"
    )
    data: List[str] = Field(
        ..., 
        description="List of data assets processed, stored, or transmitted"
    )
    trust_level: str = Field(
        ..., 
        description="The security classification or trust boundary of the component"
    )

# --- 2. Response Models for Each JSON Output ---

class MermaidResponse(BaseModel):
    mermaid: str = Field(
        ...,
        description="Valid Mermaid.js definition string that must never contain natural-language refusal text."
    )

class SummaryResponse(BaseModel):
    summary: str = Field(
        ..., 
        description="High-level textual summary of the system architecture"
    )

class ComponentsResponse(BaseModel):
    components: List[Component] = Field(
        ..., 
        description="Detailed breakdown of system components"
    )

class QuestionsResponse(BaseModel):
    questions: List[str] = Field(
        ..., 
        description="List of threat modeling and security assessment questions"
    )

class CoreThreatAnalysis(BaseModel):
    """The universal base fields every threat should have."""
    Threat: str = Field(..., description="Short title of the threat")
    Description: str = Field(..., description="Detailed description of how the threat manifests")
    Impact: Literal["Low", "Medium", "High", "Critical"] = Field(..., description="Severity of the impact")
    Likelihood: Literal["Low", "Medium", "High"] = Field(..., description="Probability of occurrence")
    Mitigation: str = Field(..., description="Technical mitigation strategy")


# ==========================================
# 3. FRAMEWORK-SPECIFIC THREAT MODELS
# ==========================================

# --- 1. STRIDE (Developer / Architecture) ---
class StrideThreatItem(CoreThreatAnalysis):
    Component: str = Field(..., description="Name of the affected component")
    ThreatCategory: Literal[
        "Spoofing", "Tampering", "Repudiation", 
        "Information Disclosure", "Denial of Service", "Elevation of Privilege"
    ] = Field(..., description="The STRIDE category of the threat")


class BusinessLogicThreatItem(CoreThreatAnalysis):
    AbusedFeature: str = Field(
        ..., 
        description="The specific business feature or workflow being targeted (e.g., 'Checkout Process', 'Password Reset')"
    )
    BusinessImpact: str = Field(
        ..., 
        description="The real-world consequence to the business (e.g., 'Financial loss due to unpaid items', 'Regulatory fine')"
    )
    LogicFlawCategory: Literal[
        "Workflow Bypass & Step Skipping",
        "Transaction & Financial Fraud",
        "Role & Privilege Abuse",
        "Resource & Quota Abuse",
        "Data Validation & State Manipulation"
    ] = Field(..., description="The type of business logic vulnerability")

T = TypeVar("T")

class ThreatModelResponse(BaseModel, Generic[T]):
    framework_used: str = Field(..., description="The name of the framework applied (e.g., 'STRIDE', 'DREAD')")
    threats: List[T] = Field(..., description="List of identified threats mapping to the framework")

# ==========================================
# Framework-Specific Response Wrappers
# ==========================================

class StrideThreatModelResponse(BaseModel):
    """Response wrapper for STRIDE analysis containing list of threats"""
    model_config = ConfigDict(json_schema_extra={"name": "StrideThreatModel"})
    ThreatModel: List[StrideThreatItem] = Field(..., description="List of STRIDE threats")

class BusinessLogicThreatModelResponse(BaseModel):
    """Response wrapper for Business Logic analysis containing list of threats"""
    model_config = ConfigDict(json_schema_extra={"name": "BusinessLogicThreatModel"})
    ThreatModel: List[BusinessLogicThreatItem] = Field(..., description="List of Business Logic threats")

# Create a Union type if you want a single endpoint to be able to return ANY of them dynamically
AnyThreatItem = Union[
    StrideThreatItem,
    BusinessLogicThreatItem
]

class ThreatModelAnalysis(BaseModel):
    mermaid_diagram: MermaidResponse
    executive_summary: SummaryResponse
    system_components: ComponentsResponse
    security_questions: QuestionsResponse