-- Datenbankschema Yaris-Wartung (SQLite)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY,
    username        TEXT    NOT NULL UNIQUE,
    password_hash   TEXT    NOT NULL,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicle (
    id                      INTEGER PRIMARY KEY CHECK (id = 1),
    name                    TEXT NOT NULL,
    model_code              TEXT,
    engine                  TEXT,
    transmission            TEXT,
    first_registration      TEXT,      -- ISO-Datum; nur Jahr bekannt -> YYYY-01-01
    first_registration_exact INTEGER NOT NULL DEFAULT 0,
    vin                     TEXT,
    license_plate           TEXT,
    notes                   TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS odometer_readings (
    id          INTEGER PRIMARY KEY,
    date        TEXT    NOT NULL,           -- ISO-Datum
    km          INTEGER NOT NULL CHECK (km >= 0),
    source      TEXT    NOT NULL DEFAULT 'manual',  -- manual | service | import
    event_id    INTEGER REFERENCES service_events(id) ON DELETE SET NULL,
    note        TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_odo_date ON odometer_readings(date, km);

CREATE TABLE IF NOT EXISTS maintenance_items (
    id                      INTEGER PRIMARY KEY,
    name                    TEXT    NOT NULL,
    kind                    TEXT    NOT NULL CHECK (kind IN ('replace','check','inspection_check','info')),
    interval_km             INTEGER,
    interval_months         INTEGER,
    first_interval_km       INTEGER,
    first_interval_months   INTEGER,
    plan_mode               TEXT    CHECK (plan_mode IN ('every_inspection','plan_step')),
    soon_months             INTEGER,       -- NULL = globale Einstellung
    part_of_inspection      INTEGER NOT NULL DEFAULT 0,
    note                    TEXT,
    active                  INTEGER NOT NULL DEFAULT 1,
    sort_order              INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS service_events (
    id          INTEGER PRIMARY KEY,
    date        TEXT    NOT NULL,
    date_exact  INTEGER NOT NULL DEFAULT 1,   -- 0 = aus Excel nur Jahr bekannt
    km          INTEGER NOT NULL CHECK (km >= 0),
    workshop    TEXT,
    cost_eur    REAL,
    note        TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS maintenance_records (
    id          INTEGER PRIMARY KEY,
    event_id    INTEGER NOT NULL REFERENCES service_events(id) ON DELETE CASCADE,
    item_id     INTEGER NOT NULL REFERENCES maintenance_items(id) ON DELETE CASCADE,
    note        TEXT,
    UNIQUE (event_id, item_id)
);
CREATE INDEX IF NOT EXISTS ix_rec_item ON maintenance_records(item_id);

-- interner Änderungszähler für die Synchronisation zwischen den Geräten
CREATE TABLE IF NOT EXISTS meta (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL
);
