"""add studio_integrations table

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-05-09
"""
from alembic import op

revision = 'b3studio4int5'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS studio_integrations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
            platform VARCHAR(32) NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT FALSE,
            expires_at TIMESTAMPTZ,
            phone_number_id VARCHAR(255),
            access_token VARCHAR(1024),
            page_id VARCHAR(128),
            instagram_account_id VARCHAR(128),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (studio_id, platform)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_studio_integrations_studio_id ON studio_integrations (studio_id)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_studio_integrations_studio_id")
    op.execute("DROP TABLE IF EXISTS studio_integrations")
