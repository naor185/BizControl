"""
The initial business types (תחומי עסק).

The database table business_type_templates is the one source of truth — the superadmin edits it and
every screen reads it. This list only seeds it: start.py inserts a type that is missing and fills a
field that is still empty, but never overwrites what someone changed.

Per type:
- key            stored on studios.business_type and businesses.category
- label          what people see
- icon           a Lucide icon name (kebab-case), rendered with lucide-react's DynamicIcon
- color          the type's color on BizFind (cards, chips, map)
- directory_only BizFind directory listing only — a business without appointments (shop, pharmacy)
- aliases        older names (earlier labels, the signup forms' lists) — turn free text into a type
- osm_tag        the OpenStreetMap tag the superadmin's BizFind import uses for this type
- modules        modules loaded when the superadmin applies the type's defaults
- services       sample services the owner can load on the services screen (price in ₪)
- messages       the field's default message texts ({"aftercare": …}); a field without one uses
                 GENERIC_MESSAGES. Care instructions exist only where they are right for the field.
- terms          the field's words (see TERM_LABELS) — used as labels and nouns ("מניקוריסטית: דנה",
                 "ביצועי המדריכים"), never inside a sentence whose verb must agree in gender. A type
                 without terms (directory listings, "other") uses GENERIC_TERMS. The owner can change
                 any word for their own business (studio_settings.business_terms).
"""

# The words that change with the field, and what the owner sees next to each in settings.
TERM_LABELS = {
    "staff": "איך נקרא מי שנותן/ת את השירות",
    "staff_plural": "ובלשון רבים",
    "service": "איך נקרא השירות",
    "service_plural": "ובלשון רבים",
    "client": "איך נקרא/ת הלקוח/ה",
    "client_plural": "ובלשון רבים",
    "place": "איך נקרא המקום",
}

# For a field without its own words. ("נותן/ת שירות", not "איש/אשת צוות" — that is the name of another
# role on the team screen, a staff member without management rights.)
GENERIC_TERMS = {
    "staff": "נותן/ת שירות", "staff_plural": "נותני שירות", "service": "שירות", "service_plural": "שירותים",
    "client": "לקוח/ה", "client_plural": "לקוחות", "place": "עסק",
}

# Tattoo aftercare instructions — the text every business used to get as its default, whatever its field.
TATTOO_AFTERCARE = 'היי {client_name}! 🎉\n\nלאחר סיום הקעקוע נשארים עם הניילון/מדבקה למשך כשעתיים.\nלאחר מכן ניתן להסיר את הניילון או המדבקה ולשטוף בעדינות עם מים פושרים וסבון.\n\nיום לאחר הקעקוע מתחילים למרוח את החמאה/המשחה פעמיים ביום - בוקר וערב למשך שלושה שבועות.\nיש למרוח שכבה דקה ומאוזנת: לא יותר מדי ולא מעט מדי.\n\nבמקרים של יובש גבוה ניתן למרוח עד 3 פעמים ביום.\n\nבזמן ההחלמה:\n❌ לא לגרד\n❌ לא לקלף\n🚫 להימנע מבריכה, ים, ג׳קוזי וסאונה למשך שבועיים\n\nלאחר כחודש וחצי מומלץ להגיע לביקורת כדי לוודא החלמה מלאה של הקעקוע. 🙏'

# For a field without its own texts: thanks and an offer to help — no care instructions, because
# instructions written for another field are wrong (and can be harmful) for this one.
GENERIC_MESSAGES = {
    "aftercare": (
        "היי {client_name}! 🙏\n\n"
        "תודה שבחרת בנו.\n"
        "אם יש לך שאלה — אנחנו כאן ונשמח לעזור."
    ),
}

