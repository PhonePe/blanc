from pydantic import BaseModel, Field
from typing import Optional

class AppOnboardRequest(BaseModel):
    name: str = Field(..., description="App name")
    org_id: str = Field(..., description="Organization id that owns this app")

class AppOnboardResponse(BaseModel):
    id: str
    name: str
    org_id: str
    status: str

    model_config = {"from_attributes": True}
