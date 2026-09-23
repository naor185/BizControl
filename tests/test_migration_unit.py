"""Migration engine pieces that need no database: normalizing, mapping, sensitive data, file parsing, matching."""
import io
from datetime import date

import pytest

from app.connectors.base import ConnectorError
from app.connectors.csv_excel import CsvExcelConnector
from app.migration.mapping import suggest_mapping, validate_mapping
from app.migration.matcher import CONFLICT, EXISTING, NEW, POSSIBLE_DUPLICATE, ClientMatcher, ServiceMatcher
from app.migration.normalize import (
    detect_date_order, name_key, names_similar, normalize_client, normalize_email, normalize_service,
    parse_bool, parse_date, parse_duration, parse_money,
)
from app.migration.sensitive import looks_like_card_number, sensitive_columns
from app.migration.universal import CLIENT, SERVICE
from app.utils.phone import normalize_phone


@pytest.mark.parametrize("raw,expected", [
    ("050-123-4567", "0501234567"),
    ("+972 50 123 4567", "0501234567"),
    ("972501234567", "0501234567"),
    ("00972501234567", "0501234567"),
    (501234567, "0501234567"),          # spreadsheet dropped the leading zero
    (501234567.0, "0501234567"),
    ("03-1234567", "031234567"),
    ("31234567", "031234567"),
    ("+1 212 555 0100", "+12125550100"),
    ("12345", None),
    ("abc", None),
    ("", None),
    (None, None),
])
def test_normalize_phone(raw, expected):
    assert normalize_phone(raw) == expected


def test_values():
    assert normalize_email(" Yael@Example.COM ") == "yael@example.com"
    assert normalize_email("not-an-email") is None
    assert parse_date("12/03/1990", "DMY") == date(1990, 3, 12)
    assert parse_date("03/12/1990", "MDY") == date(1990, 3, 12)
    assert parse_date("1990-03-12") == date(1990, 3, 12)
    assert parse_date("31/02/1990") is None
    assert parse_date(32946) == date(1990, 3, 14)          # Excel serial
    assert detect_date_order(["13/02/1990", "01/05/1991"]) == "DMY"
    assert detect_date_order(["02/13/1990"]) == "MDY"
    assert detect_date_order(["05/06/1990"]) is None        # could be either — owner must say
    assert parse_money("₪1,250.50") == 125050
    assert parse_money("120,50") == 12050
    assert parse_money("1,200") == 120000
    assert parse_money("-5") is None
    assert parse_duration("1:30") == 90
    assert parse_duration("45 דק׳") == 45
    assert parse_duration("שעה וחצי") == 90
    assert parse_duration("2 שעות") == 120
    assert parse_duration("abc") is None
    assert parse_bool("כן") is True and parse_bool("לא מאשר") is False and parse_bool("maybe") is None
    assert names_similar(name_key("יעל"), name_key("יעל כהן"))
    assert names_similar(name_key("כהן יעל"), name_key("יעל  כהן"))
    assert not names_similar(name_key("יעל כהן"), name_key("דנה כהן"))


def test_normalize_client_keeps_what_it_cannot_use():
    data, issues = normalize_client({
        "first_name": [("שם פרטי", "יעל")], "last_name": [("שם משפחה", "כהן")],
        "phone": [("טלפון", "12")], "email": [("מייל", "yael@example.com")],
        "birth_date": [("לידה", "לא ידוע")], "gender": [("מין", "נקבה")],
        "notes": [("הערה", "אלרגיה"), ("הערה נוספת", "מעדיפה בוקר")],
    }, {"date_order": "DMY"})
    assert data["full_name"] == "יעל כהן"
    assert data["phone"] is None and data["email"] == "yael@example.com"
    assert "טלפון מהמערכת הקודמת (לא תקין): 12" in data["notes"]
    assert "תאריך לידה מהמערכת הקודמת: לא ידוע" in data["notes"]
    assert "מגדר: נקבה" in data["notes"] and "הערה: אלרגיה" in data["notes"]
    assert {i["code"] for i in issues} == {"invalid_phone", "invalid_date"}
    assert data["marketing_consent"] is None     # not in the source → saved like a client added by hand

    _, issues = normalize_client({"phone": [("טלפון", "0501234567")]}, {})
    assert any(i["code"] == "missing_name" and i["level"] == "error" for i in issues)


def test_normalize_service_defaults_are_reported():
    data, issues = normalize_service({"name": [("שם", "קעקוע קטן")], "price": [("מחיר", "₪350")]}, {})
    assert data == {"external_id": None, "name": "קעקוע קטן", "duration_minutes": 60, "price_cents": 35000,
                    "category": None, "description": None, "is_active": True}
    assert [i["code"] for i in issues] == ["duration_default"]


def test_suggest_mapping_hebrew_and_english():
    headers = ["שם מלא", "Mobile", "E-mail", "תאריך לידה", "Random", "הערות"]
    cols = [["יעל כהן", "דנה לוי"], ["0501234567", "052-7654321"], ["a@b.co", "c@d.co"],
            ["13/02/1990", "01/05/1991"], ["x", "y"], ["note"]]
    out = {c["column"]: c for c in suggest_mapping(CLIENT, headers, cols)}
    assert out["שם מלא"]["target"] == "full_name" and out["שם מלא"]["status"] == "auto"
    assert out["Mobile"]["target"] == "phone" and out["Mobile"]["status"] == "auto"
    assert out["E-mail"]["target"] == "email"
    assert out["תאריך לידה"]["target"] == "birth_date" and out["תאריך לידה"]["date_order"] == "DMY"
    assert out["Random"]["target"] is None
    assert out["הערות"]["target"] == "notes" and out["הערות"]["status"] == "auto"


