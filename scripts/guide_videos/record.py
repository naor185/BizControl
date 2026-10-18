"""The guide's videos (web/public/guide) — screen recordings of its steps at a phone's size, in order: a title card, a
Hebrew caption for every action, a circle where the finger taps, and "מעולה!" only after the save really succeeded.
The paths (web/src/lib/tours.ts): the owner's first steps (business service client appointment payment), the owner's
working day (pos_sale deposit worker_task — 2026-10-15) and the messages to clients (messages_where messages_off
messages_text messages_optout — 2026-10-16).
LOCAL ONLY: the dev database, a new demo business with sample details (no real people); the API runs without its
scheduler, so nothing is sent — and the messages a step queued are deleted at the end.

Run again when a recorded screen changes (2026-10-15):
  1. docker compose up -d db
  2. a local certificate (the web app calls its API over https):
       openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 7 -subj "/CN=localhost"
         -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
  3. the API:  ALLOWED_ORIGINS=http://localhost:3005 DATABASE_URL=postgresql://bizcontrol:bizcontrol@localhost:5433/bizcontrol_dev
               JWT_SECRET=local-dev-only-secret DISABLE_SCHEDULER=1 ACCESS_TOKEN_MINUTES=1440
               (a day's sign-in: the working day's videos run on tomorrow morning's clock)
               python -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --ssl-keyfile key.pem --ssl-certfile cert.pem
     the web:  (in web/) NEXT_PUBLIC_API_BASE=https://localhost:8001 npx next dev -p 3005
  4. python scripts/guide_videos/record.py <work dir> [step names — all when none]
  5. python scripts/guide_videos/edit.py <work dir> web/public/guide      (needs: pip install imageio-ffmpeg)
Frames come from the browser's own screencast at twice the phone's pixels; the edit makes H.264 .mp4 + a cover .jpg."""
import json, random, sys, time, pathlib, warnings
import psycopg2, requests
from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

warnings.filterwarnings("ignore")
API = "https://127.0.0.1:8001"
WEB = "http://localhost:3005"
OUT = pathlib.Path(sys.argv[1]); OUT.mkdir(exist_ok=True)
ONLY = sys.argv[2:] or None
VIEW = {"width": 390, "height": 844}

# ── the demo business ──
n = random.randint(1000, 9999)
email = f"demo{n}@example.com"
requests.post(f"{API}/api/studios/register", json={"name": "סטודיו לדוגמה", "slug": f"demo-studio-{n}", "email": email, "password": "password123"}, verify=False)
token = requests.post(f"{API}/api/auth/login-by-email", json={"email": email, "password": "password123"}, verify=False).json()["access_token"]
H = {"Authorization": f"Bearer {token}"}
requests.put(f"{API}/api/tutorial/owner_start", headers=H, json={"state": "done"}, verify=False)     # no guide over the video
con = psycopg2.connect("postgresql://bizcontrol:bizcontrol@localhost:5433/bizcontrol_dev")
with con, con.cursor() as cur:                                                                         # no "verify your e-mail" bar
    cur.execute("UPDATE users SET email_verified = true, display_name = 'נועה' WHERE email = %s", (email,))
con.close()

logo = OUT / "demo_logo.png"
img = Image.new("RGB", (512, 512), (255, 255, 255))
d = ImageDraw.Draw(img)
d.ellipse((40, 40, 472, 472), fill=(2, 132, 199))
try:
    font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 190)
except OSError:
    font = ImageFont.load_default()
d.text((256, 256), "SD", fill="white", font=font, anchor="mm")
img.save(logo)

