"""add studio_notes table

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-05-07
"""
from alembic import op

revision = 'e2f3a4b5c6d7'
down_revision = 'd1e2f3a4b5c6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS studio_notes (
            id UUID PRIMARY KEY,
            studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
            created_by_email VARCHAR(255) NOT NULL,
            body TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_studio_notes_studio_id ON studio_notes (studio_id)")


def downgrade() -> None:
    op.drop_index('ix_studio_notes_studio_id', table_name='studio_notes')
    op.drop_table('studio_notes')
