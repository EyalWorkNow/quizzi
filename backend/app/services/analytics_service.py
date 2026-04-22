from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    Diagnostic,
    GameEvent,
    GameParticipant,
    GameSession,
    Question,
    QuestionTag,
    QuizQuestion,
    Response,
    Skill,
    TagType,
)


class AnalyticsService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def session_insights(self, session_id: str) -> dict[str, Any]:
        session = self.db.scalar(select(GameSession).where(GameSession.id == session_id))
        if not session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

        responses = list(
            self.db.scalars(
                select(Response).where(Response.session_id == session_id).order_by(Response.created_at.asc())
            ).all()
        )
        participants = {
            row.id: row
            for row in self.db.scalars(select(GameParticipant).where(GameParticipant.session_id == session_id)).all()
        }
        diagnostics = list(self.db.scalars(select(Diagnostic).where(Diagnostic.session_id == session_id)).all())
        events = list(self.db.scalars(select(GameEvent).where(GameEvent.session_id == session_id).order_by(GameEvent.seq.asc())).all())

        question_positions = {
            row.question_id: row.position
            for row in self.db.scalars(select(QuizQuestion).where(QuizQuestion.quiz_id == session.quiz_id)).all()
        }
        question_ids = list(question_positions.keys())
        questions = {
            row.id: row
            for row in self.db.scalars(select(Question).where(Question.id.in_(question_ids) if question_ids else False)).all()
        }

        skill_tags = list(
            self.db.scalars(
                select(QuestionTag).where(
                    QuestionTag.question_id.in_(question_ids) if question_ids else False,
                    QuestionTag.tag_type == TagType.skill,
                )
            ).all()
        )
        question_skill = {row.question_id: row.tag_value for row in skill_tags}
        skill_ids = list(set(question_skill.values()))
        skills = {
            row.id: row.name
            for row in self.db.scalars(select(Skill).where(Skill.id.in_(skill_ids) if skill_ids else False)).all()
        }

        timeline = self._question_timeline(responses, question_positions, question_skill, skills)
        skill_deltas = self._skill_deltas(diagnostics, skills)
        latency = self._latency_analysis(responses)
        at_risk = self._at_risk_students(responses, participants)
        assist = self._assist_effectiveness(events, timeline, question_skill, skills, question_positions)
        team_insights = self._team_insights(responses, participants)
        recommendations = self._recommendations(skill_deltas, at_risk, assist, team_insights)

        return {
            "session_id": session_id,
            "question_timeline": timeline,
            "skill_deltas": skill_deltas,
            "latency_analysis": latency,
            "at_risk_students": at_risk,
            "assist_effectiveness": assist,
            "team_insights": team_insights,
            "recommendations": recommendations,
        }

    def _question_timeline(
        self,
        responses: list[Response],
        question_positions: dict[str, int],
        question_skill: dict[str, str],
        skills: dict[str, str],
    ) -> list[dict[str, Any]]:
        by_question: dict[str, list[Response]] = defaultdict(list)
        for row in responses:
            by_question[row.question_id].append(row)

        rows = []
        for question_id, items in by_question.items():
            correct = sum(1 for row in items if row.is_correct)
            incorrect = len(items) - correct
            rows.append(
                {
                    "question_id": question_id,
                    "position": question_positions.get(question_id, -1),
                    "skill_id": question_skill.get(question_id),
                    "skill_name": skills.get(question_skill.get(question_id, ""), question_skill.get(question_id)),
                    "responses": len(items),
                    "correct_rate": round(correct / max(1, len(items)), 3),
                    "incorrect_rate": round(incorrect / max(1, len(items)), 3),
                    "avg_latency_ms": int(sum(row.latency_ms for row in items) / max(1, len(items))),
                }
            )
        rows.sort(key=lambda row: row["position"])
        return rows

    def _skill_deltas(self, diagnostics: list[Diagnostic], skills: dict[str, str]) -> list[dict[str, Any]]:
        grouped: dict[str, list[float]] = defaultdict(list)
        for row in diagnostics:
            grouped[row.skill_id].append(row.mastery_after - row.mastery_before)

        rows = []
        for skill_id, deltas in grouped.items():
            avg_delta = sum(deltas) / max(1, len(deltas))
            rows.append(
                {
                    "skill_id": skill_id,
                    "skill_name": skills.get(skill_id, skill_id),
                    "avg_delta": round(avg_delta, 3),
                    "improved_students": len([value for value in deltas if value > 0]),
                    "declined_students": len([value for value in deltas if value < 0]),
                }
            )
        rows.sort(key=lambda row: row["avg_delta"])
        return rows

    def _latency_analysis(self, responses: list[Response]) -> dict[str, Any]:
        latencies = sorted([max(0, row.latency_ms) for row in responses])
        correct = [row.latency_ms for row in responses if row.is_correct]
        incorrect = [row.latency_ms for row in responses if not row.is_correct]
        return {
            "p50_ms": self._percentile(latencies, 0.5),
            "p90_ms": self._percentile(latencies, 0.9),
            "avg_correct_ms": int(sum(correct) / max(1, len(correct))) if correct else 0,
            "avg_incorrect_ms": int(sum(incorrect) / max(1, len(incorrect))) if incorrect else 0,
            "samples": len(latencies),
        }

    def _at_risk_students(
        self,
        responses: list[Response],
        participants: dict[str, GameParticipant],
    ) -> list[dict[str, Any]]:
        by_participant: dict[str, list[Response]] = defaultdict(list)
        for row in responses:
            by_participant[row.participant_id].append(row)

        rows = []
        max_answers = max([len(items) for items in by_participant.values()] + [1])
        for participant_id, participant in participants.items():
            items = by_participant.get(participant_id, [])
            correct_rate = sum(1 for row in items if row.is_correct) / max(1, len(items))
            participation_rate = len(items) / max_answers
            risk_score = 0.0
            if correct_rate < 0.45:
                risk_score += 0.5
            if participation_rate < 0.6:
                risk_score += 0.3
            if participant.score < 200:
                risk_score += 0.2
            if risk_score < 0.5:
                continue

            rows.append(
                {
                    "participant_id": participant_id,
                    "nickname": participant.nickname,
                    "team_name": participant.team_name,
                    "correct_rate": round(correct_rate, 3),
                    "participation_rate": round(participation_rate, 3),
                    "risk_score": round(risk_score, 3),
                    "recommended_action": "Assign targeted remediation pack and run one guided re-check question.",
                }
            )
        rows.sort(key=lambda row: row["risk_score"], reverse=True)
        return rows[:8]

    def _assist_effectiveness(
        self,
        events: list[GameEvent],
        timeline: list[dict[str, Any]],
        question_skill: dict[str, str],
        skills: dict[str, str],
        question_positions: dict[str, int],
    ) -> list[dict[str, Any]]:
        timeline_by_question = {row["question_id"]: row for row in timeline}
        by_skill_positions: dict[str, list[tuple[int, str]]] = defaultdict(list)
        for question_id, skill_id in question_skill.items():
            by_skill_positions[skill_id].append((question_positions.get(question_id, -1), question_id))
        for skill_id in by_skill_positions:
            by_skill_positions[skill_id].sort(key=lambda item: item[0])

        rows = []
        for event in events:
            if event.event_type != "assist_card":
                continue
            payload = event.payload_json or {}
            question_id = payload.get("question_id")
            skill_id = payload.get("skill_id")
            if not question_id or not skill_id:
                continue
            baseline = timeline_by_question.get(question_id)
            if not baseline:
                continue

            follow_up_id = None
            current_pos = question_positions.get(question_id, -1)
            for pos, qid in by_skill_positions.get(skill_id, []):
                if pos > current_pos:
                    follow_up_id = qid
                    break
            follow_up = timeline_by_question.get(follow_up_id) if follow_up_id else None
            delta = None
            if follow_up:
                delta = round(float(follow_up["correct_rate"]) - float(baseline["correct_rate"]), 3)

            rows.append(
                {
                    "assist_seq": event.seq,
                    "skill_id": skill_id,
                    "skill_name": skills.get(skill_id, skill_id),
                    "question_id": question_id,
                    "baseline_correct_rate": baseline["correct_rate"],
                    "follow_up_question_id": follow_up_id,
                    "follow_up_correct_rate": follow_up["correct_rate"] if follow_up else None,
                    "effect_delta": delta,
                }
            )
        return rows

    def _team_insights(
        self,
        responses: list[Response],
        participants: dict[str, GameParticipant],
    ) -> list[dict[str, Any]]:
        by_team_responses: dict[str, list[Response]] = defaultdict(list)
        by_team_scores: dict[str, list[int]] = defaultdict(list)
        for participant in participants.values():
            if participant.team_name:
                by_team_scores[participant.team_name].append(participant.score)
        for row in responses:
            participant = participants.get(row.participant_id)
            if participant and participant.team_name:
                by_team_responses[participant.team_name].append(row)

        rows = []
        for team_name, team_rows in by_team_responses.items():
            correct = sum(1 for row in team_rows if row.is_correct)
            misconceptions = Counter()
            for row in team_rows:
                if not row.is_correct:
                    misconceptions["incorrect_cluster"] += 1
            scores = by_team_scores.get(team_name, [])
            rows.append(
                {
                    "team_name": team_name,
                    "members": len(scores),
                    "total_score": sum(scores),
                    "avg_score": round(sum(scores) / max(1, len(scores)), 2),
                    "correct_rate": round(correct / max(1, len(team_rows)), 3),
                    "dominant_issue": misconceptions.most_common(1)[0][0] if misconceptions else None,
                }
            )
        rows.sort(key=lambda row: row["total_score"], reverse=True)
        return rows

    def _recommendations(
        self,
        skill_deltas: list[dict[str, Any]],
        at_risk: list[dict[str, Any]],
        assist: list[dict[str, Any]],
        team_insights: list[dict[str, Any]],
    ) -> list[str]:
        recommendations: list[str] = []
        if skill_deltas:
            weakest = skill_deltas[0]
            recommendations.append(
                f"Re-teach {weakest['skill_name']} first: mastery delta is {weakest['avg_delta']} in this session."
            )
        if at_risk:
            recommendations.append(
                f"Run a 7-minute support station for {len(at_risk)} at-risk students with one guided worked example."
            )
        weak_teams = [row for row in team_insights if row["correct_rate"] < 0.5]
        if weak_teams:
            recommendations.append(
                f"Group intervention: {', '.join(row['team_name'] for row in weak_teams[:2])} need misconception-focused follow-up."
            )
        weak_assists = [row for row in assist if row.get("effect_delta") is not None and row["effect_delta"] < 0]
        if weak_assists:
            recommendations.append(
                "At least one assist did not improve follow-up correctness; switch to worked-example plus peer explanation."
            )
        if not recommendations:
            recommendations.append("Session is stable; assign remediation pack as homework and advance to the next skill.")
        return recommendations

    @staticmethod
    def _percentile(values: list[int], q: float) -> int:
        if not values:
            return 0
        idx = int((len(values) - 1) * q)
        return int(values[idx])
