"""Shared branded HTML email templates for all platform emails."""


def _email_base(title: str, body_html: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="he">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;direction:rtl;text-align:right;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 16px;direction:rtl;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;direction:rtl;">

        <!-- Header -->
        <tr><td style="background:#0f172a;border-radius:16px 16px 0 0;padding:28px 32px;text-align:center;">
          <div style="font-size:28px;font-weight:900;color:#ffffff;letter-spacing:-1px;">BizControl</div>
          <div style="font-size:13px;color:#94a3b8;margin-top:4px;">ניהול העסק שלך, בפשטות</div>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#ffffff;padding:36px 32px;border-right:1px solid #e2e8f0;border-left:1px solid #e2e8f0;direction:rtl;text-align:right;">
          <h2 style="margin:0 0 8px;font-size:22px;color:#0f172a;text-align:right;">{title}</h2>
          {body_html}
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 16px 16px;padding:20px 32px;text-align:center;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">הודעה זו נשלחה אוטומטית ממערכת BizControl.<br>אם לא ביקשת הודעה זו, ניתן להתעלם ממנה.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""


def welcome_email_html(name: str, studio_name: str, slug: str, email: str,
                       tmp_password: str, set_pw_link: str, frontend_url: str) -> str:
    body = f"""
      <p style="color:#475569;font-size:15px;margin:0 0 20px;">שלום <strong>{name}</strong>,</p>
      <p style="color:#475569;font-size:15px;margin:0 0 24px;">
        הסטודיו <strong style="color:#0f172a;">{studio_name}</strong> נוצר בהצלחה במערכת BizControl.
        להלן פרטי הגישה שלך:
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:28px;">
        <tr><td style="padding:24px 28px;">
          <table width="100%" cellpadding="6" cellspacing="0">
            <tr>
              <td style="font-size:13px;color:#64748b;width:45%;padding:8px 0;border-bottom:1px solid #e2e8f0;">🌐 כתובת האתר</td>
              <td style="font-size:13px;color:#0f172a;font-weight:bold;border-bottom:1px solid #e2e8f0;"><a href="{frontend_url}" style="color:#3b82f6;text-decoration:none;">{frontend_url}</a></td>
            </tr>
            <tr>
              <td style="font-size:13px;color:#64748b;padding:8px 0;border-bottom:1px solid #e2e8f0;">🏠 מזהה סטודיו</td>
              <td style="font-size:14px;color:#0f172a;font-weight:bold;font-family:monospace;border-bottom:1px solid #e2e8f0;">{slug}</td>
            </tr>
            <tr>
              <td style="font-size:13px;color:#64748b;padding:8px 0;border-bottom:1px solid #e2e8f0;">📧 אימייל</td>
              <td style="font-size:13px;color:#0f172a;font-weight:bold;border-bottom:1px solid #e2e8f0;">{email}</td>
            </tr>
            <tr>
              <td style="font-size:13px;color:#64748b;padding:8px 0;">🔑 סיסמה זמנית</td>
              <td style="font-size:14px;color:#dc2626;font-weight:bold;font-family:monospace;">{tmp_password}</td>
            </tr>
          </table>
        </td></tr>
      </table>

      <p style="color:#475569;font-size:14px;margin:0 0 20px;">
        ⚠️ <strong>מומלץ בחום</strong> להגדיר סיסמה אישית מיד לאחר הכניסה הראשונה:
      </p>

      <div style="text-align:center;margin:24px 0;">
        <a href="{set_pw_link}" style="display:inline-block;background:#0f172a;color:#ffffff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px;letter-spacing:0.3px;">
          🔐 הגדר סיסמה אישית
        </a>
      </div>

      <p style="font-size:12px;color:#94a3b8;margin:16px 0 0;text-align:center;">
        הקישור תקף ל-72 שעות. לאחר מכן ניתן לבקש קישור חדש דרך "שכחתי סיסמה".
      </p>
    """
    return _email_base("ברוך הבא ל-BizControl! 🎉", body)


def reset_password_email_html(name: str, reset_link: str) -> str:
    body = f"""
      <p style="color:#475569;font-size:15px;margin:0 0 20px;">שלום <strong>{name}</strong>,</p>
      <p style="color:#475569;font-size:15px;margin:0 0 24px;">
        קיבלנו בקשה לאיפוס הסיסמה שלך ב-BizControl.<br>
        לחץ על הכפתור כדי להגדיר סיסמה חדשה:
      </p>

      <div style="text-align:center;margin:28px 0;">
        <a href="{reset_link}" style="display:inline-block;background:#0f172a;color:#ffffff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px;">
          🔐 הגדר סיסמה חדשה
        </a>
      </div>

      <p style="font-size:13px;color:#64748b;text-align:center;margin:16px 0;">
        הקישור תקף ל-72 שעות.
      </p>
      <p style="font-size:12px;color:#94a3b8;text-align:center;margin:0;">
        אם לא ביקשת איפוס סיסמה — התעלם מהודעה זו. הסיסמה לא תשתנה.
      </p>
    """
    return _email_base("איפוס סיסמה — BizControl", body)


def invite_user_email_html(name: str, studio_name: str, role_he: str, set_pw_link: str) -> str:
    body = f"""
      <p style="color:#475569;font-size:15px;margin:0 0 20px;">שלום <strong>{name}</strong>,</p>
      <p style="color:#475569;font-size:15px;margin:0 0 24px;">
        הוזמנת להצטרף לסטודיו <strong style="color:#0f172a;">{studio_name}</strong> ב-BizControl
        בתפקיד <strong>{role_he}</strong>.
      </p>

      <div style="text-align:center;margin:28px 0;">
        <a href="{set_pw_link}" style="display:inline-block;background:#0f172a;color:#ffffff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px;">
          ✅ הגדר סיסמה והתחבר למערכת
        </a>
      </div>

      <p style="font-size:12px;color:#94a3b8;text-align:center;margin:16px 0 0;">
        הקישור תקף ל-72 שעות.
      </p>
    """
    return _email_base(f"הוזמנת ל-{studio_name}! 🎉", body)
