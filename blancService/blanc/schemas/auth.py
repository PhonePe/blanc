"""Auth-flow DTOs — registration, profile, JWT bearer envelope."""
from typing import Optional

from pydantic import BaseModel, ConfigDict


class UserCreate(BaseModel):
    email: str
    password: str
    name: Optional[str] = None


class UserOut(BaseModel):
    """Public projection of :class:`blanc.db_models.models.User`."""
    userId: str
    email: str
    name: Optional[str] = None
    role: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class Token(BaseModel):
    """OAuth2 bearer token response."""
    access_token: str
    token_type: str
