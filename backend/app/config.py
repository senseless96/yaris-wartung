"""Konfiguration über Umgebungsvariablen (im Unraid-Template einstellbar)."""
import os
import secrets
from pathlib import Path


def _bool(name: str, default: bool) -> bool:
    val = os.environ.get(name)
    if val is None or val == "":
        return default
    return val.strip().lower() in ("1", "true", "yes", "ja", "on")


DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
DB_PATH = DATA_DIR / "wartung.db"
BACKUP_DIR = Path(os.environ.get("BACKUP_DIR", str(DATA_DIR / "backups")))
STATIC_DIR = Path(os.environ.get("STATIC_DIR", str(Path(__file__).resolve().parent.parent / "static")))

ADMIN_USER = os.environ.get("APP_USER", "admin")
ADMIN_PASSWORD = os.environ.get("APP_PASSWORD", "")
RESET_PASSWORD = _bool("RESET_PASSWORD", False)

COOKIE_SECURE = _bool("COOKIE_SECURE", True)
SESSION_DAYS = int(os.environ.get("SESSION_DAYS", "180"))

BACKUP_HOUR = int(os.environ.get("BACKUP_HOUR", "3"))
BACKUP_KEEP = int(os.environ.get("BACKUP_KEEP", "30"))


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)


def secret_key() -> bytes:
    """Geheimer Schlüssel für Sitzungen – wird einmalig erzeugt und in /data gespeichert."""
    ensure_dirs()
    path = DATA_DIR / "secret.key"
    if not path.exists():
        path.write_text(secrets.token_hex(32))
        try:
            path.chmod(0o600)
        except OSError:
            pass
    return path.read_text().strip().encode()
