from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import (
    Classroom,
    Diagnostic,
    GameEvent,
    GameParticipant,
    GameSession,
    Question,
    QuestionOption,
    QuestionStatus,
    QuizQuestion,
    Response,
    SessionStatus,
    Skill,
    Student,
)


class DashboardService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def teacher_overview(self, teacher_id: str) -> dict[str, Any]:
        classes = list(
            self.db.scalars(
                select(Classroom).where(Classroom.teacher_id == teacher_id).order_by(Classroom.created_at.desc())
            ).all()
        )
        if not classes:
            return {
                "teacher_id": teacher_id,
                "totals": {
                    "classes": 0,
                    "students": 0,
                    "sessions": 0,
                    "active_sessions": 0,
                    "candidate_questions": 0,
                },
                "classes": [],
                "generated_at": datetime.now(timezone.utc),
            }

        class_ids = [row.id for row in classes]

        student_rows = self.db.execute(
            select(Student.class_id, func.count(Student.id))
            .where(Student.class_id.in_(class_ids))
            .group_by(Student.class_id)
        ).all()
        students_per_class = {class_id: count for class_id, count in student_rows}

        candidate_questions = (
            self.db.scalar(
                select(func.count(Question.id)).where(
                    Question.class_id.in_(class_ids), Question.status == QuestionStatus.candidate
                )
            )
            or 0
        )

        sessions = list(
            self.db.scalars(
                select(GameSession).where(GameSession.class_id.in_(class_ids)).order_by(GameSession.started_at.desc())
            ).all()
        )
        sessions_per_class: dict[str, list[GameSession]] = defaultdict(list)
        for session in sessions:
            sessions_per_class[session.class_id].append(session)

        weak_rows = self.db.execute(
            select(
                Diagnostic.class_id,
                Diagnostic.skill_id,
                Skill.name,
                func.avg(Diagnostic.mastery_after).label("avg_mastery"),
                func.count(Diagnostic.id).label("samples"),
            )
            .join(Skill, Skill.id == Diagnostic.skill_id)
            .where(Diagnostic.class_id.in_(class_ids))
            .group_by(Diagnostic.class_id, Diagnostic.skill_id, Skill.name)
        ).all()

        weak_per_class: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for class_id, skill_id, skill_name, avg_mastery, samples in weak_rows:
            weak_per_class[class_id].append(
                {
                    "skill_id": skill_id,
                    "skill_name": skill_name,
                    "avg_mastery": round(float(avg_mastery), 3),
                    "samples": int(samples),
                }
            )

        class_payload = []
        total_students = 0
        total_active_sessions = 0
        for classroom in classes:
            rows = sessions_per_class.get(classroom.id, [])
            active_rows = [row for row in rows if row.status in {SessionStatus.lobby, SessionStatus.active, SessionStatus.paused}]
            recent_rows = sorted(
                rows,
                key=self._session_sort_key,
                reverse=True,
            )[:3]
            weak = sorted(weak_per_class.get(classroom.id, []), key=lambda row: row["avg_mastery"])[:3]
            students_count = students_per_class.get(classroom.id, 0)

            total_students += students_count
            total_active_sessions += len(active_rows)

            class_payload.append(
                {
                    "id": classroom.id,
                    "name": classroom.name,
                    "grade_level": classroom.grade_level,
                    "join_code": classroom.join_code,
                    "students_count": students_count,
                    "total_sessions": len(rows),
                    "active_sessions": len(active_rows),
                    "weak_skills": weak,
                    "recent_sessions": [
                        {
                            "session_id": row.id,
                            "status": row.status.value,
                            "started_at": row.started_at,
                            "ended_at": row.ended_at,
                        }
                        for row in recent_rows
                    ],
                }
            )

        return {
            "teacher_id": teacher_id,
            "totals": {
                "classes": len(classes),
                "students": total_students,
                "sessions": len(sessions),
                "active_sessions": total_active_sessions,
                "candidate_questions": candidate_questions,
            },
            "classes": class_payload,
            "generated_at": datetime.now(timezone.utc),
        }

    def session_live_metrics(self, session_id: str) -> dict[str, Any]:
        session = self.db.scalar(select(GameSession).where(GameSession.id == session_id))
        if not session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

        joined_students = (
            self.db.scalar(select(func.count(GameParticipant.id)).where(GameParticipant.session_id == session_id)) or 0
        )
        active_students = (
            self.db.scalar(
                select(func.count(GameParticipant.id)).where(
                    GameParticipant.session_id == session_id, GameParticipant.is_connected.is_(True)
                )
            )
            or 0
        )
        if session.active_count != active_students:
            session.active_count = active_students
            self.db.commit()

        responses_total = self.db.scalar(select(func.count(Response.id)).where(Response.session_id == session_id)) or 0
        question_count = self.db.scalar(select(func.count(QuizQuestion.id)).where(QuizQuestion.quiz_id == session.quiz_id)) or 0
        expected_total = max(1, max(1, joined_students) * max(1, question_count))

        dropout_events = (
            self.db.scalar(
                select(func.count(GameEvent.id)).where(
                    GameEvent.session_id == session_id, GameEvent.event_type == "participant_disconnected"
                )
            )
            or 0
        )
        reconnect_events = (
            self.db.scalar(
                select(func.count(GameEvent.id)).where(
                    GameEvent.session_id == session_id, GameEvent.event_type == "participant_reconnected"
                )
            )
            or 0
        )
        assist_cards_count = (
            self.db.scalar(
                select(func.count(GameEvent.id)).where(GameEvent.session_id == session_id, GameEvent.event_type == "assist_card")
            )
            or 0
        )
        team_rows = list(
            self.db.scalars(
                select(GameParticipant)
                .where(GameParticipant.session_id == session_id, GameParticipant.team_name.is_not(None))
                .order_by(GameParticipant.score.desc())
            ).all()
        )
        by_team: dict[str, dict[str, int]] = {}
        for row in team_rows:
            team_name = row.team_name or ""
            by_team.setdefault(team_name, {"members": 0, "total_score": 0})
            by_team[team_name]["members"] += 1
            by_team[team_name]["total_score"] += row.score
        top_teams = sorted(
            [
                {
                    "team_name": team_name,
                    "members": stats["members"],
                    "total_score": stats["total_score"],
                    "avg_score": round(stats["total_score"] / max(1, stats["members"]), 2),
                }
                for team_name, stats in by_team.items()
            ],
            key=lambda item: item["total_score"],
            reverse=True,
        )[:3]

        return {
            "session_id": session.id,
            "class_id": session.class_id,
            "status": session.status.value,
            "pin": session.pin,
            "current_question_index": session.current_question_index,
            "active_students": active_students,
            "joined_students": joined_students,
            "responses_total": responses_total,
            "expected_total": expected_total,
            "participation_rate": round(responses_total / expected_total, 3),
            "teams_active": len(by_team),
            "top_teams": top_teams,
            "current_question": self._current_question_metrics(session),
            "dropout_events": int(dropout_events),
            "reconnect_events": int(reconnect_events),
            "assist_cards_count": int(assist_cards_count),
            "updated_at": datetime.now(timezone.utc),
        }

    def session_metrics_event_payload(self, session_id: str) -> dict[str, Any]:
        metrics = self.session_live_metrics(session_id)
        return {
            "status": metrics["status"],
            "current_question_index": metrics["current_question_index"],
            "active_students": metrics["active_students"],
            "joined_students": metrics["joined_students"],
            "responses_total": metrics["responses_total"],
            "participation_rate": metrics["participation_rate"],
            "teams_active": metrics["teams_active"],
            "top_teams": metrics["top_teams"],
            "current_question": metrics["current_question"],
            "dropout_events": metrics["dropout_events"],
            "reconnect_events": metrics["reconnect_events"],
            "assist_cards_count": metrics["assist_cards_count"],
            "updated_at": metrics["updated_at"].isoformat(),
        }

    def participant_live_metrics(self, session_id: str, participant_token: str) -> dict[str, Any]:
        participant = self.db.scalar(
            select(GameParticipant).where(
                GameParticipant.session_id == session_id,
                GameParticipant.participant_token == participant_token,
            )
        )
        session = self.db.scalar(select(GameSession).where(GameSession.id == session_id))
        if not participant or not session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Participant not found")

        answered_count = (
            self.db.scalar(
                select(func.count(Response.id)).where(
                    Response.session_id == session_id,
                    Response.participant_id == participant.id,
                )
            )
            or 0
        )
        total_questions = (
            self.db.scalar(select(func.count(QuizQuestion.id)).where(QuizQuestion.quiz_id == session.quiz_id))
            or 0
        )

        ranked = list(
            self.db.scalars(
                select(GameParticipant)
                .where(GameParticipant.session_id == session_id)
                .order_by(GameParticipant.score.desc(), GameParticipant.joined_at.asc())
            ).all()
        )
        rank = 1
        for idx, row in enumerate(ranked, start=1):
            if row.id == participant.id:
                rank = idx
                break

        return {
            "session_id": session_id,
            "participant_id": participant.id,
            "nickname": participant.nickname,
            "status": session.status.value,
            "is_connected": participant.is_connected,
            "score": participant.score,
            "rank": rank,
            "answered_count": int(answered_count),
            "total_questions": int(total_questions),
            "updated_at": datetime.now(timezone.utc),
        }

    def _current_question_metrics(self, session: GameSession) -> dict[str, Any] | None:
        if session.current_question_index < 0:
            return None

        question = self.db.scalar(
            select(Question)
            .join(QuizQuestion, QuizQuestion.question_id == Question.id)
            .where(
                QuizQuestion.quiz_id == session.quiz_id,
                QuizQuestion.position == session.current_question_index,
            )
        )
        if not question:
            return None

        responses = list(
            self.db.scalars(
                select(Response).where(Response.session_id == session.id, Response.question_id == question.id)
            ).all()
        )
        if not responses:
            return {
                "question_id": question.id,
                "stem": question.stem,
                "responses": 0,
                "correct_count": 0,
                "incorrect_count": 0,
                "incorrect_rate": 0.0,
                "top_wrong_option": None,
                "top_misconception": None,
            }

        correct_count = sum(1 for row in responses if row.is_correct)
        incorrect_rows = [row for row in responses if not row.is_correct]
        incorrect_count = len(incorrect_rows)
        wrong_counter = Counter(row.selected_option_id for row in incorrect_rows)

        top_wrong_option = None
        top_misconception = None
        if wrong_counter:
            top_wrong_option_id, _ = wrong_counter.most_common(1)[0]
            option = self.db.scalar(select(QuestionOption).where(QuestionOption.id == top_wrong_option_id))
            if option:
                top_wrong_option = option.text
                top_misconception = option.misconception_tag

        return {
            "question_id": question.id,
            "stem": question.stem,
            "responses": len(responses),
            "correct_count": correct_count,
            "incorrect_count": incorrect_count,
            "incorrect_rate": round(incorrect_count / max(1, len(responses)), 3),
            "top_wrong_option": top_wrong_option,
            "top_misconception": top_misconception,
        }

    @staticmethod
    def _session_sort_key(item: GameSession) -> float:
        stamp = item.started_at or item.ended_at
        if not stamp:
            return 0.0
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        return stamp.timestamp()
