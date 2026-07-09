"""Schemas for structured LLM outputs.

Split into two files:

* :mod:`~blanc.schemas.llm.analysis` — Phase A / Phase B outputs used by
  ``blanc.core.document_analysis`` (mermaid extraction, high-level summary,
  component inventory, clarification questions).
* :mod:`~blanc.schemas.llm.threats` — per-framework threat rows and their
  response wrappers, used by ``blanc.core.threat_modeling``.
"""
from blanc.schemas.llm.analysis import (
    Component,
    ComponentsResponse,
    MermaidResponse,
    QuestionsResponse,
    SummaryResponse,
)
from blanc.schemas.llm.threats import (
    BusinessLogicThreatItem,
    BusinessLogicThreatModelResponse,
    CoreThreatAnalysis,
    StrideThreatItem,
    StrideThreatModelResponse,
)

__all__ = [
    "Component",
    "ComponentsResponse",
    "MermaidResponse",
    "QuestionsResponse",
    "SummaryResponse",
    "BusinessLogicThreatItem",
    "BusinessLogicThreatModelResponse",
    "CoreThreatAnalysis",
    "StrideThreatItem",
    "StrideThreatModelResponse",
]
