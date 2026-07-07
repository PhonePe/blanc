# atm/api_schemas/api_v1/org.py
from pydantic import BaseModel

class OrgCreate(BaseModel):
    name: str

    model_config = {"from_attributes": True}
