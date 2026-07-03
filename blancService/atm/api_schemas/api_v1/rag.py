from typing import List, Optional
from pydantic import BaseModel, Field


class SearchRequest(BaseModel):
    query: str = Field(..., description="The search query string")
    environment: Optional[str] = Field(default=None, description="Target environment filter (e.g., staging, prod)")
    document_type: Optional[str] = Field(default=None, description="Filter by doc type (e.g., threat_model)")
    num_candidates: int = Field(default=100, ge=10, description="ANN candidate pool")
    k: int = Field(default=10, ge=1, description="Number of final results to return")

class IngestResponse(BaseModel):
    status: str
    message: str
    total_chunks: int
    ignored_url: Optional[str]
