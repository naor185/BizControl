from __future__ import annotations

import uuid
from datetime import datetime, date

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, func, Integer, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class StudioSettings(Base):
    __tablename__ = "studio_settings"

    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), primary_key=True)

    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="Asia/Jerusalem")
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="ILS")
    language: Mapped[str] = mapped_column(String(8), nullable=False, default="he")

    default_deposit_percent: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=20.00)

    aftercare_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    review_link_google: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_link_instagram: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_link_facebook: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_link_whatsapp: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Payment Links for Automation
    bit_link: Mapped[str | None] = mapped_column(Text, nullable=True)
    paybox_link: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Message Templates
    welcome_wa_template: Mapped[str | None] = mapped_column(Text, nullable=True)
    welcome_email_template: Mapped[str | None] = mapped_column(Text, nullable=True)
    
    confirm_wa_template: Mapped[str | None] = mapped_column(Text, nullable=True)
    confirm_email_template: Mapped[str | None] = mapped_column(Text, nullable=True)
    
    reminder_wa_template: Mapped[str | None] = mapped_column(Text, nullable=True)
    reminder_email_template: Mapped[str | None] = mapped_column(Text, nullable=True)

    post_payment_wa_template: Mapped[str | None] = mapped_column(Text, nullable=True)
    post_payment_email_template: Mapped[str | None] = mapped_column(Text, nullable=True)

    reschedule_wa_template: Mapped[str | None] = mapped_column(Text, nullable=True)
    reschedule_email_template: Mapped[str | None] = mapped_column(Text, nullable=True)

    cancel_wa_template: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancel_email_template: Mapped[str | None] = mapped_column(Text, nullable=True)

    birthday_wa_template: Mapped[str | None] = mapped_column(Text, nullable=True)
    birthday_email_template: Mapped[str | None] = mapped_column(Text, nullable=True)
    birthday_benefit_percent: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    aftercare_delay_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=30, server_default="30")
    points_per_done_appointment: Mapped[int] = mapped_column(Integer, nullable=False, default=10, server_default="10")
    points_on_signup: Mapped[int] = mapped_column(Integer, nullable=False, default=50, server_default="50")
    points_percent_per_payment: Mapped[int] = mapped_column(Integer, nullable=False, default=5, server_default="5")

    # Financial & Tax Settings
    vat_percent: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=18.00, server_default="18.00")
    income_tax_percent: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=10.00, server_default="10.00")
    social_security_percent: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=5.00, server_default="5.00")

    # Email Settings (Resend API)
    resend_api_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    resend_from_email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # WhatsApp / SMS Settings
    whatsapp_provider: Mapped[str | None] = mapped_column(String(64), nullable=True)
    whatsapp_api_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    whatsapp_phone_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Branding & Themes
    theme_primary_color: Mapped[str] = mapped_column(String(32), nullable=False, default="#000000", server_default="#000000")
    theme_secondary_color: Mapped[str] = mapped_column(String(32), nullable=False, default="#ffffff", server_default="#ffffff")
    logo_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Landing Pages
    landing_page_active_template: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    landing_page_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    landing_page_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    
    landing_page_bg_image: Mapped[str | None] = mapped_column(String(255), nullable=True)
    landing_page_title_font: Mapped[str | None] = mapped_column(String(128), nullable=True, default="Heebo", server_default="Heebo")
    landing_page_desc_font: Mapped[str | None] = mapped_column(String(128), nullable=True, default="Assistant", server_default="Assistant")
    landing_page_image_1: Mapped[str | None] = mapped_column(String(255), nullable=True)
    landing_page_image_2: Mapped[str | None] = mapped_column(String(255), nullable=True)
    landing_page_image_3: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # AI Generation Limits
    ai_generations_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    ai_generations_reset_date: Mapped[date | None] = mapped_column(DateTime(timezone=False), nullable=True)

    # Google Calendar OAuth
    google_calendar_client_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    google_calendar_client_secret: Mapped[str | None] = mapped_column(String(255), nullable=True)
    google_calendar_refresh_token: Mapped[str | None] = mapped_column(String(255), nullable=True)

    calendar_start_hour: Mapped[str] = mapped_column(String(16), nullable=False, default="08:00", server_default="08:00")
    calendar_end_hour: Mapped[str] = mapped_column(String(16), nullable=False, default="23:00", server_default="23:00")

    # Studio Info & Policy
    studio_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    studio_map_link: Mapped[str | None] = mapped_column(Text, nullable=True)
    studio_portfolio_link: Mapped[str | None] = mapped_column(Text, nullable=True)
    bank_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    bank_branch: Mapped[str | None] = mapped_column(String(32), nullable=True)
    bank_account: Mapped[str | None] = mapped_column(String(32), nullable=True)
    cancellation_free_days: Mapped[int] = mapped_column(Integer, nullable=False, default=7, server_default="7")
    deposit_lock_days: Mapped[int] = mapped_column(Integer, nullable=False, default=7, server_default="7")

    # New Message Templates
    deposit_request_wa_template: Mapped[str | None] = mapped_column(Text, nullable=True)
    deposit_approved_wa_template: Mapped[str | None] = mapped_column(Text, nullable=True)
    points_redeem_wa_template: Mapped[str | None] = mapped_column(Text, nullable=True)
    non_member_wa_template: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Green API (WhatsApp via linked device)
    whatsapp_instance_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Meta Social Inbox (Instagram DMs + Facebook Messenger)
    facebook_page_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    instagram_account_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    meta_page_access_token: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Deposit defaults
    deposit_fixed_amount_ils: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    deposit_min_duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Self-Booking (public /book/[slug] page)
    self_booking_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    self_booking_slot_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=60, server_default="60")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    studio: Mapped["Studio"] = relationship(back_populates="settings")
