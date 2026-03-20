import os
import secrets
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from google_auth_oauthlib.flow import Flow
from google.oauth2.credentials import Credentials

from app.core.database import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.models.user import User
from app.models.studio_settings import StudioSettings
from app.schemas.automation import AutomationSettingsOut

google_router = APIRouter(prefix="/studio/google", tags=["google_calendar"])

# We need a strict redirect URI that exactly matches the Google Cloud configuration
# In a real production app, this should be an environment variable.
REDIRECT_URI = "http://localhost:8000/api/studio/google/callback"
SCOPES = ['https://www.googleapis.com/auth/calendar']

def get_client_config(settings: StudioSettings):
    """Dynamically reconstructs the Google Client Secrets JSON from DB."""
    if not settings.google_calendar_client_id or not settings.google_calendar_client_secret:
        raise HTTPException(status_code=400, detail="Google Client ID or Secret are missing in automation settings.")
    
    return {
        "web": {
            "client_id": settings.google_calendar_client_id,
            "project_id": "bizcontrol", 
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "client_secret": settings.google_calendar_client_secret,
            "redirect_uris": [REDIRECT_URI]
        }
    }

@google_router.get("/auth-url")
def get_auth_url(request: Request, db: Session = Depends(get_db), ctx: AuthContext = Depends(require_studio_ctx)):
    """Generate the OAuth authorization URL for the frontend to redirect to."""
    settings = db.query(StudioSettings).filter(StudioSettings.studio_id == ctx.studio_id).first()
    if not settings:
        raise HTTPException(status_code=404, detail="Studio settings not found.")

    client_config = get_client_config(settings)
    
    flow = Flow.from_client_config(
        client_config,
        scopes=SCOPES,
        redirect_uri=REDIRECT_URI
    )
    
    authorization_url, state = flow.authorization_url(
        access_type='offline',
        prompt='consent',
        include_granted_scopes='true'
    )

    return {"url": authorization_url, "state": state}

@google_router.get("/callback")
@google_router.get("/callback/")
def google_oauth_callback(
    request: Request, 
    state: str = None, 
    code: str = None, 
    error: str = None, 
    db: Session = Depends(get_db)
):
    """The route Google redirects to after the user logs in."""
    
    from fastapi.responses import HTMLResponse
    
    if error or not code:
        html_content = f"""
        <html>
            <body>
                <script>
                    if (window.opener) {{
                        window.opener.postMessage({{ type: 'GOOGLE_OAUTH_ERROR', error: '{error or "No code received"}' }}, '*');
                        window.close();
                    }} else {{
                        document.write('Authentication failed: {error or "No code received"}. You can close this window.');
                    }}
                </script>
            </body>
        </html>
        """
        return HTMLResponse(content=html_content)
        
    html_content = f"""
    <html>
        <body>
            <script>
                // Send the code back to the main BizControl window
                if (window.opener) {{
                    window.opener.postMessage({{ type: 'GOOGLE_OAUTH_CODE', code: '{code}', state: '{state}' }}, '*');
                    window.close();
                }} else {{
                    document.write('Authentication successful. You can close this window.');
                }}
            </script>
        </body>
    </html>
    """
    return HTMLResponse(content=html_content)

from pydantic import BaseModel

class ExchangeTokenRequest(BaseModel):
    code: str

@google_router.post("/exchange-token")
def exchange_token(payload: ExchangeTokenRequest, db: Session = Depends(get_db), ctx: AuthContext = Depends(require_studio_ctx)):
    """The frontend sends the code here (after receiving it from the popup) to exchange it for a refresh token."""
    settings = db.query(StudioSettings).filter(StudioSettings.studio_id == ctx.studio_id).first()
    if not settings:
        raise HTTPException(status_code=404, detail="Settings not found")

    client_config = get_client_config(settings)
    
    flow = Flow.from_client_config(
        client_config,
        scopes=SCOPES,
        redirect_uri=REDIRECT_URI
    )
    
    try:
        flow.fetch_token(code=payload.code)
        credentials = flow.credentials
        
        # Store refresh token
        if credentials.refresh_token:
            settings.google_calendar_refresh_token = credentials.refresh_token
            db.commit()
            return {"status": "success", "message": "Google Calendar connected successfully!"}
        else:
            # Re-auth needed
            # We must force 'prompt=consent' in the auth url if changing users
            # Since they just auth'd, maybe they just re-authed without revoking.
            # In google oauth, refresh token is only sent on the very first authorization.
            # We'll assume success if they have an active token, but prompt for re-auth if they want fresh one.
            if settings.google_calendar_refresh_token:
                return {"status": "success", "message": "Google Calendar connected successfully (re-used existing token)!"}
            return {"status": "error", "message": "No refresh token received. You must revoke access in your Google Account block and try again, or it's a new error."}
            
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@google_router.post("/disconnect")
def disconnect_google(db: Session = Depends(get_db), ctx: AuthContext = Depends(require_studio_ctx)):
    """Removes the Google Calendar refresh token."""
    settings = db.query(StudioSettings).filter(StudioSettings.studio_id == ctx.studio_id).first()
    if settings:
        settings.google_calendar_refresh_token = None
        db.commit()
    return {"status": "success"}
