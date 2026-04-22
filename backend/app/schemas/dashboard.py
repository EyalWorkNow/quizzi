from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class WeakSkillOut(BaseModel):
    skill_id: str
    skill_name: str
    avg_mastery: float
    samples: int


class RecentSessionOut(BaseModel):
    session_id: str
    status: Literal["lobby", "active", "paused", "ended"]
    started_at: datetime | None = None
    ended_at: datetime | None = None


class ClassDashboardOut(BaseModel):
    id: str
    name: str
    grade_level: str
    join_code: str
    students_count: int
    total_sessions: int
    active_sessions: int
    weak_skills: list[WeakSkillOut]
    recent_sessions: list[RecentSessionOut]


class DashboardTotalsOut(BaseModel):
    classes: int
    students: int
    sessions: int
    active_sessions: int
    candidate_questions: int


class DashboardOverviewOut(BaseModel):
    teacher_id: str
    totals: DashboardTotalsOut
    classes: list[ClassDashboardOut]
    generated_at: datetime


class CurrentQuestionMetricsOut(BaseModel):
    question_id: str
    stem: str
    responses: int
    correct_count: int
    incorrect_count: int
    incorrect_rate: float
    top_wrong_option: str | None = None
    top_misconception: str | None = None


class SessionLiveMetricsOut(BaseModel):
    session_id: str
    class_id: str
    status: Literal["lobby", "active", "paused", "ended"]
    pin: str
    current_question_index: int
    active_students: int
    joined_students: int
    responses_total: int
    expected_total: int
    participation_rate: float
    teams_active: int
    top_teams: list[dict]
    current_question: CurrentQuestionMetricsOut | None = None
    dropout_events: int
    reconnect_events: int
    assist_cards_count: int
    updated_at: datetime


class StudentLiveMetricsOut(BaseModel):
    session_id: str
    participant_id: str
    nickname: str
    status: Literal["lobby", "active", "paused", "ended"]
    is_connected: bool
    score: int
    rank: int
    answered_count: int
    total_questions: int
    updated_at: datetime
