from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel


class SessionCreate(BaseModel):
    class_id: str
    quiz_id: str


class SessionOut(BaseModel):
    id: str
    class_id: str
    quiz_id: str
    pin: str
    status: Literal["lobby", "active", "paused", "ended"]
    current_question_index: int
    started_at: datetime | None = None
    ended_at: datetime | None = None
    active_count: int


class SessionStateOut(SessionOut):
    participants_count: int
    current_question: dict[str, Any] | None = None


class JoinSessionRequest(BaseModel):
    pin: str
    nickname: str
    team_name: str | None = None


class JoinSessionResponse(BaseModel):
    session_id: str
    participant_id: str
    participant_token: str
    team_name: str | None = None


class SubmitResponseRequest(BaseModel):
    participant_token: str
    option_id: str
    latency_ms: int = 0
    client_response_id: str


class LeaderboardEntry(BaseModel):
    participant_id: str
    nickname: str
    team_name: str | None = None
    score: int


class LeaderboardOut(BaseModel):
    session_id: str
    items: list[LeaderboardEntry]


class TeamLeaderboardEntry(BaseModel):
    team_name: str
    total_score: int
    members: int
    avg_score: float


class TeamLeaderboardOut(BaseModel):
    session_id: str
    items: list[TeamLeaderboardEntry]


class SessionJoinAccessOut(BaseModel):
    session_id: str
    pin: str
    join_url: str
    qr_data_uri: str | None = None
    qr_image_url: str | None = None


class SessionReportOut(BaseModel):
    summary: dict[str, Any]
    groups: list[dict[str, Any]]
    recommendations: dict[str, Any]
    remediation_pack: dict[str, Any]
