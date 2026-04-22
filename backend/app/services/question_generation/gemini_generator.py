from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx

from app.services.question_generation.interfaces import CandidateOption, CandidateQuestion

logger = logging.getLogger(__name__)


class GeminiQuestionGenerator:
    def __init__(self, api_key: str, model: str, timeout_sec: int = 25) -> None:
        self.api_key = api_key
        self.model = model.replace("models/", "")
        self.timeout_sec = timeout_sec

    def generate(
        self,
        chunks: list[dict],
        skill_context: list[dict],
        count: int,
        difficulty_mix: dict[str, int],
    ) -> list[CandidateQuestion]:
        if not chunks or count <= 0:
            return []

        plan = self._difficulty_plan(count, difficulty_mix)
        prompt = self._build_prompt(chunks, skill_context, count, plan)
        text = self._call_gemini(prompt)
        parsed = self._parse_json_payload(text)
        return self._normalize_candidates(parsed, chunks, skill_context, count, plan)

    def _call_gemini(self, prompt: str) -> str:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": prompt}],
                }
            ],
            "generationConfig": {
                "temperature": 0.2,
                "responseMimeType": "application/json",
            },
        }

        response = httpx.post(
            url,
            json=payload,
            timeout=self.timeout_sec,
            headers={"x-goog-api-key": self.api_key},
        )
        response.raise_for_status()
        data = response.json()

        candidates = data.get("candidates") or []
        if not candidates:
            raise ValueError("Gemini returned no candidates")

        content = candidates[0].get("content", {})
        parts = content.get("parts") or []
        if not parts or "text" not in parts[0]:
            raise ValueError("Gemini response does not contain text payload")
        return str(parts[0]["text"])

    def _build_prompt(
        self,
        chunks: list[dict],
        skill_context: list[dict],
        count: int,
        plan: list[str],
    ) -> str:
        skill_lines = []
        for idx, skill in enumerate(skill_context, start=1):
            skill_lines.append(f"{idx}. {skill.get('id')} | {skill.get('name')}")
        if not skill_lines:
            skill_lines = ["1. generic-skill | Core Concept"]

        chunk_lines = []
        for idx, chunk in enumerate(chunks[:12], start=1):
            content = str(chunk.get("content", "")).strip()
            content = re.sub(r"\s+", " ", content)
            chunk_lines.append(f"[chunk {idx} id={chunk.get('id')}] {content[:900]}")

        return (
            "You are generating classroom multiple-choice questions.\n"
            "Return strict JSON only, no markdown fences.\n"
            f"Create exactly {count} questions.\n"
            f"Difficulty plan order: {plan}.\n"
            "Use this schema:\n"
            "{\n"
            '  "questions": [\n'
            "    {\n"
            '      "stem": "string",\n'
            '      "explanation": "string",\n'
            '      "difficulty": "easy|medium|hard",\n'
            '      "source_chunk_id": "string",\n'
            '      "skill_tags": ["skill_id"],\n'
            '      "misconception_tags": ["string"],\n'
            '      "options": [\n'
            '        {"option_key":"A","text":"string","is_correct":true,"misconception_tag":null},\n'
            '        {"option_key":"B","text":"string","is_correct":false,"misconception_tag":"string"},\n'
            '        {"option_key":"C","text":"string","is_correct":false,"misconception_tag":"string"},\n'
            '        {"option_key":"D","text":"string","is_correct":false,"misconception_tag":"string"}\n'
            "      ]\n"
            "    }\n"
            "  ]\n"
            "}\n"
            "Hard constraints:\n"
            "- exactly one correct option.\n"
            "- options must be concise and plausible.\n"
            "- avoid duplicate stems.\n"
            "- map each question to an existing skill id.\n"
            "- output in English.\n"
            "Skill catalog:\n"
            + "\n".join(skill_lines)
            + "\n\nContent chunks:\n"
            + "\n".join(chunk_lines)
        )

    def _parse_json_payload(self, raw_text: str) -> Any:
        text = raw_text.strip()
        if text.startswith("```"):
            text = text.strip("`")
            text = text.replace("json", "", 1).strip()

        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # Fallback: try to extract the largest JSON object in the response.
            start = text.find("{")
            end = text.rfind("}")
            if start >= 0 and end > start:
                snippet = text[start : end + 1]
                return json.loads(snippet)
            raise

    def _normalize_candidates(
        self,
        parsed: Any,
        chunks: list[dict],
        skill_context: list[dict],
        count: int,
        plan: list[str],
    ) -> list[CandidateQuestion]:
        raw_questions: list[dict[str, Any]]
        if isinstance(parsed, dict):
            rows = parsed.get("questions", [])
            raw_questions = [row for row in rows if isinstance(row, dict)]
        elif isinstance(parsed, list):
            raw_questions = [row for row in parsed if isinstance(row, dict)]
        else:
            raise ValueError("Gemini payload is not a JSON object/list")

        chunk_ids = [str(chunk.get("id")) for chunk in chunks if chunk.get("id")]
        valid_skills = {str(skill.get("id")) for skill in skill_context if skill.get("id")}
        fallback_skill = next(iter(valid_skills), "generic-skill")

        normalized: list[CandidateQuestion] = []
        for idx, row in enumerate(raw_questions):
            stem = str(row.get("stem", "")).strip()
            explanation = str(row.get("explanation", "")).strip()
            if len(stem) < 20:
                continue

            options_raw = row.get("options") if isinstance(row.get("options"), list) else []
            options = self._normalize_options(options_raw)
            if len(options) != 4 or len([opt for opt in options if opt.is_correct]) != 1:
                continue

            source_chunk_id = str(row.get("source_chunk_id") or "")
            if source_chunk_id not in chunk_ids:
                source_chunk_id = chunk_ids[idx % len(chunk_ids)] if chunk_ids else None

            skill_tags_raw = row.get("skill_tags") if isinstance(row.get("skill_tags"), list) else []
            skill_tags = [str(item) for item in skill_tags_raw if str(item) in valid_skills]
            if not skill_tags:
                skill_tags = [fallback_skill]

            misconception_raw = (
                row.get("misconception_tags") if isinstance(row.get("misconception_tags"), list) else []
            )
            misconception_tags = [str(item) for item in misconception_raw if str(item).strip()]

            difficulty = str(row.get("difficulty", "")).lower()
            if difficulty not in {"easy", "medium", "hard"}:
                difficulty = plan[len(normalized) % len(plan)]

            normalized.append(
                CandidateQuestion(
                    stem=stem,
                    explanation=explanation or "Answer is supported by the relevant skill evidence.",
                    difficulty=difficulty,
                    source_chunk_id=source_chunk_id or None,
                    options=options,
                    skill_tags=skill_tags,
                    misconception_tags=misconception_tags,
                )
            )
            if len(normalized) >= count:
                break

        if not normalized:
            raise ValueError("Gemini returned no valid questions after normalization")

        return normalized

    def _normalize_options(self, rows: list[Any]) -> list[CandidateOption]:
        option_keys = ["A", "B", "C", "D"]
        normalized: list[CandidateOption] = []
        for idx, row in enumerate(rows[:4]):
            if not isinstance(row, dict):
                continue
            text = str(row.get("text", "")).strip()
            if not text:
                continue
            key = str(row.get("option_key", option_keys[idx])).upper()
            if key not in option_keys:
                key = option_keys[idx]
            normalized.append(
                CandidateOption(
                    option_key=key,
                    text=text,
                    is_correct=bool(row.get("is_correct", False)),
                    misconception_tag=(
                        str(row.get("misconception_tag")).strip()
                        if row.get("misconception_tag") is not None
                        else None
                    ),
                )
            )
        if len(normalized) < 4:
            logger.warning("gemini_options_short", extra={"count": len(normalized)})
        return normalized

    @staticmethod
    def _difficulty_plan(count: int, difficulty_mix: dict[str, int]) -> list[str]:
        plan: list[str] = []
        for difficulty in ("easy", "medium", "hard"):
            plan.extend([difficulty] * max(0, int(difficulty_mix.get(difficulty, 0))))
        if not plan:
            plan = ["medium"] * count
        while len(plan) < count:
            plan.append(plan[len(plan) % len(plan)])
        return plan[:count]