# ── what's drawn over the screen while recording ──
OVERLAY = r"""
(() => {
  const css = `
  #rec-cap{position:fixed;left:12px;right:12px;top:calc(10px + env(safe-area-inset-top,0px));z-index:2147483000;direction:rtl;
    background:rgba(15,23,42,.88);color:#fff;border-radius:18px;padding:12px 16px;font:600 17px/1.45 Heebo,Arial,sans-serif;
    box-shadow:0 10px 30px rgba(0,0,0,.25);transition:opacity .25s;opacity:0;pointer-events:none}
  #rec-cap .tag{display:block;font-size:12px;font-weight:700;color:#7dd3fc;margin-bottom:2px}
  #rec-card{position:fixed;inset:0;z-index:2147483001;direction:rtl;display:flex;flex-direction:column;align-items:center;justify-content:center;
    text-align:center;padding:32px;background:linear-gradient(160deg,#0369a1,#0c4a6e);color:#fff;font-family:Heebo,Arial,sans-serif;
    transition:opacity .35s;opacity:0;pointer-events:none}
  #rec-card .step{font-size:16px;font-weight:700;color:#bae6fd;letter-spacing:.02em}
  #rec-card .big{font-size:34px;font-weight:900;margin-top:10px;line-height:1.2}
  #rec-card .small{font-size:18px;margin-top:14px;color:#e0f2fe;line-height:1.5;max-width:320px}
  #rec-card .ok{width:84px;height:84px;border-radius:50%;background:#10b981;display:flex;align-items:center;justify-content:center;margin-bottom:18px}
  .rec-tap{position:fixed;z-index:2147483002;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;pointer-events:none;
    background:rgba(56,189,248,.35);border:3px solid rgba(14,165,233,.9);animation:rectap .6s ease-out forwards}
  @keyframes rectap{0%{transform:scale(.5);opacity:1}100%{transform:scale(1.5);opacity:0}}
  nextjs-portal{display:none!important}`;
  const add = () => {
    if (document.getElementById('rec-style')) return;
    const s = document.createElement('style'); s.id = 'rec-style'; s.textContent = css; document.head.appendChild(s);
    const cap = document.createElement('div'); cap.id = 'rec-cap'; document.body.appendChild(cap);
    const card = document.createElement('div'); card.id = 'rec-card'; document.body.appendChild(card);
  };
  window.__cap = (tag, text) => { add(); const c = document.getElementById('rec-cap');
    if (!text) { c.style.opacity = 0; return; } c.innerHTML = (tag ? `<span class="tag">${tag}</span>` : '') + text; c.style.opacity = 1; };
  window.__card = (step, big, small, ok) => { add(); const c = document.getElementById('rec-card');
    if (!big) { c.style.opacity = 0; return; }
    c.innerHTML = (ok ? '<div class="ok"><svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>' : '')
      + (step ? `<div class="step">${step}</div>` : '') + `<div class="big">${big}</div>` + (small ? `<div class="small">${small}</div>` : '');
    c.style.opacity = 1; };
  document.addEventListener('pointerdown', e => { const t = document.createElement('div'); t.className = 'rec-tap';
    t.style.left = e.clientX + 'px'; t.style.top = e.clientY + 'px'; document.body.appendChild(t); setTimeout(() => t.remove(), 700); }, true);
  if (document.readyState !== 'loading') add(); else document.addEventListener('DOMContentLoaded', add);
})();
"""

STEPS_TOTAL = 5


def record(name, start_path, script, morning=False):
    """The page at a phone's full resolution, frame by frame (the browser's own screencast) — each frame with its time,
    from the first card to the last; the edit makes the video from them. `morning`: the browser's clock at 10:00 the
    next day, where the working day's demo items wait."""
    import base64, shutil
    frames_dir = OUT / f"frames_{name}"
    shutil.rmtree(frames_dir, ignore_errors=True)
    frames_dir.mkdir()
    frames = []
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        ctx = b.new_context(viewport=VIEW, device_scale_factor=2, is_mobile=True, has_touch=True, locale="he-IL",
                            timezone_id="Asia/Jerusalem", ignore_https_errors=True)
        ctx.set_default_timeout(60000)
        ctx.add_init_script(OVERLAY)
        if morning:
            ctx.clock.set_fixed_time(MORNING)
        ctx.add_init_script(f"try {{ localStorage.setItem('bizcontrol_token', '{token}'); localStorage.setItem('biz_hide_selfbooking_banner', '1'); localStorage.setItem('bc_tour_minimized', '1'); localStorage.setItem('viki_popups', '0'); }} catch (e) {{}}")   # no ויקי popping in over a video
        pg = ctx.new_page()
        pg.goto(f"{WEB}{start_path}", wait_until="commit")
        pg.wait_for_selector("nav.fixed", timeout=120000)
        pg.wait_for_timeout(3500)
        cdp = ctx.new_cdp_session(pg)

        def on_frame(params):
            path = frames_dir / f"f{len(frames):05d}.jpg"
            path.write_bytes(base64.b64decode(params["data"]))
            frames.append((params["metadata"]["timestamp"], path.name))
            try:
                cdp.send("Page.screencastFrameAck", {"sessionId": params["sessionId"]})
            except Exception:
                pass
        cdp.on("Page.screencastFrame", on_frame)
        cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 90, "maxWidth": VIEW["width"] * 2,
                                          "maxHeight": VIEW["height"] * 2, "everyNthFrame": 1})
        pg.wait_for_timeout(300)
        start = time.time()
        script(pg)
        end = time.time()
        pg.wait_for_timeout(300)
        cdp.send("Page.stopScreencast")
        ctx.close()
        b.close()
    meta = {"frames": str(frames_dir), "list": frames, "start": start, "end": end}
    (OUT / f"{name}.json").write_text(json.dumps(meta))
    print(name, len(frames), "frames,", round(end - start, 1), "s", flush=True)


