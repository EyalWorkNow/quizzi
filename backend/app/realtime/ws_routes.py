import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.db.models import GameParticipant, GameSession
from app.db.session import SessionLocal
from app.realtime.events import event_envelope
from app.realtime.manager import manager
from app.repositories.session_repo import SessionRepository
from app.services.dashboard_service import DashboardService

router = APIRouter()


async def _stream_events(websocket: WebSocket, session_id: str, last_seq: int) -> None:
    cursor = last_seq
    while True:
        db = SessionLocal()
        try:
            repo = SessionRepository(db)
            events = repo.replay_events(session_id, cursor)
        finally:
            db.close()

        for event in events:
            await websocket.send_json(
                event_envelope(
                    session_id=event.session_id,
                    seq=event.seq,
                    event_type=event.event_type,
                    created_at=event.created_at,
                    payload=event.payload_json,
                )
            )
            cursor = event.seq
        await asyncio.sleep(0.4)


def _append_dashboard_metrics_event(repo: SessionRepository, db, session_id: str) -> None:
    payload = DashboardService(db).session_metrics_event_payload(session_id)
    seq = repo.next_seq(session_id)
    repo.append_event(session_id, seq, "dashboard_metrics", payload)


@router.websocket("/ws/teacher/sessions/{session_id}")
async def teacher_session_ws(
    websocket: WebSocket,
    session_id: str,
    last_seq: int = Query(default=0),
) -> None:
    await websocket.accept()
    manager.connect(session_id)
    try:
        await _stream_events(websocket, session_id, last_seq)
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(session_id)


@router.websocket("/ws/student/sessions/{session_id}")
async def student_session_ws(
    websocket: WebSocket,
    session_id: str,
    participant_token: str = Query(...),
    last_seq: int = Query(default=0),
) -> None:
    await websocket.accept()
    db = SessionLocal()
    try:
        participant = db.scalar(
            select(GameParticipant).where(
                GameParticipant.session_id == session_id,
                GameParticipant.participant_token == participant_token,
            )
        )
        session = db.scalar(select(GameSession).where(GameSession.id == session_id))
        if not participant or not session:
            await websocket.close(code=4401)
            return

        was_connected = participant.is_connected
        participant.is_connected = True
        participant.last_seen_at = datetime.now(timezone.utc)
        participant.left_at = None
        if not was_connected:
            session.active_count = (session.active_count or 0) + 1
        db.commit()

        if not was_connected:
            repo = SessionRepository(db)
            seq = repo.next_seq(session_id)
            repo.append_event(
                session_id,
                seq,
                "participant_reconnected",
                {"participant_id": participant.id, "active_count": session.active_count},
            )
            _append_dashboard_metrics_event(repo, db, session_id)
    finally:
        db.close()

    manager.connect(session_id)
    try:
        await _stream_events(websocket, session_id, last_seq)
    except WebSocketDisconnect:
        db = SessionLocal()
        try:
            participant = db.scalar(
                select(GameParticipant).where(
                    GameParticipant.session_id == session_id,
                    GameParticipant.participant_token == participant_token,
                )
            )
            if participant:
                was_connected = participant.is_connected
                participant.is_connected = False
                participant.left_at = datetime.now(timezone.utc)

                session = db.scalar(select(GameSession).where(GameSession.id == session_id))
                if session and was_connected:
                    session.active_count = max(0, (session.active_count or 0) - 1)
                db.commit()

                if was_connected:
                    repo = SessionRepository(db)
                    seq = repo.next_seq(session_id)
                    repo.append_event(
                        session_id,
                        seq,
                        "participant_disconnected",
                        {
                            "participant_id": participant.id,
                            "active_count": session.active_count if session else 0,
                        },
                    )
                    _append_dashboard_metrics_event(repo, db, session_id)
        finally:
            db.close()
    finally:
        manager.disconnect(session_id)
