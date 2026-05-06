"""add superadmin role and plan fields

Revision ID: d1e2f3a4b5c6
Revises: b2c3d4e5f6a7
Create Date: 2026-05-06
"""
from alembic import op
import sqlalchemy as sa

revision = 'd1e2f3a4b5c6'
down_revision = 'b2c3d4e5f6a7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop old role constraint and add new one with 'superadmin'
    op.drop_constraint('ck_users_role', 'users', type_='check')
    op.create_check_constraint(
        'ck_users_role', 'users',
        "role IN ('owner','admin','artist','staff','superadmin')"
    )

    # Add plan expiry and platform flag to studios
    op.add_column('studios', sa.Column('plan_expires_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('studios', sa.Column('is_platform', sa.Boolean(), nullable=False, server_default='false'))


def downgrade() -> None:
    op.drop_column('studios', 'is_platform')
    op.drop_column('studios', 'plan_expires_at')
    op.drop_constraint('ck_users_role', 'users', type_='check')
    op.create_check_constraint(
        'ck_users_role', 'users',
        "role IN ('owner','admin','artist','staff')"
    )