# ── helpers for a script ──
def cap(pg, tag, text, hold=1600):
    pg.evaluate("([t, x]) => window.__cap(t, x)", [tag, text])
    pg.wait_for_timeout(hold)


def card(pg, step, big, small="", ok=False, hold=2600):
    pg.evaluate("([s, b, m, o]) => window.__card(s, b, m, o)", [step, big, small, ok])
    pg.wait_for_timeout(hold)
    if ok:                       # the closing card — the video ends on it
        return
    pg.evaluate("() => window.__card('', '')")
    pg.wait_for_timeout(450)


def tap(pg, locator, after=1100):
    loc = locator.first
    loc.scroll_into_view_if_needed()
    pg.wait_for_timeout(350)
    loc.tap() if loc.is_visible() else loc.click()
    pg.wait_for_timeout(after)


def type_in(pg, locator, text, after=700):
    loc = locator.first
    loc.scroll_into_view_if_needed()
    loc.tap()
    loc.press_sequentially(text, delay=75)
    pg.wait_for_timeout(after)


def open_business(pg, category, tile):
    tap(pg, pg.locator("button[aria-controls='mobile-business-sheet']"), after=1200)
    tap(pg, pg.locator(f"#mobile-business-sheet button:has-text('{category}')"), after=1000)
    tap(pg, pg.locator(f"#mobile-business-sheet a:has-text('{tile}')"), after=2500)


# ── the five steps ──
def step_business(pg):
    tag = f"שלב 1 מתוך {STEPS_TOTAL} · פרטי העסק והלוגו"
    card(pg, f"שלב 1 מתוך {STEPS_TOTAL}", "פרטי העסק והלוגו", "הלוגו והכתובת מופיעים בהודעות ללקוחות ובדף העסק")
    cap(pg, tag, "פותחים את \"ניהול עסק\" ובוחרים \"הגדרות\"", 1400)
    open_business(pg, "הגדרות", "הגדרות")
    pg.locator("[data-tour=logo-upload]").first.wait_for()
    cap(pg, tag, "לוחצים על \"בחר תמונה\" ובוחרים את הלוגו מהטלפון", 1200)
    pg.locator("[data-tour=logo-upload]").first.scroll_into_view_if_needed()
    pg.wait_for_timeout(500)
    with pg.expect_file_chooser() as fc:
        pg.locator("[data-tour=logo-upload]").first.tap()
    fc.value.set_files(str(logo))
    pg.get_by_text("לוגו הועלה בהצלחה").first.wait_for()
    pg.wait_for_timeout(1500)
    cap(pg, tag, "כותבים את כתובת העסק", 600)
    type_in(pg, pg.locator("[data-tour=business-address]"), "רחוב הרצל 12, תל אביב")
    cap(pg, tag, "ולוחצים על \"שמור הגדרות העסק\"", 1000)
    tap(pg, pg.locator("button:has-text('שמור הגדרות העסק')"), after=400)
    pg.get_by_text("נשמרו בהצלחה").first.wait_for()          # really saved — or the recording stops here
    pg.wait_for_timeout(1800)
    cap(pg, tag, "")
    card(pg, "", "מעולה!", "פרטי העסק והלוגו נשמרו", ok=True)


