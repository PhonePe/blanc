from pydantic import BaseModel, ConfigDict
from typing import Optional, Dict


class UserCreate(BaseModel):
    email: str
    password: str
    name: Optional[str] = None
    # role: Optional[Dict] = None 

class UserOut(BaseModel):
    userId: str
    email: str
    name: Optional[str] = None
    role: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)  # required for SQLAlchemy ORM

class Token(BaseModel):
    access_token: str
    token_type: str