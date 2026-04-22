from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    ActionPlan,
    Difficulty,
    Question,
    QuestionOption,
    QuestionStatus,
    QuestionTag,
    RemediationItem,
    RemediationPack,
    TagType,
)
from app.services.question_generation.similarity_detector import JaccardSimilarityDetector


class RemediationService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.similarity = JaccardSimilarityDetector()

    def create_pack(
        self,
        action_plan: ActionPlan,
        class_id: str,
        weak_skill_ids: list[str],
        used_question_ids: set[str],
    ) -> dict:
        existing = self.db.scalar(
            select(RemediationPack).where(RemediationPack.action_plan_id == action_plan.id)
        )
        if existing:
            return self.serialize_pack(existing.id)

        pack = RemediationPack(
            action_plan_id=action_plan.id,
            class_id=class_id,
            title="Targeted Remediation Pack",
        )
        self.db.add(pack)
        self.db.flush()

        if not weak_skill_ids:
            weak_skill_ids = [
                row.get("skill_id")
                for row in action_plan.summary_json.get("top_weak_skills", [])
                if row.get("skill_id")
            ]
        skill_targets = weak_skill_ids[:3]
        target_distribution = {Difficulty.easy: 3, Difficulty.medium: 3, Difficulty.hard: 2}
        created_items: list[dict] = []
        selected_stems: list[str] = []
        pos = 0

        for skill_id in skill_targets:
            tagged_questions = list(
                self.db.scalars(
                    select(Question)
                    .join(QuestionTag, QuestionTag.question_id == Question.id)
                    .where(
                        Question.class_id == class_id,
                        Question.status == QuestionStatus.approved,
                        QuestionTag.tag_type == TagType.skill,
                        QuestionTag.tag_value == skill_id,
                        Question.id.not_in(used_question_ids) if used_question_ids else True,
                    )
                ).all()
            )

            # Fallback: if pool is too small, allow reuse of session questions.
            if len(tagged_questions) < 8:
                fallback = list(
                    self.db.scalars(
                        select(Question)
                        .join(QuestionTag, QuestionTag.question_id == Question.id)
                        .where(
                            Question.class_id == class_id,
                            Question.status == QuestionStatus.approved,
                            QuestionTag.tag_type == TagType.skill,
                            QuestionTag.tag_value == skill_id,
                        )
                    ).all()
                )
                seen_ids = {q.id for q in tagged_questions}
                for candidate in fallback:
                    if candidate.id not in seen_ids:
                        tagged_questions.append(candidate)
                        seen_ids.add(candidate.id)

            by_difficulty: dict[Difficulty, list[Question]] = {
                Difficulty.easy: [],
                Difficulty.medium: [],
                Difficulty.hard: [],
            }
            for question in tagged_questions:
                by_difficulty[question.difficulty].append(question)

            fallback_questions = list(
                self.db.scalars(
                    select(Question).where(
                        Question.class_id == class_id,
                        Question.status == QuestionStatus.approved,
                    )
                ).all()
            )
            fallback_by_difficulty: dict[Difficulty, list[Question]] = {
                Difficulty.easy: [],
                Difficulty.medium: [],
                Difficulty.hard: [],
            }
            for question in fallback_questions:
                fallback_by_difficulty[question.difficulty].append(question)

            for diff, qty in target_distribution.items():
                picked = 0
                for question in by_difficulty[diff]:
                    if any(self.similarity.jaccard(question.stem, stem) >= 0.98 for stem in selected_stems):
                        continue
                    self.db.add(
                        RemediationItem(
                            pack_id=pack.id,
                            skill_id=skill_id,
                            question_id=question.id,
                            difficulty=question.difficulty,
                            position=pos,
                        )
                    )
                    selected_stems.append(question.stem)
                    created_items.append(
                        {
                            "skill_id": skill_id,
                            "question_id": question.id,
                            "difficulty": question.difficulty.value,
                            "position": pos,
                        }
                    )
                    pos += 1
                    picked += 1
                    if picked >= qty:
                        break

                if picked < qty:
                    for question in fallback_by_difficulty[diff]:
                        if any(self.similarity.jaccard(question.stem, stem) >= 0.98 for stem in selected_stems):
                            continue
                        self.db.add(
                            RemediationItem(
                                pack_id=pack.id,
                                skill_id=skill_id,
                                question_id=question.id,
                                difficulty=question.difficulty,
                                position=pos,
                            )
                        )
                        selected_stems.append(question.stem)
                        created_items.append(
                            {
                                "skill_id": skill_id,
                                "question_id": question.id,
                                "difficulty": question.difficulty.value,
                                "position": pos,
                            }
                        )
                        pos += 1
                        picked += 1
                        if picked >= qty:
                            break

                while picked < qty:
                    generated_question = Question(
                        class_id=class_id,
                        status=QuestionStatus.approved,
                        stem=f"Remediation check ({diff.value}) for skill {skill_id} item {picked + 1}",
                        explanation="Auto-generated remediation check to complete target pack coverage.",
                        difficulty=diff,
                    )
                    self.db.add(generated_question)
                    self.db.flush()
                    self.db.add_all(
                        [
                            QuestionOption(
                                question_id=generated_question.id,
                                option_key="A",
                                text="Correct application of the target skill",
                                is_correct=True,
                            ),
                            QuestionOption(
                                question_id=generated_question.id,
                                option_key="B",
                                text="Common misconception about the target skill",
                                is_correct=False,
                                misconception_tag="remediation_misconception",
                            ),
                            QuestionOption(
                                question_id=generated_question.id,
                                option_key="C",
                                text="Partially correct but missing key condition",
                                is_correct=False,
                            ),
                            QuestionOption(
                                question_id=generated_question.id,
                                option_key="D",
                                text="Unrelated strategy",
                                is_correct=False,
                            ),
                        ]
                    )
                    self.db.add(
                        QuestionTag(
                            question_id=generated_question.id,
                            tag_type=TagType.skill,
                            tag_value=skill_id,
                        )
                    )
                    self.db.add(
                        RemediationItem(
                            pack_id=pack.id,
                            skill_id=skill_id,
                            question_id=generated_question.id,
                            difficulty=generated_question.difficulty,
                            position=pos,
                        )
                    )
                    selected_stems.append(generated_question.stem)
                    created_items.append(
                        {
                            "skill_id": skill_id,
                            "question_id": generated_question.id,
                            "difficulty": generated_question.difficulty.value,
                            "position": pos,
                        }
                    )
                    pos += 1
                    picked += 1

        self.db.commit()
        self.db.refresh(pack)
        if created_items:
            return {"pack_id": pack.id, "title": pack.title, "items": created_items}
        return self.serialize_pack(pack.id)

    def serialize_pack(self, pack_id: str) -> dict:
        pack = self.db.scalar(select(RemediationPack).where(RemediationPack.id == pack_id))
        if not pack:
            return {"pack_id": None, "title": "Targeted Remediation Pack", "items": []}

        items = list(
            self.db.scalars(
                select(RemediationItem)
                .where(RemediationItem.pack_id == pack.id)
                .order_by(RemediationItem.position.asc())
            ).all()
        )
        return {
            "pack_id": pack.id,
            "title": pack.title,
            "items": [
                {
                    "skill_id": item.skill_id,
                    "question_id": item.question_id,
                    "difficulty": item.difficulty.value,
                    "position": item.position,
                }
                for item in items
            ],
        }
