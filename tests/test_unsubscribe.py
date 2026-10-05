"""A client who asks to stop marketing — by the unsubscribe link or by replying "הסר" on WhatsApp — is taken off
the list once, the owner gets a notification in the bell, and the "removed from messages" list shows who and how.
A "הסר" reply used to do nothing (only the link worked), and a client's reply was not even matched to the client
(WhatsApp sends 972…, clients are kept as 05…). Local test database; nothing is sent."""
from sqlalchemy import select

from app.models.client import Client
from app.models.lead import Lead
from app.models.notification import Notification
from app.models.studio import Studio
from app.models.studio_settings import StudioSettings
from app.services.marketing import is_unsubscribe_reply, unsubscribe_link
from tests.conftest import register_and_login


def test_what_counts_as_a_remove_me_reply():
    for text in ("הסר", "הסר!", "  הסירו אותי בבקשה 🙏", "תסירו אותי מהרשימה", "הסר אותי מרשימת התפוצה. תודה", "STOP"):
        assert is_unsubscribe_reply(text), text
    for text in ("אפשר להסיר את התור?", "תודה רבה!", "מתי התור שלי?", "", None, "אני רוצה להסיר קעקוע"):
        assert not is_unsubscribe_reply(text), text


def _green(client, text, phone, quoted=False):
    message = ({"typeMessage": "quotedMessage", "extendedTextMessageData": {"text": text}} if quoted
               else {"typeMessage": "textMessage", "textMessageData": {"textMessage": text}})
    return client.post("/api/webhook/green/inst-1", json={
        "typeWebhook": "incomingMessageReceived",
        "senderData": {"chatId": f"{phone}@c.us", "senderName": "x"},
        "messageData": message,
    })


def test_link_and_whatsapp_reply_both_remove_and_tell_the_owner(client, db_session):
    h = register_and_login(client, slug="unsub", email="owner@unsub.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "unsub"))
    st = db_session.get(StudioSettings, s.id)
    st.whatsapp_instance_id, st.whatsapp_phone_id = "inst-1", "phone-1"
    people = {name: Client(studio_id=s.id, full_name=name, phone=phone) for name, phone in (
        ("קישור", "0521110001"), ("וואטסאפ", "0521110002"), ("ציטוט", "0521110003"), ("מטא", "0521110004"),
        ("שואלת", "0521110005"), ("בעלים", "0521110006"))}
    people["לא אישר"] = Client(studio_id=s.id, full_name="לא אישר", phone="0521110007", marketing_consent=False)
    db_session.add_all(people.values())
    db_session.commit()

    def optouts():
        return db_session.scalars(select(Notification).where(Notification.studio_id == s.id,
                                                             Notification.type == "client_optout")).all()

    # the unsubscribe link — once, however many times it is clicked
    code = unsubscribe_link(db_session, s.id, people["קישור"].id).rsplit("/", 1)[1]
    assert client.post(f"/api/public/invite/{code}/optout").status_code == 200
    assert client.post(f"/api/public/invite/{code}/optout").status_code == 200
    assert len(optouts()) == 1

    # a "הסר" reply on WhatsApp — plain, quoting our message, and through Meta
    assert _green(client, "הסר", "972521110002").json()["status"] == "unsubscribed"
    assert _green(client, "תסירו אותי בבקשה 🙏", "972521110003", quoted=True).json()["status"] == "unsubscribed"
    client.post("/api/webhook/meta", json={"object": "whatsapp_business_account", "entry": [{"changes": [{"value": {
        "metadata": {"phone_number_id": "phone-1"},
        "messages": [{"from": "972521110004", "type": "text", "text": {"body": "STOP"}}]}}]}]})
    # an ordinary question is not a removal, and a known client is not turned into a lead
    assert _green(client, "אפשר להסיר את התור?", "972521110005").json()["status"] == "ok"
    # an unknown number asking to be removed is left alone — no lead
    assert _green(client, "הסר", "972529999999").json()["status"] == "unsubscribed"
    assert db_session.scalars(select(Lead).where(Lead.studio_id == s.id)).all() == []
    # the owner switches one off on the client card
    assert client.patch(f"/api/clients/{people['בעלים'].id}", headers=h, json={"receives_marketing": False}).status_code == 200

    titles = sorted(n.title for n in optouts())
    assert titles == sorted(f"{n} הוסר/ה מרשימת ההודעות" for n in ("קישור", "וואטסאפ", "ציטוט", "מטא"))
    rows = {r["full_name"]: r for r in client.get("/api/clients/marketing-optouts", headers=h).json()}
    assert {n: r["reason"] for n, r in rows.items()} == {
        "קישור": "link", "וואטסאפ": "whatsapp", "ציטוט": "whatsapp", "מטא": "whatsapp", "בעלים": "owner", "לא אישר": "no_consent"}
    assert rows["קישור"]["opted_out_at"] and rows["לא אישר"]["opted_out_at"] is None

    # the client asked to come back — switched on again, they leave the list
    assert client.patch(f"/api/clients/{people['וואטסאפ'].id}", headers=h, json={"receives_marketing": True}).status_code == 200
    assert "וואטסאפ" not in {r["full_name"] for r in client.get("/api/clients/marketing-optouts", headers=h).json()}
