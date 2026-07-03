# atm/api_schemas/api_v1/org.py
from pydantic import BaseModel

class OrgCreate(BaseModel):
    name: str

    class Config:
        orm_mode = True
