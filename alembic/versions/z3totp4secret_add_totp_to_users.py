"""add totp_secret to users

Revision ID: z3totp4secret
Revises: z2audit3log4table
Create Date: 2026-05-07
"""
from alembic import op
import sqlalchemy as sa

revision = 'z3totp4secret'
down_revision = 'z2audit3log4table'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('totp_secret', sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'totp_secret')
