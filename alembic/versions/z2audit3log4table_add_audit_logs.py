"""add audit_logs table

Revision ID: z2audit3log4table
Revises: z1stripe2fields
Create Date: 2026-05-07
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = 'z2audit3log4table'
down_revision = 'z1stripe2fields'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'audit_logs',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('admin_id', sa.String(64), nullable=False),
        sa.Column('admin_email', sa.String(255), nullable=False),
        sa.Column('action', sa.String(64), nullable=False),
        sa.Column('studio_id', sa.String(64), nullable=True),
        sa.Column('studio_name', sa.String(255), nullable=True),
        sa.Column('details', JSONB, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_audit_logs_admin_id', 'audit_logs', ['admin_id'])
    op.create_index('ix_audit_logs_studio_id', 'audit_logs', ['studio_id'])
    op.create_index('ix_audit_logs_created_at', 'audit_logs', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_audit_logs_created_at', 'audit_logs')
    op.drop_index('ix_audit_logs_studio_id', 'audit_logs')
    op.drop_index('ix_audit_logs_admin_id', 'audit_logs')
    op.drop_table('audit_logs')
