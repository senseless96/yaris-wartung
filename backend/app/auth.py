"""Anmeldung: Passwort-Hash (scrypt), signiertes Sitzungs-Cookie, Schutz vor Rate-Angriffen."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import sqlite3
import threading
import time

from fastapi import Depends, HTTPException, Request, Response

from . import config
from .db import get_db

COOKIE = "yw_session"
_SCRYPT = dict(n=2**15, r=8, p=1, maxmem=64 * 1024 * 1024, dklen=32)


def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(pw.encode(), salt=salt, **_SCRYPT)
    return "scrypt$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(dk).decode()


def verify_password(pw: str, stored: str) -> bool:
    try:
        _, salt_b64, dk_b64 = stored.split("$")
        dk = hashlib.scrypt(pw.encode(), salt=base64.b64decode(salt_b64), **_SCRYPT)
        return hmac.compare_digest(dk, base64.b64decode(dk_b64))
    except Exception:
        return False


def ensure_user(conn: sqlite3.Connection) -> None:
    """Legt beim ersten Start den Benutzer aus APP_USER/APP_PASSWORD an."""
    if conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]:
        if config.RESET_PASSWORD and config.ADMIN_PASSWORD:
            # Notfall: Zugang aus dem Unraid-Template neu setzen (danach RESET_PASSWORD wieder auf false)
            conn.execute(
                "UPDATE users SET username = ?, password_hash = ? WHERE id = (SELECT MIN(id) FROM users)",
                (config.ADMIN_USER, hash_password(config.ADMIN_PASSWORD)),
            )
        return
    if not config.ADMIN_PASSWORD:
        raise RuntimeError("Beim ersten Start muss APP_PASSWORD gesetzt sein (Unraid-Template).")
    conn.execute(
        "INSERT INTO users(username, password_hash) VALUES (?, ?)",
        (config.ADMIN_USER, hash_password(config.ADMIN_PASSWORD)),
    )


# ---------- Sitzungs-Token ----------

def _sign(data: bytes) -> str:
    return base64.urlsafe_b64encode(hmac.new(config.secret_key(), data, hashlib.sha256).digest()).decode().rstrip("=")


def _pw_tag(password_hash: str) -> str:
    # ändert sich mit dem Passwort → alte Sitzungen werden ungültig
    return hashlib.sha256(password_hash.encode()).hexdigest()[:12]


def make_token(user_id: int, password_hash: str) -> str:
    payload = json.dumps({"u": user_id, "e": int(time.time()) + config.SESSION_DAYS * 86400, "p": _pw_tag(password_hash)})
    data = base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")
    return data + "." + _sign(data.encode())


def read_token(token: str) -> dict | None:
    try:
        data, sig = token.split(".")
        if not hmac.compare_digest(sig, _sign(data.encode())):
            return None
        payload = json.loads(base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)))
        if payload["e"] < time.time():
            return None
        return payload
    except Exception:
        return None


def set_cookie(resp: Response, token: str) -> None:
    resp.set_cookie(
        COOKIE, token, max_age=config.SESSION_DAYS * 86400, httponly=True,
        secure=config.COOKIE_SECURE, samesite="lax", path="/",
    )


def current_user(request: Request, conn: sqlite3.Connection = Depends(get_db)) -> sqlite3.Row:
    token = request.cookies.get(COOKIE)
    payload = read_token(token) if token else None
    if payload:
        user = conn.execute("SELECT * FROM users WHERE id = ?", (payload["u"],)).fetchone()
        if user and payload.get("p") == _pw_tag(user["password_hash"]):
            return user
    raise HTTPException(status_code=401, detail="Bitte anmelden.")


# ---------- Brute-Force-Schutz ----------

class LoginLimiter:
    """Max. 5 Fehlversuche je IP in 15 Minuten."""

    def __init__(self, max_fail: int = 5, window: int = 900):
        self.max_fail, self.window = max_fail, window
        self._fails: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def _recent(self, ip: str) -> list[float]:
        now = time.time()
        lst = [t for t in self._fails.get(ip, []) if now - t < self.window]
        self._fails[ip] = lst
        return lst

    def check(self, ip: str) -> None:
        with self._lock:
            if len(self._recent(ip)) >= self.max_fail:
                raise HTTPException(status_code=429, detail="Zu viele Fehlversuche. Bitte 15 Minuten warten.")

    def fail(self, ip: str) -> None:
        with self._lock:
            self._recent(ip).append(time.time())

    def reset(self, ip: str) -> None:
        with self._lock:
            self._fails.pop(ip, None)


limiter = LoginLimiter()
