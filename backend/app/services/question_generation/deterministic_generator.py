from __future__ import annotations

import itertools
import re

from app.services.question_generation.interfaces import CandidateOption, CandidateQuestion


class DeterministicQuestionGenerator:
    """Template-driven generator used as a deterministic fallback."""

    def _sentences(self, text: str) -> list[str]:
        parts = re.split(r"(?<=[.!?])\\s+", text)
        return [p.strip() for p in parts if len(p.strip().split()) >= 6]

    def generate(
        self,
        chunks: list[dict],
        skill_context: list[dict],
        count: int,
        difficulty_mix: dict[str, int],
    ) -> list[CandidateQuestion]:
        all_sentences: list[tuple[str, str | None]] = []
        for chunk in chunks:
            for sentence in self._sentences(chunk["content"]):
                all_sentences.append((sentence, chunk.get("id")))

        skills = [(skill["id"], skill["name"]) for skill in skill_context] or [("generic-skill", "core concept")]
        difficulties = list(
            itertools.chain.from_iterable(
                [[difficulty] * quantity for difficulty, quantity in difficulty_mix.items() if quantity > 0]
            )
        )
        if not difficulties:
            difficulties = ["medium"] * count

        candidates: list[CandidateQuestion] = []
        cursor = 0
        while len(candidates) < count and cursor < len(all_sentences):
            sentence, chunk_id = all_sentences[cursor]
            skill_id, skill_name = skills[cursor % len(skills)]
            difficulty = difficulties[len(candidates) % len(difficulties)]

            stem = f"Which statement best matches this idea about {skill_name}? {sentence}"
            correct = sentence
            distractors = [
                f"It means the opposite of {skill_name}.",
                f"It is unrelated to {skill_name} and only about memorization.",
                f"It applies only when no evidence is available.",
            ]
            options = [
                CandidateOption(option_key="A", text=correct, is_correct=True),
                CandidateOption(
                    option_key="B",
                    text=distractors[0],
                    is_correct=False,
                    misconception_tag=f"confuses_{skill_name.replace(' ', '_')}_opposite",
                ),
                CandidateOption(
                    option_key="C",
                    text=distractors[1],
                    is_correct=False,
                    misconception_tag=f"confuses_{skill_name.replace(' ', '_')}_scope",
                ),
                CandidateOption(
                    option_key="D",
                    text=distractors[2],
                    is_correct=False,
                    misconception_tag=f"confuses_{skill_name.replace(' ', '_')}_evidence",
                ),
            ]

            candidates.append(
                CandidateQuestion(
                    stem=stem,
                    explanation=f"This checks whether students can align evidence with {skill_name}.",
                    difficulty=difficulty,
                    source_chunk_id=chunk_id,
                    options=options,
                    skill_tags=[skill_id],
                    misconception_tags=[
                        f"confuses_{skill_name.replace(' ', '_')}_opposite",
                        f"confuses_{skill_name.replace(' ', '_')}_scope",
                        f"confuses_{skill_name.replace(' ', '_')}_evidence",
                    ],
                )
            )
            cursor += 1

        return candidates
