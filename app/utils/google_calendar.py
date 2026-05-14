import datetime
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
import pytz
from app.utils.logger import get_logger

log = get_logger(__name__)

def get_google_calendar_service(client_id: str, client_secret: str, refresh_token: str):
    """Builds and returns a Google Calendar service object."""
    credentials = Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=client_id,
        client_secret=client_secret,
    )
    service = build("calendar", "v3", credentials=credentials)
    return service

def create_google_event(service, title: str, start_time: datetime.datetime, end_time: datetime.datetime, description: str = "") -> str:
    """
    Creates an event in the primary calendar and returns the event ID.
    Will convert unaware datetimes to local timezone before sending.
    """
    
    # Ensure timezone info
    if getattr(start_time, 'tzinfo', None) is None:
        start_time = start_time.replace(tzinfo=pytz.UTC)
    if getattr(end_time, 'tzinfo', None) is None:
        end_time = end_time.replace(tzinfo=pytz.UTC)

    event = {
        'summary': title,
        'description': description,
        'start': {
            'dateTime': start_time.isoformat(),
        },
        'end': {
            'dateTime': end_time.isoformat(),
        },
    }

    created_event = service.events().insert(calendarId='primary', body=event).execute()
    return created_event.get('id')

def update_google_event(service, event_id: str, title: str = None, start_time: datetime.datetime = None, end_time: datetime.datetime = None, description: str = None):
    """Updates an existing Google Calendar event."""
    try:
        # First fetch the existing event
        event = service.events().get(calendarId='primary', eventId=event_id).execute()
        
        if title is not None:
            event['summary'] = title
        if description is not None:
            event['description'] = description
        if start_time is not None:
            if getattr(start_time, 'tzinfo', None) is None:
                start_time = start_time.replace(tzinfo=pytz.UTC)
            event['start']['dateTime'] = start_time.isoformat()
        if end_time is not None:
            if getattr(end_time, 'tzinfo', None) is None:
                end_time = end_time.replace(tzinfo=pytz.UTC)
            event['end']['dateTime'] = end_time.isoformat()

        service.events().update(calendarId='primary', eventId=event_id, body=event).execute()
    except Exception as e:
        log.warning("Failed to update Google event %s: %s", event_id, e)

def delete_google_event(service, event_id: str):
    """Deletes an event from Google Calendar."""
    try:
        service.events().delete(calendarId='primary', eventId=event_id).execute()
    except Exception as e:
        log.warning("Failed to delete Google event %s: %s", event_id, e)

def list_google_events(service, start_time: datetime.datetime, end_time: datetime.datetime) -> list:
    """Fetches events from the primary calendar within the specified time range."""
    # Ensure timezone info
    if getattr(start_time, 'tzinfo', None) is None:
        start_time = start_time.replace(tzinfo=pytz.UTC)
    if getattr(end_time, 'tzinfo', None) is None:
        end_time = end_time.replace(tzinfo=pytz.UTC)
        
    try:
        events_result = service.events().list(
            calendarId='primary', 
            timeMin=start_time.isoformat(),
            timeMax=end_time.isoformat(),
            singleEvents=True,
            orderBy='startTime'
        ).execute()
        return events_result.get('items', [])
    except Exception as e:
        log.warning("Failed to fetch Google events: %s", e)
        return []
