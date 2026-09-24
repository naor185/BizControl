"""
The Universal Data Model: the one shape every connector's data is converted into before anything
touches BizControl's own tables. A connector only has to produce these records; normalizing,
matching, validating, previewing, writing and rolling back are the engine's job and are the same
for every source.

Only entities with importable=True can be written into BizControl today. The others are defined
so connectors can already produce them and the preview can count them ("found, not importable
yet"); they become importable as the matching BizControl feature (classes, memberships) is built.
Only values the source actually has are filled — nothing is invented.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class FieldSpec:
    key: str
    label: str                 # shown to the business owner in the mapping screen
    kind: str                  # id | text | name | phone | email | date | datetime | money | int | bool | duration
    required: bool = False
    multi: bool = False        # several source columns may map here (their values are combined)
    synonyms: tuple[str, ...] = ()
    help: str = ""


@dataclass(frozen=True)
class EntitySpec:
    key: str
    label: str
    importable: bool
    fields: tuple[FieldSpec, ...] = field(default_factory=tuple)

    def field(self, key: str) -> FieldSpec | None:
        return next((f for f in self.fields if f.key == key), None)


_ID_SYNONYMS = ("id", "externalid", "מזהה", "מספר", "קוד")

CLIENT = EntitySpec("clients", "לקוחות", True, (
    FieldSpec("external_id", "מזהה במערכת הקודמת", "id",
              synonyms=_ID_SYNONYMS + ("clientid", "customerid", "memberid", "userid", "contactid",
                                       "מספרלקוח", "מסלקוח", "קודלקוח", "מזההלקוח", "תעודתזהות", "תז"),
              help="מאפשר ייבוא חוזר בלי כפילויות"),
    FieldSpec("full_name", "שם מלא", "name",
              synonyms=("name", "fullname", "clientname", "customername", "contactname", "membername",
                        "שם", "שםמלא", "שםלקוח", "שםהלקוח", "שםמלאשלהלקוח", "לקוח")),
    FieldSpec("first_name", "שם פרטי", "name", synonyms=("firstname", "fname", "givenname", "first", "שםפרטי", "פרטי")),
    FieldSpec("last_name", "שם משפחה", "name", synonyms=("lastname", "lname", "surname", "familyname", "last", "שםמשפחה", "משפחה")),
    FieldSpec("phone", "טלפון", "phone",
              synonyms=("phone", "mobile", "mobilephone", "cell", "cellphone", "cellular", "tel", "telephone",
                        "phonenumber", "mobilenumber", "whatsapp", "טלפון", "נייד", "טלפוןנייד", "פלאפון", "סלולרי",
                        "סלולר", "מספרטלפון", "מסטלפון", "טל", "וואטסאפ")),
    FieldSpec("email", "אימייל", "email",
              synonyms=("email", "mail", "emailaddress", "אימייל", "מייל", "דואל", "דואלקטרוני", "כתובתמייל", "כתובתאימייל")),
    FieldSpec("birth_date", "תאריך לידה", "date",
              synonyms=("birthday", "birthdate", "dob", "dateofbirth", "תאריךלידה", "יוםהולדת", "תלידה")),
    FieldSpec("gender", "מגדר", "text", synonyms=("gender", "sex", "מגדר", "מין"),
              help="אין שדה מגדר בכרטיס הלקוח — יישמר בהערות"),
    FieldSpec("tags", "תגיות", "text", multi=True, synonyms=("tags", "tag", "labels", "group", "groups", "תגיות", "תגית", "קבוצה", "קבוצות"),
              help="יישמר בהערות"),
    FieldSpec("notes", "הערות", "text", multi=True,
              synonyms=("notes", "note", "comments", "comment", "remarks", "description", "הערות", "הערה", "תיאור")),
    FieldSpec("created_at", "תאריך הצטרפות", "datetime",
              synonyms=("createdat", "created", "createddate", "joined", "joindate", "joinedat", "signupdate",
                        "registrationdate", "registered", "memberssince", "membersince", "תאריךהצטרפות",
                        "תאריךיצירה", "נוצרב", "הצטרףב", "תאריךרישום")),
    FieldSpec("marketing_consent", "מאשר דיוור", "bool",
              synonyms=("marketingconsent", "optin", "subscribed", "newsletter", "acceptsmarketing", "marketing",
                        "מאשרדיוור", "הסכמהלדיוור", "דיוור", "מאשרפרסום", "מאשרשיווק"),
              help="לקוח עם 'לא' לא יקבל הודעות שיווקיות (תפוצות, הזמנה למועדון, הטבת יום הולדת), וגם לא הודעת ביטול תור והודעה אחרי טיפול"),
))

SERVICE = EntitySpec("services", "שירותים", True, (
    FieldSpec("external_id", "מזהה במערכת הקודמת", "id", synonyms=_ID_SYNONYMS + ("serviceid", "productid", "itemid", "קודשירות", "מזההשירות")),
    FieldSpec("name", "שם השירות", "text", required=True,
              synonyms=("name", "service", "servicename", "title", "treatment", "product", "item",
                        "שם", "שירות", "שםשירות", "שםהשירות", "טיפול", "שםטיפול", "סוגטיפול", "מוצר")),
    FieldSpec("duration_minutes", "משך (דקות)", "duration",
              synonyms=("duration", "durationminutes", "minutes", "length", "time", "משך", "משךזמן", "זמן", "דקות", "משךבדקות")),
    FieldSpec("price", "מחיר (₪)", "money", synonyms=("price", "cost", "amount", "fee", "rate", "מחיר", "עלות", "סכום", "תעריף")),
    FieldSpec("category", "קטגוריה", "text", synonyms=("category", "type", "group", "קטגוריה", "סוג", "קבוצה")),
    FieldSpec("description", "תיאור", "text", multi=True, synonyms=("description", "details", "notes", "תיאור", "פרטים", "הערות")),
    FieldSpec("is_active", "פעיל", "bool", synonyms=("active", "isactive", "enabled", "status", "פעיל", "סטטוס", "זמין")),
))

# Defined for connectors that have them; not writable into BizControl yet.
APPOINTMENT = EntitySpec("appointments", "תורים", False, (
    FieldSpec("external_id", "מזהה", "id"), FieldSpec("client_external_id", "לקוח", "id"),
    FieldSpec("staff_external_id", "איש צוות", "id"), FieldSpec("service_external_id", "שירות", "id"),
    FieldSpec("start_at", "התחלה", "datetime"), FieldSpec("end_at", "סיום", "datetime"),
    FieldSpec("status", "סטטוס", "text"), FieldSpec("notes", "הערות", "text"), FieldSpec("location", "מיקום", "text"),
))
MEMBERSHIP = EntitySpec("memberships", "מנויים", False, (
    FieldSpec("external_id", "מזהה", "id"), FieldSpec("client_external_id", "לקוח", "id"),
    FieldSpec("membership_type", "סוג מנוי", "text"), FieldSpec("status", "סטטוס", "text"),
    FieldSpec("start_date", "התחלה", "date"), FieldSpec("end_date", "סיום", "date"),
    FieldSpec("price", "מחיר", "money"), FieldSpec("currency", "מטבע", "text"), FieldSpec("billing_cycle", "מחזור חיוב", "text"),
    FieldSpec("next_billing_at", "חיוב הבא", "date"), FieldSpec("total_sessions", "סה״כ כניסות", "int"),
    FieldSpec("used_sessions", "כניסות שנוצלו", "int"), FieldSpec("remaining_sessions", "כניסות שנותרו", "int"),
    FieldSpec("discount", "הנחה", "money"), FieldSpec("freeze_status", "הקפאה", "text"),
))
PAYMENT = EntitySpec("payments", "תשלומים", False, (
    # Never card numbers, CVV or any other payment-method data — see sensitive.py.
    FieldSpec("external_id", "מזהה", "id"), FieldSpec("client_external_id", "לקוח", "id"),
    FieldSpec("membership_external_id", "מנוי", "id"), FieldSpec("amount", "סכום", "money"),
    FieldSpec("currency", "מטבע", "text"), FieldSpec("payment_date", "תאריך", "date"),
    FieldSpec("status", "סטטוס", "text"), FieldSpec("payment_type", "אמצעי תשלום", "text"),
    FieldSpec("provider_reference", "אסמכתא", "text"),
))
STAFF = EntitySpec("staff", "צוות", False, (
    FieldSpec("external_id", "מזהה", "id"), FieldSpec("full_name", "שם", "name"),
    FieldSpec("email", "אימייל", "email"), FieldSpec("phone", "טלפון", "phone"), FieldSpec("role", "תפקיד", "text"),
))
COURSE = EntitySpec("courses", "קורסים", False, (
    FieldSpec("external_id", "מזהה", "id"), FieldSpec("name", "שם", "text"),
    FieldSpec("start_date", "התחלה", "date"), FieldSpec("end_date", "סיום", "date"),
    FieldSpec("sessions_count", "מספר מפגשים", "int"), FieldSpec("capacity", "מקומות", "int"), FieldSpec("price", "מחיר", "money"),
))

ENTITIES: dict[str, EntitySpec] = {e.key: e for e in (CLIENT, SERVICE, APPOINTMENT, MEMBERSHIP, PAYMENT, STAFF, COURSE)}


def entity_spec(key: str) -> EntitySpec | None:
    return ENTITIES.get(key)
