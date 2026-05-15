"""replace smtp fields with resend api key

Revision ID: z8resend_replace_smtp
Revises: z7global_salary_pay_type
Create Date: 2026-05-15
"""
from alembic import op
import sqlalchemy as sa

revision = "z8resend_replace_smtp"
down_revision = "z7global_salary_pay_type"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("studio_settings", sa.Column("resend_api_key", sa.String(255), nullable=True))
    op.add_column("studio_settings", sa.Column("resend_from_email", sa.String(255), nullable=True))
    op.drop_column("studio_settings", "smtp_host")
    op.drop_column("studio_settings", "smtp_port")
    op.drop_column("studio_settings", "smtp_user")
    op.drop_column("studio_settings", "smtp_pass")
    op.drop_column("studio_settings", "smtp_from_email")


def downgrade():
    op.add_column("studio_settings", sa.Column("smtp_host", sa.String(255), nullable=True))
    op.add_column("studio_settings", sa.Column("smtp_port", sa.Integer(), nullable=True))
    op.add_column("studio_settings", sa.Column("smtp_user", sa.String(255), nullable=True))
    op.add_column("studio_settings", sa.Column("smtp_pass", sa.String(255), nullable=True))
    op.add_column("studio_settings", sa.Column("smtp_from_email", sa.String(255), nullable=True))
    op.drop_column("studio_settings", "resend_api_key")
    op.drop_column("studio_settings", "resend_from_email")