# Texts the old settings screen saved into every business's settings as if the owner had written them
# (it pre-filled its defaults and saved them). start.py clears a saved text still equal to one of these,
# so the field's default applies; a text the owner changed is left alone.
LEGACY_SAVED_ONLY_IF_UNCHANGED = {
    "aftercare_message": TATTOO_AFTERCARE,
    "deposit_approved_wa_template": '✅ {client_name}, המקדמה אושרה!\n\nהתור שלך מאושר ונעול:\n📅 תאריך: {appointment_date}\n🕐 שעה: {appointment_time}\n✂️ אמן/ית: {artist_name}\n📍 כתובת: {studio_address}\n🗺️ ניווט: {map_link}\n🖼️ תיק עבודות: {portfolio_link}\n\n*מדיניות ביטולים:* ביטול עד {cancellation_free_days} ימים לפני — החזר מלא. פחות מ-{cancellation_free_days} ימים — ללא החזר מקדמה. שינוי תור אפשרי עד {deposit_lock_days} ימים לפני.\n\nמחכים לך! 🙏',
}

BUSINESS_TYPES: list[dict] = [
    {"key": "tattoo", "label": "קעקועים", "icon": "palette", "color": "#7c3aed", "sort": 10,
     "aliases": ["סטודיו קעקועים", "קעקוע", "קעקועים ופירסינג", "tattoo"], "osm_tag": "shop=tattoo",
     "terms": {"staff": "אמן/ית", "staff_plural": "אמנים", "service": "קעקוע", "service_plural": "קעקועים", "client": "לקוח/ה", "client_plural": "לקוחות", "place": "סטודיו"},
     "messages": {"aftercare": TATTOO_AFTERCARE},
     "modules": ["crm", "calendar", "payments", "whatsapp", "customer_club", "ocr"],
     "services": [{"name": "ייעוץ", "duration_minutes": 60, "price": 0, "color": "#8b5cf6"},
                  {"name": "קעקוע קטן", "duration_minutes": 120, "price": 300, "color": "#7c3aed"},
                  {"name": "קעקוע בינוני", "duration_minutes": 240, "price": 600, "color": "#6d28d9"},
                  {"name": "קעקוע גדול", "duration_minutes": 360, "price": 900, "color": "#5b21b6"}]},
    {"key": "barber", "label": "ספרות וברברשופ", "icon": "scissors", "color": "#0284c7", "sort": 20,
     "aliases": ["ספר / ברברשופ", "ספרות", "ספר", "ברברשופ", "מספרת גברים", "barber"], "osm_tag": "shop=hairdresser",
     "terms": {"staff": "ספר/ית", "staff_plural": "ספרים", "service": "תספורת", "service_plural": "תספורות", "client": "לקוח/ה", "client_plural": "לקוחות", "place": "מספרה"},
     "modules": ["crm", "calendar", "payments", "whatsapp", "online_booking", "wait_list"],
     "services": [{"name": "תספורת", "duration_minutes": 30, "price": 60, "color": "#0ea5e9"},
                  {"name": "זקן", "duration_minutes": 20, "price": 40, "color": "#0284c7"},
                  {"name": "תספורת + זקן", "duration_minutes": 45, "price": 90, "color": "#0369a1"}]},
    {"key": "hair", "label": "עיצוב שיער", "icon": "brush", "color": "#c026d3", "sort": 30,
     "aliases": ["מעצב שיער", "מעצבת שיער", "סלון שיער", "מספרה"], "osm_tag": "shop=hairdresser",
     "terms": {"staff": "מעצב/ת שיער", "staff_plural": "מעצבי שיער", "service": "טיפול", "service_plural": "טיפולים", "client": "לקוח/ה", "client_plural": "לקוחות", "place": "סלון"},
     "modules": ["crm", "calendar", "payments", "whatsapp", "online_booking", "customer_club"],
     "services": [{"name": "תספורת", "duration_minutes": 45, "price": 120, "color": "#d946ef"},
                  {"name": "צבע", "duration_minutes": 90, "price": 300, "color": "#c026d3"},
                  {"name": "פן", "duration_minutes": 30, "price": 90, "color": "#a21caf"}]},
    {"key": "nails", "label": "מניקור ופדיקור", "icon": "hand", "color": "#db2777", "sort": 40,
     "aliases": ["ציפורניים", "פדיקור ומניקור", "מניקור", "פדיקור", "לק ג'ל", "nails"], "osm_tag": "shop=beauty",
     "terms": {"staff": "מניקוריסטית", "staff_plural": "מניקוריסטיות", "service": "טיפול", "service_plural": "טיפולים", "client": "לקוח/ה", "client_plural": "לקוחות", "place": "סטודיו"},
     "modules": ["crm", "calendar", "payments", "whatsapp", "online_booking"],
     "services": [{"name": "מניקור", "duration_minutes": 45, "price": 80, "color": "#ec4899"},
                  {"name": "פדיקור", "duration_minutes": 60, "price": 100, "color": "#db2777"},
                  {"name": "לק ג'ל", "duration_minutes": 60, "price": 120, "color": "#be185d"},
                  {"name": "בנייה", "duration_minutes": 90, "price": 200, "color": "#9d174d"}]},
    {"key": "spa", "label": "קוסמטיקה וספא", "icon": "flower-2", "color": "#059669", "sort": 50,
     "aliases": ["ספא / קוסמטיקה", "קוסמטיקה ויופי", "קוסמטיקה", "קוסמטיקאית", "ספא", "spa"], "osm_tag": "shop=beauty",
     "terms": {"staff": "קוסמטיקאית", "staff_plural": "קוסמטיקאיות", "service": "טיפול", "service_plural": "טיפולים", "client": "לקוח/ה", "client_plural": "לקוחות", "place": "מכון"},
     "modules": ["crm", "calendar", "payments", "whatsapp", "online_booking", "customer_club"],
     "services": [{"name": "פנים בסיסי", "duration_minutes": 60, "price": 200, "color": "#6366f1"},
                  {"name": "עיסוי שוודי", "duration_minutes": 60, "price": 250, "color": "#4f46e5"},
                  {"name": "עיסוי רקמות עמוק", "duration_minutes": 90, "price": 320, "color": "#4338ca"}]},
    {"key": "laser", "label": "לייזר והסרת שיער", "icon": "zap", "color": "#4338ca", "sort": 60,
     "aliases": ["קליניקת לייזר", "לייזר", "הסרת שיער", "laser"], "osm_tag": "shop=beauty",
     "terms": {"staff": "מטפל/ת", "staff_plural": "מטפלים", "service": "טיפול", "service_plural": "טיפולים", "client": "לקוח/ה", "client_plural": "לקוחות", "place": "קליניקה"},
     "modules": ["crm", "calendar", "payments", "whatsapp", "email", "online_booking"],
     "services": [{"name": "לייזר שפם", "duration_minutes": 30, "price": 150, "color": "#f59e0b"},
                  {"name": "לייזר ביקיני", "duration_minutes": 45, "price": 250, "color": "#d97706"},
                  {"name": "לייזר גב", "duration_minutes": 60, "price": 350, "color": "#b45309"}]},
    {"key": "massage", "label": "עיסוי ורפלקסולוגיה", "icon": "hand-heart", "color": "#0891b2", "sort": 70,
     "aliases": ["עיסוי", "רפלקסולוגיה", "massage"], "osm_tag": "shop=massage",
     "terms": {"staff": "מעסה", "staff_plural": "מעסים", "service": "טיפול", "service_plural": "טיפולים", "client": "לקוח/ה", "client_plural": "לקוחות", "place": "קליניקה"},
     "modules": ["crm", "calendar", "payments", "whatsapp", "online_booking", "customer_club"],
     "services": [{"name": "עיסוי שוודי", "duration_minutes": 60, "price": 250, "color": "#06b6d4"},
                  {"name": "עיסוי רקמות עמוק", "duration_minutes": 60, "price": 300, "color": "#0891b2"},
                  {"name": "רפלקסולוגיה", "duration_minutes": 45, "price": 200, "color": "#0e7490"}]},
    {"key": "pilates", "label": "פילאטיס ויוגה", "icon": "person-standing", "color": "#d97706", "sort": 80,
     "aliases": ["פילאטיס / כושר", "פילאטיס", "יוגה", "pilates", "yoga"], "osm_tag": "leisure=fitness_centre",
     "terms": {"staff": "מדריך/ה", "staff_plural": "מדריכים", "service": "שיעור", "service_plural": "שיעורים", "client": "מתאמן/ת", "client_plural": "מתאמנים", "place": "סטודיו"},
     "modules": ["crm", "calendar", "payments", "whatsapp", "online_booking", "wait_list", "customer_club"],
     "services": [{"name": "שיעור אישי", "duration_minutes": 60, "price": 200, "color": "#10b981"},
                  {"name": "שיעור קבוצתי", "duration_minutes": 60, "price": 80, "color": "#059669"},
                  {"name": "מנוי חודשי", "duration_minutes": 0, "price": 600, "color": "#047857"}]},
    {"key": "gym", "label": "מכון כושר ואימונים", "icon": "dumbbell", "color": "#ea580c", "sort": 90,
     "aliases": ["מכון כושר", "חדר כושר", "כושר", "אימונים", "אימון אישי", "מאמן כושר", "gym"],
     "osm_tag": "leisure=fitness_centre",
     "terms": {"staff": "מאמן/ת", "staff_plural": "מאמנים", "service": "אימון", "service_plural": "אימונים", "client": "מתאמן/ת", "client_plural": "מתאמנים", "place": "מכון"},
     "modules": ["crm", "calendar", "payments", "whatsapp", "online_booking", "wait_list", "customer_club"],
     "services": [{"name": "אימון אישי", "duration_minutes": 60, "price": 200, "color": "#f97316"},
                  {"name": "אימון זוגי", "duration_minutes": 60, "price": 300, "color": "#ea580c"},
                  {"name": "בניית תוכנית אימונים", "duration_minutes": 45, "price": 250, "color": "#c2410c"}]},
    {"key": "medical", "label": "קליניקה ובריאות", "icon": "stethoscope", "color": "#0d9488", "sort": 100,
     "aliases": ["קליניקה / מרפאה", "קליניקה / בריאות", "קליניקה", "מרפאה", "בריאות", "medical"],
     "osm_tag": "healthcare=clinic",
     "terms": {"staff": "מטפל/ת", "staff_plural": "מטפלים", "service": "טיפול", "service_plural": "טיפולים", "client": "מטופל/ת", "client_plural": "מטופלים", "place": "קליניקה"},
     "modules": ["crm", "calendar", "payments", "whatsapp", "email"],
     "services": [{"name": "ייעוץ", "duration_minutes": 30, "price": 350, "color": "#14b8a6"},
                  {"name": "טיפול", "duration_minutes": 60, "price": 500, "color": "#0d9488"}]},
    {"key": "dental", "label": "מרפאת שיניים ושיננית", "icon": "smile", "color": "#2563eb", "sort": 110,
     "aliases": ["מרפאת שיניים", "שיניים", "שיננית", "רופא שיניים", "dental", "dentist"], "osm_tag": "amenity=dentist",
     "terms": {"staff": "מטפל/ת", "staff_plural": "מטפלים", "service": "טיפול", "service_plural": "טיפולים", "client": "מטופל/ת", "client_plural": "מטופלים", "place": "מרפאה"},
     "modules": ["crm", "calendar", "payments", "whatsapp", "email"],
     "services": [{"name": "בדיקה תקופתית", "duration_minutes": 30, "price": 200, "color": "#3b82f6"},
                  {"name": "הסרת אבנית", "duration_minutes": 45, "price": 300, "color": "#2563eb"},
                  {"name": "הלבנת שיניים", "duration_minutes": 60, "price": 1200, "color": "#1d4ed8"}]},
    {"key": "psychology", "label": "פסיכולוגיה וקואצ׳ינג", "icon": "brain", "color": "#be123c", "sort": 120,
     "aliases": ["פסיכולוגיה / קואצ׳ינג", "פסיכולוגיה", "קואצ׳ינג", "טיפול רגשי", "פסיכותרפיה"],
     "osm_tag": "healthcare=psychotherapist",
     "terms": {"staff": "מטפל/ת", "staff_plural": "מטפלים", "service": "פגישה", "service_plural": "פגישות", "client": "מטופל/ת", "client_plural": "מטופלים", "place": "קליניקה"},
     "modules": ["crm", "calendar", "payments", "whatsapp", "email"],
     "services": [{"name": "פגישת היכרות", "duration_minutes": 50, "price": 300, "color": "#e11d48"},
                  {"name": "פגישה טיפולית", "duration_minutes": 50, "price": 400, "color": "#be123c"},
                  {"name": "פגישת קואצ׳ינג", "duration_minutes": 60, "price": 450, "color": "#9f1239"}]},
    {"key": "photography", "label": "צילום", "icon": "camera", "color": "#65a30d", "sort": 130,
     "aliases": ["צלם", "צלמת", "סטודיו לצילום", "photography"], "osm_tag": "shop=photo",
     "terms": {"staff": "צלם/ת", "staff_plural": "צלמים", "service": "צילום", "service_plural": "צילומים", "client": "לקוח/ה", "client_plural": "לקוחות", "place": "סטודיו"},
     "modules": ["crm", "calendar", "payments", "whatsapp", "email", "online_booking"],
     "services": [{"name": "צילומי תדמית", "duration_minutes": 60, "price": 600, "color": "#84cc16"},
                  {"name": "צילומי משפחה", "duration_minutes": 90, "price": 900, "color": "#65a30d"},
                  {"name": "צילומי הריון", "duration_minutes": 60, "price": 700, "color": "#4d7c0f"}]},
    # BizFind directory only — businesses without appointments
    {"key": "clothing", "label": "חנות בגדים", "icon": "shirt", "color": "#9333ea", "sort": 200, "directory_only": True,
     "aliases": ["בגדים", "אופנה"], "osm_tag": "shop=clothes", "modules": ["crm"], "services": []},
    {"key": "pharmacy", "label": "בית מרקחת", "icon": "pill", "color": "#16a34a", "sort": 210, "directory_only": True,
     "aliases": ["פארם"], "osm_tag": "amenity=pharmacy", "modules": ["crm"], "services": []},
    {"key": "florist", "label": "פרחים", "icon": "flower", "color": "#e11d48", "sort": 220, "directory_only": True,
     "aliases": ["חנות פרחים", "florist"], "osm_tag": "shop=florist", "modules": ["crm"], "services": []},
    {"key": "other", "label": "אחר", "icon": "store", "color": "#475569", "sort": 999,
     "aliases": [], "osm_tag": None,
     "modules": ["crm", "calendar", "payments", "whatsapp"],
     "services": [{"name": "שירות", "duration_minutes": 60, "price": 0, "color": "#64748b"}]},
]

# Labels the original eight types had before 2026-09-24. A label that still equals its old default is
# upgraded once to the new one; a label someone changed is left alone.
PREVIOUS_LABELS = {
    "tattoo": "סטודיו קעקועים",
    "barber": "ספר / ברברשופ",
    "nails": "ציפורניים",
    "laser": "קליניקת לייזר",
    "pilates": "פילאטיס / כושר",
    "spa": "ספא / קוסמטיקה",
    "medical": "קליניקה / מרפאה",
}
