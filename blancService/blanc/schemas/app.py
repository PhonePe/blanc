"""Application (a.k.a. "app" — the entity below an org) DTOs."""
from pydantic import BaseModel, ConfigDict, Field


class AppOnboardRequest(BaseModel):
    """Payload for ``POST /app/onboard``."""
    name: str = Field(..., description="App name")
    org_id: str = Field(..., description="Organization id that owns this app")


class AppOnboardResponse(BaseModel):
    id: str
    name: str
    org_id: str
    status: str

    model_config = ConfigDict(from_attributes=True)
