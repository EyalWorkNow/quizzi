from sqlalchemy import delete, select

from app.db.models import Question, QuestionOption, QuestionStatus, QuestionTag
from app.repositories.base import Repository


class QuestionRepository(Repository):
    def create_candidate(
        self,
        class_id: str,
        stem: str,
        explanation: str,
        difficulty: str,
        source_chunk_id: str | None,
        options: list[dict],
        tags: list[dict],
    ) -> Question:
        question = Question(
            class_id=class_id,
            stem=stem,
            explanation=explanation,
            difficulty=difficulty,
            source_chunk_id=source_chunk_id,
            status=QuestionStatus.candidate,
        )
        self.db.add(question)
        self.db.flush()

        for option in options:
            self.db.add(
                QuestionOption(
                    question_id=question.id,
                    option_key=option["option_key"],
                    text=option["text"],
                    is_correct=option["is_correct"],
                    misconception_tag=option.get("misconception_tag"),
                )
            )

        for tag in tags:
            self.db.add(
                QuestionTag(
                    question_id=question.id,
                    tag_type=tag["tag_type"],
                    tag_value=tag["tag_value"],
                )
            )

        self.db.commit()
        self.db.refresh(question)
        return question

    def list_candidates(self, class_id: str) -> list[Question]:
        return list(
            self.db.scalars(
                select(Question)
                .where(Question.class_id == class_id, Question.status == QuestionStatus.candidate)
                .order_by(Question.created_at.desc())
            ).all()
        )

    def get_question(self, question_id: str, class_id: str | None = None) -> Question | None:
        stmt = select(Question).where(Question.id == question_id)
        if class_id:
            stmt = stmt.where(Question.class_id == class_id)
        return self.db.scalar(stmt)

    def list_approved(self, class_id: str) -> list[Question]:
        return list(
            self.db.scalars(
                select(Question).where(Question.class_id == class_id, Question.status == QuestionStatus.approved)
            ).all()
        )

    def replace_options(self, question_id: str, options: list[dict]) -> None:
        self.db.execute(delete(QuestionOption).where(QuestionOption.question_id == question_id))
        for option in options:
            self.db.add(
                QuestionOption(
                    question_id=question_id,
                    option_key=option["option_key"],
                    text=option["text"],
                    is_correct=option["is_correct"],
                    misconception_tag=option.get("misconception_tag"),
                )
            )

    def update_status(self, question: Question, status: QuestionStatus) -> Question:
        question.status = status
        self.db.commit()
        self.db.refresh(question)
        return question