def step_service(pg):
    tag = f"שלב 2 מתוך {STEPS_TOTAL} · שירות ראשון"
    card(pg, f"שלב 2 מתוך {STEPS_TOTAL}", "שירות ראשון", "שירות הוא מה שהעסק מוכר — עם מחיר ומשך")
    cap(pg, tag, "\"ניהול עסק\" ← \"תורים ושירותים\" ← \"שירותים\"", 1400)
    open_business(pg, "תורים ושירותים", "שירותים")
    cap(pg, tag, "לוחצים על \"שירות חדש\"", 900)
    tap(pg, pg.locator("[data-tour=service-new]"), after=1300)
    cap(pg, tag, "כותבים את שם השירות", 500)
    type_in(pg, pg.locator("[data-tour=service-form] input").nth(0), "קעקוע קטן")
    cap(pg, tag, "ואת המחיר", 500)
    type_in(pg, pg.locator("[data-tour=service-form] input[type=number]"), "300")
    cap(pg, tag, "ולוחצים על \"צור שירות\"", 1000)
    tap(pg, pg.locator("[data-tour=service-form] button:has-text('צור שירות')"), after=400)
    pg.locator("[data-tour=service-form]").wait_for(state="hidden")
    pg.wait_for_timeout(1800)
    cap(pg, tag, "")
    card(pg, "", "מעולה!", "השירות הראשון שלך נשמר", ok=True)


def step_client(pg):
    tag = f"שלב 3 מתוך {STEPS_TOTAL} · לקוח ראשון"
    card(pg, f"שלב 3 מתוך {STEPS_TOTAL}", "לקוח ראשון", "לכל לקוח יש כרטיס: פרטים, תורים ותשלומים")
    cap(pg, tag, "לוחצים על \"לקוחות\" בשורה התחתונה", 1200)
    tap(pg, pg.locator("nav.fixed a[href='/clients']"), after=2500)
    cap(pg, tag, "ועל \"לקוח חדש\"", 900)
    tap(pg, pg.locator("[data-tour=client-new]"), after=1300)
    fields = pg.locator("[data-tour=client-form] input:not([type=checkbox])")
    cap(pg, tag, "כותבים שם וטלפון", 500)
    type_in(pg, fields.nth(0), "דנה לוי")
    type_in(pg, fields.nth(1), "0501234567")
    cap(pg, tag, "ולוחצים על \"שמור\"", 1000)
    tap(pg, pg.locator("[data-tour=client-form] button:has-text('שמור')"), after=400)
    pg.locator("[data-tour=client-form]").wait_for(state="hidden")
    pg.wait_for_timeout(1800)
    cap(pg, tag, "")
    card(pg, "", "מעולה!", "הלקוח הראשון נוסף", ok=True)


def step_appointment(pg):
    tag = f"שלב 4 מתוך {STEPS_TOTAL} · תור ראשון"
    card(pg, f"שלב 4 מתוך {STEPS_TOTAL}", "תור ראשון", "קובעים ביומן תור ללקוח ולשירות")
    cap(pg, tag, "ביומן לוחצים על +", 1200)
    tap(pg, pg.locator("[data-tour=appointment-new]"), after=1500)
    cap(pg, tag, "בוחרים לקוח", 500)
    type_in(pg, pg.locator("[data-tour=appointment-form] input[placeholder='חפש לפי שם או טלפון...']"), "דנה", after=1200)
    tap(pg, pg.locator("[data-tour=appointment-form] div.cursor-pointer:has-text('דנה לוי')"), after=900)
    cap(pg, tag, "בוחרים את השירות", 500)
    tap(pg, pg.locator("[data-tour=appointment-form] button[aria-pressed]:has-text('קעקוע קטן')"), after=900)
    cap(pg, tag, "התאריך והשעה כבר מולאו (חצי השעה הבאה) — אפשר לשנות אותם", 2000)
    cap(pg, tag, "ולוחצים על \"קבע תור חדש\"", 900)
    tap(pg, pg.locator("[data-tour=appointment-form] button:has-text('קבע תור חדש')"), after=400)
    pg.locator("[data-tour=appointment-form]").wait_for(state="hidden")
    pg.wait_for_timeout(2200)
    cap(pg, tag, "")
    card(pg, "", "מעולה!", "התור הראשון נקבע ביומן", ok=True)


