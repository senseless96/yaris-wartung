"""FastAPI-Anwendung: REST-API unter /api, ausgelieferte PWA unter /."""
from __future__ import annotations

import logging
import sqlite3
import tempfile
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Depends, FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field, field_validator

from . import backup, config, logic
from .auth import COOKIE, current_user, ensure_user, hash_password, limiter, make_token, set_cookie, verify_password
from .db import bump_version, data_version, get_db, init_db, session

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with session() as conn:
        ensure_user(conn)
    worker = backup.DailyBackup()
    worker.start()
    yield
    worker.stop()


app = FastAPI(title="Yaris Wartung", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
api = APIRouter(prefix="/api")
auth_api = APIRouter(prefix="/api", dependencies=[Depends(current_user)])


# ---------------------------------------------------------------- Modelle

class LoginIn(BaseModel):
    username: str
    password: str


class PasswordIn(BaseModel):
    old_password: str
    new_password: str = Field(min_length=8)
    new_username: Optional[str] = None


class OdometerIn(BaseModel):
    date: date
    km: int = Field(ge=0, le=2_000_000)
    note: Optional[str] = None


class EventIn(BaseModel):
    date: date
    date_exact: bool = True
    km: int = Field(ge=0, le=2_000_000)
    item_ids: list[int] = Field(min_length=1)
    workshop: Optional[str] = None
    cost_eur: Optional[float] = Field(default=None, ge=0)
    note: Optional[str] = None


class ItemIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["replace", "check", "inspection_check", "info"] = "replace"
    interval_km: Optional[int] = Field(default=None, gt=0)
    interval_months: Optional[int] = Field(default=None, gt=0)
    first_interval_km: Optional[int] = Field(default=None, gt=0)
    first_interval_months: Optional[int] = Field(default=None, gt=0)
    plan_mode: Optional[Literal["every_inspection", "plan_step"]] = None
    soon_months: Optional[int] = Field(default=None, ge=0, le=24)
    part_of_inspection: bool = False
    note: Optional[str] = None
    active: bool = True
    sort_order: Optional[int] = None


class VehicleIn(BaseModel):
    name: str = Field(min_length=1)
    model_code: Optional[str] = None
    engine: Optional[str] = None
    transmission: Optional[str] = None
    first_registration: date
    first_registration_exact: bool = True
    vin: Optional[str] = None
    license_plate: Optional[str] = None
    notes: Optional[str] = None


class SettingsIn(BaseModel):
    soon_months: int = Field(ge=0, le=24)

    @field_validator("soon_months")
    @classmethod
    def _v(cls, v):
        return int(v)


# ---------------------------------------------------------------- Hilfen

def check_km_consistent(conn: sqlite3.Connection, d: date, km: int, ignore_odo_id: int | None = None) -> None:
    """Kilometerstände müssen zeitlich aufsteigend sein."""
    ds = d.isoformat()
    params: list = [ds]
    extra = ""
    if ignore_odo_id:
        extra = " AND id != ?"
        params.append(ignore_odo_id)
    before = conn.execute(f"SELECT MAX(km) FROM odometer_readings WHERE date <= ?{extra}", params).fetchone()[0]
    after = conn.execute(f"SELECT MIN(km) FROM odometer_readings WHERE date > ?{extra}", params).fetchone()[0]
    if before is not None and km < before:
        raise HTTPException(400, f"Kilometerstand zu niedrig: Bis zu diesem Datum sind bereits {before:,} km eingetragen.".replace(",", "."))
    if after is not None and km > after:
        raise HTTPException(400, f"Kilometerstand zu hoch: Zu einem späteren Datum sind nur {after:,} km eingetragen.".replace(",", "."))


def upsert_odometer_for_event(conn: sqlite3.Connection, d: date, km: int, event_id: int) -> None:
    """Jeder Wartungstermin erzeugt/aktualisiert einen verknüpften Kilometerstand."""
    linked = conn.execute("SELECT id FROM odometer_readings WHERE event_id = ?", (event_id,)).fetchone()
    if linked:
        conn.execute("UPDATE odometer_readings SET date = ?, km = ? WHERE id = ?", (d.isoformat(), km, linked["id"]))
    else:
        conn.execute(
            "INSERT INTO odometer_readings(date, km, source, note, event_id) VALUES (?, ?, 'service', 'Wartung', ?)",
            (d.isoformat(), km, event_id),
        )


# ---------------------------------------------------------------- Öffentlich

@api.get("/health")
def health():
    return {"ok": True}


@api.post("/auth/login")
def login(body: LoginIn, request: Request, response: Response, conn: sqlite3.Connection = Depends(get_db)):
    ip = request.client.host if request.client else "?"
    limiter.check(ip)
    user = conn.execute("SELECT * FROM users WHERE username = ?", (body.username.strip(),)).fetchone()
    if not user or not verify_password(body.password, user["password_hash"]):
        limiter.fail(ip)
        raise HTTPException(401, "Benutzername oder Passwort falsch.")
    limiter.reset(ip)
    set_cookie(response, make_token(user["id"], user["password_hash"]))
    return {"username": user["username"]}


@api.post("/auth/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


# ---------------------------------------------------------------- Geschützt

@auth_api.get("/auth/me")
def me(user=Depends(current_user)):
    return {"username": user["username"]}


@auth_api.post("/auth/password")
def change_password(body: PasswordIn, response: Response, user=Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    if not verify_password(body.old_password, user["password_hash"]):
        raise HTTPException(400, "Das bisherige Passwort ist falsch.")
    new_hash = hash_password(body.new_password)
    username = (body.new_username or user["username"]).strip()
    conn.execute("UPDATE users SET password_hash = ?, username = ? WHERE id = ?", (new_hash, username, user["id"]))
    set_cookie(response, make_token(user["id"], new_hash))
    return {"ok": True, "username": username}


@auth_api.get("/version")
def version(conn: sqlite3.Connection = Depends(get_db)):
    return {"version": data_version(conn)}


@auth_api.get("/dashboard")
def dashboard(conn: sqlite3.Connection = Depends(get_db)):
    data = logic.compute_items(conn)
    veh = conn.execute("SELECT * FROM vehicle WHERE id = 1").fetchone()
    data["vehicle"] = dict(veh) if veh else None
    data["version"] = data_version(conn)
    last_event = conn.execute("SELECT date, km FROM service_events ORDER BY date DESC, km DESC LIMIT 1").fetchone()
    data["last_service"] = dict(last_event) if last_event else None
    data["records_this_year"] = conn.execute(
        "SELECT COUNT(*) FROM maintenance_records r JOIN service_events e ON e.id = r.event_id WHERE substr(e.date,1,4) = ?",
        (str(date.today().year),),
    ).fetchone()[0]
    return data


# ---- Kilometerstand

@auth_api.get("/odometer")
def list_odometer(conn: sqlite3.Connection = Depends(get_db)):
    rows = conn.execute("SELECT * FROM odometer_readings ORDER BY date DESC, km DESC").fetchall()
    return [dict(r) for r in rows]


@auth_api.post("/odometer", status_code=201)
def add_odometer(body: OdometerIn, conn: sqlite3.Connection = Depends(get_db)):
    if body.date > date.today():
        raise HTTPException(400, "Das Datum liegt in der Zukunft.")
    check_km_consistent(conn, body.date, body.km)
    cur = conn.execute(
        "INSERT INTO odometer_readings(date, km, source, note) VALUES (?, ?, 'manual', ?)",
        (body.date.isoformat(), body.km, body.note),
    )
    bump_version(conn)
    return {"id": cur.lastrowid}


@auth_api.delete("/odometer/{oid}")
def delete_odometer(oid: int, conn: sqlite3.Connection = Depends(get_db)):
    if conn.execute("SELECT COUNT(*) FROM odometer_readings").fetchone()[0] <= 1:
        raise HTTPException(400, "Der letzte Kilometerstand kann nicht gelöscht werden.")
    conn.execute("DELETE FROM odometer_readings WHERE id = ?", (oid,))
    bump_version(conn)
    return {"ok": True}


# ---- Wartungshistorie

def _event_rows(conn: sqlite3.Connection, where: str = "", params: tuple = ()) -> list[dict]:
    events = conn.execute(f"SELECT * FROM service_events {where} ORDER BY date DESC, km DESC, id DESC", params).fetchall()
    recs = conn.execute(
        "SELECT r.event_id, i.id, i.name FROM maintenance_records r JOIN maintenance_items i ON i.id = r.item_id ORDER BY i.sort_order"
    ).fetchall()
    by_event: dict[int, list] = {}
    for r in recs:
        by_event.setdefault(r["event_id"], []).append({"id": r["id"], "name": r["name"]})
    return [dict(e) | {"items": by_event.get(e["id"], [])} for e in events]


@auth_api.get("/events")
def list_events(conn: sqlite3.Connection = Depends(get_db)):
    return _event_rows(conn)


def _save_event(conn: sqlite3.Connection, body: EventIn, event_id: int | None) -> int:
    if body.date > date.today():
        raise HTTPException(400, "Das Datum liegt in der Zukunft.")
    ids = sorted(set(body.item_ids))
    found = conn.execute(
        f"SELECT COUNT(*) FROM maintenance_items WHERE id IN ({','.join('?' * len(ids))})", ids
    ).fetchone()[0]
    if found != len(ids):
        raise HTTPException(400, "Unbekannte Wartungsposition.")
    linked = None
    if event_id is not None:
        linked = conn.execute("SELECT id FROM odometer_readings WHERE event_id = ?", (event_id,)).fetchone()
    check_km_consistent(conn, body.date, body.km, ignore_odo_id=linked["id"] if linked else None)
    vals = (body.date.isoformat(), int(body.date_exact), body.km, body.workshop, body.cost_eur, body.note)
    if event_id is None:
        cur = conn.execute(
            "INSERT INTO service_events(date, date_exact, km, workshop, cost_eur, note) VALUES (?,?,?,?,?,?)", vals
        )
        event_id = cur.lastrowid
    else:
        if not conn.execute("SELECT 1 FROM service_events WHERE id = ?", (event_id,)).fetchone():
            raise HTTPException(404, "Eintrag nicht gefunden.")
        conn.execute(
            "UPDATE service_events SET date=?, date_exact=?, km=?, workshop=?, cost_eur=?, note=? WHERE id=?",
            vals + (event_id,),
        )
        conn.execute("DELETE FROM maintenance_records WHERE event_id = ?", (event_id,))
    conn.executemany(
        "INSERT INTO maintenance_records(event_id, item_id) VALUES (?, ?)", [(event_id, i) for i in ids]
    )
    upsert_odometer_for_event(conn, body.date, body.km, event_id)
    bump_version(conn)
    return event_id


@auth_api.post("/events", status_code=201)
def add_event(body: EventIn, conn: sqlite3.Connection = Depends(get_db)):
    return {"id": _save_event(conn, body, None)}


@auth_api.put("/events/{eid}")
def update_event(eid: int, body: EventIn, conn: sqlite3.Connection = Depends(get_db)):
    return {"id": _save_event(conn, body, eid)}


@auth_api.delete("/events/{eid}")
def delete_event(eid: int, conn: sqlite3.Connection = Depends(get_db)):
    conn.execute("DELETE FROM service_events WHERE id = ?", (eid,))
    bump_version(conn)
    return {"ok": True}


# ---- Wartungspositionen

@auth_api.get("/items")
def list_items(conn: sqlite3.Connection = Depends(get_db)):
    return logic.compute_items(conn, include_inactive=True)["items"]


def _item_values(body: ItemIn) -> tuple:
    return (
        body.name.strip(), body.kind, body.interval_km, body.interval_months, body.first_interval_km,
        body.first_interval_months, body.plan_mode, body.soon_months, int(body.part_of_inspection),
        body.note, int(body.active),
    )


@auth_api.post("/items", status_code=201)
def add_item(body: ItemIn, conn: sqlite3.Connection = Depends(get_db)):
    order = body.sort_order or (conn.execute("SELECT COALESCE(MAX(sort_order), 0) + 10 FROM maintenance_items").fetchone()[0])
    cur = conn.execute(
        "INSERT INTO maintenance_items(name, kind, interval_km, interval_months, first_interval_km, first_interval_months, "
        "plan_mode, soon_months, part_of_inspection, note, active, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        _item_values(body) + (order,),
    )
    bump_version(conn)
    return {"id": cur.lastrowid}


@auth_api.put("/items/{iid}")
def update_item(iid: int, body: ItemIn, conn: sqlite3.Connection = Depends(get_db)):
    row = conn.execute("SELECT sort_order FROM maintenance_items WHERE id = ?", (iid,)).fetchone()
    if not row:
        raise HTTPException(404, "Position nicht gefunden.")
    conn.execute(
        "UPDATE maintenance_items SET name=?, kind=?, interval_km=?, interval_months=?, first_interval_km=?, "
        "first_interval_months=?, plan_mode=?, soon_months=?, part_of_inspection=?, note=?, active=?, sort_order=? WHERE id=?",
        _item_values(body) + (body.sort_order or row["sort_order"], iid),
    )
    bump_version(conn)
    return {"ok": True}


@auth_api.delete("/items/{iid}")
def delete_item(iid: int, conn: sqlite3.Connection = Depends(get_db)):
    used = conn.execute("SELECT COUNT(*) FROM maintenance_records WHERE item_id = ?", (iid,)).fetchone()[0]
    if used:
        raise HTTPException(400, "Diese Position hat bereits Einträge in der Historie. Bitte stattdessen deaktivieren.")
    conn.execute("DELETE FROM maintenance_items WHERE id = ?", (iid,))
    bump_version(conn)
    return {"ok": True}


# ---- Fahrzeug & Einstellungen

@auth_api.get("/vehicle")
def get_vehicle(conn: sqlite3.Connection = Depends(get_db)):
    row = conn.execute("SELECT * FROM vehicle WHERE id = 1").fetchone()
    return dict(row) if row else None


@auth_api.put("/vehicle")
def put_vehicle(body: VehicleIn, conn: sqlite3.Connection = Depends(get_db)):
    conn.execute(
        "INSERT INTO vehicle(id, name, model_code, engine, transmission, first_registration, first_registration_exact, vin, license_plate, notes) "
        "VALUES (1,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, model_code=excluded.model_code, "
        "engine=excluded.engine, transmission=excluded.transmission, first_registration=excluded.first_registration, "
        "first_registration_exact=excluded.first_registration_exact, vin=excluded.vin, license_plate=excluded.license_plate, notes=excluded.notes",
        (body.name, body.model_code, body.engine, body.transmission, body.first_registration.isoformat(),
         int(body.first_registration_exact), body.vin, body.license_plate, body.notes),
    )
    bump_version(conn)
    return {"ok": True}


@auth_api.get("/settings")
def get_settings(conn: sqlite3.Connection = Depends(get_db)):
    return {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM settings")}


@auth_api.put("/settings")
def put_settings(body: SettingsIn, conn: sqlite3.Connection = Depends(get_db)):
    conn.execute("INSERT OR REPLACE INTO settings(key, value) VALUES ('soon_months', ?)", (str(body.soon_months),))
    bump_version(conn)
    return {"ok": True}


# ---- Datensicherung

@auth_api.get("/backups")
def get_backups():
    return {"backups": backup.list_backups(), "keep": config.BACKUP_KEEP, "hour": config.BACKUP_HOUR}


@auth_api.post("/backups", status_code=201)
def make_backup():
    return {"name": backup.create_backup("manuell").name}


@auth_api.get("/backups/{name}")
def download_backup(name: str):
    p = backup.backup_path(name)
    if not p:
        raise HTTPException(404, "Sicherung nicht gefunden.")
    return FileResponse(p, filename=name, media_type="application/octet-stream")


@auth_api.post("/backups/{name}/restore")
def restore_backup(name: str):
    p = backup.backup_path(name)
    if not p:
        raise HTTPException(404, "Sicherung nicht gefunden.")
    try:
        before = backup.restore_from(p)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "safety_backup": before}


@auth_api.post("/backups-upload/restore")
async def restore_upload(file: UploadFile = File(...)):
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False, dir=config.DATA_DIR) as tmp:
        while chunk := await file.read(1024 * 1024):
            tmp.write(chunk)
        tmp_path = Path(tmp.name)
    try:
        before = backup.restore_from(tmp_path)
    except ValueError as e:
        raise HTTPException(400, str(e))
    finally:
        tmp_path.unlink(missing_ok=True)
    return {"ok": True, "safety_backup": before}


app.include_router(api)
app.include_router(auth_api)


# ---------------------------------------------------------------- PWA ausliefern

@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    if path.startswith("api/"):
        return JSONResponse({"detail": "Nicht gefunden."}, status_code=404)
    static = config.STATIC_DIR
    target = (static / path).resolve()
    if path and target.is_file() and static.resolve() in target.parents:
        headers = {}
        if path in ("sw.js", "manifest.webmanifest") or path.startswith("workbox-"):
            headers["Cache-Control"] = "no-cache"
        elif path.startswith("assets/"):
            headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return FileResponse(target, headers=headers)
    index = static / "index.html"
    if index.is_file():
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
    return JSONResponse({"detail": "Frontend nicht gebaut."}, status_code=404)
