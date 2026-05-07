"""add social inbox fields to studio_settings

Revision ID: g4b5c6d7e8f9
Revises: f3a4b5c6d7e8
Create Date: 2026-05-07
"""
from alembic import op
import sqlalchemy as sa

revision = 'g4b5c6d7e8f9'
down_revision = 'f3a4b5c6d7e8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('studio_settings', sa.Column('facebook_page_id', sa.String(64), nullable=True))
    op.add_column('studio_settings', sa.Column('instagram_account_id', sa.String(64), nullable=True))
    op.add_column('studio_settings', sa.Column('meta_page_access_token', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('studio_settings', 'meta_page_access_token')
    op.drop_column('studio_settings', 'instagram_account_id')
    op.drop_column('studio_settings', 'facebook_page_id')
