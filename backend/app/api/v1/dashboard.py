from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_teacher
from app.db.models import Classroom, GameSession, Teacher
from app.db.session import get_db
from app.schemas.dashboard import DashboardOverviewOut, SessionLiveMetricsOut, StudentLiveMetricsOut
from app.services.dashboard_service import DashboardService

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/overview", response_model=DashboardOverviewOut)
def overview(
    db: Session = Depends(get_db),
    teacher: Teacher = Depends(get_current_teacher),
) -> DashboardOverviewOut:
    payload = DashboardService(db).teacher_overview(teacher.id)
    return DashboardOverviewOut(**payload)


@router.get("/sessions/{session_id}/live", response_model=SessionLiveMetricsOut)
def session_live_metrics(
    session_id: str,
    db: Session = Depends(get_db),
    teacher: Teacher = Depends(get_current_teacher),
) -> SessionLiveMetricsOut:
    session = db.scalar(
        select(GameSession).join(Classroom, Classroom.id == GameSession.class_id).where(
            GameSession.id == session_id,
            Classroom.teacher_id == teacher.id,
        )
    )
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    payload = DashboardService(db).session_live_metrics(session.id)
    return SessionLiveMetricsOut(**payload)


@router.get("/sessions/{session_id}/me", response_model=StudentLiveMetricsOut)
def student_live_metrics(
    session_id: str,
    participant_token: str,
    db: Session = Depends(get_db),
) -> StudentLiveMetricsOut:
    payload = DashboardService(db).participant_live_metrics(session_id, participant_token)
    return StudentLiveMetricsOut(**payload)
