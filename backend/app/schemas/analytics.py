from typing import Any

from pydantic import BaseModel


class SessionInsightsOut(BaseModel):
    session_id: str
    question_timeline: list[dict[str, Any]]
    skill_deltas: list[dict[str, Any]]
    latency_analysis: dict[str, Any]
    at_risk_students: list[dict[str, Any]]
    assist_effectiveness: list[dict[str, Any]]
    team_insights: list[dict[str, Any]]
    recommendations: list[str]
