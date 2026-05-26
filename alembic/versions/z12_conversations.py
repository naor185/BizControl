"""add unified conversations + messages + attribution tables

Revision ID: z12_conversations
Revises: z11_feature_flags
Create Date: 2026-05-24
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "z12_conversations"
down_revision = "z11_feature_flags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Unified conversations (one row per contact per channel) ──────────────
    op.create_table(
        "conversations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("studio_id", UUID(as_uuid=True), sa.ForeignKey("studios.id", ondelete="CASCADE"), nullable=False),
        sa.Column("client_id", UUID(as_uuid=True), sa.ForeignKey("clients.id", ondelete="SET NULL"), nullable=True),
        sa.Column("lead_id", UUID(as_uuid=True), sa.ForeignKey("leads.id", ondelete="SET NULL"), nullable=True),

        # Platform identity
        sa.Column("platform", sa.String(20), nullable=False),          # whatsapp | instagram | facebook
        sa.Column("external_id", sa.String(128), nullable=False),      # phone / IGSID / PSID
        sa.Column("display_name", sa.String(255), nullable=True),

        # Attribution
        sa.Column("source_type", sa.String(32), nullable=True),        # organic | paid_ad | story_reply | comment | lead_form
        sa.Column("campaign_id", sa.String(64), nullable=True),
        sa.Column("campaign_name", sa.String(255), nullable=True),
        sa.Column("ad_id", sa.String(64), nullable=True),
        sa.Column("ad_name", sa.String(255), nullable=True),
        sa.Column("post_id", sa.String(128), nullable=True),
        sa.Column("reel_id", sa.String(128), nullable=True),
        sa.Column("referral_url", sa.Text, nullable=True),

        # Status
        sa.Column("status", sa.String(20), nullable=False, server_default="'open'"),  # open | resolved | spam
        sa.Column("assigned_to", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("is_pinned", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("tags", JSONB, nullable=True),                       # ["hot", "returning", ...]
        sa.Column("internal_notes", sa.Text, nullable=True),

        # Metrics
        sa.Column("first_response_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("unread_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("message_count", sa.Integer, nullable=False, server_default="0"),

        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),

        sa.UniqueConstraint("studio_id", "platform", "external_id", name="uq_conversation"),
    )
    op.create_index("ix_conversations_studio_id", "conversations", ["studio_id"])
    op.create_index("ix_conversations_client_id", "conversations", ["client_id"])
    op.create_index("ix_conversations_lead_id", "conversations", ["lead_id"])
    op.create_index("ix_conversations_last_message", "conversations", ["studio_id", "last_message_at"])
    op.create_index("ix_conversations_platform", "conversations", ["studio_id", "platform"])

    # ── Unified messages ──────────────────────────────────────────────────────
    op.create_table(
        "messages",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("conversation_id", UUID(as_uuid=True), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("studio_id", UUID(as_uuid=True), sa.ForeignKey("studios.id", ondelete="CASCADE"), nullable=False),

        sa.Column("direction", sa.String(4), nullable=False),          # in | out
        sa.Column("platform", sa.String(20), nullable=False),
        sa.Column("external_message_id", sa.String(128), nullable=True),  # Meta message ID

        sa.Column("type", sa.String(20), nullable=False, server_default="'text'"),  # text | image | video | audio | file | template
        sa.Column("body", sa.Text, nullable=True),
        sa.Column("media_url", sa.Text, nullable=True),
        sa.Column("media_type", sa.String(32), nullable=True),

        sa.Column("is_read", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("delivery_status", sa.String(20), nullable=True),    # sent | delivered | read | failed

        sa.Column("sent_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),  # null = incoming
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_messages_conversation_id", "messages", ["conversation_id"])
    op.create_index("ix_messages_studio_id", "messages", ["studio_id"])
    op.create_index("ix_messages_sent_at", "messages", ["conversation_id", "sent_at"])

    # ── Lead source attribution (granular tracking) ───────────────────────────
    op.create_table(
        "lead_sources",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("studio_id", UUID(as_uuid=True), sa.ForeignKey("studios.id", ondelete="CASCADE"), nullable=False),
        sa.Column("lead_id", UUID(as_uuid=True), sa.ForeignKey("leads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("conversation_id", UUID(as_uuid=True), nullable=True),  # FK to conversations (soft)

        # Source attribution
        sa.Column("platform", sa.String(20), nullable=False),
        sa.Column("source_type", sa.String(32), nullable=False),       # organic | paid_ad | story_reply | reel | post | lead_form | referral
        sa.Column("campaign_id", sa.String(64), nullable=True),
        sa.Column("campaign_name", sa.String(255), nullable=True),
        sa.Column("ad_set_id", sa.String(64), nullable=True),
        sa.Column("ad_id", sa.String(64), nullable=True),
        sa.Column("ad_name", sa.String(255), nullable=True),
        sa.Column("post_id", sa.String(128), nullable=True),
        sa.Column("reel_id", sa.String(128), nullable=True),
        sa.Column("story_id", sa.String(128), nullable=True),
        sa.Column("referral_url", sa.Text, nullable=True),

        # Conversion tracking
        sa.Column("converted_to_booking", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("converted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revenue_cents", sa.Integer, nullable=True),         # filled when booking is paid

        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_lead_sources_studio_id", "lead_sources", ["studio_id"])
    op.create_index("ix_lead_sources_lead_id", "lead_sources", ["lead_id"])
    op.create_index("ix_lead_sources_campaign", "lead_sources", ["studio_id", "campaign_id"])
    op.create_index("ix_lead_sources_ad", "lead_sources", ["studio_id", "ad_id"])


def downgrade() -> None:
    op.drop_index("ix_lead_sources_ad", "lead_sources")
    op.drop_index("ix_lead_sources_campaign", "lead_sources")
    op.drop_index("ix_lead_sources_lead_id", "lead_sources")
    op.drop_index("ix_lead_sources_studio_id", "lead_sources")
    op.drop_table("lead_sources")

    op.drop_index("ix_messages_sent_at", "messages")
    op.drop_index("ix_messages_studio_id", "messages")
    op.drop_index("ix_messages_conversation_id", "messages")
    op.drop_table("messages")

    op.drop_index("ix_conversations_platform", "conversations")
    op.drop_index("ix_conversations_last_message", "conversations")
    op.drop_index("ix_conversations_lead_id", "conversations")
    op.drop_index("ix_conversations_client_id", "conversations")
    op.drop_index("ix_conversations_studio_id", "conversations")
    op.drop_table("conversations")
