from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass
class CandidateOption:
    option_key: str
    text: str
    is_correct: bool
    misconception_tag: str | None = None


@dataclass
class CandidateQuestion:
    stem: str
    explanation: str
    difficulty: str
    source_chunk_id: str | None
    options: list[CandidateOption]
    skill_tags: list[str]
    misconception_tags: list[str]


@dataclass
class QualityResult:
    passed: bool
    reasons: list[str]


class QuestionGenerator(Protocol):
    def generate(
        self,
        chunks: list[dict],
        skill_context: list[dict],
        count: int,
        difficulty_mix: dict[str, int],
    ) -> list[CandidateQuestion]:
        ...


class QualityChecker(Protocol):
    def evaluate(self, candidate: CandidateQuestion, existing_questions: list[str]) -> QualityResult:
        ...


class SimilarityDetector(Protocol):
    def jaccard(self, text_a: str, text_b: str) -> float:
        ...
