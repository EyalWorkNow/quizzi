from __future__ import annotations

import random
import uuid

import httpx

BASE_URL = "http://localhost:8000/api/v1"


def main() -> None:
    client = httpx.Client(timeout=20.0)

    email = f"demo_{uuid.uuid4().hex[:8]}@example.com"
    password = "Password123!"
    signup = client.post(f"{BASE_URL}/auth/signup", json={"email": email, "password": password})
    signup.raise_for_status()
    token = signup.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    class_resp = client.post(
        f"{BASE_URL}/classes",
        json={"name": "Demo Class", "grade_level": "6"},
        headers=headers,
    )
    class_resp.raise_for_status()
    class_id = class_resp.json()["id"]
    class_code = class_resp.json()["join_code"]

    registration = client.post(
        f"{BASE_URL}/students/register",
        json={"join_code": class_code, "pseudonym": "S_registered", "display_name": "Registered Student"},
    )
    registration.raise_for_status()

    skill_ids = []
    for name in ["Fractions", "Ratios", "Proportions"]:
        res = client.post(
            f"{BASE_URL}/skills",
            json={
                "class_id": class_id,
                "name": name,
                "description": f"Understand {name.lower()}",
                "grade_level": "6",
            },
            headers=headers,
        )
        res.raise_for_status()
        skill_ids.append(res.json()["id"])

    content_text = " ".join(
        [
            "Fractions represent equal parts of a whole and can be compared using common denominators.",
            "Equivalent fractions have different forms but the same magnitude.",
            "Ratios compare two quantities in order and can be simplified by common factors.",
            "Proportions are equations where two ratios are equal after scaling.",
            "Unit rates help compare values with one term fixed at 1.",
            "Students may confuse numerator and denominator when ordering fractions.",
            "Students may reverse ratio order when translating word problems.",
            "Cross multiplication verifies proportional relationships.",
        ]
        * 6
    )
    source = client.post(
        f"{BASE_URL}/content/sources",
        json={"class_id": class_id, "title": "Demo Curriculum", "source_type": "text", "raw_content": content_text},
        headers=headers,
    )
    source.raise_for_status()
    source_id = source.json()["id"]

    generated = client.post(
        f"{BASE_URL}/content/sources/{source_id}/generate-candidates",
        json={"skill_ids": skill_ids, "count": 30, "provider": "gemini"},
        headers=headers,
    )
    generated.raise_for_status()

    candidates = client.get(f"{BASE_URL}/questions/candidates", params={"class_id": class_id}, headers=headers)
    candidates.raise_for_status()
    candidate_rows = candidates.json()

    approved_ids = []
    for row in candidate_rows[:20]:
        approve = client.post(f"{BASE_URL}/questions/{row['id']}/approve", headers=headers)
        approve.raise_for_status()
        approved_ids.append(row["id"])

    quiz = client.post(
        f"{BASE_URL}/quizzes",
        json={"class_id": class_id, "title": "Demo Generated Quiz", "question_ids": approved_ids},
        headers=headers,
    )
    quiz.raise_for_status()
    quiz_id = quiz.json()["id"]

    session = client.post(
        f"{BASE_URL}/sessions",
        json={"class_id": class_id, "quiz_id": quiz_id},
        headers=headers,
    )
    session.raise_for_status()
    session_data = session.json()
    session_id = session_data["id"]
    pin = session_data["pin"]
    join_access = client.get(f"{BASE_URL}/sessions/{session_id}/join-access", headers=headers)
    join_access.raise_for_status()

    participants: list[dict] = []
    for idx in range(10):
        joined = client.post(
            f"{BASE_URL}/sessions/join",
            json={
                "pin": pin,
                "nickname": f"S{idx+1}",
                "team_name": "Team Alpha" if idx < 5 else "Team Beta",
            },
        )
        joined.raise_for_status()
        participants.append(joined.json())

    for q_idx in range(min(8, len(approved_ids))):
        next_question = client.post(f"{BASE_URL}/sessions/{session_id}/next", headers=headers)
        next_question.raise_for_status()
        q_payload = next_question.json()
        options = q_payload["options"]
        correct_option = options[0]
        wrong_option = options[1] if len(options) > 1 else options[0]

        for idx, participant in enumerate(participants):
            choose_wrong = q_idx < 3 and idx < 5
            option = wrong_option if choose_wrong else correct_option
            response = client.post(
                f"{BASE_URL}/sessions/{session_id}/responses",
                json={
                    "participant_token": participant["participant_token"],
                    "option_id": option["id"],
                    "latency_ms": random.randint(300, 2400),
                    "client_response_id": uuid.uuid4().hex,
                },
            )
            response.raise_for_status()

    finished = client.post(f"{BASE_URL}/sessions/{session_id}/end", headers=headers)
    finished.raise_for_status()

    report = client.get(f"{BASE_URL}/sessions/{session_id}/report", headers=headers)
    report.raise_for_status()

    diagnostics = client.get(f"{BASE_URL}/diagnostics/sessions/{session_id}", headers=headers)
    diagnostics.raise_for_status()
    team_board = client.get(f"{BASE_URL}/sessions/{session_id}/teams/leaderboard", headers=headers)
    team_board.raise_for_status()
    insights = client.get(f"{BASE_URL}/analytics/sessions/{session_id}/insights", headers=headers)
    insights.raise_for_status()

    print("Smoke demo complete")
    print(f"Class ID: {class_id}")
    print(f"Class code: {class_code}")
    print(f"Session ID: {session_id}")
    print(f"Join URL: {join_access.json()['join_url']}")
    print("Top weak skills:")
    for skill in report.json()["summary"].get("top_weak_skills", []):
        print(f" - {skill['skill_name']} (avg mastery {skill['avg_mastery']})")
    print("Support groups:", len(report.json()["groups"]))
    print("Remediation items:", len(report.json()["remediation_pack"].get("items", [])))
    print("Team leaderboard rows:", len(team_board.json().get("items", [])))
    print("Insights recommendations:", len(insights.json().get("recommendations", [])))


if __name__ == "__main__":
    main()