def step_payment(pg):
    tag = f"שלב 5 מתוך {STEPS_TOTAL} · אמצעי תשלום למקדמות"
    card(pg, f"שלב 5 מתוך {STEPS_TOTAL}", "אמצעי תשלום למקדמות", "כדי שלקוחות יוכלו לשלם מקדמה — ביט, פייבוקס או העברה בנקאית")
    cap(pg, tag, "פותחים את \"ניהול עסק\" ובוחרים \"הגדרות\"", 1400)
    open_business(pg, "הגדרות", "הגדרות")
    cap(pg, tag, "עוברים ללשונית \"פיננסים ותשלומים\"", 900)
    tap(pg, pg.get_by_role("tab", name="פיננסים"), after=1800)
    cap(pg, tag, "מדביקים את קישור הביט שלכם", 600)
    type_in(pg, pg.locator("[data-tour=pay-bit]"), "https://www.bitpay.co.il/app/me/example")
    cap(pg, tag, "ולוחצים על \"שמור הגדרות העסק\"", 1000)
    tap(pg, pg.locator("button:has-text('שמור הגדרות העסק')"), after=400)
    pg.get_by_text("נשמרו בהצלחה").first.wait_for()
    pg.wait_for_timeout(1800)
    cap(pg, tag, "")
    card(pg, "", "מעולה!", "אמצעי התשלום נשמר ומופיע בדף התשלום של הלקוחות", ok=True)


# ── the owner's working day (2026-10-15) ──
# Its demo items wait at 10:00–13:00 the next day, and the browser's clock says it's 10:00 then — a calm morning in
# the calendar, nothing overdue (the server's clock is the real one, and to it they are in the future).
import base64
import datetime as _dt
import pytz
IL = pytz.timezone("Asia/Jerusalem")
DAY = (_dt.datetime.now(IL) + _dt.timedelta(days=1)).date()
MORNING = IL.localize(_dt.datetime.combine(DAY, _dt.time(10, 0)))
WORKER = {}


def api(method, path, h=None, **kw):
    r = requests.request(method, f"{API}{path}", headers=h or H, verify=False, **kw)
    assert r.status_code < 300, (path, r.status_code, r.text[:300])
    return r.json() if r.text else None


def working_day():
    """The demo business's working day: a service and a client, a worker, an appointment whose client said they paid
    the deposit (with the picture they sent), a task for the worker. Once per run."""
    if WORKER:
        return
    claims = json.loads(base64.urlsafe_b64decode(token.split(".")[1] + "=="))
    if claims["exp"] < MORNING.timestamp() + 3600:
        sys.exit("The API's sign-in ends before tomorrow morning — run it with ACCESS_TOKEN_MINUTES=1440 (see the top)")
    api("PUT", "/api/tutorial/owner_workday", json={"state": "done"})                 # no guide over the video
    api("POST", "/api/services", json={"name": "קעקוע קטן", "price_cents": 30000, "duration_minutes": 60})
    client = api("POST", "/api/clients", json={"full_name": "דנה לוי", "phone": "0501234567"})
    me = api("GET", "/api/auth/me")

    def at(hh, mm):
        return IL.localize(_dt.datetime.combine(DAY, _dt.time(hh, mm))).astimezone(_dt.timezone.utc).isoformat()
    appt = api("POST", "/api/appointments", json={"client_id": client["id"], "artist_id": me["id"], "title": "קעקוע קטן",
                                                   "starts_at": at(11, 0), "ends_at": at(12, 0), "deposit_amount_cents": 10000})
    w_email = f"yossi{n}@example.com"
    worker = api("POST", "/api/users/artists", json={"email": w_email, "password": "password123", "display_name": "יוסי", "role": "artist"})
    con = psycopg2.connect("postgresql://bizcontrol:bizcontrol@localhost:5433/bizcontrol_dev")
    with con, con.cursor() as cur:
        cur.execute("UPDATE users SET email_verified = true WHERE email = %s", (w_email,))
        cur.execute("UPDATE appointments SET payment_sent_at = now() - interval '20 minutes' WHERE id = %s", (appt["id"],))
    con.close()
    api("POST", "/api/tasks", json={"title": "להזמין דיו שחור", "task_date": DAY.isoformat(), "start_time": "10:30",
                                     "end_time": "11:00", "assignee_id": worker["id"]})
    WORKER.update(appt=appt["id"])


