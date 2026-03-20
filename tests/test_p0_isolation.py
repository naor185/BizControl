from tests.conftest import register_and_login

def test_cross_studio_isolation_clients(client):
    h1 = register_and_login(client, slug="s1", email="owner1@s1.com")
    h2 = register_and_login(client, slug="s2", email="owner2@s2.com")

    # יוצרים לקוח בסטודיו 1
    r = client.post("/api/clients", headers=h1, json={
        "full_name": "Client One",
        "phone": "0501111111",
        "email": "c1@test.com",
        "marketing_consent": True,
        "notes": None,
        "is_active": True
    })
    assert r.status_code == 201, r.text
    c1_id = r.json()["id"]

    # סטודיו 2 לא אמור לראות אותו
    r = client.get("/api/clients", headers=h2)
    assert r.status_code == 200
    ids = [x["id"] for x in r.json()]
    assert c1_id not in ids

    # וגם GET ישיר צריך להיות 404
    r = client.get(f"/api/clients/{c1_id}", headers=h2)
    assert r.status_code == 404
