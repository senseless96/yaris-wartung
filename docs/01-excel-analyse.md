# Schritt 1 – Analyse der Excel-Datei „Toyota_Yaris_Hybrid_2018_Wartungsplan.xlsx“

Stand: 14.11.2026

## 1. Aufbau der Datei

| Blatt | Inhalt |
|---|---|
| **Inspektion** | Eingaben (gelb), berechnete Planstufe, Inspektionsstatus, Tabelle mit 12 Positionen inkl. Fälligkeitsformeln |
| **Wartungsplan** | Referenz-Intervalle aus der Quelle (Toyota Serbien, Preisliste Yaris Hybrid NHP130, 17.10.2018) und Annahmen |

Keine ausgeblendeten Blätter/Spalten, keine benannten Bereiche, keine Datenüberprüfungen.

### Eingabezellen (gelb, Blatt „Inspektion“)

| Zelle | Bedeutung | Wert |
|---|---|---|
| C6 | Inspektionsjahr (= „heute“) | 2026 |
| C7 | Kilometerstand | 105.000 |
| C8 | Erstzulassung (nur Jahr) | 2018 |
| C9 | Letzte Inspektion: Jahr | 2025 |
| C10 | Letzte Inspektion: km | 81.967 |
| E14:F25 | Je Position: zuletzt Jahr / km | siehe Tabelle unten |

## 2. Wartungspositionen (1:1 aus der Excel-Datei)

| # | Position | km-Intervall | Jahres-Intervall | Zuletzt Jahr | Zuletzt km | Typ „Laut Plan“ |
|---|---|---|---|---|---|---|
| 1 | Toyota-Inspektion (Umfang prüfen) | 15.000 | 1 | 2025 | 81.967 | Jede Inspektion |
| 2 | Motoröl wechseln | 15.000 | 1 | 2025 | 81.967 | Jede Inspektion |
| 3 | Ölfilter ersetzen | 15.000 | 1 | 2025 | 81.967 | Jede Inspektion |
| 4 | Dichtung Ölablassschraube | 15.000 | 1 | 2025 | 81.967 | Jede Inspektion |
| 5 | Bremsflüssigkeit wechseln | 30.000 | 2 | 2025 | 81.967 | Stufen 2, 4, 6, 8 |
| 6 | Innenraumfilter ersetzen | 30.000 | 2 | 2025 | 81.967 | Stufen 2, 4, 6, 8 |
| 7 | Motor-Luftfilter ersetzen | 60.000 | 4 | 2024 | 62.373 | Stufen 4, 8 |
| 8 | Zündkerzen ersetzen | 90.000 | 6 | 2025 | 81.967 | Stufe 6 |
| 9 | Hybridbatterie prüfen lassen | 15.000 | 1 | 2025 | 81.967 | Jede Inspektion |
| 10 | Bremsen / Reifen / Licht prüfen | – | 1 | 2025 | 81.967 | Jede Inspektion (nur Prüfung) |
| 11 | Kühlmittel / Undichtigkeiten prüfen | – | 1 | 2025 | 81.967 | Jede Inspektion (nur Prüfung) |
| 12 | Getriebeöl: Vorgabe prüfen | – | – | – | – | „FIN / Serviceheft prüfen“, kein Intervall |

## 3. Berechnungslogik (Formeln entschlüsselt)

### 3.1 Planstufe (F6)
```
WENN Eingaben fehlen ODER Inspektionsjahr < Erstzulassung ODER km < 0 → "Eingaben prüfen"
SONST Planstufe = MAX( 1 ; AUFRUNDEN(km / 15.000) ; Inspektionsjahr − Erstzulassungsjahr )
```
Aktuell: MAX(1; AUFRUNDEN(105.000/15.000)=7; 2026−2018=8) = **8**

### 3.2 Nächster Termin laut Plan (F7)
`Planstufe × 15.000 km oder Jahr (Erstzulassung + Planstufe)` → „120000 km oder Jahr 2026“

### 3.3 Inspektionsstatus (F9)
```
fällig, wenn (Jahr heute − Jahr letzte Inspektion) ≥ 1  ODER  (km heute − km letzte Inspektion) ≥ 15.000
```

### 3.4 „Laut Plan“ (Spalte G)
- Positionen mit 1 Jahr: immer „Jede Inspektion“
- sonst: `REST(Planstufe; Intervall-Jahre) = 0` → „Planmäßiger Termin“, sonst „Nicht in dieser Stufe“
- Das funktioniert, weil bei allen Positionen gilt: km-Intervall / 15.000 = Jahres-Intervall.

### 3.5 „Mit Historie“ (Spalte H) – die eigentliche Fälligkeit
```
WENN Planstufe ungültig            → "Eingaben prüfen"
WENN Jahr UND km leer              → "Historie prüfen"     (orange/braune Schrift)
WENN nur eins von beiden leer      → "Beide Werte ergänzen"
WENN (Jahr heute − Jahr zuletzt) ≥ Intervall-Jahre
  ODER (km heute − km zuletzt) ≥ Intervall-km → "FÄLLIG" (rote Schrift, roter Hintergrund)
SONST                               → "Noch nicht fällig"
```
→ **Was zuerst eintritt** (km oder Zeit), Grenze jeweils **inklusive** (≥).

