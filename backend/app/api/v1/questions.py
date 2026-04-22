from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_teacher
from app.db.models import Question, QuestionStatus, Teacher
from app.db.session import get_db
from app.repositories.question_repo import QuestionRepository
from app.schemas.question import CandidateQuestionOut, QuestionOptionOut, QuestionPatch, QuestionTagOut

router = APIRouter(prefix="/questions", tags=["questions"])


def _serialize_question(question: Question) -> CandidateQuestionOut:
    return CandidateQuestionOut(
        id=question.id,
        class_id=question.class_id,
        status=question.status.value,
        stem=question.stem,
        explanation=question.explanation,
        difficulty=question.difficulty.value,
        created_at=question.created_at,
        options=[
            QuestionOptionOut(
                id=option.id,
                option_key=option.option_key,
                text=option.text,
                is_correct=option.is_correct,
                misconception_tag=option.misconception_tag,
            )
            for option in question.options
        ],
        tags=[
            QuestionTagOut(id=tag.id, tag_type=tag.tag_type.value, tag_value=tag.tag_value)
            for tag in question.tags
        ],
    )


@router.get("/candidates", response_model=list[CandidateQuestionOut])
def list_candidates(
    class_id: str,
    db: Session = Depends(get_db),
    _teacher: Teacher = Depends(get_current_teacher),
) -> list[CandidateQuestionOut]:
    stmt = (
        select(Question)
        .options(selectinload(Question.options), selectinload(Question.tags))
        .where(Question.class_id == class_id, Question.status == QuestionStatus.candidate)
    )
    rows = list(db.scalars(stmt).all())
    return [_serialize_question(row) for row in rows]


@router.patch("/{question_id}", response_model=CandidateQuestionOut)
def patch_question(
    question_id: str,
    payload: QuestionPatch,
    db: Session = Depends(get_db),
    _teacher: Teacher = Depends(get_current_teacher),
) -> CandidateQuestionOut:
    repo = QuestionRepository(db)
    question = repo.get_question(question_id)
    if not question:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")

    if payload.stem is not None:
        question.stem = payload.stem
    if payload.explanation is not None:
        question.explanation = payload.explanation
    if payload.difficulty is not None:
        question.difficulty = payload.difficulty
    if payload.options is not None:
        repo.replace_options(question.id, [o.model_dump() for o in payload.options])

    db.commit()
    db.refresh(question)
    question = db.scalar(
        select(Question)
        .options(selectinload(Question.options), selectinload(Question.tags))
        .where(Question.id == question.id)
    )
    return _serialize_question(question)


@router.post("/{question_id}/approve", response_model=CandidateQuestionOut)
def approve_question(
    question_id: str,
    db: Session = Depends(get_db),
    _teacher: Teacher = Depends(get_current_teacher),
) -> CandidateQuestionOut:
    repo = QuestionRepository(db)
    question = repo.get_question(question_id)
    if not question:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")
    question.status = QuestionStatus.approved
    db.commit()
    db.refresh(question)
    question = db.scalar(
        select(Question)
        .options(selectinload(Question.options), selectinload(Question.tags))
        .where(Question.id == question.id)
    )
    return _serialize_question(question)


@router.post("/{question_id}/reject", response_model=CandidateQuestionOut)
def reject_question(
    question_id: str,
    db: Session = Depends(get_db),
    _teacher: Teacher = Depends(get_current_teacher),
) -> CandidateQuestionOut:
    repo = QuestionRepository(db)
    question = repo.get_question(question_id)
    if not question:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")
    question.status = QuestionStatus.rejected
    db.commit()
    db.refresh(question)
    question = db.scalar(
        select(Question)
        .options(selectinload(Question.options), selectinload(Question.tags))
        .where(Question.id == question.id)
    )
    return _serialize_question(question)
