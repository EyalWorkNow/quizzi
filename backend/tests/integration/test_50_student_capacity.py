import uuid


def auth_headers(client):
    email = f"teacher_{uuid.uuid4().hex[:6]}@example.com"
    password = "Password123!"
    res = client.post("/api/v1/auth/signup", json={"email": email, "password": password})
    assert res.status_code == 200
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def setup_quiz(client, headers):
    class_res = client.post("/api/v1/classes", json={"name": "Class 50", "grade_level": "7"}, headers=headers)
    assert class_res.status_code == 200
    class_id = class_res.json()["id"]

    skill_res = client.post(
        "/api/v1/skills",
        json={"class_id": class_id, "name": "Decimals", "description": "desc", "grade_level": "7"},
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
            "raw_content": (
                "Decimals represent tenths and hundredths. "
                "Equivalent decimals have the same value. "
                "Students often misalign place value when adding decimals. "
                "Rounding checks the next digit."
            ),
        },
        headers=headers,
    )
    assert source_res.status_code == 200
    source_id = source_res.json()["id"]

    gen_res = client.post(
        f"/api/v1/content/sources/{source_id}/generate-candidates",
        json={"skill_ids": [skill_id], "count": 8, "provider": "deterministic"},
        headers=headers,
    )
    assert gen_res.status_code == 200

    candidates = client.get(f"/api/v1/questions/candidates?class_id={class_id}", headers=headers)
    assert candidates.status_code == 200
    rows = candidates.json()
    assert rows

    approved = []
    for row in rows[:6]:
        ok = client.post(f"/api/v1/questions/{row['id']}/approve", headers=headers)
        assert ok.status_code == 200
        approved.append(row["id"])

    quiz = client.post(
        "/api/v1/quizzes",
        json={"class_id": class_id, "title": "Capacity Quiz", "question_ids": approved},
        headers=headers,
    )
    assert quiz.status_code == 200
    return class_id, quiz.json()["id"]


def test_50_students_can_join_and_play(client):
    headers = auth_headers(client)
    class_id, quiz_id = setup_quiz(client, headers)

    session = client.post("/api/v1/sessions", json={"class_id": class_id, "quiz_id": quiz_id}, headers=headers)
    assert session.status_code == 200
    session_id = session.json()["id"]
    pin = session.json()["pin"]

    participants = []
    for idx in range(50):
        joined = client.post(
            "/api/v1/sessions/join",
            json={
                "pin": pin,
                "nickname": f"S{idx+1}",
                "team_name": f"Team-{idx % 5 + 1}",
            },
        )
        assert joined.status_code == 200
        participants.append(joined.json())

    state = client.get(f"/api/v1/sessions/{session_id}", headers=headers)
    assert state.status_code == 200
    assert state.json()["participants_count"] == 50
    assert state.json()["active_count"] == 50

    next_question = client.post(f"/api/v1/sessions/{session_id}/next", headers=headers)
    assert next_question.status_code == 200
    options = next_question.json()["options"]
    correct = options[0]["id"]
    wrong = options[1]["id"] if len(options) > 1 else correct

    for idx, participant in enumerate(participants):
        choice = wrong if idx < 20 else correct
        resp = client.post(
            f"/api/v1/sessions/{session_id}/responses",
            json={
                "participant_token": participant["participant_token"],
                "option_id": choice,
                "latency_ms": 800 + (idx % 4) * 50,
                "client_response_id": uuid.uuid4().hex,
            },
        )
        assert resp.status_code == 200
        assert resp.json()["accepted"] is True

    leaderboard = client.get(f"/api/v1/sessions/{session_id}/leaderboard", headers=headers)
    assert leaderboard.status_code == 200
    assert len(leaderboard.json()["items"]) == 50

    team_board = client.get(f"/api/v1/sessions/{session_id}/teams/leaderboard", headers=headers)
    assert team_board.status_code == 200
    assert len(team_board.json()["items"]) == 5

    live_metrics = client.get(f"/api/v1/dashboard/sessions/{session_id}/live", headers=headers)
    assert live_metrics.status_code == 200
    metrics_payload = live_metrics.json()
    assert metrics_payload["joined_students"] == 50
    assert metrics_payload["active_students"] == 50
    assert metrics_payload["teams_active"] == 5
    assert metrics_payload["current_question"]["responses"] == 50

    end = client.post(f"/api/v1/sessions/{session_id}/end", headers=headers)
    assert end.status_code == 200

    insights = client.get(f"/api/v1/analytics/sessions/{session_id}/insights", headers=headers)
    assert insights.status_code == 200
    assert "recommendations" in insights.json()
