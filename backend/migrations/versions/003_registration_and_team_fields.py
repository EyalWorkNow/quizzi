"""registration and team fields

Revision ID: 003_registration_and_team_fields
Revises: 002_indexes_and_constraints
Create Date: 2026-03-01
"""

from alembic import op
import sqlalchemy as sa


revision = "003_registration_and_team_fields"
down_revision = "002_indexes_and_constraints"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("classes", sa.Column("join_code", sa.String(length=16), nullable=True))
    op.execute("UPDATE classes SET join_code = UPPER(SUBSTR(REPLACE(id, '-', ''), 1, 8)) WHERE join_code IS NULL")
    op.alter_column("classes", "join_code", nullable=False)
    op.create_unique_constraint("uq_classes_join_code", "classes", ["join_code"])

    op.add_column("game_participants", sa.Column("team_name", sa.String(length=80), nullable=True))
    op.create_index("ix_game_participants_session_team", "game_participants", ["session_id", "team_name"])


def downgrade() -> None:
    op.drop_index("ix_game_participants_session_team", table_name="game_participants")
    op.drop_column("game_participants", "team_name")

    op.drop_constraint("uq_classes_join_code", "classes", type_="unique")
    op.drop_column("classes", "join_code")
