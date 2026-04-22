# Decision Engine

## Mastery Model
- Start mastery per student/skill at `0.5`.
- Update per attempt:
  - Weights: `easy=0.06`, `medium=0.10`, `hard=0.14`
  - `delta = w*(1-m)` for correct
  - `delta = -w*m` for incorrect
  - `m_next = clamp(m + delta, 0, 1)`

## Real-time Assist
Trigger on each question when:
- incorrect rate `> 35%`
- and response count `>= max(5, ceil(active_students*0.6))`

Assist payload includes:
- skill id
- evidence (`incorrect_rate`, `response_count`, `top_wrong_option`, `misconception_tag`)
- recommended micro-intervention script

## Post-game Plan
Layer 1: top weak skills + class distribution + skill evidence rows.
Layer 2: support groups by dominant weak skill (group cap 8, merge small groups).
Layer 3: remediation pack (3 easy + 3 medium + 2 hard per weak skill, dedupe by similarity).

## Actionability and Explainability
Each teacher next-step now includes:
- why now (`avg_mastery` + weakness rank)
- intervention script (60-90 second micro-teach)
- focus error (`top_wrong_option`)
- misconception tag
- linked evidence list (question IDs + incorrect rates)

## Analytics
- Skill mastery table
- Misconception heatmap
- Question quality (difficulty, discrimination, ambiguous flag)
- Engagement (participation, dropout/reconnect)
- Deep session insights (timeline, latency percentiles, assist impact, team effects, at-risk students)

## Runtime Data Flow During Quiz
1. Student joins or reconnects: participant state is persisted and `game_events` gets `participant_joined`/`participant_reconnected`.
2. Teacher opens question: `question_opened` is appended; clients receive it via WS replay-safe stream.
3. Student submits response: append-only `responses` write (idempotent key), then leaderboard + assist check.
4. Assist check runs: if threshold crossed, `assist_card` event is persisted with evidence.
5. Dashboard metric snapshot emits: server computes fresh metrics from `responses`, `game_participants`, and `game_events`, then appends `dashboard_metrics`.
6. Teacher host dashboard updates from WS event immediately; periodic REST poll (`/dashboard/sessions/{id}/live`) is fallback for network jitter.
7. Session ends: decision engine persists diagnostics/action-plan/remediation/passport snapshots, then dashboard reflects final state.
8. `analytics/sessions/{id}/insights` computes post-game deep analysis with concrete recommendations for group instruction and remediation.
