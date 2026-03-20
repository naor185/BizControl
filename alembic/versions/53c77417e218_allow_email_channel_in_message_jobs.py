"""allow email channel in message jobs

Revision ID: 53c77417e218
Revises: 47913cd36090
Create Date: 2026-03-01 23:59:41.255211
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '53c77417e218'
down_revision: Union[str, None] = '47913cd36090'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop old constraint and add new one to allow 'email'
    op.execute("ALTER TABLE message_jobs DROP CONSTRAINT IF EXISTS ck_message_jobs_channel")
    op.create_check_constraint(
        "ck_message_jobs_channel",
        "message_jobs",
        sa.column("channel").in_(["whatsapp", "email"])
    )

def downgrade() -> None:
    # Revert to only 'whatsapp' (might fail if email jobs exist, but that's standard for downgrade)
    op.execute("ALTER TABLE message_jobs DROP CONSTRAINT IF EXISTS ck_message_jobs_channel")
    op.create_check_constraint(
        "ck_message_jobs_channel",
        "message_jobs",
        sa.column("channel").in_(["whatsapp"])
    )
