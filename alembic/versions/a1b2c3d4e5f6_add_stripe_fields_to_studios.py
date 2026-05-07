"""add stripe fields to studios

Revision ID: z1stripe2fields
Revises: df4d148d9a3a
Create Date: 2026-05-07
"""
from alembic import op
import sqlalchemy as sa

revision = 'z1stripe2fields'
down_revision = 'df4d148d9a3a'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('studios', sa.Column('stripe_customer_id', sa.String(128), nullable=True))
    op.add_column('studios', sa.Column('stripe_subscription_id', sa.String(128), nullable=True))


def downgrade() -> None:
    op.drop_column('studios', 'stripe_subscription_id')
    op.drop_column('studios', 'stripe_customer_id')
