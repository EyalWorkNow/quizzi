from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy import and_, desc, func, select
from sqlalchemy.orm import Session

from app.db.models import (
    ActionPlan,
    Diagnostic,
    GameEvent,
    GameParticipant,
    GameSession,
    Passport,
    Question,
    QuestionOption,
    QuestionTag,
    QuizQuestion,
    RemediationPack,
    Response,
    Skill,
    TagType,
)
from app.services.grouping_service import GroupingService
from app.services.remediation_service import RemediationService


@dataclass
class DecisionOutputs:
    summary: dict
    groups: list[dict]
    recommendations: dict
    remediation_pack: dict


class MasteryUpdater:
    WEIGHTS = {"easy": 0.06, "medium": 0.10, "hard": 0.14}

    def apply(self, previous_mastery: float, difficulty: str, is_correct: bool) -> float:
        weight = self.WEIGHTS.get(difficulty, 0.10)
        delta = weight * (1 - previous_mastery) if is_correct else -weight * previous_mastery
        return max(0.0, min(1.0, previous_mastery + delta))


class DiagnosticsService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.mastery = MasteryUpdater()
        self.grouping = GroupingService()
        self.remediation = RemediationService(db)

    def compute_session_outputs(self, session_id: str) -> DecisionOutputs:
        session = self.db.scalar(select(GameSession).where(GameSession.id == session_id))
        if not session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

        existing_plan = self.db.scalar(select(ActionPlan).where(ActionPlan.session_id == session_id))
        if existing_plan:
            return self._build_existing_output(existing_plan)

        responses = list(
            self.db.scalars(
                select(Response).where(Response.session_id == session_id).order_by(Response.created_at.asc())
            ).all()
        )
        participants = {
            p.id: p
            for p in self.db.scalars(select(GameParticipant).where(GameParticipant.session_id == session_id)).all()
        }
        question_ids = list({r.question_id for r in responses})
        questions = {
            q.id: q for q in self.db.scalars(select(Question).where(Question.id.in_(question_ids) if question_ids else False)).all()
        }

        skill_tags = list(
            self.db.scalars(
                select(QuestionTag).where(
                    QuestionTag.question_id.in_(question_ids) if question_ids else False,
                    QuestionTag.tag_type == TagType.skill,
                )
            ).all()
        )
        skill_by_question = {tag.question_id: tag.tag_value for tag in skill_tags}

        skill_ids = list({skill_id for skill_id in skill_by_question.values()})
        skill_rows = list(self.db.scalars(select(Skill).where(Skill.id.in_(skill_ids) if skill_ids else False)).all())
        skill_lookup = {
            skill.id: {"id": skill.id, "name": skill.name, "parent_skill_id": skill.parent_skill_id}
            for skill in skill_rows
        }

        student_skill_mastery: dict[str, dict[str, float]] = defaultdict(dict)
        raw_progress: dict[tuple[str, str], list[tuple[str, bool, str | None]]] = defaultdict(list)

        option_map = {
            o.id: o
            for o in self.db.scalars(
                select(QuestionOption).where(QuestionOption.id.in_([r.selected_option_id for r in responses]) if responses else False)
            ).all()
        }

        skill_evidence = self._build_skill_evidence(
            responses=responses,
            skill_by_question=skill_by_question,
            option_map=option_map,
            skill_lookup=skill_lookup,
        )

        for response in responses:
            participant = participants.get(response.participant_id)
            if not participant or not participant.student_id:
                continue
            skill_id = skill_by_question.get(response.question_id)
            question = questions.get(response.question_id)
            if not skill_id or not question:
                continue

            misconception = None
            if not response.is_correct:
                selected = option_map.get(response.selected_option_id)
                misconception = selected.misconception_tag if selected else None

            raw_progress[(participant.student_id, skill_id)].append(
                (question.difficulty.value, response.is_correct, misconception)
            )

        used_question_ids = set(question_ids)
        diagnostics_rows: list[Diagnostic] = []
        passports_rows: list[Passport] = []

        for (student_id, skill_id), attempts in raw_progress.items():
            previous_mastery = self._latest_mastery(student_id, skill_id)
            mastery_before = previous_mastery
            correct_count = 0
            incorrect_count = 0
            misconception_counter: Counter[str] = Counter()

            for difficulty, is_correct, misconception in attempts:
                previous_mastery = self.mastery.apply(previous_mastery, difficulty, is_correct)
                if is_correct:
                    correct_count += 1
                else:
                    incorrect_count += 1
                    if misconception:
                        misconception_counter[misconception] += 1

            top_misconception = misconception_counter.most_common(1)[0][0] if misconception_counter else None
            student_skill_mastery[student_id][skill_id] = previous_mastery

            diagnostics_rows.append(
                Diagnostic(
                    session_id=session_id,
                    class_id=session.class_id,
                    student_id=student_id,
                    skill_id=skill_id,
                    mastery_before=mastery_before,
                    mastery_after=previous_mastery,
                    correct_count=correct_count,
                    incorrect_count=incorrect_count,
                    top_misconception=top_misconception,
                )
            )

            passports_rows.append(
                Passport(
                    class_id=session.class_id,
                    student_id=student_id,
                    skill_id=skill_id,
                    session_id=session_id,
                    mastery_value=previous_mastery,
                    recent_misconception=top_misconception,
                    recommended_practice_json={
                        "focus_skill": skill_lookup.get(skill_id, {}).get("name", skill_id),
                        "suggestion": "Complete a short 5-question practice set and discuss one worked example.",
                    },
                )
            )

        for row in diagnostics_rows + passports_rows:
            self.db.add(row)

        class_skill_scores: dict[str, list[float]] = defaultdict(list)
        for student_scores in student_skill_mastery.values():
            for skill_id, mastery in student_scores.items():
                class_skill_scores[skill_id].append(mastery)

        skill_summary = [
            {
                "skill_id": skill_id,
                "skill_name": skill_lookup.get(skill_id, {}).get("name", skill_id),
                "avg_mastery": round(sum(scores) / len(scores), 3),
                "student_count": len(scores),
            }
            for skill_id, scores in class_skill_scores.items()
            if scores
        ]
        skill_summary.sort(key=lambda item: item["avg_mastery"])
        top_weak = skill_summary[:3]
        weak_skill_ids = [item["skill_id"] for item in top_weak]

        groups = self.grouping.create_groups(student_skill_mastery, skill_lookup)
        summary = {
            "top_weak_skills": top_weak,
            "class_distribution": self._distribution(student_skill_mastery),
            "skill_evidence": skill_evidence,
        }
        recommendations = {
            "teacher_next_steps": self._teacher_next_steps(top_weak, skill_evidence),
            "explainability": "Recommendations are based on per-skill error rates and misconception clusters from live responses.",
        }

        action_plan = ActionPlan(
            session_id=session_id,
            class_id=session.class_id,
            summary_json=summary,
            groups_json=groups,
            recommendations_json=recommendations,
        )
        self.db.add(action_plan)
        self.db.flush()

        remediation_pack = self.remediation.create_pack(
            action_plan=action_plan,
            class_id=session.class_id,
            weak_skill_ids=weak_skill_ids,
            used_question_ids=used_question_ids,
        )

        self.db.commit()
        return DecisionOutputs(
            summary=summary,
            groups=groups,
            recommendations=recommendations,
            remediation_pack=remediation_pack,
        )

    def get_session_diagnostics(self, session_id: str) -> dict:
        session = self.db.scalar(select(GameSession).where(GameSession.id == session_id))
        if not session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

        diagnostics = list(self.db.scalars(select(Diagnostic).where(Diagnostic.session_id == session_id)).all())
        skill_mastery = self._skill_mastery_table(diagnostics)

        misconception_heatmap = self._misconception_heatmap(session_id)
        question_quality = self._question_quality(session_id)
        engagement = self._engagement(session_id, session.quiz_id)

        return {
            "session_id": session_id,
            "skill_mastery": skill_mastery,
            "misconception_heatmap": misconception_heatmap,
            "question_quality": question_quality,
            "engagement": engagement,
        }

    def _latest_mastery(self, student_id: str, skill_id: str) -> float:
        latest = self.db.scalar(
            select(Passport)
            .where(Passport.student_id == student_id, Passport.skill_id == skill_id)
            .order_by(desc(Passport.created_at))
            .limit(1)
        )
        return latest.mastery_value if latest else 0.5

    def _distribution(self, student_skill_mastery: dict[str, dict[str, float]]) -> dict:
        all_values = [value for per_skill in student_skill_mastery.values() for value in per_skill.values()]
        below = len([v for v in all_values if v < 0.4])
        mid = len([v for v in all_values if 0.4 <= v < 0.7])
        high = len([v for v in all_values if v >= 0.7])
        return {"below_0_4": below, "between_0_4_0_7": mid, "above_0_7": high, "samples": len(all_values)}

    def _build_skill_evidence(
        self,
        responses: list[Response],
        skill_by_question: dict[str, str],
        option_map: dict[str, QuestionOption],
        skill_lookup: dict[str, dict],
    ) -> list[dict]:
        by_question: dict[str, list[Response]] = defaultdict(list)
        for response in responses:
            by_question[response.question_id].append(response)

        by_skill: dict[str, list[dict]] = defaultdict(list)
        for question_id, items in by_question.items():
            skill_id = skill_by_question.get(question_id)
            if not skill_id:
                continue
            incorrect = [item for item in items if not item.is_correct]
            if not items:
                continue
            incorrect_rate = len(incorrect) / len(items)
            wrong_counter = Counter(item.selected_option_id for item in incorrect)
            top_wrong_option_text = None
            top_misconception = None
            if wrong_counter:
                top_wrong_option_id, _ = wrong_counter.most_common(1)[0]
                top_option = option_map.get(top_wrong_option_id)
                if top_option:
                    top_wrong_option_text = top_option.text
                    top_misconception = top_option.misconception_tag

            by_skill[skill_id].append(
                {
                    "question_id": question_id,
                    "incorrect_rate": round(incorrect_rate, 3),
                    "response_count": len(items),
                    "top_wrong_option": top_wrong_option_text,
                    "misconception_tag": top_misconception,
                }
            )

        rows: list[dict] = []
        for skill_id, evidence in by_skill.items():
            evidence.sort(key=lambda item: item["incorrect_rate"], reverse=True)
            rows.append(
                {
                    "skill_id": skill_id,
                    "skill_name": skill_lookup.get(skill_id, {}).get("name", skill_id),
                    "evidence": evidence[:3],
                }
            )
        rows.sort(key=lambda item: max((e["incorrect_rate"] for e in item["evidence"]), default=0), reverse=True)
        return rows

    def _teacher_next_steps(self, top_weak: list[dict], skill_evidence: list[dict]) -> list[dict]:
        evidence_map = {item["skill_id"]: item["evidence"] for item in skill_evidence}
        steps: list[dict] = []
        for weak in top_weak:
            skill_id = weak["skill_id"]
            evidence = evidence_map.get(skill_id, [])
            primary = evidence[0] if evidence else {}
            wrong_option = primary.get("top_wrong_option", "a recurring distractor")
            misconception = primary.get("misconception_tag", "concept confusion")
            steps.append(
                {
                    "skill_id": skill_id,
                    "skill_name": weak["skill_name"],
                    "why_now": (
                        f"{weak['skill_name']} is among the weakest skills with avg mastery {weak['avg_mastery']}."
                    ),
                    "script": (
                        "Pause 60-90 seconds: restate the core rule, contrast it with the common mistake, "
                        "then ask one follow-up check question before continuing."
                    ),
                    "focus_error": wrong_option,
                    "misconception_tag": misconception,
                    "evidence": evidence,
                }
            )
        return steps

    def _skill_mastery_table(self, diagnostics: list[Diagnostic]) -> list[dict]:
        grouped: dict[str, list[float]] = defaultdict(list)
        for row in diagnostics:
            grouped[row.skill_id].append(row.mastery_after)

        result = []
        for skill_id, scores in grouped.items():
            result.append(
                {
                    "skill_id": skill_id,
                    "avg_mastery": round(sum(scores) / len(scores), 3),
                    "samples": len(scores),
                }
            )
        result.sort(key=lambda item: item["avg_mastery"])
        return result

    def _misconception_heatmap(self, session_id: str) -> list[dict]:
        stmt = (
            select(QuestionTag.tag_value, QuestionOption.misconception_tag, func.count(Response.id))
            .join(QuestionOption, QuestionOption.id == Response.selected_option_id)
            .join(QuestionTag, and_(QuestionTag.question_id == Response.question_id, QuestionTag.tag_type == TagType.skill))
            .where(Response.session_id == session_id, Response.is_correct.is_(False))
            .group_by(QuestionTag.tag_value, QuestionOption.misconception_tag)
        )
        rows = self.db.execute(stmt).all()
        return [
            {"skill_id": skill_id, "misconception_tag": misconception, "count": count}
            for skill_id, misconception, count in rows
        ]

    def _question_quality(self, session_id: str) -> list[dict]:
        responses = list(self.db.scalars(select(Response).where(Response.session_id == session_id)).all())
        if not responses:
            return []

        participant_scores = {
            p.id: p.score
            for p in self.db.scalars(select(GameParticipant).where(GameParticipant.session_id == session_id)).all()
        }
        ordered = sorted(participant_scores.items(), key=lambda item: item[1], reverse=True)
        quartile = max(1, len(ordered) // 4)
        top_ids = {pid for pid, _ in ordered[:quartile]}
        bottom_ids = {pid for pid, _ in ordered[-quartile:]}

        by_question: dict[str, list[Response]] = defaultdict(list)
        for response in responses:
            by_question[response.question_id].append(response)

        quality_rows = []
        for question_id, items in by_question.items():
            pct_correct = sum(1 for i in items if i.is_correct) / len(items)
            top = [i for i in items if i.participant_id in top_ids]
            bottom = [i for i in items if i.participant_id in bottom_ids]
            top_pct = sum(1 for i in top if i.is_correct) / len(top) if top else 0.0
            bottom_pct = sum(1 for i in bottom if i.is_correct) / len(bottom) if bottom else 0.0
            discrimination = top_pct - bottom_pct

            wrong_counts = Counter(i.selected_option_id for i in items if not i.is_correct)
            tie_gap = 1.0
            if len(wrong_counts) >= 2:
                common = wrong_counts.most_common(2)
                tie_gap = (common[0][1] - common[1][1]) / max(1, len(items))

            quality_rows.append(
                {
                    "question_id": question_id,
                    "pct_correct": round(pct_correct, 3),
                    "difficulty_index": round(1 - pct_correct, 3),
                    "discrimination": round(discrimination, 3),
                    "ambiguous": discrimination < 0.15 or tie_gap < 0.05,
                }
            )

        return quality_rows

    def _engagement(self, session_id: str, quiz_id: str) -> dict:
        participant_count = self.db.scalar(
            select(func.count(GameParticipant.id)).where(GameParticipant.session_id == session_id)
        ) or 0
        response_count = self.db.scalar(select(func.count(Response.id)).where(Response.session_id == session_id)) or 0

        question_count = self.db.scalar(
            select(func.count(QuizQuestion.id)).where(QuizQuestion.quiz_id == quiz_id)
        ) or 0
        expected = max(1, participant_count * max(1, question_count))
        events = list(self.db.scalars(select(GameEvent).where(GameEvent.session_id == session_id)).all())

        dropouts = sum(1 for event in events if event.event_type == "participant_disconnected")
        reconnects = sum(1 for event in events if event.event_type == "participant_reconnected")

        return {
            "participation_rate": round(response_count / expected, 3),
            "dropout_events": dropouts,
            "reconnect_events": reconnects,
            "participants": participant_count,
            "responses": response_count,
        }

    def _build_existing_output(self, action_plan: ActionPlan) -> DecisionOutputs:
        pack = self.db.scalar(
            select(RemediationPack).where(RemediationPack.action_plan_id == action_plan.id)
        )
        remediation_pack = self.remediation.serialize_pack(pack.id) if pack else {"pack_id": None, "title": "", "items": []}
        return DecisionOutputs(
            summary=action_plan.summary_json,
            groups=action_plan.groups_json,
            recommendations=action_plan.recommendations_json,
            remediation_pack=remediation_pack,
        )
