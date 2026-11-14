"""Wartungslogik – übersetzt aus der Excel-Datei (Blatt „Inspektion“, Spalten G und H, Zellen F6/F7).

Fälligkeit (Excel Spalte H):
    fällig, wenn  km_aktuell − km_zuletzt ≥ Intervall-km  ODER  Zeit seit letzter Durchführung ≥ Intervall
    → in der App mit echten Daten: Fälligkeitsdatum = Datum zuletzt + Intervall-Monate.
Erweiterungen (freigegeben):
    - „Bald fällig“: 3 Monate vor dem Fälligkeitsdatum. Für km-Fälligkeiten wird das Datum aus der
      durchschnittlichen Fahrleistung geschätzt.
    - Erstintervall (Kühlmittel): ohne Historie ab Erstzulassung mit 0 km.
    - Keine Historie → Status „missing“ (grau).
"""
from __future__ import annotations

import calendar
import math
import sqlite3
from dataclasses import dataclass, asdict
from datetime import date, timedelta

STATUS_ORDER = {"overdue": 0, "soon": 1, "missing": 2, "ok": 3, "info": 4}


def add_months(d: date, months: int) -> date:
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def parse_date(s: str) -> date:
    return date.fromisoformat(s[:10])


@dataclass
class Odometer:
    km: int | None
    date: date | None
    km_per_day: float | None


def current_odometer(conn: sqlite3.Connection, today: date) -> Odometer:
    rows = conn.execute("SELECT date, km FROM odometer_readings ORDER BY date, km").fetchall()
    if not rows:
        return Odometer(None, None, None)
    last = rows[-1]
    last_d, last_km = parse_date(last["date"]), last["km"]
    # Fahrleistung: Vergleich mit dem jüngsten Wert, der mindestens 180 Tage älter ist (sonst ältester Wert).
    ref = None
    for r in rows:
        if parse_date(r["date"]) <= last_d - timedelta(days=180):
            ref = r
    if ref is None:
        ref = rows[0]
    days = (last_d - parse_date(ref["date"])).days
    rate = (last_km - ref["km"]) / days if days >= 14 and last_km > ref["km"] else None
    return Odometer(last_km, last_d, rate)


@dataclass
class ItemStatus:
    id: int
    name: str
    kind: str
    status: str                 # overdue | soon | ok | missing | info
    interval_km: int | None
    interval_months: int | None
    first_interval_km: int | None
    first_interval_months: int | None
    soon_months: int | None
    plan_mode: str | None
    part_of_inspection: bool
    note: str | None
    active: bool
    sort_order: int
    last_date: str | None = None
    last_date_exact: bool | None = None
    last_km: int | None = None
    last_event_id: int | None = None
    base_is_registration: bool = False
    due_km: int | None = None
    due_date: str | None = None
    projected_km_date: str | None = None
    remaining_km: int | None = None
    remaining_days: int | None = None
    plan_due_this_step: bool | None = None


def plan_step(km: int | None, today: date, registration: date | None) -> int | None:
    """Excel F6: MAX(1; AUFRUNDEN(km/15000); Inspektionsjahr − Erstzulassungsjahr)."""
    if km is None or registration is None:
        return None
    return max(1, math.ceil(km / 15000), today.year - registration.year)


