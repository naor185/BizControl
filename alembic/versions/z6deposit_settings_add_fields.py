"""add deposit settings to studio_settings

Revision ID: z6deposit7settings
Revises: z4notifications
Branch Labels: None
Depends On: None
"""
from alembic import op
import sqlalchemy as sa

revision = 'z6deposit7settings'
down_revision = 'z4notifications'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE studio_settings
        ADD COLUMN IF NOT EXISTS deposit_fixed_amount_ils INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS deposit_min_duration_minutes INTEGER
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE studio_settings DROP COLUMN IF EXISTS deposit_fixed_amount_ils")
    op.execute("ALTER TABLE studio_settings DROP COLUMN IF EXISTS deposit_min_duration_minutes")