def press_long(pg, hour, day):
    """A long press on the calendar at an hour of a day (a phone's way to pick an empty hour) — the mouse, held, with the
    tap circle drawn."""
    row = pg.locator(f".fc-timegrid-slot-lane[data-time='{hour}:00']").first
    row.scroll_into_view_if_needed()
    pg.wait_for_timeout(500)
    rb = row.bounding_box()
    cb = pg.locator(f".fc-timegrid-col[data-date='{day.isoformat()}']").first.bounding_box()
    x, y = cb["x"] + cb["width"] / 2, rb["y"] + rb["height"] / 2
    pg.evaluate("([x, y]) => { const t = document.createElement('div'); t.className = 'rec-tap'; t.style.left = x + 'px';"
                " t.style.top = y + 'px'; document.body.appendChild(t); setTimeout(() => t.remove(), 700); }", [x, y])
    pg.mouse.move(x, y)
    pg.mouse.down()
    pg.wait_for_timeout(450)
    pg.mouse.up()
    pg.wait_for_timeout(1200)


def step_pos_sale(pg):
    tag = "יום עבודה · שלב 1 מתוך 3 · מכירה בקופה"
    card(pg, "יום עבודה · שלב 1 מתוך 3", "מכירה בקופה", "הקופה רושמת את התשלום ומפיקה קבלה ללקוח")
    cap(pg, tag, "לוחצים על \"קופה\" בשורה התחתונה", 1200)
    tap(pg, pg.locator("nav.fixed a[href='/pos']"), after=2500)
    cap(pg, tag, "בוחרים את השירות שנמכר — המחיר מתמלא לבד", 900)
    tap(pg, pg.locator("[data-tour=pos-services]:visible button:has-text('קעקוע קטן')"), after=1200)
    cap(pg, tag, "(אפשר גם להקליד מחיר במקלדת)", 1500)
    cap(pg, tag, "לוחצים על \"+ הוסף לעגלה\"", 900)
    tap(pg, pg.locator("[data-tour=pos-add]:visible"), after=1800)
    cap(pg, tag, "בוחרים איך הלקוח שילם", 900)
    tap(pg, pg.locator("button:visible:has-text('מזומן')").last, after=900)
    cap(pg, tag, "ולוחצים על \"גבה\"", 900)
    tap(pg, pg.locator("[data-tour=pos-checkout]:visible"), after=400)
    pg.get_by_text("תשלום בוצע!").first.wait_for()            # really sold — or the recording stops here
    pg.wait_for_timeout(2000)
    cap(pg, tag, "")
    card(pg, "", "מעולה!", "המכירה נרשמה והקבלה הופקה", ok=True)


def step_deposit(pg):
    tag = "יום עבודה · שלב 2 מתוך 3 · אישור מקדמה"
    card(pg, "יום עבודה · שלב 2 מתוך 3", "אישור מקדמה", "לקוח שילם מקדמה ולחץ \"שילמתי\" — מאשרים, וזה מפיק קבלה")
    cap(pg, tag, "ביומן, תור שהלקוח דיווח ששילם מסומן בפעמון — לוחצים עליו", 1600)
    tap(pg, pg.locator(".fc-event:has-text('דנה לוי')"), after=1600)
    cap(pg, tag, "כאן רואים שהלקוח דיווח ששילם", 1800)
    cap(pg, tag, "לוחצים על \"אישור המקדמה\"", 900)
    tap(pg, pg.locator("[data-tour=deposit-approve]"), after=1500)
    cap(pg, tag, "בוחרים באיזה אמצעי התקבלה המקדמה", 900)
    tap(pg, pg.locator("[data-tour=deposit-confirm] button:has-text('Bit')"), after=900)
    cap(pg, tag, "ולוחצים על \"אשר וצור קבלה\"", 900)
    tap(pg, pg.locator("button:has-text('אשר וצור קבלה')"), after=400)
    pg.get_by_text("קבלה נוצרה!").first.wait_for()
    pg.wait_for_timeout(2000)
    cap(pg, tag, "")
    card(pg, "", "מעולה!", "המקדמה אושרה והקבלה הופקה", ok=True)


