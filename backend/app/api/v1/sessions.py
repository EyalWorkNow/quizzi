from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_teacher
from app.core.config import get_settings
from app.core.rate_limit import InMemoryRateLimiter
from app.db.models import Classroom, GameSession, Teacher
from app.db.session import get_db
from app.schemas.session import (
    JoinSessionRequest,
    JoinSessionResponse,
    LeaderboardEntry,
    LeaderboardOut,
    SessionCreate,
    SessionJoinAccessOut,
    SessionOut,
    SessionReportOut,
    SessionStateOut,
    SubmitResponseRequest,
    TeamLeaderboardEntry,
    TeamLeaderboardOut,
)
from app.services.game_service import GameService

router = APIRouter(prefix="/sessions", tags=["sessions"])
settings = get_settings()
join_limiter = InMemoryRateLimiter(
    window_sec=settings.join_rate_limit_window_sec,
    max_requests=settings.join_rate_limit_max,
)


@router.post("", response_model=SessionOut)
def create_session(
    payload: SessionCreate,
    db: Session = Depends(get_db),
    _teacher: Teacher = Depends(get_current_teacher),
) -> SessionOut:
    _assert_teacher_session_scope(db, payload.class_id, _teacher.id)
    service = GameService(db)
    session = service.create_session(payload.class_id, payload.quiz_id)
    return SessionOut(
        id=session.id,
        class_id=session.class_id,
        quiz_id=session.quiz_id,
        pin=session.pin,
        status=session.status.value,
        current_question_index=session.current_question_index,
        started_at=session.started_at,
        ended_at=session.ended_at,
        active_count=session.active_count,
    )


@router.get("/{session_id}", response_model=SessionStateOut)
def get_session_state(
    session_id: str,
    db: Session = Depends(get_db),
    _teacher: Teacher = Depends(get_current_teacher),
) -> SessionStateOut:
    _assert_teacher_owns_session(db, session_id, _teacher.id)
    state = GameService(db).get_session_state(session_id)
    return SessionStateOut(**state)


@router.post("/{session_id}/next")
def next_question(
    session_id: str,
    db: Session = Depends(get_db),
    _teacher: Teacher = Depends(get_current_teacher),
) -> dict:
    _assert_teacher_owns_session(db, session_id, _teacher.id)
    return GameService(db).next_question(session_id)


@router.post("/{session_id}/pause")
def pause(
    session_id: str,
    db: Session = Depends(get_db),
    _teacher: Teacher = Depends(get_current_teacher),
) -> dict:
    _assert_teacher_owns_session(db, session_id, _teacher.id)
    session = GameService(db).pause(session_id)
    return {"id": session.id, "status": session.status.value}


@router.post("/{session_id}/resume")
def resume(
    session_id: str,
    db: Session = Depends(get_db),
    _teacher: Teacher = Depends(get_current_teacher),
) -> dict:
    _assert_teacher_owns_session(db, session_id, _teacher.id)
    session = GameService(db).resume(session_id)
    return {"id": session.id, "status": session.status.value}


@router.post("/{session_id}/end")
def end_session(
    session_id: str,
    db: Session = Depends(get_db),
    _teacher: Teacher = Depends(get_current_teacher),
) -> dict:
    _assert_teacher_owns_session(db, session_id, _teacher.id)
    return GameService(db).end_session(session_id)


@router.post("/join", response_model=JoinSessionResponse)
def join_session(
    payload: JoinSessionRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> JoinSessionResponse:
    ip = request.client.host if request.client else "unknown"
    key = f"{ip}:{payload.pin}"
    status_result = join_limiter.allow(key)
    if not status_result.allowed:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many join attempts")

    participant = GameService(db).join_session(payload.pin, payload.nickname, payload.team_name)
    return JoinSessionResponse(
        session_id=participant.session_id,
        participant_id=participant.id,
        participant_token=participant.participant_token,
        team_name=participant.team_name,
    )


@router.post("/{session_id}/responses")
def submit_response(
    session_id: str,
    payload: SubmitResponseRequest,
    db: Session = Depends(get_db),
) -> dict:
    return GameService(db).submit_response(
        session_id=session_id,
        participant_token=payload.participant_token,
        option_id=payload.option_id,
        latency_ms=payload.latency_ms,
        client_response_id=payload.client_response_id,
    )


@router.get("/{session_id}/report", response_model=SessionReportOut)
def session_report(
    session_id: str,
    db: Session = Depends(get_db),
    _teacher: Teacher = Depends(get_current_teacher),
) -> SessionReportOut:
    _assert_teacher_owns_session(db, session_id, _teacher.id)
    report = GameService(db).report(session_id)
    return SessionReportOut(**report)


@router.get("/{session_id}/leaderboard", response_model=LeaderboardOut)
def session_leaderboard(
    session_id: str,
    db: Session = Depends(get_db),
    _teacher: Teacher = Depends(get_current_teacher),
) -> LeaderboardOut:
    _assert_teacher_owns_session(db, session_id, _teacher.id)
    items = GameService(db).leaderboard(session_id)
    return LeaderboardOut(
        session_id=session_id,
        items=[LeaderboardEntry(**item) for item in items],
    )


@router.get("/{session_id}/teams/leaderboard", response_model=TeamLeaderboardOut)
def team_leaderboard(
    session_id: str,
    db: Session = Depends(get_db),
    _teacher: Teacher = Depends(get_current_teacher),
) -> TeamLeaderboardOut:
    _assert_teacher_owns_session(db, session_id, _teacher.id)
    items = GameService(db).team_leaderboard(session_id)
    return TeamLeaderboardOut(
        session_id=session_id,
        items=[TeamLeaderboardEntry(**item) for item in items],
    )


@router.get("/{session_id}/join-access", response_model=SessionJoinAccessOut)
def join_access(
    session_id: str,
    db: Session = Depends(get_db),
    _teacher: Teacher = Depends(get_current_teacher),
) -> SessionJoinAccessOut:
    _assert_teacher_owns_session(db, session_id, _teacher.id)
    payload = GameService(db).join_access(session_id)
    return SessionJoinAccessOut(**payload)


def _assert_teacher_owns_session(db: Session, session_id: str, teacher_id: str) -> None:
    session = db.scalar(
        select(GameSession)
        .join(Classroom, Classroom.id == GameSession.class_id)
        .where(GameSession.id == session_id, Classroom.teacher_id == teacher_id)
    )
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")


def _assert_teacher_session_scope(db: Session, class_id: str, teacher_id: str) -> None:
    classroom = db.scalar(select(Classroom).where(Classroom.id == class_id, Classroom.teacher_id == teacher_id))
    if not classroom:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Class not found")
