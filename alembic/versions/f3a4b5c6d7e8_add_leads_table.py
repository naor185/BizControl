"""add leads table

Revision ID: f3a4b5c6d7e8
Revises: e2f3a4b5c6d7
Create Date: 2026-05-07
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = 'f3a4b5c6d7e8'
down_revision = 'e2f3a4b5c6d7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'leads',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('studio_id', UUID(as_uuid=True), sa.ForeignKey('studios.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('phone', sa.String(50), nullable=True),
        sa.Column('email', sa.String(255), nullable=True),
        sa.Column('source', sa.String(32), nullable=False, server_default='manual'),
        sa.Column('status', sa.String(32), nullable=False, server_default='new'),
        sa.Column('service_interest', sa.String(255), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_leads_studio_id', 'leads', ['studio_id'])
    op.create_index('ix_leads_status', 'leads', ['studio_id', 'status'])


def downgrade() -> None:
    op.drop_index('ix_leads_status', table_name='leads')
    op.drop_index('ix_leads_studio_id', table_name='leads')
    op.drop_table('leads')
