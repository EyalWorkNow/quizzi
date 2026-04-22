from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_teacher
from app.core.config import get_settings
from app.core.rate_limit import InMemoryRateLimiter
from app.db.models import Classroom, Teacher
from app.db.session import get_db
from app.repositories.classes_repo import ClassesRepository
from app.schemas.classroom import (
    StudentCreate,
    StudentOut,
    StudentSelfRegisterOut,
    StudentSelfRegisterRequest,
)

router = APIRouter(prefix="/students", tags=["students"])
settings = get_settings()
register_limiter = InMemoryRateLimiter(
    window_sec=settings.join_rate_limit_window_sec,
    max_requests=settings.join_rate_limit_max * 2,
)


@router.post("/classes/{class_id}", response_model=StudentOut)
def create_student(
    class_id: str,
    payload: StudentCreate,
    db: Session = Depends(get_db),
    teacher: Teacher = Depends(get_current_teacher),
) -> StudentOut:
    classroom = db.get(Classroom, class_id)
    if not classroom or classroom.teacher_id != teacher.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Class not found")

    repo = ClassesRepository(db)
    student = repo.add_student(class_id, payload.pseudonym, payload.display_name)
    return StudentOut(
        id=student.id,
        class_id=student.class_id,
        pseudonym=student.pseudonym,
        display_name=student.display_name,
        created_at=student.created_at,
    )


@router.post("/register", response_model=StudentSelfRegisterOut)
def self_register_student(
    payload: StudentSelfRegisterRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> StudentSelfRegisterOut:
    pseudonym = payload.pseudonym.strip()
    if not pseudonym:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nickname is required")

    ip = request.client.host if request.client else "unknown"
    key = f"{ip}:{payload.join_code.upper()}"
    if not register_limiter.allow(key).allowed:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many registration attempts")

    repo = ClassesRepository(db)
    classroom = repo.get_class_by_join_code(payload.join_code.upper())
    if not classroom:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid class code")

    existing = repo.find_student_by_pseudonym(classroom.id, pseudonym)
    if existing:
        if payload.display_name is not None:
            existing.display_name = payload.display_name
            db.commit()
            db.refresh(existing)
        student = existing
    else:
        student = repo.add_student(classroom.id, pseudonym, payload.display_name)

    return StudentSelfRegisterOut(
        student_id=student.id,
        class_id=student.class_id,
        pseudonym=student.pseudonym,
        display_name=student.display_name,
    )
