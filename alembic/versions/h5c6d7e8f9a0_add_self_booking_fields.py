"""add self booking fields to studio_settings

Revision ID: h5c6d7e8f9a0
Revises: g4b5c6d7e8f9
Create Date: 2026-05-07
"""
from alembic import op
import sqlalchemy as sa

revision = 'h5c6d7e8f9a0'
down_revision = 'g4b5c6d7e8f9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('studio_settings', sa.Column('self_booking_enabled', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('studio_settings', sa.Column('self_booking_slot_minutes', sa.Integer(), nullable=False, server_default='60'))


def downgrade() -> None:
    op.drop_column('studio_settings', 'self_booking_slot_minutes')
    op.drop_column('studio_settings', 'self_booking_enabled')
