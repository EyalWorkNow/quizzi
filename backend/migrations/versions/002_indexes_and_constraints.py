"""indexes and constraints

Revision ID: 002_indexes_and_constraints
Revises: 001_initial_schema
Create Date: 2026-02-28
"""

from alembic import op


revision = "002_indexes_and_constraints"
down_revision = "001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_responses_session_question", "responses", ["session_id", "question_id"])
    op.create_index("ix_diagnostics_session_student_skill", "diagnostics", ["session_id", "student_id", "skill_id"])
    op.create_index("ix_passports_student_skill_created", "passports", ["student_id", "skill_id", "created_at"])
    op.create_index("ix_questions_class_status_difficulty", "questions", ["class_id", "status", "difficulty"])
    op.create_index("ix_game_participants_session_connected", "game_participants", ["session_id", "is_connected"])


def downgrade() -> None:
    op.drop_index("ix_game_participants_session_connected", table_name="game_participants")
    op.drop_index("ix_questions_class_status_difficulty", table_name="questions")
    op.drop_index("ix_passports_student_skill_created", table_name="passports")
    op.drop_index("ix_diagnostics_session_student_skill", table_name="diagnostics")
    op.drop_index("ix_responses_session_question", table_name="responses")
