# Schritt 2 – Datenmodell und Wartungslogik

Grundlage: `01-excel-analyse.md`. Die SQL-Definition steht in `backend/app/schema.sql`, die Startdaten aus der Excel-Datei in `backend/app/seed/excel_import.json`.

## 1. Tabellen (SQLite)

```
users                 Login (ein gemeinsamer Benutzer, Passwort als Argon2/bcrypt-Hash)
vehicle               Fahrzeugdaten (1 Datensatz)
settings              globale Einstellungen (Schwellen „bald fällig“, Inspektions-Basisintervall)
odometer_readings     Kilometerstand-Verlauf (Datum, km)
maintenance_items     Wartungspositionen mit Intervallen (= Excel-Zeilen 14–25)
service_events        ein Werkstatt-/Wartungstermin (Datum, km, Werkstatt, Kosten, Notiz)
maintenance_records   welche Positionen bei einem Termin erledigt wurden (= Historie)
```

### maintenance_items – Felder
| Feld | Bedeutung | Excel |
|---|---|---|
| name | Bezeichnung | Spalte B |
| kind | `replace` (Wechsel), `check` (Prüfung mit Intervall), `inspection_check` (nur Prüfpunkt der Inspektion), `info` (kein Intervall) | abgeleitet |
| interval_km | km-Intervall oder NULL | Spalte C |
| interval_months | Zeit-Intervall in Monaten oder NULL | Spalte D × 12 |
| plan_mode | `every_inspection` oder `plan_step` | Spalte G |
| first_interval_km / first_interval_months | optionaler abweichender Erstwechsel (z. B. Kühlmittel) | neu, nur nach Freigabe |
| soon_months | Vorwarnung in Monaten für diese Position, NULL = globaler Wert (3) | neu |
| part_of_inspection | wird mit „Inspektion erledigt“ gemeinsam abgehakt | neu (Komfort) |
| note | Hinweistext | Spalte H / Blatt Wartungsplan |
| active, sort_order | Anzeige | – |

## 2. Berechnung (Python, 1:1 aus Excel übersetzt)

```
letzte = jüngster maintenance_record der Position (nach Datum, dann km)

wenn kind == "info"                 → Status "info"           (grau, z. B. Getriebeöl)
wenn kind == "inspection_check"     → Status "info" (wird mit der Inspektion abgehakt, zählt nicht extra)
wenn keine letzte Durchführung       → "missing" = Ohne Daten (grau); Ausnahme Erstintervall ab Erstzulassung

faellig_km    = letzte.km    + interval_km        (falls interval_km gesetzt)
faellig_datum = letzte.datum + interval_months    (falls interval_months gesetzt)

ÜBERFÄLLIG (rot)  wenn km_aktuell ≥ faellig_km  ODER  heute ≥ faellig_datum      (Excel: ≥, "was zuerst eintritt")
BALD (orange)     wenn frühestes Datum aus { faellig_datum, geschätztes Datum für faellig_km } ≤ heute + 3 Monate
                  (geschätzt über Ø km/Tag aus dem Kilometerverlauf; Vorwarnzeit global oder je Position einstellbar)
OHNE DATEN (grau) wenn keine Durchführung eingetragen und kein Erstintervall ab Erstzulassung
OK (grün)         sonst
```
- Excel-genauer Import: „Jahr 2025“ → 01.01.2025. Damit liefert die App heute dieselben Ergebnisse wie die Excel-Datei.
- Wird eine Wartung eingetragen, entsteht ein neuer `maintenance_record`. Die nächste Fälligkeit wird bei jeder Abfrage neu berechnet und nicht gespeichert, damit nach einer Intervalländerung nichts veraltet ist.
- Ein neuer Kilometerstand aus einem Wartungstermin wird automatisch auch in `odometer_readings` übernommen.

### Planstufe (nur als Info-Karte)
```
stufe = max(1, ceil(km_aktuell / 15000), jahr_heute − jahr_erstzulassung)
nächster Plantermin = stufe × 15.000 km oder Jahr (EZ + stufe)
Position "laut Plan dran" = plan_mode == every_inspection  ODER  stufe % (interval_months/12) == 0
```

## 3. Dashboard-Kennzahlen
- aktueller km-Stand = jüngster `odometer_readings`-Eintrag
- Anzahl rot / orange / grün aus der Berechnung oben
- „erledigt“ = Anzahl der Positionen, die grün sind (zusätzlich Anzahl der Historien-Einträge im laufenden Jahr)
- Fahrzeugstatus = schlechtester Einzelstatus (rot > orange > grün)
