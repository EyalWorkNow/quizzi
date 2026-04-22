from __future__ import annotations

import logging

import httpx
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import QuestionTag, Skill, TagType
from app.core.config import get_settings
from app.repositories.content_repo import ContentRepository
from app.repositories.question_repo import QuestionRepository
from app.services.question_generation.deterministic_generator import DeterministicQuestionGenerator
from app.services.question_generation.gemini_generator import GeminiQuestionGenerator
from app.services.question_generation.quality_checker import DeterministicQualityChecker
from app.utils.chunking import chunk_text
from app.utils.html_extract import extract_readable_text

logger = logging.getLogger(__name__)


class IngestService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.settings = get_settings()
        self.content_repo = ContentRepository(db)
        self.question_repo = QuestionRepository(db)
        self.deterministic_generator = DeterministicQuestionGenerator()
        self.gemini_generator = (
            GeminiQuestionGenerator(
                api_key=self.settings.gemini_api_key,
                model=self.settings.gemini_model,
                timeout_sec=self.settings.gemini_timeout_sec,
            )
            if self.settings.gemini_api_key
            else None
        )
        self.quality_checker = DeterministicQualityChecker()

    def create_source(
        self,
        class_id: str,
        source_type: str,
        title: str,
        raw_content: str | None,
        source_url: str | None,
    ):
        content = raw_content or ""
        if source_type == "url":
            if not source_url:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="source_url required")
            try:
                response = httpx.get(source_url, timeout=10.0)
                response.raise_for_status()
                content = extract_readable_text(response.text)
            except Exception as exc:  # noqa: BLE001
                logger.exception("failed to fetch source url")
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

        if not content.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty content")

        return self.content_repo.create_source(class_id, source_type, title, content, source_url)

    def generate_candidates(self, source_id: str, count: int, skill_ids: list[str], provider: str = "auto") -> dict:
        source = self.content_repo.get_source(source_id)
        if not source:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found")

        chunks = chunk_text(source.raw_content)
        saved_chunks = self.content_repo.save_chunks(
            source_id,
            [
                {
                    "chunk_index": c.index,
                    "content": c.content,
                    "checksum": c.checksum,
                    "metadata_json": {},
                }
                for c in chunks
            ],
        )

        skills_stmt = select(Skill).where(Skill.class_id == source.class_id)
        if skill_ids:
            skills_stmt = skills_stmt.where(Skill.id.in_(skill_ids))
        skills = list(self.db.scalars(skills_stmt).all())
        skill_context = [{"id": s.id, "name": s.name} for s in skills]

        chunk_payload = [{"id": c.id, "content": c.content} for c in saved_chunks]
        difficulty_mix = {"easy": max(1, count // 3), "medium": max(1, count // 3), "hard": max(1, count // 4)}

        provider_used = "deterministic"
        fallback_used = False
        provider_error = None

        selected_provider = (provider or "auto").lower()
        if selected_provider not in {"auto", "gemini", "deterministic"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid provider")

        if selected_provider == "gemini" and not self.gemini_generator:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Gemini provider not configured")

        if selected_provider in {"auto", "gemini"} and self.gemini_generator:
            try:
                generated = self.gemini_generator.generate(
                    chunks=chunk_payload,
                    skill_context=skill_context,
                    count=count,
                    difficulty_mix=difficulty_mix,
                )
                provider_used = "gemini"
            except Exception as exc:  # noqa: BLE001
                logger.exception("gemini_generation_failed")
                provider_error = str(exc)
                if selected_provider == "gemini":
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail=f"Gemini generation failed: {exc}",
                    ) from exc
                generated = self.deterministic_generator.generate(
                    chunks=chunk_payload,
                    skill_context=skill_context,
                    count=count,
                    difficulty_mix=difficulty_mix,
                )
                provider_used = "deterministic"
                fallback_used = True
        else:
            generated = self.deterministic_generator.generate(
                chunks=chunk_payload,
                skill_context=skill_context,
                count=count,
                difficulty_mix=difficulty_mix,
            )
            provider_used = "deterministic"

        existing = [q.stem for q in self.question_repo.list_candidates(source.class_id)]
        created = 0
        rejected = 0

        for candidate in generated:
            quality = self.quality_checker.evaluate(candidate, existing)
            if not quality.passed:
                rejected += 1
                continue

            question = self.question_repo.create_candidate(
                class_id=source.class_id,
                stem=candidate.stem,
                explanation=candidate.explanation,
                difficulty=candidate.difficulty,
                source_chunk_id=candidate.source_chunk_id,
                options=[
                    {
                        "option_key": o.option_key,
                        "text": o.text,
                        "is_correct": o.is_correct,
                        "misconception_tag": o.misconception_tag,
                    }
                    for o in candidate.options
                ],
                tags=[{"tag_type": TagType.skill, "tag_value": tag} for tag in candidate.skill_tags]
                + [
                    {"tag_type": TagType.misconception, "tag_value": tag}
                    for tag in candidate.misconception_tags
                ],
            )
            existing.append(question.stem)
            created += 1

        return {
            "source_id": source_id,
            "chunks_created": len(saved_chunks),
            "candidates_created": created,
            "rejected_by_quality": rejected,
            "provider_used": provider_used,
            "fallback_used": fallback_used,
            "provider_error": provider_error,
        }

    def skill_name_for_question(self, question_id: str) -> str | None:
        tag = self.db.scalar(
            select(QuestionTag).where(QuestionTag.question_id == question_id, QuestionTag.tag_type == TagType.skill)
        )
        return tag.tag_value if tag else None
