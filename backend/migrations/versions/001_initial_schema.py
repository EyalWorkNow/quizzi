"""initial schema

Revision ID: 001_initial_schema
Revises:
Create Date: 2026-02-28
"""

from alembic import op
import sqlalchemy as sa


revision = "001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


source_type = sa.Enum("text", "markdown", "url", name="source_type")
source_status = sa.Enum("pending", "processed", "failed", name="source_status")
question_status = sa.Enum("candidate", "approved", "rejected", name="question_status")
difficulty = sa.Enum("easy", "medium", "hard", name="difficulty")
quiz_status = sa.Enum("draft", "published", name="quiz_status")
session_status = sa.Enum("lobby", "active", "paused", "ended", name="session_status")
tag_type = sa.Enum("skill", "misconception", name="tag_type")


def upgrade() -> None:
    bind = op.get_bind()
    source_type.create(bind, checkfirst=True)
    source_status.create(bind, checkfirst=True)
    question_status.create(bind, checkfirst=True)
    difficulty.create(bind, checkfirst=True)
    quiz_status.create(bind, checkfirst=True)
    session_status.create(bind, checkfirst=True)
    tag_type.create(bind, checkfirst=True)

    op.create_table(
        "teachers",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("email", sa.String(length=255), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "classes",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("teacher_id", sa.String(length=36), sa.ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("grade_level", sa.String(length=50), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "students",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("class_id", sa.String(length=36), sa.ForeignKey("classes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("pseudonym", sa.String(length=80), nullable=False),
        sa.Column("display_name", sa.String(length=120)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "rosters",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("class_id", sa.String(length=36), sa.ForeignKey("classes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_type", sa.String(length=50), nullable=False),
        sa.Column("file_name", sa.String(length=255)),
        sa.Column("row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "skills",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("class_id", sa.String(length=36), sa.ForeignKey("classes.id", ondelete="CASCADE"), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("grade_level", sa.String(length=50), nullable=False),
        sa.Column("parent_skill_id", sa.String(length=36), sa.ForeignKey("skills.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "content_sources",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("class_id", sa.String(length=36), sa.ForeignKey("classes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_type", source_type, nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("source_url", sa.String(length=500)),
        sa.Column("raw_content", sa.Text(), nullable=False),
        sa.Column("status", source_status, nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "content_chunks",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("content_source_id", sa.String(length=36), sa.ForeignKey("content_sources.id", ondelete="CASCADE"), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("checksum", sa.String(length=128), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "questions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("class_id", sa.String(length=36), sa.ForeignKey("classes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", question_status, nullable=False, server_default="candidate"),
        sa.Column("stem", sa.Text(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("difficulty", difficulty, nullable=False),
        sa.Column("source_chunk_id", sa.String(length=36), sa.ForeignKey("content_chunks.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "question_options",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("question_id", sa.String(length=36), sa.ForeignKey("questions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("option_key", sa.String(length=1), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("is_correct", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("misconception_tag", sa.String(length=255)),
    )

    op.create_table(
        "question_tags",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("question_id", sa.String(length=36), sa.ForeignKey("questions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tag_type", tag_type, nullable=False),
        sa.Column("tag_value", sa.String(length=255), nullable=False),
    )

    op.create_table(
        "quizzes",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("class_id", sa.String(length=36), sa.ForeignKey("classes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("status", quiz_status, nullable=False, server_default="draft"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True)),
    )

    op.create_table(
        "quiz_questions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("quiz_id", sa.String(length=36), sa.ForeignKey("quizzes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question_id", sa.String(length=36), sa.ForeignKey("questions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.UniqueConstraint("quiz_id", "position", name="uq_quiz_position"),
    )

    op.create_table(
        "game_sessions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("class_id", sa.String(length=36), sa.ForeignKey("classes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("quiz_id", sa.String(length=36), sa.ForeignKey("quizzes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("pin", sa.String(length=8), nullable=False, unique=True),
        sa.Column("status", session_status, nullable=False, server_default="lobby"),
        sa.Column("current_question_index", sa.Integer(), nullable=False, server_default="-1"),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("ended_at", sa.DateTime(timezone=True)),
        sa.Column("active_count", sa.Integer(), nullable=False, server_default="0"),
    )

    op.create_table(
        "game_participants",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("session_id", sa.String(length=36), sa.ForeignKey("game_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", sa.String(length=36), sa.ForeignKey("students.id", ondelete="SET NULL"), nullable=True),
        sa.Column("nickname", sa.String(length=80), nullable=False),
        sa.Column("participant_token", sa.String(length=64), nullable=False, unique=True),
        sa.Column("is_connected", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_seen_at", sa.DateTime(timezone=True)),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("left_at", sa.DateTime(timezone=True)),
    )

    op.create_table(
        "game_events",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("session_id", sa.String(length=36), sa.ForeignKey("game_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("session_id", "seq", name="uq_session_seq"),
    )

    op.create_table(
        "responses",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("session_id", sa.String(length=36), sa.ForeignKey("game_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question_id", sa.String(length=36), sa.ForeignKey("questions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("participant_id", sa.String(length=36), sa.ForeignKey("game_participants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("selected_option_id", sa.String(length=36), sa.ForeignKey("question_options.id", ondelete="CASCADE"), nullable=False),
        sa.Column("is_correct", sa.Boolean(), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("client_response_id", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("session_id", "participant_id", "client_response_id", name="uq_response_idempotency"),
    )

    op.create_table(
        "diagnostics",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("session_id", sa.String(length=36), sa.ForeignKey("game_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("class_id", sa.String(length=36), sa.ForeignKey("classes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", sa.String(length=36), sa.ForeignKey("students.id", ondelete="SET NULL"), nullable=True),
        sa.Column("skill_id", sa.String(length=36), sa.ForeignKey("skills.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mastery_before", sa.Float(), nullable=False),
        sa.Column("mastery_after", sa.Float(), nullable=False),
        sa.Column("correct_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("incorrect_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("top_misconception", sa.String(length=255)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "action_plans",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("session_id", sa.String(length=36), sa.ForeignKey("game_sessions.id", ondelete="CASCADE"), unique=True, nullable=False),
        sa.Column("class_id", sa.String(length=36), sa.ForeignKey("classes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("summary_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("groups_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("recommendations_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "remediation_packs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("action_plan_id", sa.String(length=36), sa.ForeignKey("action_plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("class_id", sa.String(length=36), sa.ForeignKey("classes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("assigned_quiz_id", sa.String(length=36), sa.ForeignKey("quizzes.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "remediation_items",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("pack_id", sa.String(length=36), sa.ForeignKey("remediation_packs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("skill_id", sa.String(length=36), sa.ForeignKey("skills.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question_id", sa.String(length=36), sa.ForeignKey("questions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("difficulty", difficulty, nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
    )

    op.create_table(
        "passports",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("class_id", sa.String(length=36), sa.ForeignKey("classes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", sa.String(length=36), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("skill_id", sa.String(length=36), sa.ForeignKey("skills.id", ondelete="CASCADE"), nullable=False),
        sa.Column("session_id", sa.String(length=36), sa.ForeignKey("game_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mastery_value", sa.Float(), nullable=False),
        sa.Column("recent_misconception", sa.String(length=255)),
        sa.Column("recommended_practice_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("passports")
    op.drop_table("remediation_items")
    op.drop_table("remediation_packs")
    op.drop_table("action_plans")
    op.drop_table("diagnostics")
    op.drop_table("responses")
    op.drop_table("game_events")
    op.drop_table("game_participants")
    op.drop_table("game_sessions")
    op.drop_table("quiz_questions")
    op.drop_table("quizzes")
    op.drop_table("question_tags")
    op.drop_table("question_options")
    op.drop_table("questions")
    op.drop_table("content_chunks")
    op.drop_table("content_sources")
    op.drop_table("skills")
    op.drop_table("rosters")
    op.drop_table("students")
    op.drop_table("classes")
    op.drop_table("teachers")

    bind = op.get_bind()
    tag_type.drop(bind, checkfirst=True)
    session_status.drop(bind, checkfirst=True)
    quiz_status.drop(bind, checkfirst=True)
    difficulty.drop(bind, checkfirst=True)
    question_status.drop(bind, checkfirst=True)
    source_status.drop(bind, checkfirst=True)
    source_type.drop(bind, checkfirst=True)