def test_suggest_mapping_does_not_trust_a_name_the_values_contradict():
    out = suggest_mapping(CLIENT, ["טלפון"], [["abc", "def", "ghi", "jkl"]])[0]
    assert out["status"] != "auto"


def test_suggest_mapping_one_column_per_field():
    out = suggest_mapping(CLIENT, ["טלפון", "נייד"], [["0501234567"], ["0527654321"]])
    assert [c["target"] for c in out].count("phone") == 1


def test_validate_mapping():
    assert validate_mapping(CLIENT, {0: "phone"}, 2)          # no name column
    assert not validate_mapping(CLIENT, {0: "full_name", 1: "notes"}, 2)
    assert validate_mapping(CLIENT, {0: "phone", 1: "phone"}, 2)
    assert validate_mapping(SERVICE, {0: "price"}, 1)         # service name is required


def test_card_columns_are_dropped():
    assert looks_like_card_number("4580 4580 4580 4580")
    assert not looks_like_card_number("0501234567")
    headers = ["שם", "מספר כרטיס אשראי", "הערות", "cc"]
    rows = [["יעל", "x", "4111111111111111", "y"], ["דנה", "y", "5555555555554444", "z"]]
    dropped = sensitive_columns(headers, rows)
    assert set(dropped) == {1, 2, 3}


def test_csv_connector_hebrew_windows_encoding_and_semicolons():
    text = "שם;טלפון\r\nיעל כהן;050-1234567\r\n\r\nדנה;0527654321\r\n"
    table = CsvExcelConnector("clients.csv", text.encode("cp1255")).read("clients")
    assert table.headers == ["שם", "טלפון"]
    assert table.rows == [["יעל כהן", "050-1234567"], ["דנה", "0527654321"]]
    assert table.info["encoding"] == "cp1255"


def test_xlsx_connector():
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.append(["Name", "Phone", "Birthday"])
    ws.append(["Yael", 501234567, date(1990, 3, 12)])
    buf = io.BytesIO()
    wb.save(buf)
    table = CsvExcelConnector("c.xlsx", buf.getvalue()).read("clients")
    assert table.headers == ["Name", "Phone", "Birthday"]
    assert table.rows[0][0] == "Yael" and table.rows[0][2] == date(1990, 3, 12)


def test_connector_errors_are_readable():
    with pytest.raises(ConnectorError):
        CsvExcelConnector("a.xls", b"\xd0\xcf\x11\xe0").read("clients")
    with pytest.raises(ConnectorError):
        CsvExcelConnector("a.csv", b"only,headers\r\n").read("clients")


class _FakeClientMatcher(ClientMatcher):
    def __init__(self, clients, linked=None):   # skip the database
        self.clients, self.by_phone, self.by_email = {}, {}, {}
        for cid, name, phone, email in clients:
            self.clients[cid] = (name_key(name), name)
            if phone:
                self.by_phone.setdefault(phone, []).append(cid)
            if email:
                self.by_email.setdefault(email, []).append(cid)
        self.linked = linked or {}
        self.seen_phone, self.seen_email = {}, {}


def test_client_matching_order():
    m = _FakeClientMatcher([("A", "יעל כהן", "0501111111", "yael@x.co"), ("B", "דני לוי", "0502222222", "dani@x.co")],
                           linked={"ext-9": "B"})
    assert m.match(2, "ext-9", None, None, None).status == EXISTING                              # 1. source + id
    r = m.match(3, None, "0501111111", None, name_key("יעל"))
    assert (r.status, r.target_id, r.reason) == (EXISTING, "A", "phone_name")                    # 2/4. phone + name
    r = m.match(4, None, "0501111111", None, name_key("נועה כהן"))
    assert (r.status, r.reason) == (POSSIBLE_DUPLICATE, "phone_other_name")                      # parent/child share a phone
    r = m.match(5, None, None, "dani@x.co", name_key("דני לוי"))
    assert (r.status, r.target_id) == (EXISTING, "B")                                           # 3/5. email + name
    assert m.match(6, None, "0501111111", "dani@x.co", None).status == CONFLICT                 # two different clients
    assert m.match(7, None, "0509999999", None, name_key("חדש")).status == NEW
    r = m.match(8, None, "0509999999", None, name_key("חדש"))
    assert (r.status, r.reason, r.ref_row) == (POSSIBLE_DUPLICATE, "in_file", 7)                # twice in the same file


def test_service_matching():
    m = ServiceMatcher.__new__(ServiceMatcher)
    m.services, m.by_name, m.linked, m.seen = {"S": "קעקוע קטן"}, {name_key("קעקוע קטן"): "S"}, {}, {}
    assert m.match(2, None, name_key("קעקוע  קטן")).status == EXISTING
    assert m.match(3, None, name_key("פירסינג")).status == NEW
    assert m.match(4, None, name_key("פירסינג")).status == POSSIBLE_DUPLICATE
