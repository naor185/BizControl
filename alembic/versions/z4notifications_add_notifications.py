"""add notifications table

Revision ID: z4notifications
Revises: z3totp4secret
Create Date: 2026-05-14
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = 'z4notifications'
down_revision = 'z3totp4secret'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'notifications',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('studio_id', UUID(as_uuid=True), sa.ForeignKey('studios.id', ondelete='CASCADE'), nullable=False),
        sa.Column('type', sa.String(32), nullable=False, server_default='system'),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('body', sa.Text, nullable=False, server_default=''),
        sa.Column('is_read', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('action_url', sa.String(512), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_notifications_studio_id', 'notifications', ['studio_id'])
    op.create_index('ix_notifications_is_read', 'notifications', ['is_read'])
    op.create_index('ix_notifications_created_at', 'notifications', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_notifications_created_at', 'notifications')
    op.drop_index('ix_notifications_is_read', 'notifications')
    op.drop_index('ix_notifications_studio_id', 'notifications')
    op.drop_table('notifications')
