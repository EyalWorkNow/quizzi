import uuid


def auth_headers(client):
    email = f"teacher_{uuid.uuid4().hex[:6]}@example.com"
    password = "Password123!"
    res = client.post("/api/v1/auth/signup", json={"email": email, "password": password})
    assert res.status_code == 200
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def setup_quiz(client, headers):
    class_res = client.post("/api/v1/classes", json={"name": "Class Teams", "grade_level": "6"}, headers=headers)
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
                "Ratios compare ordered values. "
                "Equivalent ratios preserve multiplicative structure. "
                "Students often flip ratio order in word problems."
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
        json={"class_id": class_id, "title": "Ratios quiz", "question_ids": approved},
        headers=headers,
    )
    return class_id, quiz.json()["id"]


def test_registration_qr_team_and_analytics(client):
    headers = auth_headers(client)
    class_id, quiz_id = setup_quiz(client, headers)

    registration = client.get(f"/api/v1/classes/{class_id}/registration", headers=headers)
    assert registration.status_code == 200
    join_code = registration.json()["join_code"]
    assert len(join_code) >= 6

    self_register = client.post(
        "/api/v1/students/register",
        json={"join_code": join_code, "pseudonym": "S-registered", "display_name": "Registered Student"},
    )
    assert self_register.status_code == 200
    assert self_register.json()["class_id"] == class_id

    session = client.post("/api/v1/sessions", json={"class_id": class_id, "quiz_id": quiz_id}, headers=headers).json()
    session_id = session["id"]
    pin = session["pin"]

    access = client.get(f"/api/v1/sessions/{session_id}/join-access", headers=headers)
    assert access.status_code == 200
    assert pin in access.json()["join_url"]
    assert "qr_image_url" in access.json()

    participants = []
    for idx in range(6):
        joined = client.post(
            "/api/v1/sessions/join",
            json={
                "pin": pin,
                "nickname": f"S{idx+1}",
                "team_name": "Team Alpha" if idx < 3 else "Team Beta",
            },
        )
        assert joined.status_code == 200
        participants.append(joined.json())

    question = client.post(f"/api/v1/sessions/{session_id}/next", headers=headers)
    assert question.status_code == 200
    options = question.json()["options"]
    correct = options[0]["id"]
    wrong = options[1]["id"] if len(options) > 1 else correct

    for idx, participant in enumerate(participants):
        chosen = wrong if idx < 2 else correct
        resp = client.post(
            f"/api/v1/sessions/{session_id}/responses",
            json={
                "participant_token": participant["participant_token"],
                "option_id": chosen,
                "latency_ms": 900,
                "client_response_id": uuid.uuid4().hex,
            },
        )
        assert resp.status_code == 200

    team_board = client.get(f"/api/v1/sessions/{session_id}/teams/leaderboard", headers=headers)
    assert team_board.status_code == 200
    assert len(team_board.json()["items"]) == 2

    client.post(f"/api/v1/sessions/{session_id}/end", headers=headers)

    insights = client.get(f"/api/v1/analytics/sessions/{session_id}/insights", headers=headers)
    assert insights.status_code == 200
    payload = insights.json()
    assert "question_timeline" in payload
    assert "recommendations" in payload
