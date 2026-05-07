"""add studio_notes table

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-05-07
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = 'e2f3a4b5c6d7'
down_revision = 'd1e2f3a4b5c6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'studio_notes',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('studio_id', UUID(as_uuid=True), sa.ForeignKey('studios.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('created_by_email', sa.String(255), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_studio_notes_studio_id', 'studio_notes', ['studio_id'])


def downgrade() -> None:
    op.drop_index('ix_studio_notes_studio_id', table_name='studio_notes')
    op.drop_table('studio_notes')
