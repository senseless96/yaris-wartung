"""SQLite-Zugriff, Schema-Initialisierung und Erstimport der Excel-Daten."""
import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from . import config

APP_DIR = Path(__file__).resolve().parent
SCHEMA = (APP_DIR / "schema.sql").read_text(encoding="utf-8")
SEED = APP_DIR / "seed" / "excel_import.json"


def connect(path: Path | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path or config.DB_PATH), timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 15000")
    return conn


@contextmanager
def session():
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_db():
    """FastAPI-Dependency: eine Verbindung pro Anfrage."""
    with session() as conn:
        yield conn


def bump_version(conn: sqlite3.Connection) -> None:
    conn.execute(
        "INSERT INTO meta(key, value) VALUES('data_version', '1') "
        "ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1"
    )


def data_version(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT value FROM meta WHERE key='data_version'").fetchone()
    return int(row["value"]) if row else 0


def init_db() -> None:
    config.ensure_dirs()
    with session() as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA)
        if conn.execute("SELECT COUNT(*) FROM maintenance_items").fetchone()[0] == 0:
            seed(conn)


def seed(conn: sqlite3.Connection) -> None:
    data = json.loads(SEED.read_text(encoding="utf-8"))
    v = data["vehicle"]
    conn.execute(
        "INSERT OR REPLACE INTO vehicle(id, name, model_code, engine, transmission, first_registration, first_registration_exact) "
        "VALUES (1, ?, ?, ?, ?, ?, ?)",
        (v["name"], v["model_code"], v["engine"], v["transmission"], v["first_registration"], v["first_registration_exact"]),
    )
    for k, val in data["settings"].items():
        conn.execute("INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)", (k, str(val)))
    for r in data["odometer_readings"]:
        conn.execute(
            "INSERT INTO odometer_readings(date, km, source, note) VALUES (?, ?, ?, ?)",
            (r["date"], r["km"], r.get("source", "import"), r.get("note")),
        )
    ids: dict[str, int] = {}
    for i, it in enumerate(data["maintenance_items"], start=1):
        cur = conn.execute(
            "INSERT INTO maintenance_items(name, kind, interval_km, interval_months, first_interval_km, first_interval_months, "
            "plan_mode, part_of_inspection, note, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                it["name"], it["kind"], it.get("interval_km"), it.get("interval_months"),
                it.get("first_interval_km"), it.get("first_interval_months"), it.get("plan_mode"),
                it.get("part_of_inspection", 0), it.get("note"), i * 10,
            ),
        )
        ids[it["key"]] = cur.lastrowid
    for ev in data["service_events"]:
        cur = conn.execute(
            "INSERT INTO service_events(date, date_exact, km, note) VALUES (?, ?, ?, ?)",
            (ev["date"], ev["date_exact"], ev["km"], ev.get("note")),
        )
        conn.execute(
            "UPDATE odometer_readings SET event_id = ? WHERE date = ? AND km = ? AND event_id IS NULL",
            (cur.lastrowid, ev["date"], ev["km"]),
        )
        for key in ev["items"]:
            conn.execute("INSERT INTO maintenance_records(event_id, item_id) VALUES (?, ?)", (cur.lastrowid, ids[key]))
    bump_version(conn)
