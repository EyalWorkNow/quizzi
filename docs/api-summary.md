# API Summary

Base URL: `/api/v1`

## Auth
- `POST /auth/signup`
- `POST /auth/login`
- `GET /auth/me`
- `POST /auth/logout`

## Class + Students
- `POST /classes`
- `GET /classes`
- `POST /classes/{class_id}/roster/import`
- `GET /classes/{class_id}/students`
- `GET /classes/{class_id}/registration`
- `POST /classes/{class_id}/registration/rotate`
- `POST /students/classes/{class_id}`
- `POST /students/register` (public student self-registration with class code)

## Skills + Content + Questions
- `POST /skills`
- `GET /skills?class_id=`
- `POST /content/sources`
- `POST /content/sources/{source_id}/generate-candidates` (`provider`: `gemini|auto|deterministic`)
- `GET /questions/candidates?class_id=`
- `PATCH /questions/{question_id}`
- `POST /questions/{question_id}/approve`
- `POST /questions/{question_id}/reject`

## Quizzes + Sessions
- `POST /quizzes`
- `GET /quizzes?class_id=`
- `POST /sessions`
- `GET /sessions/{session_id}` (session state, PIN, active/total participants, current question)
- `POST /sessions/{session_id}/next`
- `POST /sessions/{session_id}/pause`
- `POST /sessions/{session_id}/resume`
- `POST /sessions/{session_id}/end`
- `POST /sessions/join`
- `POST /sessions/{session_id}/responses`
- `GET /sessions/{session_id}/leaderboard`
- `GET /sessions/{session_id}/teams/leaderboard`
- `GET /sessions/{session_id}/join-access` (PIN join URL + QR payload)
- `GET /sessions/{session_id}/report`

## Analytics
- `GET /analytics/sessions/{session_id}/insights` (timeline, risk, assist impact, team analysis)

## Dashboard
- `GET /dashboard/overview`
- `GET /dashboard/sessions/{session_id}/live`
- `GET /dashboard/sessions/{session_id}/me?participant_token=...` (student personal runtime metrics)

## Diagnostics + Passport
- `GET /diagnostics/sessions/{session_id}`
- `GET /classes/{class_id}/students/{student_id}/passport`

## WebSockets
- `WS /ws/teacher/sessions/{session_id}`
- `WS /ws/student/sessions/{session_id}?participant_token=...&last_seq=...`
- Live stream includes `dashboard_metrics` events with participation, connection, and misconception signal for the current question.
- Live stream may include `team_leaderboard` events when team mode is used.
