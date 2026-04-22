# Quizzy MVP

Quizzy is a classroom game-based assessment platform with a deterministic Decision Engine:
- Real-time teacher assist during live sessions
- Post-game action plans with support groups
- Remediation packs and student learning passports
- Safe curriculum ingestion with quality-gated question generation
- Reconnect-safe student flow with queued answer delivery on unstable Wi-Fi
- Live dashboard metrics pipeline (`/dashboard/overview` and `/dashboard/sessions/{id}/live`) powered by persisted events/responses
- Student runtime dashboard signal (`/dashboard/sessions/{id}/me`) for rank/score/progress
- Class registration channel with class code (`join_code`) + student self-registration
- Join QR payload for session projection + optional team mode with team leaderboard
- Deep session analytics endpoint for actionable group interventions
- Gemini-backed question generation (with deterministic fallback)

## Monorepo
- `/backend` FastAPI + SQLAlchemy + Alembic
- `/frontend` Next.js App Router + TypeScript + Tailwind + shadcn-style UI
- `/infra` Docker Compose + env templates
- `/docs` architecture + API + decision engine notes

## Setup
1. Copy environment templates:
```bash
cp infra/.env.example infra/.env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```
2. Configure Gemini in `backend/.env`:
```bash
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.5-flash
```
3. Start services:
```bash
docker compose -f infra/docker-compose.yml up --build -d
```
4. Run migrations:
```bash
docker compose -f infra/docker-compose.yml exec backend alembic upgrade head
```
5. Seed sample data:
```bash
docker compose -f infra/docker-compose.yml exec backend python scripts/seed.py
```

## Demo Walkthrough
1. Open [http://localhost:3000](http://localhost:3000)
2. Sign up as a teacher.
3. Create a class and add skills.
4. Ingest content and generate candidates.
5. Approve candidates and publish quiz from quiz builder.
6. Share class registration code from class page (`Student Registration Channel`) and pre-register students (optional).
7. Host live session from dashboard (class ID + quiz ID).
8. Project QR from host screen (`Join with QR`) so students can join quickly.
9. Students join via PIN at `/student/join` (optional team name for group mode).
10. Progress questions in host screen and observe assist cards + team leaderboard.
11. End session and open report page (includes deep insights).
12. Open student passport pages from class roster.

Seed login (if using `scripts/seed.py`):
- Email: `teacher@example.com`
- Password: `Password123!`

## Automated Smoke Scenario
Run a fully automated API smoke scenario (seeds class + simulates 10 students + generates action plan):
```bash
docker compose -f infra/docker-compose.yml exec backend python scripts/smoke_demo.py
```

## Tests
Backend tests:
```bash
docker compose -f infra/docker-compose.yml exec backend pytest -q
```
Frontend smoke check:
```bash
docker compose -f infra/docker-compose.yml exec frontend pnpm test:smoke
```

## Auth + Security
- Teacher auth: email/password + JWT
- Student access: PIN + nickname (no required student account)
- Password hashing with `pbkdf2_sha256`
- Join endpoint rate-limited in-memory (`JOIN_RATE_LIMIT_MAX=120` default, class-size safe for 50 learners)

## Reliability Notes
- Student responses are idempotent (`client_response_id`) and can be retried safely.
- WebSocket reconnection uses event replay from `game_events` via `last_seq`.
- Student answer queue persists locally until server acknowledges submission.
- Session lifecycle emits `dashboard_metrics` events so teacher host view updates continuously during the quiz.

## Notes
- PDF OCR is intentionally excluded in MVP.
- Question generation uses Gemini by default when `GEMINI_API_KEY` is configured, with deterministic fallback.
