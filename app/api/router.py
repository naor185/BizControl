from fastapi import APIRouter
from app.api.client_routes import router as client_router
from app.api.auth_routes import router as auth_router
from app.api.studio_routes import router as studio_router
from app.api.appointment_routes import router as appointment_router
from app.api.artist_routes import router as artist_router
from app.api.payment_routes import router as payment_router
from app.api.calendar_routes import router as calendar_router
from app.api.automation_routes import router as automation_router
from app.api.message_routes import router as message_router
from app.api.upload_routes import router as upload_router
from app.api.public_routes import router as public_router
from app.api.email_routes import router as email_router
from app.api.google_routes import google_router
from app.api.dashboard_routes import router as dashboard_router
from app.api.expense_routes import router as expense_router
from app.api.staff_routes import router as staff_router
from app.api.goal_routes import router as goal_router
from app.api.product_routes import router as product_router
from app.api.export_routes import router as export_router
from app.api.inbox_routes import router as inbox_router
from app.api.webhook_routes import router as webhook_router
from app.api.superadmin_routes import router as superadmin_router
from app.api.lead_routes import router as lead_router
from app.api.billing_routes import router as billing_router
from app.api.client_portal_routes import router as client_portal_router
from app.api.booking_request_routes import router as booking_request_router
from app.api.notification_routes import router as notification_router
from app.api.task_routes import router as task_router
from app.api.coupon_routes import router as coupon_router
from app.api.customer_club_routes import router as customer_club_router, design_router as wallet_design_router
from app.api.tier_routes import router as tier_router
from app.api.stamp_routes import router as stamp_router
from app.api.ai_routes import router as ai_router
from app.api.nfc_routes import router as nfc_router
from app.api.pos_routes import router as pos_router
from app.api.security_routes import router as security_router
from app.api.analytics_routes import router as analytics_router
from app.api.quick_reply_routes import router as quick_reply_router
from app.api.superadmin_features_routes import router as superadmin_features_router
from app.api.service_routes import router as service_router

api_router = APIRouter()
api_router.include_router(studio_router)
api_router.include_router(auth_router)
api_router.include_router(client_router)
api_router.include_router(appointment_router)
api_router.include_router(artist_router)
api_router.include_router(payment_router)
api_router.include_router(calendar_router)
api_router.include_router(automation_router)
api_router.include_router(message_router)
api_router.include_router(upload_router)
api_router.include_router(public_router)
api_router.include_router(email_router)
api_router.include_router(google_router)
api_router.include_router(dashboard_router)
api_router.include_router(expense_router)
api_router.include_router(staff_router)
api_router.include_router(goal_router)
api_router.include_router(product_router)
api_router.include_router(export_router)
api_router.include_router(inbox_router)
api_router.include_router(webhook_router)
api_router.include_router(superadmin_router)
api_router.include_router(lead_router)
api_router.include_router(billing_router)
api_router.include_router(client_portal_router)
api_router.include_router(booking_request_router)
api_router.include_router(notification_router)
api_router.include_router(task_router)
api_router.include_router(coupon_router)
api_router.include_router(customer_club_router)
api_router.include_router(wallet_design_router)
api_router.include_router(tier_router)
api_router.include_router(stamp_router)
api_router.include_router(ai_router)
api_router.include_router(nfc_router)
api_router.include_router(pos_router)
api_router.include_router(security_router)
api_router.include_router(analytics_router)
api_router.include_router(quick_reply_router)
api_router.include_router(superadmin_features_router)
api_router.include_router(service_router)
