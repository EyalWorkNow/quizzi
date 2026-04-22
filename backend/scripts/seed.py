from __future__ import annotations

import secrets

from sqlalchemy import select

from app.core.security import hash_password
from app.db.base import Base
from app.db.models import (
    Classroom,
    Question,
    QuestionOption,
    QuestionStatus,
    QuestionTag,
    Quiz,
    QuizQuestion,
    QuizStatus,
    Skill,
    TagType,
    Teacher,
)
from app.db.session import SessionLocal


def seed() -> None:
    db = SessionLocal()
    try:
        Base.metadata.create_all(bind=db.get_bind())
        teacher = db.scalar(select(Teacher).where(Teacher.email == "teacher@example.com"))
        if not teacher:
            teacher = Teacher(email="teacher@example.com", password_hash=hash_password("Password123!"))
            db.add(teacher)
            db.flush()

        classroom = db.scalar(select(Classroom).where(Classroom.teacher_id == teacher.id, Classroom.name == "Grade 6 - A"))
        if not classroom:
            classroom = Classroom(
                teacher_id=teacher.id,
                name="Grade 6 - A",
                grade_level="6",
                join_code=_join_code(),
            )
            db.add(classroom)
            db.flush()

        skills = list(db.scalars(select(Skill).where(Skill.class_id == classroom.id)).all())
        if not skills:
            fraction = Skill(
                class_id=classroom.id,
                name="Fractions",
                description="Understand equivalent and ordering of fractions",
                grade_level="6",
            )
            ratio = Skill(
                class_id=classroom.id,
                name="Ratios",
                description="Reason proportionally with ratios",
                grade_level="6",
            )
            db.add_all([fraction, ratio])
            db.flush()
            skills = [fraction, ratio]

        existing_questions = list(db.scalars(select(Question).where(Question.class_id == classroom.id)).all())
        if not existing_questions:
            for idx in range(12):
                difficulty = ["easy", "medium", "hard"][idx % 3]
                skill = skills[idx % len(skills)]
                q = Question(
                    class_id=classroom.id,
                    status=QuestionStatus.approved,
                    stem=f"Seed Q{idx+1}: Which statement is correct about {skill.name}?",
                    explanation=f"Checks conceptual understanding of {skill.name}.",
                    difficulty=difficulty,
                )
                db.add(q)
                db.flush()

                db.add_all(
                    [
                        QuestionOption(question_id=q.id, option_key="A", text="Correct statement", is_correct=True),
                        QuestionOption(
                            question_id=q.id,
                            option_key="B",
                            text="Common misconception",
                            is_correct=False,
                            misconception_tag="confuses_definition",
                        ),
                        QuestionOption(question_id=q.id, option_key="C", text="Incorrect scope", is_correct=False),
                        QuestionOption(question_id=q.id, option_key="D", text="Incorrect evidence", is_correct=False),
                    ]
                )
                db.add(QuestionTag(question_id=q.id, tag_type=TagType.skill, tag_value=skill.id))

        quiz = db.scalar(select(Quiz).where(Quiz.class_id == classroom.id, Quiz.title == "Seed Quiz"))
        if not quiz:
            quiz = Quiz(class_id=classroom.id, title="Seed Quiz", status=QuizStatus.published)
            db.add(quiz)
            db.flush()

            approved_questions = list(
                db.scalars(
                    select(Question)
                    .where(Question.class_id == classroom.id, Question.status == QuestionStatus.approved)
                    .limit(10)
                ).all()
            )
            for idx, question in enumerate(approved_questions):
                db.add(QuizQuestion(quiz_id=quiz.id, question_id=question.id, position=idx))

        db.commit()
        print("Seed complete")
        print("Teacher: teacher@example.com / Password123!")
    finally:
        db.close()


def _join_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(8))


if __name__ == "__main__":
    seed()
