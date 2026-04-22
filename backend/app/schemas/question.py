from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class QuestionOptionIn(BaseModel):
    option_key: str
    text: str
    is_correct: bool = False
    misconception_tag: str | None = None


class QuestionOptionOut(QuestionOptionIn):
    id: str


class QuestionTagOut(BaseModel):
    id: str
    tag_type: Literal["skill", "misconception"]
    tag_value: str


class CandidateQuestionOut(BaseModel):
    id: str
    class_id: str
    status: Literal["candidate", "approved", "rejected"]
    stem: str
    explanation: str
    difficulty: Literal["easy", "medium", "hard"]
    created_at: datetime
    options: list[QuestionOptionOut]
    tags: list[QuestionTagOut]


class QuestionPatch(BaseModel):
    stem: str | None = None
    explanation: str | None = None
    difficulty: Literal["easy", "medium", "hard"] | None = None
    options: list[QuestionOptionIn] | None = None