def step_worker_task(pg):
    tag = "יום עבודה · שלב 3 מתוך 3 · משימה לעובד"
    card(pg, "יום עבודה · שלב 3 מתוך 3", "משימה לעובד", "העובד מקבל הודעה, ותזכורת כל עוד לא סימן \"בוצע\"")
    cap(pg, tag, "ביומן לוחצים לחיצה ארוכה על שעה פנויה", 1400)
    press_long(pg, "13:00", DAY)
    cap(pg, tag, "בוחרים \"משימה / תזכורת\"", 900)
    tap(pg, pg.locator("[data-tour=type-task]"), after=1500)
    cap(pg, tag, "כותבים מה צריך לעשות", 500)
    type_in(pg, pg.locator("input[placeholder^='לדוגמה: ארנונה']"), "לנקות את חדר הטיפולים")
    cap(pg, tag, "ובוחרים ב\"למי המשימה\" את העובד", 1000)
    pg.locator("[data-tour=task-assignee] select").select_option(label="יוסי")
    pg.wait_for_timeout(1500)
    cap(pg, tag, "ולוחצים על \"הוסף משימה\"", 900)
    tap(pg, pg.locator("button:has-text('הוסף משימה')"), after=400)
    pg.locator("[data-tour=task-assignee]").wait_for(state="hidden")
    pg.wait_for_timeout(2000)
    cap(pg, tag, "")
    card(pg, "", "מעולה!", "המשימה נמסרה — יוסי קיבל הודעה", ok=True)


# ── the messages to clients (2026-10-16) — the owner's own demo business, nothing sent ──
def _messages_card(pg, n, title, small):
    card(pg, f"ההודעות ללקוחות · שלב {n} מתוך 4", title, small)


def step_messages_where(pg):
    tag = "ההודעות ללקוחות · שלב 1 מתוך 4 · כל ההודעות במקום אחד"
    _messages_card(pg, 1, "כל ההודעות במקום אחד", "כל מה שהמערכת שולחת ללקוחות בשבילך — ומתי")
    cap(pg, tag, "\"ניהול עסק\" ← \"לקוחות ושיווק\" ← \"תבניות הודעות\"", 1400)
    open_business(pg, "לקוחות ושיווק", "תבניות הודעות")
    pg.locator("[data-tour=msg-card]").first.wait_for()
    cap(pg, tag, "כל כרטיס הוא הודעה אחת — ומתחת לשם כתוב מתי היא יוצאת", 2200)
    for y in (420, 840, 1260):
        pg.mouse.wheel(0, 420)
        pg.wait_for_timeout(900)
    cap(pg, tag, "תורים, תזכורות, תשלומים, מועדון — הכול לפי נושא", 2200)
    cap(pg, tag, "")
    card(pg, "", "זה הכול!", "ההודעות יוצאות לבד — לא צריך לעשות כלום", ok=True)


def step_messages_off(pg):
    tag = "ההודעות ללקוחות · שלב 2 מתוך 4 · לכבות הודעה"
    _messages_card(pg, 2, "לכבות הודעה", "הודעה כבויה לא יוצאת לאף לקוח")
    pg.locator("[data-tour=msg-switch]").first.wait_for()
    cap(pg, tag, "לכל הודעה יש מתג", 1300)
    switch = pg.locator("[data-tour=msg-switch] button, [data-tour=msg-switch] [role=switch]").first
    tap(pg, switch, after=1600)
    cap(pg, tag, "כבויה — היא לא תצא לאף לקוח", 2000)
    cap(pg, tag, "רוצים שתחזור? מדליקים באותו מתג", 900)
    tap(pg, switch, after=1600)
    cap(pg, tag, "תזכורות ואישורים לתורים יוצאים תמיד — אלא אם כיביתם אותם כאן", 2600)
    cap(pg, tag, "")
    card(pg, "", "זה הכול!", "מתג אחד — לכל הלקוחות", ok=True)


