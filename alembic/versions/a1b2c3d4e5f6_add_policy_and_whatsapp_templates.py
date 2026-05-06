"""add policy and whatsapp templates

Revision ID: a1b2c3d4e5f6
Revises: 4f0b7a2d9c10
Create Date: 2026-05-05

"""
from alembic import op
import sqlalchemy as sa

revision = 'a1b2c3d4e5f6'
down_revision = '4eabebc19696'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('studio_settings', sa.Column('studio_address', sa.Text(), nullable=True))
    op.add_column('studio_settings', sa.Column('studio_map_link', sa.Text(), nullable=True))
    op.add_column('studio_settings', sa.Column('studio_portfolio_link', sa.Text(), nullable=True))
    op.add_column('studio_settings', sa.Column('bank_name', sa.String(128), nullable=True))
    op.add_column('studio_settings', sa.Column('bank_branch', sa.String(32), nullable=True))
    op.add_column('studio_settings', sa.Column('bank_account', sa.String(32), nullable=True))
    op.add_column('studio_settings', sa.Column('cancellation_free_days', sa.Integer(), nullable=False, server_default='7'))
    op.add_column('studio_settings', sa.Column('deposit_lock_days', sa.Integer(), nullable=False, server_default='7'))
    op.add_column('studio_settings', sa.Column('deposit_request_wa_template', sa.Text(), nullable=True))
    op.add_column('studio_settings', sa.Column('deposit_approved_wa_template', sa.Text(), nullable=True))
    op.add_column('studio_settings', sa.Column('points_redeem_wa_template', sa.Text(), nullable=True))
    op.add_column('studio_settings', sa.Column('non_member_wa_template', sa.Text(), nullable=True))
    op.add_column('studio_settings', sa.Column('whatsapp_instance_id', sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column('studio_settings', 'whatsapp_instance_id')
    op.drop_column('studio_settings', 'non_member_wa_template')
    op.drop_column('studio_settings', 'points_redeem_wa_template')
    op.drop_column('studio_settings', 'deposit_approved_wa_template')
    op.drop_column('studio_settings', 'deposit_request_wa_template')
    op.drop_column('studio_settings', 'deposit_lock_days')
    op.drop_column('studio_settings', 'cancellation_free_days')
    op.drop_column('studio_settings', 'bank_account')
    op.drop_column('studio_settings', 'bank_branch')
    op.drop_column('studio_settings', 'bank_name')
    op.drop_column('studio_settings', 'studio_portfolio_link')
    op.drop_column('studio_settings', 'studio_map_link')
    op.drop_column('studio_settings', 'studio_address')
