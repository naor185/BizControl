"""add global pay type and global_salary to users

Revision ID: z7global8salary
Revises: z6deposit7settings
Branch Labels: None
Depends On: None
"""
from alembic import op
import sqlalchemy as sa

revision = 'z7global8salary'
down_revision = 'z6deposit7settings'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS global_salary NUMERIC(10, 2) NOT NULL DEFAULT 0.00
    """)
    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_pay_type")
    op.execute("""
        ALTER TABLE users
        ADD CONSTRAINT ck_users_pay_type
        CHECK (pay_type IN ('hourly','commission','none','global'))
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_pay_type")
    op.execute("""
        ALTER TABLE users
        ADD CONSTRAINT ck_users_pay_type
        CHECK (pay_type IN ('hourly','commission','none'))
    """)
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS global_salary")
