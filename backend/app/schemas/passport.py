from datetime import datetime
from typing import Any

from pydantic import BaseModel


class PassportSnapshot(BaseModel):
    session_id: str
    skill_id: str
    mastery_value: float
    recent_misconception: str | None = None
    recommended_practice: dict[str, Any]
    created_at: datetime


class PassportOut(BaseModel):
    student_id: str
    class_id: str
    snapshots: list[PassportSnapshot]
