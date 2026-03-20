"""create studios users studio_settings

Revision ID: 0001_create_core_tables
Revises:
Create Date: 2026-02-24
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001_create_core_tables"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # Enable pgcrypto for gen_random_uuid()
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')

    op.create_table(
        "studios",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False, unique=True),
        sa.Column("domain", sa.String(length=255), nullable=True, unique=True),
        sa.Column("logo_url", sa.Text(), nullable=True),
        sa.Column("primary_color", sa.String(length=32), nullable=True),
        sa.Column("subscription_plan", sa.String(length=32), nullable=False, server_default="free"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("studio_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("studios.id", ondelete="CASCADE"), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("role IN ('owner','admin','artist','staff')", name="ck_users_role"),
        sa.UniqueConstraint("studio_id", "email", name="uq_users_studio_email"),
    )

    op.create_table(
        "studio_settings",
        sa.Column("studio_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("studios.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("timezone", sa.String(length=64), nullable=False, server_default="Asia/Jerusalem"),
        sa.Column("currency", sa.String(length=8), nullable=False, server_default="ILS"),
        sa.Column("language", sa.String(length=8), nullable=False, server_default="he"),
        sa.Column("default_deposit_percent", sa.Numeric(5, 2), nullable=False, server_default="20.00"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    op.create_index("idx_users_studio_id", "users", ["studio_id"])
    op.create_index("idx_users_email", "users", ["email"])


def downgrade():
    op.drop_index("idx_users_email", table_name="users")
    op.drop_index("idx_users_studio_id", table_name="users")
    op.drop_table("studio_settings")
    op.drop_table("users")
    op.drop_table("studios")
