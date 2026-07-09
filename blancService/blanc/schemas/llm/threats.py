"""Framework-specific threat schemas.

Each framework has:

* A ``…ThreatItem`` model — one threat row.
* A ``…ThreatModelResponse`` wrapper — the top-level JSON the LLM returns,
  keyed on ``ThreatModel`` so multiple frameworks can share the same
  downstream persistence path.

New frameworks land here as another ``item + response`` pair.
"""
from typing import List, Literal

from pydantic import BaseModel, ConfigDict, Field


class CoreThreatAnalysis(BaseModel):
    """Universal fields every threat item shares. Framework-specific
    subclasses add taxonomy-specific columns (STRIDE category, business
    logic flaw category, etc.)."""
    Threat: str = Field(..., description="Short title of the threat")
    Description: str = Field(
        ..., description="Detailed description of how the threat manifests"
    )
    Impact: Literal["Low", "Medium", "High", "Critical"] = Field(
        ..., description="Severity of the impact"
    )
    Likelihood: Literal["Low", "Medium", "High"] = Field(
        ..., description="Probability of occurrence"
    )
    Mitigation: str = Field(..., description="Technical mitigation strategy")


# ── STRIDE ────────────────────────────────────────────────────────

class StrideThreatItem(CoreThreatAnalysis):
    Component: str = Field(..., description="Name of the affected component")
    ThreatCategory: Literal[
        "Spoofing",
        "Tampering",
        "Repudiation",
        "Information Disclosure",
        "Denial of Service",
        "Elevation of Privilege",
    ] = Field(..., description="The STRIDE category of the threat")


class StrideThreatModelResponse(BaseModel):
    """Wrapper for STRIDE analysis containing the list of threats."""
    model_config = ConfigDict(json_schema_extra={"name": "StrideThreatModel"})

    ThreatModel: List[StrideThreatItem] = Field(
        ..., description="List of STRIDE threats"
    )


# ── Business Logic ────────────────────────────────────────────────

class BusinessLogicThreatItem(CoreThreatAnalysis):
    AbusedFeature: str = Field(
        ...,
        description=(
            "The specific business feature or workflow being targeted "
            "(e.g., 'Checkout Process', 'Password Reset')"
        ),
    )
    BusinessImpact: str = Field(
        ...,
        description=(
            "The real-world consequence to the business "
            "(e.g., 'Financial loss due to unpaid items', 'Regulatory fine')"
        ),
    )
    LogicFlawCategory: Literal[
        "Workflow Bypass & Step Skipping",
        "Transaction & Financial Fraud",
        "Role & Privilege Abuse",
        "Resource & Quota Abuse",
        "Data Validation & State Manipulation",
    ] = Field(..., description="The type of business logic vulnerability")


class BusinessLogicThreatModelResponse(BaseModel):
    """Wrapper for Business Logic analysis containing the list of threats."""
    model_config = ConfigDict(json_schema_extra={"name": "BusinessLogicThreatModel"})

    ThreatModel: List[BusinessLogicThreatItem] = Field(
        ..., description="List of Business Logic threats"
    )
