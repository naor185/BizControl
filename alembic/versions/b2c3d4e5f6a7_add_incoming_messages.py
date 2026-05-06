"""add incoming messages inbox

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-05-05

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = 'b2c3d4e5f6a7'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'incoming_messages',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('studio_id', UUID(as_uuid=True), sa.ForeignKey('studios.id', ondelete='CASCADE'), nullable=False),
        sa.Column('client_id', UUID(as_uuid=True), sa.ForeignKey('clients.id', ondelete='SET NULL'), nullable=True),
        sa.Column('from_phone', sa.String(32), nullable=False),
        sa.Column('from_name', sa.String(128), nullable=True),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('channel', sa.String(16), nullable=False, server_default='whatsapp'),
        sa.Column('is_read', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('received_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index('ix_incoming_messages_studio_id', 'incoming_messages', ['studio_id'])
    op.create_index('ix_incoming_messages_from_phone', 'incoming_messages', ['from_phone'])


def downgrade() -> None:
    op.drop_index('ix_incoming_messages_from_phone', 'incoming_messages')
    op.drop_index('ix_incoming_messages_studio_id', 'incoming_messages')
    op.drop_table('incoming_messages')
