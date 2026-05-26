"""add feature flags + encrypted credentials + webhook logs

Revision ID: z11_feature_flags
Revises: z10_ads_analytics
Create Date: 2026-05-24
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "z11_feature_flags"
down_revision = "z10_ads_analytics"
branch_labels = None
depends_on = None

# All available platform features
FEATURES = [
    "meta_inbox",          # Instagram DM + Facebook Messenger inbox
    "whatsapp_cloud",      # WhatsApp Cloud API (Meta)
    "marketing_analytics", # Ads analytics dashboard
    "ai_insights",         # AI business recommendations
    "ai_auto_tag",         # Auto-tagging leads with AI
    "lead_attribution",    # Full ad→lead→booking attribution
    "realtime_inbox",      # SSE realtime inbox updates
    "quick_replies",       # Saved reply templates
]


def upgrade() -> None:
    # Feature flags per studio — Super Admin controls these
    op.create_table(
        "studio_features",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("studio_id", UUID(as_uuid=True), sa.ForeignKey("studios.id", ondelete="CASCADE"), nullable=False),
        sa.Column("feature", sa.String(64), nullable=False),
        sa.Column("is_enabled", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("enabled_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("enabled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("studio_id", "feature", name="uq_studio_feature"),
    )
    op.create_index("ix_studio_features_studio_id", "studio_features", ["studio_id"])
    op.create_index("ix_studio_features_feature", "studio_features", ["studio_id", "feature"])

    # Encrypted external credentials — Super Admin injects, never exposed to tenant
    op.create_table(
        "studio_credentials",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("studio_id", UUID(as_uuid=True), sa.ForeignKey("studios.id", ondelete="CASCADE"), nullable=False),
        sa.Column("platform", sa.String(32), nullable=False),     # meta | whatsapp | google | etc.
        sa.Column("key_name", sa.String(64), nullable=False),     # access_token | refresh_token | phone_id | etc.
        sa.Column("encrypted_value", sa.Text, nullable=False),    # Fernet-encrypted
        sa.Column("injected_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("injected_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.UniqueConstraint("studio_id", "platform", "key_name", name="uq_studio_credential"),
    )
    op.create_index("ix_studio_credentials_studio_id", "studio_credentials", ["studio_id"])
    op.create_index("ix_studio_credentials_platform", "studio_credentials", ["studio_id", "platform"])

    # Webhook logs — track every incoming webhook event
    op.create_table(
        "webhook_logs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("studio_id", UUID(as_uuid=True), nullable=True),          # null if studio not identified yet
        sa.Column("platform", sa.String(32), nullable=False),                # meta | green | twilio
        sa.Column("event_type", sa.String(64), nullable=False),              # message | lead | status | echo
        sa.Column("status", sa.String(16), nullable=False, server_default="'ok'"),  # ok | error | ignored
        sa.Column("payload", JSONB, nullable=True),
        sa.Column("error", sa.Text, nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_webhook_logs_studio_id", "webhook_logs", ["studio_id"])
    op.create_index("ix_webhook_logs_received_at", "webhook_logs", ["received_at"])
    op.create_index("ix_webhook_logs_platform", "webhook_logs", ["platform", "event_type"])


def downgrade() -> None:
    op.drop_index("ix_webhook_logs_platform", "webhook_logs")
    op.drop_index("ix_webhook_logs_received_at", "webhook_logs")
    op.drop_index("ix_webhook_logs_studio_id", "webhook_logs")
    op.drop_table("webhook_logs")

    op.drop_index("ix_studio_credentials_platform", "studio_credentials")
    op.drop_index("ix_studio_credentials_studio_id", "studio_credentials")
    op.drop_table("studio_credentials")

    op.drop_index("ix_studio_features_feature", "studio_features")
    op.drop_index("ix_studio_features_studio_id", "studio_features")
    op.drop_table("studio_features")
