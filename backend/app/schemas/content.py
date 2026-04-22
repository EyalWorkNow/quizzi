from datetime import datetime
from typing import Literal

from pydantic import BaseModel, HttpUrl


class ContentSourceCreate(BaseModel):
    class_id: str
    title: str
    source_type: Literal["text", "markdown", "url"]
    raw_content: str | None = None
    source_url: HttpUrl | None = None


class ContentSourceOut(BaseModel):
    id: str
    class_id: str
    title: str
    source_type: str
    status: str
    created_at: datetime


class GenerateCandidatesRequest(BaseModel):
    skill_ids: list[str] = []
    count: int = 12
    provider: Literal["auto", "gemini", "deterministic"] = "auto"


class CandidateGenerationResult(BaseModel):
    source_id: str
    chunks_created: int
    candidates_created: int
    rejected_by_quality: int
    provider_used: Literal["gemini", "deterministic"]
    fallback_used: bool = False
    provider_error: str | None = None
