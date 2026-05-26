"""add ads analytics + ad_account_id to settings

Revision ID: z10_ads_analytics
Revises: z9ai_tables
Create Date: 2026-05-24
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "z10_ads_analytics"
down_revision = "z9ai_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add Meta Ads account ID to studio settings
    op.add_column("studio_settings", sa.Column("meta_ad_account_id", sa.String(64), nullable=True))

    # Ad insights cache (synced from Meta Marketing API)
    op.create_table(
        "ad_insights",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("studio_id", UUID(as_uuid=True), sa.ForeignKey("studios.id", ondelete="CASCADE"), nullable=False),
        sa.Column("date_start", sa.Date, nullable=False),
        sa.Column("date_stop", sa.Date, nullable=False),
        sa.Column("campaign_id", sa.String(64), nullable=False),
        sa.Column("campaign_name", sa.String(255), nullable=False, server_default=""),
        sa.Column("ad_set_id", sa.String(64), nullable=True),
        sa.Column("ad_set_name", sa.String(255), nullable=True),
        sa.Column("ad_id", sa.String(64), nullable=True),
        sa.Column("ad_name", sa.String(255), nullable=True),
        sa.Column("impressions", sa.Integer, nullable=False, server_default="0"),
        sa.Column("clicks", sa.Integer, nullable=False, server_default="0"),
        sa.Column("reach", sa.Integer, nullable=False, server_default="0"),
        sa.Column("spend_cents", sa.Integer, nullable=False, server_default="0"),
        sa.Column("leads", sa.Integer, nullable=False, server_default="0"),
        sa.Column("link_clicks", sa.Integer, nullable=False, server_default="0"),
        sa.Column("actions", JSONB, nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_ad_insights_studio_id", "ad_insights", ["studio_id"])
    op.create_index("ix_ad_insights_date", "ad_insights", ["studio_id", "date_start"])
    op.create_index("ix_ad_insights_campaign", "ad_insights", ["studio_id", "campaign_id"])

    # AI recommendations cache
    op.create_table(
        "ai_insights",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("studio_id", UUID(as_uuid=True), sa.ForeignKey("studios.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", sa.String(32), nullable=False),         # ads | organic | leads | general
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("priority", sa.String(16), nullable=False, server_default="medium"),  # high | medium | low
        sa.Column("icon", sa.String(8), nullable=True),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_ai_insights_studio_id", "ai_insights", ["studio_id"])

    # Quick replies (saved templates for inbox)
    op.create_table(
        "quick_replies",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("studio_id", UUID(as_uuid=True), sa.ForeignKey("studios.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(100), nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("shortcut", sa.String(30), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_quick_replies_studio_id", "quick_replies", ["studio_id"])


def downgrade() -> None:
    op.drop_index("ix_quick_replies_studio_id", "quick_replies")
    op.drop_table("quick_replies")

    op.drop_index("ix_ai_insights_studio_id", "ai_insights")
    op.drop_table("ai_insights")

    op.drop_index("ix_ad_insights_campaign", "ad_insights")
    op.drop_index("ix_ad_insights_date", "ad_insights")
    op.drop_index("ix_ad_insights_studio_id", "ad_insights")
    op.drop_table("ad_insights")

    op.drop_column("studio_settings", "meta_ad_account_id")
