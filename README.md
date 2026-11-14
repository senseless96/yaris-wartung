# Yaris Wartung

Persönliche Wartungs-App (PWA) für den Toyota Yaris Hybrid 2018. Sie ersetzt die bisherige Excel-Datei.

- **Backend:** Python / FastAPI, SQLite (`backend/`)
- **Frontend:** React + Vite, installierbar als PWA (`frontend/`)
- **Betrieb:** ein Docker-Container auf Unraid, Daten in `/data`

| Dokument | Inhalt |
|---|---|
| `docs/01-excel-analyse.md` | Analyse der Excel-Datei, Plausibilitätsprüfung, Entscheidungen |
| `docs/02-datenmodell-und-logik.md` | Datenmodell und Fälligkeitsberechnung |
| `docs/03-installation-unraid.md` | Installation: Unraid, Tailscale, Proxy Manager, Handys |

## Entwicklung

```bash
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt pytest httpx
cd backend && DATA_DIR=../data APP_PASSWORD=test12345 COOKIE_SECURE=false ../.venv/bin/uvicorn app.main:app --reload
cd frontend && npm install && npm run dev   # http://localhost:5173
cd backend && ../.venv/bin/python -m pytest
```