### 3.6 Bedingte Formatierung
- Text enthält „FÄLLIG“ → rote Schrift (#A22525) auf hellrot (#FDE8E7)
- Text enthält „Historie prüfen“ → braun-orange Schrift (#855000) auf hellgelb (#FFF1D6)
- **Es gibt keinen Zustand „bald fällig“** – den muss die App neu bekommen (siehe offene Fragen).

## 4. Ergebnis mit den aktuellen Excel-Werten (km 105.000, Jahr 2026)

| Position | Nächste Fälligkeit | Status |
|---|---|---|
| Inspektion, Öl, Ölfilter, Dichtung, Hybridbatterie-Check | 96.967 km oder 2026 | **ÜBERFÄLLIG** (seit ca. 8.000 km) |
| Bremsflüssigkeit | 111.967 km oder 2027 | noch ~7.000 km |
| Innenraumfilter | 111.967 km oder 2027 | noch ~7.000 km |
| Motor-Luftfilter | 122.373 km oder 2028 | i. O. |
| Zündkerzen | 171.967 km oder 2031 | i. O. |

## 5. Gefundene Schwächen der Excel-Logik

1. **Nur Jahre, keine Daten.** Eine Wartung im Dezember 2025 gilt am 1. Januar 2026 schon als fällig. Die App rechnet mit echten Daten (Tag/Monat).
   *Excel-genaue Übernahme:* „Jahr X“ wird als 01.01.X importiert – dann ergibt die App exakt dieselben Ergebnisse wie die Excel-Datei, bis echte Daten nachgetragen sind.
2. **Erstzulassung nur als Jahr** → die Planstufe nach Alter ist ungenau (in der Datei selbst so vermerkt).
3. **Planstufe vs. Historie:** „Laut Plan“ sagt für Bremsflüssigkeit „Planmäßiger Termin“, „Mit Historie“ sagt „Noch nicht fällig“. Vorschlag: In der App ist die **Historie maßgeblich** (Ampel), die Planstufe wird nur als Info angezeigt.
4. **Positionen 1–4 und 9** haben identische Intervalle → in der App als „Inspektion durchgeführt“ mit einem Klick gemeinsam abhakbar, aber weiterhin einzeln gespeichert.
5. Prüfpositionen (10, 11) haben kein km-Intervall und keine eigene Fälligkeitsformel – sie laufen in der App als Prüfpunkte der Inspektion mit.

## 6. Plausibilitätsprüfung für den Yaris Hybrid 2018 (XP13, 1NZ-FXE)

> Wichtig: Die Quelle der Excel-Datei ist eine **serbische** Toyota-Preisliste, nicht der deutsche Wartungsplan. Die offiziellen Toyota-Europa-Pläne (toyota-tech.eu) konnte ich aus dieser Umgebung nicht abrufen. Die folgenden Punkte sind daher **Hinweise zum Abgleich mit dem Serviceheft**, keine Änderungen. Nichts davon ist in die App übernommen, solange du es nicht bestätigst.

| Punkt | Excel | Einschätzung |
|---|---|---|
| Inspektion / Öl / Ölfilter 15.000 km / 1 Jahr | ✔ | Entspricht dem üblichen Toyota-Europa-Intervall. |
| Bremsflüssigkeit 30.000 km / 2 Jahre | ✔ | 2 Jahre ist in Deutschland üblich und plausibel. |
| Motor-Luftfilter 60.000 km / 4 Jahre | ✔ plausibel | Bei viel Staub früher. |
| Innenraumfilter 30.000 km / 2 Jahre | ⚠ prüfen | Viele Toyota-Pläne in DE sehen den Pollenfilter **jährlich / 15.000 km** vor. Bitte im Serviceheft prüfen. |
| Zündkerzen 90.000 km / 6 Jahre | ⚠ prüfen | Je nach Markt werden 60.000 oder 90.000 km genannt. Außerdem: Wurden die Kerzen 2025 bei 81.967 km **wirklich** gewechselt? (Datum identisch mit der Inspektion.) |
| **Kühlmittel Motor + Inverter** | ❌ fehlt | Toyota Super Long Life Coolant: Erstwechsel üblicherweise **160.000 km / 10 Jahre**, danach alle 80.000 km / 5 Jahre → bei EZ 2018 ca. **2028** fällig. Empfehlung: aufnehmen. |
| Hybridbatterie-Check jährlich | ✔ wichtig | Toyota verlängert die Hybridbatterie-Garantie (Hybrid Battery Extended Care), solange der Check jährlich gemacht wird → in der App unbedingt behalten. |
| Getriebeöl (Hybridgetriebe P410) | ✔ korrekt | Toyota sieht im Normalbetrieb keinen festen Wechsel vor, nur eine Prüfung. Bleibt als Info-Position. |
| 12-V-Batterie, Bremsbeläge, Reifen | ✔ korrekt | nach Befund, kein Intervall |
| **HU/AU (TÜV)** | fehlt | Keine Wartung, aber alle 2 Jahre Pflicht. Empfehlung: als zusätzliche Position (nur Zeit, 24 Monate). |

## 7. Entscheidungen (14.11.2026)

| Frage | Entscheidung |
|---|---|
| „Bald fällig“ (Orange) | **3 Monate** vor Fälligkeit. Für km-Fälligkeiten wird das Datum aus der Fahrleistung geschätzt. |
| Genaue Daten | Werden später in der App nachgetragen. Bis dahin gilt der 01.01. des Jahres (Excel-genau). |
| Kilometerstand | 105.000 km bestätigt |
| Historie 2025 | Alle Excel-Einträge sind korrekt |
| Kühlmittel | **Aufgenommen:** erstmals 160.000 km / 10 Jahre ab EZ, danach 80.000 km / 5 Jahre |
| HU/AU | **Aufgenommen:** alle 24 Monate (letzte HU noch nachtragen) |
| Innenraumfilter | **Geändert auf 15.000 km / 1 Jahr**, wird bei jeder Inspektion gewechselt |
| Fehlende Historie | **Grau** („Ohne Daten“) |