def step_messages_text(pg):
    tag = "ההודעות ללקוחות · שלב 3 מתוך 4 · לשנות את הנוסח"
    _messages_card(pg, 3, "לשנות את הנוסח", "נוסח משלכם — ורואים איך הלקוח יראה אותו")
    pg.locator("[data-tour=msg-edit]").first.wait_for()
    cap(pg, tag, "לחצו \"עריכת הנוסח\"", 1000)
    tap(pg, pg.locator("[data-tour=msg-edit]"), after=1500)
    editor = pg.locator("[data-tour=msg-editor]")
    cap(pg, tag, "כותבים את ההודעה במילים שלכם", 700)
    editor.first.fill("")
    type_in(pg, editor, "היי ", after=300)
    cap(pg, tag, "הכפתורים מוסיפים פרטים — שם הלקוח, תאריך, שעה", 900)
    tap(pg, pg.locator("button:has-text('+ שם לקוח')"), after=600)
    pg.keyboard.type(", התור שלך ב-", delay=75)            # on from where the detail went in — no tap in the box
    tap(pg, pg.locator("button:has-text('+ תאריך תור')"), after=600)
    pg.keyboard.type(" אושר. מחכים לך!", delay=75)
    pg.wait_for_timeout(600)
    pg.locator("[data-tour=msg-preview]").first.scroll_into_view_if_needed()
    cap(pg, tag, "וכאן רואים בדיוק איך הלקוח יראה את זה", 2400)
    cap(pg, tag, "מרוצים? לחצו \"שמירה\"", 900)
    tap(pg, pg.locator("button:has-text('שמירה')").last, after=400)
    pg.get_by_text("הנוסח נשמר").first.wait_for()
    pg.wait_for_timeout(1400)
    cap(pg, tag, "רוצים לחזור? \"חזרה לנוסח של המערכת\"", 2000)
    cap(pg, tag, "")
    card(pg, "", "מעולה!", "הנוסח שלכם נשמר", ok=True)


def step_messages_optout(pg):
    tag = "ההודעות ללקוחות · שלב 4 מתוך 4 · הסרה מהודעות שיווקיות"
    _messages_card(pg, 4, "הסרה מהודעות שיווקיות", "תפוצות, הזמנה למועדון, ברכת יום הולדת")
    marketing = pg.locator("[data-tour=msg-marketing]").first
    marketing.wait_for()
    marketing.scroll_into_view_if_needed()
    pg.wait_for_timeout(600)
    cap(pg, tag, "לקוח שלא רוצה הודעות שיווקיות יכול להסיר את עצמו", 1800)
    cap(pg, tag, "בקישור שבהודעה, או בתשובה \"הסר\" בוואטסאפ", 2200)
    cap(pg, tag, "ואפשר גם לכבות לו את זה בכרטיס הלקוח:", 900)
    pg.goto(f"{WEB}/clients/{MESSAGES['client']}", wait_until="commit")
    pg.wait_for_function("() => [...document.querySelectorAll('nav.fixed')].some(e => e.getBoundingClientRect().width > 0)", timeout=120000)
    block = pg.locator("h3:has-text('הודעות שיווקיות')").first
    block.wait_for()
    block.scroll_into_view_if_needed()
    pg.wait_for_timeout(900)
    cap(pg, tag, "כאן, ב\"הודעות שיווקיות\"", 2000)
    cap(pg, tag, "תזכורות ואישורים לתורים ימשיכו לצאת אליו", 2400)
    cap(pg, tag, "")
    card(pg, "", "זה הכול!", "הלקוח מחליט — והתורים שלו ממשיכים כרגיל", ok=True)


MESSAGES = {}


def messages_setup():
    if MESSAGES:
        return
    api("PUT", "/api/tutorial/owner_messages", json={"state": "done"})
    c = api("POST", "/api/clients", json={"full_name": "דנה לוי", "phone": "0501234567"})
    MESSAGES["client"] = c["id"]


STEPS = [("business", step_business, {}), ("service", step_service, {}), ("client", step_client, {}),
         ("appointment", step_appointment, {}), ("payment", step_payment, {}),
         ("pos_sale", step_pos_sale, {"day": True}), ("deposit", step_deposit, {"day": True}),
         ("worker_task", step_worker_task, {"day": True}),
         ("messages_where", step_messages_where, {"messages": True}), ("messages_off", step_messages_off, {"messages": True, "start": "/message-templates"}),
         ("messages_text", step_messages_text, {"messages": True, "start": "/message-templates"}),
         ("messages_optout", step_messages_optout, {"messages": True, "start": "/message-templates"})]
try:
    for name, script, how in STEPS:
        if ONLY and name not in ONLY:
            continue
        if how.get("day"):
            working_day()
        if how.get("messages"):
            messages_setup()
        record(name, how.get("start", "/calendar"), script, morning=bool(how.get("day")))
finally:
    con = psycopg2.connect("postgresql://bizcontrol:bizcontrol@localhost:5433/bizcontrol_dev")
    with con, con.cursor() as cur:                       # what the demo queued — never sent (no scheduler), now gone
        cur.execute("DELETE FROM message_jobs WHERE studio_id = (SELECT studio_id FROM users WHERE email = %s)", (email,))
        print("demo messages removed:", cur.rowcount)
    con.close()
