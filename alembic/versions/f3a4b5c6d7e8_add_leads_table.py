"""add leads table

Revision ID: f3a4b5c6d7e8
Revises: e2f3a4b5c6d7
Create Date: 2026-05-07
"""
from alembic import op

revision = 'f3a4b5c6d7e8'
down_revision = 'e2f3a4b5c6d7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS leads (
            id UUID PRIMARY KEY,
            studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            phone VARCHAR(50),
            email VARCHAR(255),
            source VARCHAR(32) NOT NULL DEFAULT 'manual',
            status VARCHAR(32) NOT NULL DEFAULT 'new',
            service_interest VARCHAR(255),
            notes TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_leads_studio_id ON leads (studio_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_leads_status ON leads (studio_id, status)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_leads_status")
    op.execute("DROP INDEX IF EXISTS ix_leads_studio_id")
    op.execute("DROP TABLE IF EXISTS leads")
