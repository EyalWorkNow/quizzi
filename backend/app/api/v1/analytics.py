from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_teacher
from app.db.models import Classroom, GameSession, Teacher
from app.db.session import get_db
from app.schemas.analytics import SessionInsightsOut
from app.services.analytics_service import AnalyticsService

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/sessions/{session_id}/insights", response_model=SessionInsightsOut)
def session_insights(
    session_id: str,
    db: Session = Depends(get_db),
    teacher: Teacher = Depends(get_current_teacher),
) -> SessionInsightsOut:
    session = db.scalar(
        select(GameSession).join(Classroom, Classroom.id == GameSession.class_id).where(
            GameSession.id == session_id,
            Classroom.teacher_id == teacher.id,
        )
    )
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    payload = AnalyticsService(db).session_insights(session_id)
    return SessionInsightsOut(**payload)
