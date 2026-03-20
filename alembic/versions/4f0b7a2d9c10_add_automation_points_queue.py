"""add automation settings, points ledger, message queue, done hooks

Revision ID: 4f0b7a2d9c10
Revises: 28e0ba1340a4
Create Date: 2026-02-25
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "4f0b7a2d9c10"
down_revision: Union[str, None] = "b1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- studio_settings: automation fields ---
    op.add_column("studio_settings", sa.Column("aftercare_message", sa.Text(), nullable=True))
    op.add_column("studio_settings", sa.Column("review_link_google", sa.Text(), nullable=True))
    op.add_column("studio_settings", sa.Column("review_link_instagram", sa.Text(), nullable=True))
    op.add_column("studio_settings", sa.Column("review_link_facebook", sa.Text(), nullable=True))
    op.add_column("studio_settings", sa.Column("review_link_whatsapp", sa.Text(), nullable=True))
    op.add_column("studio_settings", sa.Column("aftercare_delay_minutes", sa.Integer(), nullable=False, server_default="30"))
    op.add_column("studio_settings", sa.Column("points_per_done_appointment", sa.Integer(), nullable=False, server_default="10"))

    # --- clients: marketing consent (כדי לא לשלוח בלי אישור אם תרצה) ---
    op.add_column("clients", sa.Column("marketing_consent", sa.Boolean(), nullable=False, server_default=sa.text("true")))

    # --- appointments: done timestamp + idempotency flag ---
    op.add_column("appointments", sa.Column("done_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("appointments", sa.Column("automation_enqueued_at", sa.DateTime(timezone=True), nullable=True))

    # --- points ledger ---
    op.create_table(
        "client_points_ledger",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("studio_id", sa.UUID(), nullable=False),
        sa.Column("client_id", sa.UUID(), nullable=False),
        sa.Column("appointment_id", sa.UUID(), nullable=True),
        sa.Column("delta_points", sa.Integer(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["studio_id"], ["studios.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["appointment_id"], ["appointments.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_points_ledger_studio_client", "client_points_ledger", ["studio_id", "client_id"], unique=False)

    # --- message queue ---
    op.create_table(
        "message_jobs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("studio_id", sa.UUID(), nullable=False),
        sa.Column("client_id", sa.UUID(), nullable=False),
        sa.Column("appointment_id", sa.UUID(), nullable=True),
        sa.Column("channel", sa.String(length=16), nullable=False),
        sa.Column("to_phone", sa.String(length=40), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("channel IN ('whatsapp')", name="ck_message_jobs_channel"),
        sa.CheckConstraint("status IN ('pending','sent','failed','canceled')", name="ck_message_jobs_status"),
        sa.ForeignKeyConstraint(["studio_id"], ["studios.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["appointment_id"], ["appointments.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_message_jobs_due", "message_jobs", ["status", "scheduled_at"], unique=False)
    op.create_index("ix_message_jobs_studio", "message_jobs", ["studio_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_message_jobs_studio", table_name="message_jobs")
    op.drop_index("ix_message_jobs_due", table_name="message_jobs")
    op.drop_table("message_jobs")

    op.drop_index("ix_points_ledger_studio_client", table_name="client_points_ledger")
    op.drop_table("client_points_ledger")

    op.drop_column("appointments", "automation_enqueued_at")
    op.drop_column("appointments", "done_at")

    op.drop_column("clients", "marketing_consent")

    op.drop_column("studio_settings", "points_per_done_appointment")
    op.drop_column("studio_settings", "aftercare_delay_minutes")
    op.drop_column("studio_settings", "review_link_whatsapp")
    op.drop_column("studio_settings", "review_link_facebook")
    op.drop_column("studio_settings", "review_link_instagram")
    op.drop_column("studio_settings", "review_link_google")
    op.drop_column("studio_settings", "aftercare_message")
