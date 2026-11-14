"""Tägliche Datensicherung und Wiederherstellung (SQLite Online-Backup, auch im laufenden Betrieb sicher)."""
from __future__ import annotations

import logging
import re
import sqlite3
import threading
from datetime import datetime, timedelta
from pathlib import Path

from . import config
from .db import connect, bump_version

log = logging.getLogger("backup")
NAME_RE = re.compile(r"^wartung_\d{4}-\d{2}-\d{2}_\d{4}(_[a-z0-9-]+)?\.db$")
REQUIRED_TABLES = {"vehicle", "maintenance_items", "service_events", "maintenance_records", "odometer_readings", "users"}


def create_backup(label: str = "auto") -> Path:
    config.ensure_dirs()
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    suffix = "" if label == "auto" else f"_{label}"
    target = config.BACKUP_DIR / f"wartung_{stamp}{suffix}.db"
    src = connect()
    dst = sqlite3.connect(str(target))
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    prune()
    log.info("Backup erstellt: %s", target.name)
    return target


def prune() -> None:
    """Behält die neuesten BACKUP_KEEP automatischen Sicherungen; manuelle bleiben erhalten."""
    autos = sorted(p for p in config.BACKUP_DIR.glob("wartung_*.db") if re.fullmatch(r"wartung_\d{4}-\d{2}-\d{2}_\d{4}\.db", p.name))
    for p in autos[: max(0, len(autos) - config.BACKUP_KEEP)]:
        p.unlink(missing_ok=True)


def list_backups() -> list[dict]:
    config.ensure_dirs()
    out = []
    for p in sorted(config.BACKUP_DIR.glob("wartung_*.db"), reverse=True):
        if NAME_RE.match(p.name):
            st = p.stat()
            out.append({"name": p.name, "size": st.st_size, "created": datetime.fromtimestamp(st.st_mtime).isoformat(timespec="minutes")})
    return out


def backup_path(name: str) -> Path | None:
    if not NAME_RE.match(name):
        return None
    p = config.BACKUP_DIR / name
    return p if p.is_file() else None


def validate_db_file(path: Path) -> None:
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("Die Sicherung ist beschädigt.")
            tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        finally:
            conn.close()
    except sqlite3.DatabaseError as e:
        raise ValueError("Keine gültige Sicherungsdatei.") from e
    if not REQUIRED_TABLES <= tables:
        raise ValueError("Die Datei ist keine Sicherung dieser App.")


def restore_from(path: Path) -> str:
    """Sichert zuerst den aktuellen Stand und spielt dann die Sicherung ein."""
    validate_db_file(path)
    before = create_backup("vor-wiederherstellung")
    src = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    dst = connect()
    try:
        src.backup(dst)
        bump_version(dst)
        dst.commit()
    finally:
        src.close()
        dst.close()
    return before.name


class DailyBackup(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True, name="daily-backup")
        self._stop = threading.Event()

    def run(self) -> None:
        # Falls heute noch keine Sicherung existiert (z. B. Server war aus): sofort nachholen.
        today = datetime.now().strftime("%Y-%m-%d")
        if not any(b["name"].startswith(f"wartung_{today}") for b in list_backups()):
            self._safe_backup()
        while not self._stop.is_set():
            now = datetime.now()
            nxt = now.replace(hour=config.BACKUP_HOUR, minute=0, second=0, microsecond=0)
            if nxt <= now:
                nxt += timedelta(days=1)
            if self._stop.wait((nxt - now).total_seconds()):
                break
            self._safe_backup()

    def _safe_backup(self) -> None:
        try:
            create_backup()
        except Exception:
            log.exception("Backup fehlgeschlagen")

    def stop(self) -> None:
        self._stop.set()
