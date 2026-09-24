"""
BizControl Voice — Phase 2: transcription + AI summary for a call recording.

Reuses the same provider client used by ויקי (app/services/ai/orchestrator.py) —
Groq / Gemini / OpenAI, detected by API key prefix. Groq and OpenAI expose an
OpenAI-compatible Whisper endpoint (client.audio.transcriptions.create); Gemini
does not, so transcription is skipped (not failed) when only a Gemini key is
configured — the AI summary step is skipped too since it needs the transcript.

Best-effort throughout: every step is wrapped so a failure degrades gracefully
(e.g. transcription works but summary fails → transcript is still saved).
"""
from __future__ import annotations

import io
import json
import logging

import requests
from sqlalchemy.orm import Session

from app.models.call import Call
from app.services.ai.orchestrator import _get_client

log = logging.getLogger(__name__)

_SUMMARY_PROMPT = """אתה מנתח שיחות טלפון עבור עסק בתחום: {business_field}. קיבלת תמלול של שיחה בין נציג/ת העסק ללקוח.
נתח את התמלול והחזר אך ורק JSON תקין (בלי טקסט נוסף, בלי markdown) במבנה הבא:
{
  "intent": "מה הלקוח רצה/ביקש",
  "offered": "מה הוצע ללקוח",
  "quoted_price_ils": <מספר או null>,
  "deposit_mentioned": <true/false>,
  "objections": "התנגדויות שהועלו, אם היו",
  "closing_likelihood": "נמוך / בינוני / גבוה",
  "next_step": "המלצה קצרה להמשך טיפול בליד/לקוח"
}

תמלול השיחה:
{transcript}
"""


def _whisper_model_for(base_url: str) -> str | None:
    if "groq.com" in base_url:
        return "whisper-large-v3"
    if "openai.com" in base_url or base_url == "":
        return "whisper-1"
    return None  # Gemini's OpenAI-compat layer has no audio transcription endpoint


def transcribe_recording(recording_url: str) -> str | None:
    try:
        client, _ = _get_client()
    except RuntimeError:
        log.info("[call_ai] no AI provider configured — skipping transcription")
        return None

    base_url = str(client.base_url)
    model = _whisper_model_for(base_url)
    if not model:
        log.info("[call_ai] provider %s has no Whisper endpoint — skipping transcription", base_url)
        return None

    try:
        resp = requests.get(recording_url, timeout=30)
        resp.raise_for_status()
    except Exception as e:
        log.warning("[call_ai] failed to download recording %s: %s", recording_url, e)
        return None

    try:
        audio_file = io.BytesIO(resp.content)
        audio_file.name = "recording.mp3"
        # client here is async (AsyncOpenAI) — transcription is called from a
        # sync context (webhook handler), so use the sync-friendly .with_raw_response
        # is unnecessary; simplest is a plain sync client with the same base_url/key.
        import openai
        sync_client = openai.OpenAI(api_key=client.api_key, base_url=base_url)
        transcript = sync_client.audio.transcriptions.create(model=model, file=audio_file, language="he")
        return transcript.text
    except Exception as e:
        log.warning("[call_ai] transcription failed: %s", e)
        return None


def summarize_transcript(transcript: str, business_field: str = "לא ידוע") -> dict | None:
    try:
        client, model = _get_client()
    except RuntimeError:
        return None

    try:
        import openai
        sync_client = openai.OpenAI(api_key=client.api_key, base_url=str(client.base_url))
        resp = sync_client.chat.completions.create(
            model=model,
            # replace(), not format(): the prompt's JSON braces made format() raise KeyError on every call
            messages=[{"role": "user", "content": _SUMMARY_PROMPT.replace("{business_field}", business_field)
                                                                  .replace("{transcript}", transcript[:8000])}],
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        content = resp.choices[0].message.content or "{}"
        return json.loads(content)
    except Exception as e:
        log.warning("[call_ai] summary generation failed: %s", e)
        return None


def process_call_recording(db: Session, call: Call) -> None:
    """Best-effort: transcribe + summarize a call that now has a recording_url.
    Never raises — the webhook must still ack the provider even if this fails."""
    if not call.recording_url:
        return
    try:
        transcript = transcribe_recording(call.recording_url)
        if transcript:
            call.transcript = transcript
            db.commit()
            from app.models.studio import Studio
            from app.services.business_types import describe, type_lookup
            studio = db.get(Studio, call.studio_id)
            summary = summarize_transcript(transcript, describe(type_lookup(db), studio.business_type if studio else None)["label"])
            if summary:
                call.ai_summary = summary
                db.commit()
    except Exception as e:
        log.exception("[call_ai] process_call_recording failed for call %s: %s", call.id, e)
