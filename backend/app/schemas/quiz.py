from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class QuizCreate(BaseModel):
    class_id: str
    title: str
    question_ids: list[str] = []
    skill_ids: list[str] = []
    question_count: int = 10
    difficulty_mix: dict[str, int] = {"easy": 4, "medium": 4, "hard": 2}


class QuizOut(BaseModel):
    id: str
    class_id: str
    title: str
    status: Literal["draft", "published"]
    created_at: datetime
    published_at: datetime | None = None
