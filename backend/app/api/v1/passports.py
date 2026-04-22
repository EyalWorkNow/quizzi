from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_teacher
from app.db.models import Classroom, Teacher
from app.db.session import get_db
from app.schemas.passport import PassportOut, PassportSnapshot
from app.services.passport_service import PassportService

router = APIRouter(prefix="/classes", tags=["passports"])


@router.get("/{class_id}/students/{student_id}/passport", response_model=PassportOut)
def student_passport(
    class_id: str,
    student_id: str,
    db: Session = Depends(get_db),
    _teacher: Teacher = Depends(get_current_teacher),
) -> PassportOut:
    classroom = db.scalar(select(Classroom).where(Classroom.id == class_id, Classroom.teacher_id == _teacher.id))
    if not classroom:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Class not found")

    snapshots = PassportService(db).get_student_passport(class_id, student_id)
    return PassportOut(
        student_id=student_id,
        class_id=class_id,
        snapshots=[
            PassportSnapshot(
                session_id=s.session_id,
                skill_id=s.skill_id,
                mastery_value=s.mastery_value,
                recent_misconception=s.recent_misconception,
                recommended_practice=s.recommended_practice_json,
                created_at=s.created_at,
            )
            for s in snapshots
        ],
    )
