from __future__ import annotations

import base64
from io import BytesIO
import secrets
from datetime import datetime, timezone
from random import randint
from urllib.parse import quote_plus

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import (
    ActionPlan,
    GameParticipant,
    GameSession,
    QuestionOption,
    Quiz,
    Student,
    RemediationPack,
    SessionStatus,
)
from app.repositories.session_repo import SessionRepository
from app.services.dashboard_service import DashboardService
from app.services.diagnostics_service import DiagnosticsService
from app.services.realtime_assist_service import RealtimeAssistService


class GameService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.settings = get_settings()
        self.repo = SessionRepository(db)
        self.assist = RealtimeAssistService(db)
        self.diagnostics = DiagnosticsService(db)
        self.dashboard = DashboardService(db)

    def create_session(self, class_id: str, quiz_id: str) -> GameSession:
        quiz = self.db.scalar(select(Quiz).where(Quiz.id == quiz_id, Quiz.class_id == class_id))
        if not quiz:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quiz not found")

        pin = self._generate_pin()
        session = self.repo.create_session(class_id, quiz_id, pin)
        self._emit(session.id, "session_created", {"pin": pin, "status": session.status.value})
        self._emit_dashboard_metrics(session.id)
        return session

    def join_session(self, pin: str, nickname: str, team_name: str | None = None) -> GameParticipant:
        session = self.repo.get_session_by_pin(pin)
        if not session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid PIN")
        if session.status == SessionStatus.ended:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session ended")

        existing_participant = self.repo.get_participant_by_nickname(session.id, nickname)
        if existing_participant:
            was_connected = existing_participant.is_connected
            existing_participant.is_connected = True
            if team_name is not None:
                existing_participant.team_name = team_name
            existing_participant.last_seen_at = datetime.now(timezone.utc)
            existing_participant.left_at = None

            if not was_connected:
                session.active_count = (session.active_count or 0) + 1
                self.db.commit()
                self._emit(
                    session.id,
                    "participant_reconnected",
                    {"participant_id": existing_participant.id, "nickname": existing_participant.nickname},
                )
                self._emit_dashboard_metrics(session.id)
            else:
                self.db.commit()
            return existing_participant

        student = self.db.scalar(
            select(Student).where(Student.class_id == session.class_id, Student.pseudonym == nickname)
        )
        if not student:
            student = Student(class_id=session.class_id, pseudonym=nickname, display_name=nickname)
            self.db.add(student)
            self.db.flush()

        participant = self.repo.add_participant(
            session_id=session.id,
            nickname=nickname,
            participant_token=secrets.token_hex(24),
            student_id=student.id if student else None,
            team_name=team_name,
        )
        session.active_count = (session.active_count or 0) + 1
        self.db.commit()

        self._emit(
            session.id,
            "participant_joined",
            {"participant_id": participant.id, "nickname": nickname, "team_name": participant.team_name},
        )
        self._emit_dashboard_metrics(session.id)
        return participant

    def get_session_state(self, session_id: str) -> dict:
        session = self._session_or_404(session_id)
        questions = self.repo.quiz_questions(session.quiz_id)
        connected = self.repo.connected_participants_count(session_id)
        participants = self.repo.participants(session_id)
        if session.active_count != connected:
            session.active_count = connected
            self.db.commit()

        current_question = None
        if 0 <= session.current_question_index < len(questions):
            question = questions[session.current_question_index]
            current_question = {
                "id": question.id,
                "stem": question.stem,
                "index": session.current_question_index,
            }

        return {
            "id": session.id,
            "class_id": session.class_id,
            "quiz_id": session.quiz_id,
            "pin": session.pin,
            "status": session.status.value,
            "current_question_index": session.current_question_index,
            "started_at": session.started_at,
            "ended_at": session.ended_at,
            "active_count": session.active_count,
            "participants_count": len(participants),
            "current_question": current_question,
        }

    def next_question(self, session_id: str) -> dict:
        session = self._session_or_404(session_id)
        questions = self.repo.quiz_questions(session.quiz_id)
        if not questions:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Quiz has no questions")

        if session.current_question_index + 1 >= len(questions):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No more questions")

        session.current_question_index += 1
        if session.status == SessionStatus.lobby:
            session.status = SessionStatus.active
            session.started_at = datetime.now(timezone.utc)

        self.db.commit()
        question = questions[session.current_question_index]

        payload = {
            "question_id": question.id,
            "index": session.current_question_index,
            "stem": question.stem,
            "options": [{"id": o.id, "key": o.option_key, "text": o.text} for o in question.options],
        }
        self._emit(session.id, "question_opened", payload)
        self._emit_dashboard_metrics(session.id)
        return payload

    def pause(self, session_id: str) -> GameSession:
        session = self._session_or_404(session_id)
        session.status = SessionStatus.paused
        self.db.commit()
        self._emit(session.id, "session_paused", {"status": session.status.value})
        self._emit_dashboard_metrics(session.id)
        return session

    def resume(self, session_id: str) -> GameSession:
        session = self._session_or_404(session_id)
        session.status = SessionStatus.active
        self.db.commit()
        self._emit(session.id, "session_resumed", {"status": session.status.value})
        self._emit_dashboard_metrics(session.id)
        return session

    def submit_response(
        self,
        session_id: str,
        participant_token: str,
        option_id: str,
        latency_ms: int,
        client_response_id: str,
    ) -> dict:
        session = self._session_or_404(session_id)
        question = self.repo.current_question(session)
        if not question:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No active question")

        participant = self.repo.get_participant_by_token(session_id, participant_token)
        if not participant:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid participant token")

        if not participant.is_connected:
            participant.is_connected = True
            participant.left_at = None
            session.active_count = (session.active_count or 0) + 1
            self.db.commit()
            self._emit(
                session.id,
                "participant_reconnected",
                {"participant_id": participant.id, "nickname": participant.nickname},
            )
            self._emit_dashboard_metrics(session.id)
        participant.last_seen_at = datetime.now(timezone.utc)
        self.db.commit()

        option = self.db.scalar(
            select(QuestionOption).where(QuestionOption.id == option_id, QuestionOption.question_id == question.id)
        )
        if not option:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Option not in current question")

        try:
            response = self.repo.save_response(
                session_id=session_id,
                question_id=question.id,
                participant_id=participant.id,
                option_id=option.id,
                is_correct=option.is_correct,
                latency_ms=latency_ms,
                client_response_id=client_response_id,
            )
        except IntegrityError:
            self.db.rollback()
            return {
                "accepted": True,
                "idempotent": True,
                "is_correct": option.is_correct,
                "score": participant.score,
            }

        if option.is_correct:
            participant.score += max(50, 100 - latency_ms // 100)
            self.db.commit()

        self._emit(
            session.id,
            "response_received",
            {
                "participant_id": participant.id,
                "question_id": question.id,
                "is_correct": option.is_correct,
            },
        )

        assist_card = self.assist.evaluate_question(session.id, question.id, max(1, session.active_count))
        if assist_card:
            self._emit(session.id, "assist_card", assist_card)

        leaderboard = self.leaderboard(session.id)
        self._emit(session.id, "leaderboard", {"items": leaderboard})
        team_board = self.team_leaderboard(session.id)
        if team_board:
            self._emit(session.id, "team_leaderboard", {"items": team_board})
        self._emit_dashboard_metrics(session.id)

        return {
            "accepted": True,
            "response_id": response.id,
            "is_correct": option.is_correct,
            "score": participant.score,
            "assist_card": assist_card,
        }

    def end_session(self, session_id: str) -> dict:
        session = self._session_or_404(session_id)
        session.status = SessionStatus.ended
        session.ended_at = datetime.now(timezone.utc)
        self.db.commit()

        outputs = self.diagnostics.compute_session_outputs(session.id)
        self._emit(session.id, "session_ended", {"status": session.status.value})
        self._emit(
            session.id,
            "action_plan_ready",
            {
                "summary": outputs.summary,
                "groups": outputs.groups,
                "recommendations": outputs.recommendations,
                "remediation_pack": outputs.remediation_pack,
            },
        )
        self._emit_dashboard_metrics(session.id)
        return {
            "status": session.status.value,
            "summary": outputs.summary,
            "groups": outputs.groups,
            "recommendations": outputs.recommendations,
            "remediation_pack": outputs.remediation_pack,
        }

    def report(self, session_id: str) -> dict:
        plan = self.db.scalar(select(ActionPlan).where(ActionPlan.session_id == session_id))
        if not plan:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Action plan not found")
        pack = self.db.scalar(select(RemediationPack).where(RemediationPack.action_plan_id == plan.id))
        return {
            "summary": plan.summary_json,
            "groups": plan.groups_json,
            "recommendations": plan.recommendations_json,
            "remediation_pack": self.diagnostics.remediation.serialize_pack(pack.id) if pack else {"pack_id": None, "title": "", "items": []},
        }

    def leaderboard(self, session_id: str) -> list[dict]:
        rows = self.repo.leaderboard(session_id)
        return [
            {
                "participant_id": row.id,
                "nickname": row.nickname,
                "team_name": row.team_name,
                "score": row.score,
            }
            for row in rows
        ]

    def team_leaderboard(self, session_id: str) -> list[dict]:
        rows = self.repo.participants(session_id)
        by_team: dict[str, list[GameParticipant]] = {}
        for row in rows:
            if not row.team_name:
                continue
            by_team.setdefault(row.team_name, []).append(row)

        board = []
        for team_name, members in by_team.items():
            total = sum(member.score for member in members)
            board.append(
                {
                    "team_name": team_name,
                    "total_score": total,
                    "members": len(members),
                    "avg_score": round(total / max(1, len(members)), 2),
                }
            )
        board.sort(key=lambda item: item["total_score"], reverse=True)
        return board

    def join_access(self, session_id: str) -> dict:
        session = self._session_or_404(session_id)
        join_url = f"{self.settings.frontend_origin}/student/join?pin={session.pin}"
        return {
            "session_id": session.id,
            "pin": session.pin,
            "join_url": join_url,
            "qr_data_uri": self._generate_qr_data_uri(join_url),
            "qr_image_url": f"https://api.qrserver.com/v1/create-qr-code/?size=320x320&data={quote_plus(join_url)}",
        }

    def _generate_pin(self) -> str:
        for _ in range(20):
            pin = str(randint(100000, 999999))
            if not self.repo.get_session_by_pin(pin):
                return pin
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to generate PIN")

    def _session_or_404(self, session_id: str) -> GameSession:
        session = self.repo.get_session(session_id)
        if not session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
        return session

    def _emit(self, session_id: str, event_type: str, payload: dict) -> None:
        seq = self.repo.next_seq(session_id)
        self.repo.append_event(session_id, seq, event_type, payload)

    def _emit_dashboard_metrics(self, session_id: str) -> None:
        payload = self.dashboard.session_metrics_event_payload(session_id)
        self._emit(session_id, "dashboard_metrics", payload)

    def _generate_qr_data_uri(self, text: str) -> str | None:
        try:
            import qrcode
            from qrcode.image.svg import SvgPathImage
        except Exception:
            return None

        buffer = BytesIO()
        image = qrcode.make(text, image_factory=SvgPathImage, box_size=8, border=2)
        image.save(buffer)
        svg_bytes = buffer.getvalue()
        encoded = base64.b64encode(svg_bytes).decode("ascii")
        return f"data:image/svg+xml;base64,{encoded}"
