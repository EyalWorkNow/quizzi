from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Question, QuestionStatus, Quiz, QuizQuestion, QuizStatus
from app.repositories.question_repo import QuestionRepository
from app.schemas.quiz import QuizCreate


class QuizService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.question_repo = QuestionRepository(db)

    def create_quiz(self, payload: QuizCreate) -> Quiz:
        quiz = Quiz(class_id=payload.class_id, title=payload.title, status=QuizStatus.draft)
        self.db.add(quiz)
        self.db.flush()

        question_ids = payload.question_ids
        if not question_ids:
            question_ids = self._pick_questions(
                class_id=payload.class_id,
                skill_ids=payload.skill_ids,
                count=payload.question_count,
                difficulty_mix=payload.difficulty_mix,
            )

        if not question_ids:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No approved questions available")

        for idx, question_id in enumerate(question_ids):
            self.db.add(QuizQuestion(quiz_id=quiz.id, question_id=question_id, position=idx))

        quiz.status = QuizStatus.published
        quiz.published_at = datetime.now(timezone.utc)
        self.db.commit()
        self.db.refresh(quiz)
        return quiz

    def _pick_questions(
        self,
        class_id: str,
        skill_ids: list[str],
        count: int,
        difficulty_mix: dict[str, int],
    ) -> list[str]:
        stmt = select(Question).where(Question.class_id == class_id, Question.status == QuestionStatus.approved)
        questions = list(self.db.scalars(stmt).all())
        if skill_ids:
            filtered: list[Question] = []
            for q in questions:
                if any(tag.tag_type.value == "skill" and tag.tag_value in skill_ids for tag in q.tags):
                    filtered.append(q)
            questions = filtered

        buckets: dict[str, list[Question]] = {"easy": [], "medium": [], "hard": []}
        for question in questions:
            buckets[question.difficulty.value].append(question)

        selected: list[str] = []
        for difficulty, qty in difficulty_mix.items():
            selected.extend([q.id for q in buckets.get(difficulty, [])[:qty]])

        if len(selected) < count:
            remaining = [q.id for q in questions if q.id not in selected]
            selected.extend(remaining[: max(0, count - len(selected))])

        return selected[:count]

    def list_quizzes(self, class_id: str) -> list[Quiz]:
        return list(self.db.scalars(select(Quiz).where(Quiz.class_id == class_id)).all())
