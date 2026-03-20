"""add google_event_id to appointments

Revision ID: aaca349ce630
Revises: 2a981732826a
Create Date: 2026-02-28 20:01:02.770288
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'aaca349ce630'
down_revision: Union[str, None] = '2a981732826a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('appointments', sa.Column('google_event_id', sa.String(length=255), nullable=True))
    op.create_index(op.f('ix_appointments_google_event_id'), 'appointments', ['google_event_id'], unique=False)

def downgrade() -> None:
    op.drop_index(op.f('ix_appointments_google_event_id'), table_name='appointments')
    op.drop_column('appointments', 'google_event_id')
