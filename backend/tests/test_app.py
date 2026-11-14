import importlib
from datetime import date

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("APP_USER", "yaris")
    monkeypatch.setenv("APP_PASSWORD", "geheim123")
    monkeypatch.setenv("COOKIE_SECURE", "false")
    from app import config, db, auth, backup, main
    for m in (config, db, auth, backup, main):
        importlib.reload(m)
    with TestClient(main.app) as c:
        yield c


def login(c):
    r = c.post("/api/auth/login", json={"username": "yaris", "password": "geheim123"})
    assert r.status_code == 200


def by_name(items, prefix):
    return next(i for i in items if i["name"].startswith(prefix))


def test_requires_login(client):
    assert client.get("/api/dashboard").status_code == 401
    assert client.post("/api/auth/login", json={"username": "yaris", "password": "falsch"}).status_code == 401


def test_excel_equivalence(tmp_path, monkeypatch):
    """Mit Stichtag 01.01.2026 / 105.000 km muss die App exakt die Excel-Spalte H liefern."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from app import config, db, logic
    importlib.reload(config); importlib.reload(db)
    db.init_db()
    with db.session() as conn:
        conn.execute("UPDATE odometer_readings SET date='2026-01-01' WHERE km=105000")
        res = logic.compute_items(conn, today=date(2026, 1, 1))
    items = res["items"]
    excel = {
        "Toyota-Inspektion": "overdue", "Motoröl": "overdue", "Ölfilter": "overdue", "Dichtung": "overdue",
        "Hybridbatterie": "overdue", "Motor-Luftfilter": "ok", "Zündkerzen": "ok",
    }
    for name, st in excel.items():
        assert by_name(items, name)["status"] == st, name
    assert by_name(items, "Bremsflüssigkeit")["status"] in ("ok", "soon")  # Excel: „Noch nicht fällig“
    assert by_name(items, "Bremsflüssigkeit")["due_km"] == 111967
    assert by_name(items, "Motor-Luftfilter")["due_km"] == 122373
    assert by_name(items, "Zündkerzen")["due_date"] == "2031-01-01"
    assert res["plan_step"] == 8 and res["plan_next"] == {"km": 120000, "year": 2026}


def test_dashboard_and_new_rules(client):
    login(client)
    d = client.get("/api/dashboard").json()
    items = d["items"]
    assert d["odometer"]["km"] == 105000
    assert by_name(items, "HU/AU")["status"] == "missing"
    assert by_name(items, "Getriebeöl")["status"] == "info"
    k = by_name(items, "Kühlmittel wechseln")
    assert k["base_is_registration"] and k["due_km"] == 160000 and k["due_date"] == "2028-01-01"
    assert by_name(items, "Innenraumfilter")["interval_months"] == 12
    assert d["overall"] == "overdue"


def test_service_event_resets_due(client):
    login(client)
    ids = [i["id"] for i in client.get("/api/items").json() if i["part_of_inspection"]]
    today = date.today().isoformat()
    r = client.post("/api/events", json={"date": today, "km": 105200, "item_ids": ids, "workshop": "Toyota"})
    assert r.status_code == 201, r.text
    d = client.get("/api/dashboard").json()
    oil = by_name(d["items"], "Motoröl")
    assert oil["status"] == "ok" and oil["due_km"] == 120200
    assert d["odometer"]["km"] == 105200
    # km kleiner als bekannter Stand wird abgelehnt
    assert client.post("/api/odometer", json={"date": today, "km": 100}).status_code == 400


def test_soon_by_km_projection(client):
    login(client)
    ids = [i["id"] for i in client.get("/api/items").json() if i["name"].startswith("Motoröl")]
    # Ölwechsel vor 11 Monaten -> nach Zeit in 1 Monat fällig -> orange
    from app.logic import add_months
    d0 = add_months(date.today(), -11)
    client.post("/api/odometer", json={"date": date.today().isoformat(), "km": 106000})
    r = client.post("/api/events", json={"date": d0.isoformat(), "km": 105000, "item_ids": ids})
    assert r.status_code == 201, r.text
    oil = by_name(client.get("/api/dashboard").json()["items"], "Motoröl")
    assert oil["status"] == "soon"


def test_backup_and_restore(client):
    login(client)
    name = client.post("/api/backups").json()["name"]
    ev = client.get("/api/events").json()[0]
    client.delete(f"/api/events/{ev['id']}")
    assert len(client.get("/api/events").json()) == 1
    r = client.post(f"/api/backups/{name}/restore")
    assert r.status_code == 200, r.text
    assert len(client.get("/api/events").json()) == 2
    assert client.get(f"/api/backups/../secret.key").status_code == 404


def test_password_change(client):
    login(client)
    r = client.post("/api/auth/password", json={"old_password": "geheim123", "new_password": "neuesPasswort1"})
    assert r.status_code == 200
    client.cookies.clear()
    assert client.post("/api/auth/login", json={"username": "yaris", "password": "geheim123"}).status_code == 401
    assert client.post("/api/auth/login", json={"username": "yaris", "password": "neuesPasswort1"}).status_code == 200


def test_reset_password(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("APP_USER", "yaris")
    monkeypatch.setenv("APP_PASSWORD", "erstesPW1")
    from app import config, db, auth
    importlib.reload(config); importlib.reload(db); importlib.reload(auth)
    db.init_db()
    with db.session() as conn:
        auth.ensure_user(conn)
    monkeypatch.setenv("APP_PASSWORD", "zweitesPW2")
    monkeypatch.setenv("RESET_PASSWORD", "true")
    importlib.reload(config); importlib.reload(auth)
    with db.session() as conn:
        auth.ensure_user(conn)
        h = conn.execute("SELECT password_hash FROM users").fetchone()[0]
    assert auth.verify_password("zweitesPW2", h)


def test_second_user(client):
    login(client)
    r = client.post("/api/users", json={"username": "partnerin", "password": "zweitesPW1"})
    assert r.status_code == 201
    assert client.post("/api/users", json={"username": "partnerin", "password": "xxxxxxxx1"}).status_code == 400
    users = client.get("/api/users").json()
    assert [u["username"] for u in users] == ["yaris", "partnerin"]
    me = next(u for u in users if u["is_me"])
    assert client.delete(f"/api/users/{me['id']}").status_code == 400
    # zweiter Benutzer sieht dieselben Daten
    client.cookies.clear()
    assert client.post("/api/auth/login", json={"username": "partnerin", "password": "zweitesPW1"}).status_code == 200
    assert client.get("/api/dashboard").json()["odometer"]["km"] == 105000
    # und kann den ersten nicht-sich-selbst löschen? -> erlaubt, aber nicht sich selbst
    other = next(u for u in client.get("/api/users").json() if not u["is_me"])
    assert client.delete(f"/api/users/{other['id']}").status_code == 200
