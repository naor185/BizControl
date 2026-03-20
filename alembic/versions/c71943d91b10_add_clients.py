"""add clients

Revision ID: c71943d91b10
Revises: fb53a031c580
Create Date: 2026-02-24 20:39:19.849250
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'c71943d91b10'
down_revision: Union[str, None] = 'fb53a031c580'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "clients",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("studio_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("studios.id", ondelete="CASCADE"), nullable=False),
        sa.Column("full_name", sa.String(length=160), nullable=False),
        sa.Column("phone", sa.String(length=40), nullable=True),
        sa.Column("email", sa.String(length=254), nullable=True),
        sa.Column("birth_date", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("loyalty_points", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    op.create_index("ix_clients_studio_id", "clients", ["studio_id"])
    op.create_index("ix_clients_full_name", "clients", ["full_name"])
    op.create_index("ix_clients_phone", "clients", ["phone"])
    op.create_index("ix_clients_email", "clients", ["email"])

    # Unique per studio
    op.create_unique_constraint("uq_clients_studio_phone", "clients", ["studio_id", "phone"])
    op.create_unique_constraint("uq_clients_studio_email", "clients", ["studio_id", "email"])


def downgrade() -> None:
    op.drop_table("clients")
