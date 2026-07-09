"""Organization DTOs."""
from pydantic import BaseModel, ConfigDict


class OrgCreate(BaseModel):
    """Payload for ``POST /org/new``."""
    name: str

    model_config = ConfigDict(from_attributes=True)
