from pydantic import BaseModel, Field
from datetime import date

class AutomationSettingsOut(BaseModel):
    aftercare_message: str | None = None
    review_link_google: str | None = None
    review_link_instagram: str | None = None
    review_link_facebook: str | None = None
    review_link_whatsapp: str | None = None
    aftercare_delay_minutes: int = 30
    points_per_done_appointment: int = 10
    points_on_signup: int = 50
    points_percent_per_payment: int = 5
    vat_percent: float = 17.00
    income_tax_percent: float = 10.00
    social_security_percent: float = 5.00

    # Payment Links
    bit_link: str | None = None
    paybox_link: str | None = None

    # Message Templates
    welcome_wa_template: str | None = None
    welcome_email_template: str | None = None
    confirm_wa_template: str | None = None
    confirm_email_template: str | None = None
    reminder_wa_template: str | None = None
    reminder_email_template: str | None = None
    post_payment_wa_template: str | None = None
    post_payment_email_template: str | None = None
    reschedule_wa_template: str | None = None
    reschedule_email_template: str | None = None
    cancel_wa_template: str | None = None
    cancel_email_template: str | None = None

    # Birthday Templates
    birthday_wa_template: str | None = None
    birthday_email_template: str | None = None
    birthday_benefit_percent: int = 0

    # SMTP Settings
    smtp_host: str | None = None
    smtp_port: int | None = None
    smtp_user: str | None = None
    smtp_pass: str | None = None
    smtp_from_email: str | None = None

    # WhatsApp Settings
    whatsapp_provider: str | None = None
    whatsapp_api_key: str | None = None
    whatsapp_phone_id: str | None = None

    # Branding & Themes
    theme_primary_color: str = "#000000"
    theme_secondary_color: str = "#ffffff"
    logo_filename: str | None = None

    # Landing Pages
    landing_page_active_template: int = 1
    landing_page_title: str | None = None
    landing_page_description: str | None = None
    
    landing_page_bg_image: str | None = None
    landing_page_title_font: str = "Heebo"
    landing_page_desc_font: str = "Assistant"
    
    landing_page_image_1: str | None = None
    landing_page_image_2: str | None = None
    landing_page_image_3: str | None = None

    # Google Calendar
    google_calendar_client_id: str | None = None
    google_calendar_client_secret: str | None = None
    google_calendar_refresh_token: str | None = None

    calendar_start_hour: str = "08:00"
    calendar_end_hour: str = "23:00"

    # AI Limits
    ai_generations_count: int = 0
    ai_generations_reset_date: date | None = None

    # Studio Info & Policy
    studio_address: str | None = None
    studio_map_link: str | None = None
    studio_portfolio_link: str | None = None
    bank_name: str | None = None
    bank_branch: str | None = None
    bank_account: str | None = None
    cancellation_free_days: int = 7
    deposit_lock_days: int = 7

    # New WhatsApp Templates
    deposit_request_wa_template: str | None = None
    deposit_approved_wa_template: str | None = None
    points_redeem_wa_template: str | None = None
    non_member_wa_template: str | None = None

    # Green API
    whatsapp_instance_id: str | None = None

class AutomationSettingsUpdate(BaseModel):
    aftercare_message: str | None = None
    review_link_google: str | None = None
    review_link_instagram: str | None = None
    review_link_facebook: str | None = None
    review_link_whatsapp: str | None = None
    aftercare_delay_minutes: int | None = Field(default=None, ge=0, le=1440)
    points_per_done_appointment: int | None = Field(default=None, ge=0, le=100000)
    points_on_signup: int | None = Field(default=None, ge=0, le=100000)
    points_percent_per_payment: int | None = Field(default=None, ge=0, le=100)
    vat_percent: float | None = Field(default=None, ge=0, le=100)
    income_tax_percent: float | None = Field(default=None, ge=0, le=100)
    social_security_percent: float | None = Field(default=None, ge=0, le=100)

    # Payment Links
    bit_link: str | None = None
    paybox_link: str | None = None

    # Message Templates
    welcome_wa_template: str | None = None
    welcome_email_template: str | None = None
    confirm_wa_template: str | None = None
    confirm_email_template: str | None = None
    reminder_wa_template: str | None = None
    reminder_email_template: str | None = None
    post_payment_wa_template: str | None = None
    post_payment_email_template: str | None = None
    reschedule_wa_template: str | None = None
    reschedule_email_template: str | None = None
    cancel_wa_template: str | None = None
    cancel_email_template: str | None = None

    # Birthday Templates
    birthday_wa_template: str | None = None
    birthday_email_template: str | None = None
    birthday_benefit_percent: int | None = Field(default=None, ge=0, le=100)

    # SMTP Settings
    smtp_host: str | None = None
    smtp_port: int | None = Field(default=None, ge=1, le=65535)
    smtp_user: str | None = None
    smtp_pass: str | None = None
    smtp_from_email: str | None = None

    # WhatsApp Settings
    whatsapp_provider: str | None = None
    whatsapp_api_key: str | None = None
    whatsapp_phone_id: str | None = None

    # Branding & Themes
    theme_primary_color: str | None = None
    theme_secondary_color: str | None = None

    # Landing Pages
    landing_page_active_template: int | None = Field(default=None, ge=1, le=3)
    landing_page_title: str | None = None
    landing_page_description: str | None = None
    
    landing_page_bg_image: str | None = None
    landing_page_title_font: str | None = None
    landing_page_desc_font: str | None = None
    
    landing_page_image_1: str | None = None
    landing_page_image_2: str | None = None
    landing_page_image_3: str | None = None

    # Google Calendar
    google_calendar_client_id: str | None = None
    google_calendar_client_secret: str | None = None
    google_calendar_refresh_token: str | None = None

    calendar_start_hour: str | None = None
    calendar_end_hour: str | None = None

    # Studio Info & Policy
    studio_address: str | None = None
    studio_map_link: str | None = None
    studio_portfolio_link: str | None = None
    bank_name: str | None = None
    bank_branch: str | None = None
    bank_account: str | None = None
    cancellation_free_days: int | None = Field(default=None, ge=0, le=365)
    deposit_lock_days: int | None = Field(default=None, ge=0, le=365)

    # New WhatsApp Templates
    deposit_request_wa_template: str | None = None
    deposit_approved_wa_template: str | None = None
    points_redeem_wa_template: str | None = None
    non_member_wa_template: str | None = None

    # Green API
    whatsapp_instance_id: str | None = None