def _plan_flag(item: sqlite3.Row, step: int | None) -> bool | None:
    """Excel Spalte G: jede Inspektion, oder REST(Planstufe; Intervall-Jahre) = 0."""
    if step is None:
        return None
    if item["plan_mode"] == "every_inspection":
        return True
    if item["plan_mode"] != "plan_step":
        return None
    km, months = item["interval_km"], item["interval_months"]
    if not km or not months or km % 15000 or months % 12 or km // 15000 != months // 12:
        return None
    return step % (months // 12) == 0


def compute_items(conn: sqlite3.Connection, today: date | None = None, include_inactive: bool = False) -> dict:
    today = today or date.today()
    odo = current_odometer(conn, today)
    veh = conn.execute("SELECT * FROM vehicle WHERE id = 1").fetchone()
    reg = parse_date(veh["first_registration"]) if veh and veh["first_registration"] else None
    srow = conn.execute("SELECT value FROM settings WHERE key = 'soon_months'").fetchone()
    soon_default = int(srow["value"]) if srow else 3
    step = plan_step(odo.km, today, reg)

    last_rows = conn.execute(
        """
        SELECT r.item_id, e.id AS event_id, e.date, e.date_exact, e.km
        FROM maintenance_records r JOIN service_events e ON e.id = r.event_id
        ORDER BY e.date, e.km, e.id
        """
    ).fetchall()
    last_by_item = {r["item_id"]: r for r in last_rows}  # letzte gewinnt

    where = "" if include_inactive else "WHERE active = 1"
    items = conn.execute(f"SELECT * FROM maintenance_items {where} ORDER BY sort_order, id").fetchall()
    result: list[ItemStatus] = []
    for it in items:
        s = ItemStatus(
            id=it["id"], name=it["name"], kind=it["kind"], status="info",
            interval_km=it["interval_km"], interval_months=it["interval_months"],
            first_interval_km=it["first_interval_km"], first_interval_months=it["first_interval_months"],
            soon_months=it["soon_months"], plan_mode=it["plan_mode"],
            part_of_inspection=bool(it["part_of_inspection"]), note=it["note"],
            active=bool(it["active"]), sort_order=it["sort_order"],
            plan_due_this_step=_plan_flag(it, step),
        )
        last = last_by_item.get(it["id"])
        if last:
            s.last_date, s.last_date_exact = last["date"], bool(last["date_exact"])
            s.last_km, s.last_event_id = last["km"], last["event_id"]

        if it["kind"] in ("info", "inspection_check") or (not it["interval_km"] and not it["interval_months"]):
            s.status = "info"
            result.append(s)
            continue

        if last:
            base_date, base_km = parse_date(last["date"]), last["km"]
            iv_km, iv_m = it["interval_km"], it["interval_months"]
        elif (it["first_interval_km"] or it["first_interval_months"]) and reg:
            base_date, base_km = reg, 0
            iv_km, iv_m = it["first_interval_km"], it["first_interval_months"]
            s.base_is_registration = True
        else:
            s.status = "missing"
            result.append(s)
            continue

        due_date = add_months(base_date, iv_m) if iv_m else None
        due_km = base_km + iv_km if iv_km else None
        s.due_date = due_date.isoformat() if due_date else None
        s.due_km = due_km

        overdue = False
        candidates: list[date] = []
        if due_km is not None and odo.km is not None:
            s.remaining_km = due_km - odo.km
            if odo.km >= due_km:
                overdue = True
            elif odo.km_per_day:
                proj = (odo.date or today) + timedelta(days=math.ceil(s.remaining_km / odo.km_per_day))
                s.projected_km_date = proj.isoformat()
                candidates.append(proj)
        if due_date is not None:
            if today >= due_date:
                overdue = True
            candidates.append(due_date)

        if candidates:
            s.remaining_days = (min(candidates) - today).days
        soon_m = it["soon_months"] if it["soon_months"] is not None else soon_default
        if overdue:
            s.status = "overdue"
        elif candidates and min(candidates) <= add_months(today, soon_m):
            s.status = "soon"
        else:
            s.status = "ok"
        result.append(s)

    counts = {k: 0 for k in ("overdue", "soon", "ok", "missing", "info")}
    for s in result:
        counts[s.status] += 1
    tracked = [s for s in result if s.status != "info"]
    overall = min((s.status for s in tracked), key=lambda x: STATUS_ORDER[x], default="ok")

    return {
        "today": today.isoformat(),
        "odometer": {
            "km": odo.km,
            "date": odo.date.isoformat() if odo.date else None,
            "km_per_year": round(odo.km_per_day * 365) if odo.km_per_day else None,
        },
        "plan_step": step,
        "plan_next": (
            {"km": step * 15000, "year": reg.year + step} if step and reg else None
        ),
        "soon_months": soon_default,
        "counts": counts,
        "overall": overall,
        "items": [asdict(s) for s in result],
    }
