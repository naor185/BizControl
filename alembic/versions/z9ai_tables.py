"""add AI assistant tables

Revision ID: z9ai_tables
Revises: z8resend_replace_smtp
Create Date: 2026-05-22
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "z9ai_tables"
down_revision = "z8resend_replace_smtp"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_conversations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("studio_id", UUID(as_uuid=True), sa.ForeignKey("studios.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("message_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("total_tokens", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_ai_conversations_studio_id", "ai_conversations", ["studio_id"])
    op.create_index("ix_ai_conversations_user_id", "ai_conversations", ["user_id"])

    op.create_table(
        "ai_messages",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("conversation_id", UUID(as_uuid=True), sa.ForeignKey("ai_conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("tools_used", JSONB, nullable=True),
        sa.Column("tokens_used", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_ai_messages_conversation_id", "ai_messages", ["conversation_id"])

    op.create_table(
        "ai_audit_logs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("studio_id", UUID(as_uuid=True), nullable=True),
        sa.Column("user_id", UUID(as_uuid=True), nullable=True),
        sa.Column("event_type", sa.String(50), nullable=False),
        sa.Column("details", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_ai_audit_logs_studio_id", "ai_audit_logs", ["studio_id"])
    op.create_index("ix_ai_audit_logs_event_type", "ai_audit_logs", ["event_type"])
    op.create_index("ix_ai_audit_logs_created_at", "ai_audit_logs", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_ai_audit_logs_created_at", "ai_audit_logs")
    op.drop_index("ix_ai_audit_logs_event_type", "ai_audit_logs")
    op.drop_index("ix_ai_audit_logs_studio_id", "ai_audit_logs")
    op.drop_table("ai_audit_logs")

    op.drop_index("ix_ai_messages_conversation_id", "ai_messages")
    op.drop_table("ai_messages")

    op.drop_index("ix_ai_conversations_user_id", "ai_conversations")
    op.drop_index("ix_ai_conversations_studio_id", "ai_conversations")
    op.drop_table("ai_conversations")
