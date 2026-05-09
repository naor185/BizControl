"""add booking_requests table

Revision ID: k1l2m3n4o5p6
Revises: z3totp4secret_add_totp_to_users
Create Date: 2026-05-10
"""
from alembic import op

revision = "k1l2m3n4o5p6"
down_revision = "z3totp4secret_add_totp_to_users"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS booking_requests (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
            artist_id UUID REFERENCES users(id) ON DELETE SET NULL,
            client_name VARCHAR(160) NOT NULL,
            client_phone VARCHAR(32) NOT NULL,
            client_email VARCHAR(255),
            service_note TEXT,
            requested_at TIMESTAMPTZ NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'pending',
            rejection_reason TEXT,
            reviewed_by_id UUID,
            reviewed_at TIMESTAMPTZ,
            appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_booking_requests_studio_id ON booking_requests (studio_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_booking_requests_artist_id ON booking_requests (artist_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_booking_requests_status ON booking_requests (status)")


def downgrade():
    op.execute("DROP TABLE IF EXISTS booking_requests")
