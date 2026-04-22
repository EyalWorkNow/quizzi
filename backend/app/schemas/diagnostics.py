from typing import Any

from pydantic import BaseModel


class SessionDiagnosticsOut(BaseModel):
    session_id: str
    skill_mastery: list[dict[str, Any]]
    misconception_heatmap: list[dict[str, Any]]
    question_quality: list[dict[str, Any]]
    engagement: dict[str, Any]
