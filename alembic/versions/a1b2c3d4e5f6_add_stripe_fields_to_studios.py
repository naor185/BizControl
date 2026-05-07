"""add stripe fields to studios

Revision ID: a1b2c3d4e5f6
Revises: df4d148d9a3a
Create Date: 2026-05-07
"""
from alembic import op
import sqlalchemy as sa

revision = 'a1b2c3d4e5f6'
down_revision = 'df4d148d9a3a'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('studios', sa.Column('stripe_customer_id', sa.String(128), nullable=True))
    op.add_column('studios', sa.Column('stripe_subscription_id', sa.String(128), nullable=True))


def downgrade() -> None:
    op.drop_column('studios', 'stripe_subscription_id')
    op.drop_column('studios', 'stripe_customer_id')
