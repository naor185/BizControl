"""add lead campaign fields

Revision ID: a1b2c3d4e5f6
Revises: f3a4b5c6d7e8
Create Date: 2026-05-09
"""
from alembic import op

revision = 'a1b2c3d4e5f6'
down_revision = 'f3a4b5c6d7e8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE leads ADD COLUMN IF NOT EXISTS campaign_name VARCHAR(255)")
    op.execute("ALTER TABLE leads ADD COLUMN IF NOT EXISTS ad_id VARCHAR(128)")
    op.execute("ALTER TABLE leads ADD COLUMN IF NOT EXISTS external_id VARCHAR(128)")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_leads_external_id ON leads (studio_id, external_id) WHERE external_id IS NOT NULL")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_leads_external_id")
    op.execute("ALTER TABLE leads DROP COLUMN IF EXISTS external_id")
    op.execute("ALTER TABLE leads DROP COLUMN IF EXISTS ad_id")
    op.execute("ALTER TABLE leads DROP COLUMN IF EXISTS campaign_name")
