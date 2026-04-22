from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_teacher
from app.db.models import Teacher
from app.db.session import get_db
from app.schemas.quiz import QuizCreate, QuizOut
from app.services.quiz_service import QuizService

router = APIRouter(prefix="/quizzes", tags=["quizzes"])


@router.post("", response_model=QuizOut)
def create_quiz(
    payload: QuizCreate,
    db: Session = Depends(get_db),
    _teacher: Teacher = Depends(get_current_teacher),
) -> QuizOut:
    service = QuizService(db)
    quiz = service.create_quiz(payload)
    return QuizOut(
        id=quiz.id,
        class_id=quiz.class_id,
        title=quiz.title,
        status=quiz.status.value,
        created_at=quiz.created_at,
        published_at=quiz.published_at,
    )


@router.get("", response_model=list[QuizOut])
def list_quizzes(
    class_id: str,
    db: Session = Depends(get_db),
    _teacher: Teacher = Depends(get_current_teacher),
) -> list[QuizOut]:
    service = QuizService(db)
    quizzes = service.list_quizzes(class_id)
    return [
        QuizOut(
            id=quiz.id,
            class_id=quiz.class_id,
            title=quiz.title,
            status=quiz.status.value,
            created_at=quiz.created_at,
            published_at=quiz.published_at,
        )
        for quiz in quizzes
    ]
