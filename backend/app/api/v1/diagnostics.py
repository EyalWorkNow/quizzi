from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_teacher
from app.db.models import Classroom, GameSession, Teacher
from app.db.session import get_db
from app.schemas.diagnostics import SessionDiagnosticsOut
from app.services.diagnostics_service import DiagnosticsService

router = APIRouter(prefix="/diagnostics", tags=["diagnostics"])


@router.get("/sessions/{session_id}", response_model=SessionDiagnosticsOut)
def session_diagnostics(
    session_id: str,
    db: Session = Depends(get_db),
    _teacher: Teacher = Depends(get_current_teacher),
) -> SessionDiagnosticsOut:
    session = db.scalar(
        select(GameSession).join(Classroom, Classroom.id == GameSession.class_id).where(
            GameSession.id == session_id,
            Classroom.teacher_id == _teacher.id,
        )
    )
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    data = DiagnosticsService(db).get_session_diagnostics(session_id)
    return SessionDiagnosticsOut(**data)
