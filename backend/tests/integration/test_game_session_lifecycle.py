import uuid


def auth_headers(client):
    email = f"teacher_{uuid.uuid4().hex[:6]}@example.com"
    password = "Password123!"
    res = client.post("/api/v1/auth/signup", json={"email": email, "password": password})
    assert res.status_code == 200
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def bootstrap_quiz(client, headers):
    class_res = client.post("/api/v1/classes", json={"name": "Class A", "grade_level": "6"}, headers=headers)
    assert class_res.status_code == 200
    class_id = class_res.json()["id"]

    skill_res = client.post(
        "/api/v1/skills",
        json={"class_id": class_id, "name": "Fractions", "description": "desc", "grade_level": "6"},
        headers=headers,
    )
    assert skill_res.status_code == 200
    skill_id = skill_res.json()["id"]

    source_res = client.post(
        "/api/v1/content/sources",
        json={
            "class_id": class_id,
            "title": "Curriculum",
            "source_type": "text",
            "raw_content": "Fractions represent equal parts. Equivalent fractions have same value.",
        },
        headers=headers,
    )
    assert source_res.status_code == 200
    source_id = source_res.json()["id"]

    gen_res = client.post(
        f"/api/v1/content/sources/{source_id}/generate-candidates",
        json={"skill_ids": [skill_id], "count": 6},
        headers=headers,
    )
    assert gen_res.status_code == 200

    candidates = client.get(f"/api/v1/questions/candidates?class_id={class_id}", headers=headers)
    assert candidates.status_code == 200
    rows = candidates.json()
    assert rows

    approved = []
    for row in rows[:4]:
        ok = client.post(f"/api/v1/questions/{row['id']}/approve", headers=headers)
        assert ok.status_code == 200
        approved.append(row["id"])

    quiz = client.post(
        "/api/v1/quizzes",
        json={"class_id": class_id, "title": "Quiz", "question_ids": approved},
        headers=headers,
    )
    assert quiz.status_code == 200
    return class_id, quiz.json()["id"]


def test_game_session_lifecycle(client):
    headers = auth_headers(client)
    class_id, quiz_id = bootstrap_quiz(client, headers)

    session = client.post("/api/v1/sessions", json={"class_id": class_id, "quiz_id": quiz_id}, headers=headers)
    assert session.status_code == 200
    session_id = session.json()["id"]
    pin = session.json()["pin"]

    join = client.post("/api/v1/sessions/join", json={"pin": pin, "nickname": "S1"})
    assert join.status_code == 200
    first_join = join.json()
    participant_token = first_join["participant_token"]

    # Re-join with same nickname should reuse participant identity (reconnect-safe).
    rejoin = client.post("/api/v1/sessions/join", json={"pin": pin, "nickname": "S1"})
    assert rejoin.status_code == 200
    second_join = rejoin.json()
    assert second_join["participant_id"] == first_join["participant_id"]
    assert second_join["participant_token"] == first_join["participant_token"]

    state = client.get(f"/api/v1/sessions/{session_id}", headers=headers)
    assert state.status_code == 200
    assert state.json()["participants_count"] == 1
    assert state.json()["active_count"] == 1

    next_question = client.post(f"/api/v1/sessions/{session_id}/next", headers=headers)
    assert next_question.status_code == 200
    option_id = next_question.json()["options"][0]["id"]

    submit = client.post(
        f"/api/v1/sessions/{session_id}/responses",
        json={
            "participant_token": participant_token,
            "option_id": option_id,
            "latency_ms": 800,
            "client_response_id": uuid.uuid4().hex,
        },
    )
    assert submit.status_code == 200
    assert submit.json()["accepted"] is True

    leaderboard = client.get(f"/api/v1/sessions/{session_id}/leaderboard", headers=headers)
    assert leaderboard.status_code == 200
    assert len(leaderboard.json()["items"]) == 1
