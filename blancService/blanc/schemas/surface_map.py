"""Surface-map inventory DTOs — the analyst-curated component graph.

Mirrors the frontend Surface Map editor. Each component / boundary /
environment lives in a JSON blob under ``surface_map.surface_map``
in MariaDB; these Pydantic models validate the round-trip.

Naming note: was ``threat_modeling_schema.py``. Renamed to match the
domain concept ("surface map") and the DB table (``surface_map``).
"""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# ── Enum literals (kept as ``Literal[...]`` rather than proper enums so
# future client values still parse without a schema migration) ────────

ComponentType = Literal[
    "Client", "Edge", "Application", "Data", "External", "Infrastructure"
]
Exposure = Literal["Public", "Partner", "Internal", "Restricted", "VPN"]
TrustLevel = Literal["Critical", "High", "Medium", "Low"]
EnvironmentType = Literal["External", "Semi-Trusted", "Internal", "Restricted"]
Protocol = Literal[
    "HTTPS", "HTTPS/Token", "mTLS", "gRPC", "SQL/TCP", "TCP", "WebSocket", "AMQP/Kafka"
]
AuthN = Literal[
    "None", "API Key", "JWT", "OAuth2/OIDC", "mTLS",
    "SAML", "Basic", "Session", "Service Account",
]
AuthZ = Literal[
    "None", "RBAC", "ABAC", "ACL", "Policy (OPA/Cedar)", "Cloud IAM", "OAuth Scopes",
]


# ── Inventory entities ────────────────────────────────────────────

class SurfaceComponent(BaseModel):
    id: str
    name: str
    type: ComponentType = "Application"
    exposure: Exposure = "Internal"
    environment: str = "Unspecified Environment"
    trust_level: TrustLevel = Field(default="Medium", alias="trustLevel")
    authn: AuthN = "None"
    authz: AuthZ = "None"
    desc: str = ""

    model_config = ConfigDict(populate_by_name=True)


class SurfaceBoundary(BaseModel):
    id: str
    name: str
    source: str
    destination: str
    protocol: Protocol = "HTTPS"
    authentication: str = "TLS 1.3"
    threat_level: TrustLevel = Field(default="Medium", alias="threatLevel")

    model_config = ConfigDict(populate_by_name=True)


class SurfaceEnvironment(BaseModel):
    id: str
    name: str
    type: EnvironmentType = "Internal"
    desc: str = ""
    # IDs of SurfaceComponent.id values that live inside this environment /
    # trust zone. Powers the per-environment "components in this zone" check
    # boxes in the UI; replaces the standalone Trust Boundaries section.
    member_components: List[str] = Field(default_factory=list)


class SurfaceMapPayload(BaseModel):
    """Wire format sent by the client on PUT and returned on GET."""
    components: List[SurfaceComponent] = Field(default_factory=list)
    trust_boundaries: List[SurfaceBoundary] = Field(default_factory=list)
    environments: List[SurfaceEnvironment] = Field(default_factory=list)
    mermaid: Optional[str] = None


class SurfaceMapResponse(BaseModel):
    """Full record returned by the API (payload + metadata)."""
    assessment_id: str
    image_id: str
    surface_map: SurfaceMapPayload
    updated_at: Optional[str] = None
    created_at: Optional[str] = None
