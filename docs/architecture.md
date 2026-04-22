# Quizzy Architecture

## Overview
Quizzy is a single-tenant classroom assessment platform with an action-first loop:
1. Ingest curriculum content.
2. Generate and review skill-tagged questions.
3. Run live game sessions over WebSocket events.
4. Produce decision outputs: assist cards, grouped interventions, remediation packs, and passports.

## Services
- `frontend` (Next.js): teacher and student web clients.
- `backend` (FastAPI): REST API + websocket channels + decision engine.
- `db` (PostgreSQL): source of truth for content, questions, sessions, analytics.

## Data and Reliability
- Game events are append-only (`game_events`) with per-session sequence numbers for replay.
- Student and teacher websocket clients reconnect with exponential backoff and `last_seq` replay.
- Student answer queue persists locally in browser to avoid data loss on unstable Wi-Fi.
- Student responses are idempotent by unique `(session_id, participant_id, client_response_id)`.
- Rejoining with the same nickname in a session reuses participant identity and token.
- Class-level registration channel uses `join_code` for low-friction student onboarding before gameplay.

## Live Dashboard Architecture
- `DashboardService` computes two views from persisted data only (no volatile in-memory state):
- `DashboardService` computes two teacher views and one student view from persisted data only (no volatile in-memory state):
  - Teacher overview (`/dashboard/overview`): per-class students, session activity, weak skills, review queue load.
  - Session live metrics (`/dashboard/sessions/{id}/live`): participation, active vs joined students, current-question wrong-option cluster, reconnect/dropout counts.
  - Student live metrics (`/dashboard/sessions/{id}/me`): personal rank, score, and answer progress.
- Metrics inputs:
  - `responses` for participation and correctness.
  - `game_participants` for connection state and active counts.
  - `game_events` for reconnect/dropout/assist operational signals.
  - `diagnostics` for weak-skill rollups in teacher dashboard.
- During quiz runtime, every lifecycle mutation emits `dashboard_metrics`:
  - join/reconnect/disconnect
  - question opened
  - response accepted
  - pause/resume/end
- Frontend host screen consumes `dashboard_metrics` over WS for sub-second updates and falls back to periodic REST refresh for resilience.
- Team gameplay uses optional `team_name` on join, persisted on participants, with aggregated `team_leaderboard` events and endpoint support.
- Join acceleration: backend exposes `join-access` payload (PIN URL + QR) for classroom projection and mobile scanning.

## Decision Engine
- Real-time assist triggers at >35% incorrect with minimum participation threshold.
- Skill mastery updates are bounded [0,1] with difficulty-weighted updates.
- Post-game outputs persist as `diagnostics`, `action_plans`, `remediation_packs`, `passports`.
- Recommendations include explicit evidence and teacher scripts.

## Deep Analytics Layer
- Session insights API computes:
  - question-by-question timeline (accuracy + latency)
  - skill mastery deltas from diagnostics
  - latency distribution (`p50`, `p90`, correct vs incorrect)
  - at-risk students with action recommendations
  - assist effectiveness (baseline question vs follow-up question on same skill)
  - team-level accuracy/score insights
- Output is intentionally actionable and tied to next-step interventions, not vanity reporting.

## Question Generation Providers
- Primary provider: Gemini (`GEMINI_API_KEY`) through Google Generative Language API.
- Request-level provider control: `gemini`, `auto`, `deterministic`.
- `auto` uses Gemini when configured and falls back to deterministic templates on provider/runtime failure.
- All generated candidates still pass deterministic quality gates before entering review.
