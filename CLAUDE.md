# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BizControl is a **multi-tenant SaaS** platform for tattoo and beauty studios. Each studio is an isolated tenant with its own clients, appointments, payments, and settings. Deployed on Railway (backend + Postgres) and Vercel/Railway (Next.js frontend).

## Commands

### Backend (Python / FastAPI)
```bash
# Run locally
pip install -r requirements.txt
python start.py                    # runs schema migrations + uvicorn on PORT env var

# Run dev server directly (no schema check)
uvicorn app.main:app --reload --port 8000

# Environment variables required locally
DATABASE_URL=postgresql://...
JWT_SECRET=...
GROQ_API_KEY=...   # or GEMINI_API_KEY / OPENAI_API_KEY for ויקי AI
```

### Frontend (Next.js 14)
```bash
cd web
npm install
npm run dev       # http://localhost:3000
npm run build     # next build --webpack
npm run lint      # eslint
```

### Deploy
```bash
git add -A && git commit -m "..." && git push
# Railway auto-deploys on push to main. No manual steps needed.
```

## Architecture

### Multi-tenancy Model
Every DB row that belongs to a studio has `studio_id: UUID`. All API routes enforce isolation via `require_studio_ctx` (FastAPI dependency in `app/core/deps.py`) which reads `studio_id` from the JWT. **Never query without filtering by `studio_id`.**

### Backend Structure (`app/`)
| Path | Purpose |
|------|---------|
| `app/main.py` | FastAPI app, CORS, APScheduler, startup migrations (inline SQL) |
| `app/api/router.py` | Registers all routers under `/api` |
| `app/api/*_routes.py` | One file per domain (appointments, clients, payments, etc.) |
| `app/models/` | SQLAlchemy ORM models (one file per table) |
| `app/crud/` | Business logic called from routes |
| `app/schemas/` | Pydantic request/response schemas |
| `app/services/` | Background workers and complex services |
| `app/core/deps.py` | `AuthContext` dataclass + `require_studio_ctx` dependency |
| `app/core/features.py` | `require_feature()` dependency — gates routes by feature flag |
| `start.py` | Entry point: runs idempotent `ALTER TABLE ... IF NOT EXISTS` then uvicorn |

### Database Migrations
**No Alembic CLI.** Migrations are handled two ways:
1. **`start.py`** — idempotent raw SQL (`IF NOT EXISTS`) that runs on every startup for new tables/columns.
2. **`app/main.py` startup event** — additional `ALTER TABLE ... IF NOT EXISTS` for newer columns.

When adding a new column or table, add it to `start.py` (preferred) or the startup block in `main.py`.

### Authentication
- JWT-based. `app/core/auth_deps.py` → `get_current_user()` → validates token, returns `User`.
- Roles: `owner`, `admin`, `artist`, `receptionist`, `manager`, `superadmin`.
- `require_studio_ctx` wraps `get_current_user` and produces `AuthContext(studio_id, user_id, role)`.
- `require_roles(*roles)` — FastAPI dependency for role-gating specific endpoints.

### Feature Flags
Per-studio feature flags stored in `studio_features` table. Use `require_feature("flag_name")` as a FastAPI dependency to gate routes. Managed by superadmin at `/admin/studios/[id]`.

### Scheduler (APScheduler)
`BackgroundScheduler` starts in `main.py`. Key jobs:
- Every 20s: `process_due_jobs` (sends pending WhatsApp/email from `message_jobs` queue)
- Every 2h: `sweep_upcoming_reminders` (1-day reminders), `sweep_7day_reminders`, `sweep_3day_reminders`
- Cron 08:00 Israel time: `sweep_same_day_reminders`
- Cron 25th/month: `sweep_birthday_messages`

### Message Queue (`message_jobs` table)
All outbound messages (WhatsApp, email) are **enqueued** first, then processed by `process_due_jobs`. Use `MessageJob` model. Always set `reminder_type` (e.g. `"1day"`, `"7day"`, `"same_day"`) for reminder messages to enable dedup — never use body-tag dedup (`[7day]` in message text).

WhatsApp providers: `green_api` (linked device) or `meta` (Cloud API). Both dispatched via `send_whatsapp_message()` in `message_worker.py`.

### AI Assistant (ויקי)
- Backend: `app/services/ai/` — `orchestrator.py`, `tools.py`, `prompts.py`
- Supports Groq (llama), Gemini, OpenAI — detected by API key prefix (`gsk_` → Groq, `AIza` → Gemini)
- Tools that fetch live data: `get_today_appointments`, `get_monthly_revenue`, `search_client`, `get_dashboard_stats`, `get_inactive_clients`, `get_top_artists`
- **Important**: Navigation/help questions skip tools entirely (`_needs_tools()` check) to avoid Groq 400 errors on llama function-calling
- Tool results include an `answer` field with a pre-built Hebrew sentence; always use it verbatim

### Frontend Structure (`web/src/`)
| Path | Purpose |
|------|---------|
| `app/` | Next.js App Router pages |
| `components/AppShell.tsx` | Main layout with sidebar nav and SSE unread count |
| `components/AIAssistant.tsx` | ויקי floating chat widget |
| `lib/api.ts` | `apiFetch<T>()` — authenticated fetch with auto-refresh |

All API calls go through `apiFetch()` from `lib/api.ts`. Token stored in `localStorage` as `bizcontrol_token`. `API_BASE` is set via `NEXT_PUBLIC_API_URL` env var.

### Key Conventions
- **Timezones**: All DB timestamps are UTC. Israel timezone (`Asia/Jerusalem`, UTC+3) must be applied when calculating "today" or scheduling cron jobs. Use `pytz.timezone("Asia/Jerusalem")` — never `datetime.utcnow()` for user-facing date logic.
- **Deposit flow**: `deposit_amount_cents > 0` = deposit required; `payment_verified_at IS NOT NULL` = paid. Both conditions checked together to determine "pending deposit."
- **Appointment status**: `scheduled → done / canceled / no_show`. Use `POST /api/appointments/{id}/mark-done` to close without sending a message.
- **Confirmation messages**: `enqueue_confirmation_message()` in `app/crud/automation.py` handles both deposit and no-deposit appointments. Always includes: artist name, address, map link, portfolio, cancellation policy.
- **Templates**: `format_template(template, context)` replaces `{placeholder}` variables. `smart_format()` auto-appends details for plain-text templates.
