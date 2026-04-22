from sqlalchemy import func, select

from app.db.models import (
    ActionPlan,
    GameEvent,
    GameParticipant,
    GameSession,
    Question,
    Quiz,
    QuizQuestion,
    RemediationPack,
    Response,
)
from app.repositories.base import Repository


class SessionRepository(Repository):
    def create_session(self, class_id: str, quiz_id: str, pin: str) -> GameSession:
        session = GameSession(class_id=class_id, quiz_id=quiz_id, pin=pin)
        return self.add_and_commit(session)

    def get_session(self, session_id: str) -> GameSession | None:
        return self.db.scalar(select(GameSession).where(GameSession.id == session_id))

    def get_session_by_pin(self, pin: str) -> GameSession | None:
        return self.db.scalar(select(GameSession).where(GameSession.pin == pin))

    def get_quiz(self, quiz_id: str) -> Quiz | None:
        return self.db.scalar(select(Quiz).where(Quiz.id == quiz_id))

    def quiz_questions(self, quiz_id: str) -> list[Question]:
        stmt = (
            select(Question)
            .join(QuizQuestion, QuizQuestion.question_id == Question.id)
            .where(QuizQuestion.quiz_id == quiz_id)
            .order_by(QuizQuestion.position.asc())
        )
        return list(self.db.scalars(stmt).all())

    def current_question(self, session: GameSession) -> Question | None:
        questions = self.quiz_questions(session.quiz_id)
        if session.current_question_index < 0 or session.current_question_index >= len(questions):
            return None
        return questions[session.current_question_index]

    def add_participant(
        self,
        session_id: str,
        nickname: str,
        participant_token: str,
        student_id: str | None = None,
        team_name: str | None = None,
    ) -> GameParticipant:
        participant = GameParticipant(
            session_id=session_id,
            nickname=nickname,
            team_name=team_name,
            participant_token=participant_token,
            student_id=student_id,
        )
        self.db.add(participant)
        self.db.flush()
        self.db.refresh(participant)
        return participant

    def get_participant_by_token(self, session_id: str, participant_token: str) -> GameParticipant | None:
        return self.db.scalar(
            select(GameParticipant).where(
                GameParticipant.session_id == session_id,
                GameParticipant.participant_token == participant_token,
            )
        )

    def get_participant_by_nickname(self, session_id: str, nickname: str) -> GameParticipant | None:
        return self.db.scalar(
            select(GameParticipant).where(
                GameParticipant.session_id == session_id,
                GameParticipant.nickname == nickname,
            )
        )

    def connected_participants_count(self, session_id: str) -> int:
        return self.db.scalar(
            select(func.count(GameParticipant.id)).where(
                GameParticipant.session_id == session_id,
                GameParticipant.is_connected.is_(True),
            )
        ) or 0

    def save_response(
        self,
        session_id: str,
        question_id: str,
        participant_id: str,
        option_id: str,
        is_correct: bool,
        latency_ms: int,
        client_response_id: str,
    ) -> Response:
        response = Response(
            session_id=session_id,
            question_id=question_id,
            participant_id=participant_id,
            selected_option_id=option_id,
            is_correct=is_correct,
            latency_ms=latency_ms,
            client_response_id=client_response_id,
        )
        self.db.add(response)
        self.db.commit()
        self.db.refresh(response)
        return response

    def list_responses_for_question(self, session_id: str, question_id: str) -> list[Response]:
        return list(
            self.db.scalars(
                select(Response).where(Response.session_id == session_id, Response.question_id == question_id)
            ).all()
        )

    def participants(self, session_id: str) -> list[GameParticipant]:
        return list(self.db.scalars(select(GameParticipant).where(GameParticipant.session_id == session_id)).all())

    def leaderboard(self, session_id: str) -> list[GameParticipant]:
        return list(
            self.db.scalars(
                select(GameParticipant)
                .where(GameParticipant.session_id == session_id)
                .order_by(GameParticipant.score.desc(), GameParticipant.joined_at.asc())
            ).all()
        )

    def next_seq(self, session_id: str) -> int:
        current = self.db.scalar(select(func.max(GameEvent.seq)).where(GameEvent.session_id == session_id))
        return 1 if current is None else current + 1

    def append_event(self, session_id: str, seq: int, event_type: str, payload: dict) -> GameEvent:
        event = GameEvent(session_id=session_id, seq=seq, event_type=event_type, payload_json=payload)
        self.db.add(event)
        self.db.commit()
        self.db.refresh(event)
        return event

    def replay_events(self, session_id: str, after_seq: int) -> list[GameEvent]:
        stmt = (
            select(GameEvent)
            .where(GameEvent.session_id == session_id, GameEvent.seq > after_seq)
            .order_by(GameEvent.seq.asc())
        )
        return list(self.db.scalars(stmt).all())

    def get_action_plan(self, session_id: str) -> ActionPlan | None:
        return self.db.scalar(select(ActionPlan).where(ActionPlan.session_id == session_id))

    def get_remediation_pack(self, action_plan_id: str) -> RemediationPack | None:
        return self.db.scalar(select(RemediationPack).where(RemediationPack.action_plan_id == action_plan_id))
