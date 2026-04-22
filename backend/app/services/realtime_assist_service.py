from collections import Counter
from math import ceil

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import QuestionOption, QuestionTag, TagType
from app.repositories.session_repo import SessionRepository


class RealtimeAssistService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repo = SessionRepository(db)

    def evaluate_question(self, session_id: str, question_id: str, active_students: int) -> dict | None:
        responses = self.repo.list_responses_for_question(session_id, question_id)
        if not responses:
            return None

        response_count = len(responses)
        if response_count < max(5, ceil(active_students * 0.6)):
            return None

        incorrect = [response for response in responses if not response.is_correct]
        incorrect_rate = len(incorrect) / max(1, response_count)
        if incorrect_rate <= 0.35:
            return None

        top_wrong = None
        misconception = None
        if incorrect:
            wrong_counter = Counter(response.selected_option_id for response in incorrect)
            top_option_id, _ = wrong_counter.most_common(1)[0]
            top_option = self.db.scalar(select(QuestionOption).where(QuestionOption.id == top_option_id))
            top_wrong = top_option.text if top_option else None
            misconception = top_option.misconception_tag if top_option else None

        skill_tag = self.db.scalar(
            select(QuestionTag).where(QuestionTag.question_id == question_id, QuestionTag.tag_type == TagType.skill)
        )
        skill_id = skill_tag.tag_value if skill_tag else None

        return {
            "session_id": session_id,
            "question_id": question_id,
            "skill_id": skill_id,
            "incorrect_rate": round(incorrect_rate, 3),
            "response_count": response_count,
            "top_wrong_option": top_wrong,
            "misconception_tag": misconception,
            "script": (
                "Pause for 60-90 seconds. Reframe the core idea with one counter-example, "
                "then run a single follow-up check question before resuming."
            ),
        }
