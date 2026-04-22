import uuid

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app.db.models import GameEvent


def auth_headers(client):
    email = f"teacher_{uuid.uuid4().hex[:6]}@example.com"
    password = "Password123!"
    res = client.post("/api/v1/auth/signup", json={"email": email, "password": password})
    assert res.status_code == 200
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def setup_quiz(client, headers):
    class_res = client.post("/api/v1/classes", json={"name": "Class Dashboard", "grade_level": "7"}, headers=headers)
    class_id = class_res.json()["id"]

    skill_res = client.post(
        "/api/v1/skills",
        json={"class_id": class_id, "name": "Decimals", "description": "desc", "grade_level": "7"},
        headers=headers,
    )
    skill_id = skill_res.json()["id"]

    source_res = client.post(
        "/api/v1/content/sources",
        json={
            "class_id": class_id,
            "title": "Curriculum",
            "source_type": "text",
            "raw_content": (
                "Decimals represent parts of ten and hundred. "
                "Equivalent decimals can be compared by place value. "
                "Rounding requires checking the next digit. "
                "Students often align digits incorrectly when adding decimals."
            ),
        },
        headers=headers,
    )
    source_id = source_res.json()["id"]

    client.post(
        f"/api/v1/content/sources/{source_id}/generate-candidates",
        json={"skill_ids": [skill_id], "count": 8},
        headers=headers,
    )
    candidates = client.get(f"/api/v1/questions/candidates?class_id={class_id}", headers=headers).json()

    approved = []
    for row in candidates[:5]:
        client.post(f"/api/v1/questions/{row['id']}/approve", headers=headers)
        approved.append(row["id"])

    quiz = client.post(
        "/api/v1/quizzes",
        json={"class_id": class_id, "title": "Decimals quiz", "question_ids": approved},
        headers=headers,
    )
    return class_id, quiz.json()["id"]


def test_dashboard_overview_and_live_metrics(client):
    headers = auth_headers(client)
    class_id, quiz_id = setup_quiz(client, headers)

    session = client.post("/api/v1/sessions", json={"class_id": class_id, "quiz_id": quiz_id}, headers=headers).json()
    session_id = session["id"]
    pin = session["pin"]

    participants = []
    for idx in range(6):
        joined = client.post("/api/v1/sessions/join", json={"pin": pin, "nickname": f"S{idx+1}"})
        participants.append(joined.json())

    first_question = client.post(f"/api/v1/sessions/{session_id}/next", headers=headers)
    assert first_question.status_code == 200
    options = first_question.json()["options"]
    correct = options[0]["id"]
    wrong = options[1]["id"] if len(options) > 1 else correct

    for idx, participant in enumerate(participants):
        chosen = wrong if idx < 3 else correct
        resp = client.post(
            f"/api/v1/sessions/{session_id}/responses",
            json={
                "participant_token": participant["participant_token"],
                "option_id": chosen,
                "latency_ms": 700,
                "client_response_id": uuid.uuid4().hex,
            },
        )
        assert resp.status_code == 200

    student_live = client.get(
        f"/api/v1/dashboard/sessions/{session_id}/me",
        params={"participant_token": participants[0]["participant_token"]},
    )
    assert student_live.status_code == 200
    student_payload = student_live.json()
    assert student_payload["answered_count"] >= 1
    assert student_payload["rank"] >= 1

    overview = client.get("/api/v1/dashboard/overview", headers=headers)
    assert overview.status_code == 200
    overview_payload = overview.json()
    assert overview_payload["totals"]["classes"] >= 1
    assert overview_payload["classes"][0]["students_count"] >= 6

    live = client.get(f"/api/v1/dashboard/sessions/{session_id}/live", headers=headers)
    assert live.status_code == 200
    live_payload = live.json()
    assert live_payload["joined_students"] == 6
    assert live_payload["active_students"] == 6
    assert live_payload["current_question"]["responses"] == 6
    assert live_payload["current_question"]["incorrect_count"] >= 3

    engine = create_engine("sqlite:///./test_quizzy.db", connect_args={"check_same_thread": False})
    testing_session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    db = testing_session()
    try:
        metrics_events = db.scalar(
            select(func.count(GameEvent.id)).where(
                GameEvent.session_id == session_id,
                GameEvent.event_type == "dashboard_metrics",
            )
        )
    finally:
        db.close()

    assert (metrics_events or 0) >= 3
