import uuid


def auth_headers(client):
    email = f"teacher_{uuid.uuid4().hex[:6]}@example.com"
    password = "Password123!"
    res = client.post("/api/v1/auth/signup", json={"email": email, "password": password})
    assert res.status_code == 200
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def setup_quiz(client, headers):
    class_res = client.post("/api/v1/classes", json={"name": "Class B", "grade_level": "6"}, headers=headers)
    class_id = class_res.json()["id"]

    skill_res = client.post(
        "/api/v1/skills",
        json={"class_id": class_id, "name": "Ratios", "description": "desc", "grade_level": "6"},
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
                "Ratios compare quantities in a fixed order. "
                "Proportions show two ratios are equal when scaled. "
                "Equivalent ratios can be found by multiplying both terms. "
                "Students often reverse ratio order in word problems. "
                "Unit rates compare one unit to another quantity. "
                "Cross multiplication can verify if two ratios are proportional."
            ),
        },
        headers=headers,
    )
    source_id = source_res.json()["id"]

    client.post(
        f"/api/v1/content/sources/{source_id}/generate-candidates",
        json={"skill_ids": [skill_id], "count": 10},
        headers=headers,
    )

    candidates = client.get(f"/api/v1/questions/candidates?class_id={class_id}", headers=headers).json()
    approved = []
    for row in candidates[:6]:
        client.post(f"/api/v1/questions/{row['id']}/approve", headers=headers)
        approved.append(row["id"])

    quiz = client.post(
        "/api/v1/quizzes",
        json={"class_id": class_id, "title": "Quiz", "question_ids": approved},
        headers=headers,
    )
    return class_id, quiz.json()["id"]


def test_action_plan_generation(client):
    headers = auth_headers(client)
    class_id, quiz_id = setup_quiz(client, headers)

    session = client.post("/api/v1/sessions", json={"class_id": class_id, "quiz_id": quiz_id}, headers=headers).json()
    session_id = session["id"]
    pin = session["pin"]

    participants = []
    for idx in range(10):
        joined = client.post("/api/v1/sessions/join", json={"pin": pin, "nickname": f"S{idx+1}"})
        participants.append(joined.json())

    leaderboard_cycle = 0
    while True:
        next_resp = client.post(f"/api/v1/sessions/{session_id}/next", headers=headers)
        if next_resp.status_code != 200:
            break
        q = next_resp.json()
        options = q["options"]
        correct = options[0]["id"]
        wrong = options[1]["id"] if len(options) > 1 else correct

        for idx, participant in enumerate(participants):
            chosen = wrong if idx < 5 and leaderboard_cycle < 2 else correct
            resp = client.post(
                f"/api/v1/sessions/{session_id}/responses",
                json={
                    "participant_token": participant["participant_token"],
                    "option_id": chosen,
                    "latency_ms": 1000,
                    "client_response_id": uuid.uuid4().hex,
                },
            )
            assert resp.status_code == 200
        leaderboard_cycle += 1

    end = client.post(f"/api/v1/sessions/{session_id}/end", headers=headers)
    assert end.status_code == 200

    report = client.get(f"/api/v1/sessions/{session_id}/report", headers=headers)
    assert report.status_code == 200
    payload = report.json()
    assert "top_weak_skills" in payload["summary"]
    assert isinstance(payload["groups"], list)

    diagnostics = client.get(f"/api/v1/diagnostics/sessions/{session_id}", headers=headers)
    assert diagnostics.status_code == 200
    assert "skill_mastery" in diagnostics.json()
