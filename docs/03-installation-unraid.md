# Installation auf Unraid – Schritt für Schritt (über die Oberfläche)

## Überblick

```
Handy (Tailscale-App an)
   │  https://wartung.deine-domain.de   (Zertifikat von Let's Encrypt)
   ▼
Tailscale-VPN ──► Unraid ──► Nginx Proxy Manager (HTTPS) ──► Container „yaris-wartung“ :8085
                                                               └─ /mnt/user/appdata/yaris-wartung
                                                                  ├─ wartung.db   (Datenbank)
                                                                  ├─ secret.key   (Sitzungsschlüssel)
                                                                  └─ backups/     (tägliche Sicherungen)
```

- **Kein offener Port im Router.** Die Domain zeigt auf die *Tailscale-IP* des Servers, also ist sie nur im VPN erreichbar.
- **HTTPS** mit echtem Zertifikat über die DNS-Challenge des Proxy Managers.
- **Anmeldung** mit Benutzername und Passwort in der App.
- **Daten** liegen außerhalb des Containers in `appdata` und überstehen jedes Update.

---

## 1. Docker-Image bereitstellen (einmalig)

Unraid lädt die App als fertiges Image aus der GitHub Container Registry. Das Image wird automatisch gebaut, die Bauanleitung dafür liegt in `.github/workflows/docker.yml`.

1. Ein GitHub-Konto anlegen (kostenlos) und ein neues Repository `yaris-wartung` erstellen.
2. Den Projektordner in dieses Repository übertragen. *(Das kann Claude für dich erledigen, sobald das Repository existiert.)*
3. Unter **Actions** wird das Image in etwa 3 Minuten gebaut.
4. Auf GitHub: **Profil → Packages → yaris-wartung → Package settings → Change visibility → Public**.
   Der Code enthält keine Passwörter oder Daten. Deine Daten liegen ausschließlich auf Unraid.

Das Image heißt danach `ghcr.io/senseless96/yaris-wartung:latest`.

## 2. Container auf Unraid anlegen

**Docker → Add Container** (unten auf der Seite), dann folgende Felder ausfüllen:

| Feld | Wert |
|---|---|
| Name | `yaris-wartung` |
| Repository | `ghcr.io/senseless96/yaris-wartung:latest` |
| Network Type | `Bridge` |
| WebUI | `http://[IP]:[PORT:8080]/` |

Danach über **„Add another Path, Port, Variable, Label or Device“** diese Einträge hinzufügen:

| Config Type | Name | Container | Host / Wert |
|---|---|---|---|
| **Port** | WebUI-Port | Container Port `8080` | Host Port `8085` |
| **Path** | Daten | Container Path `/data` | Host Path `/mnt/user/appdata/yaris-wartung` |
| **Variable** | Benutzername | Key `APP_USER` | z. B. `yaris` |
| **Variable** | Passwort | Key `APP_PASSWORD` | ein sicheres Passwort (mindestens 12 Zeichen) |
| **Variable** | Nur HTTPS | Key `COOKIE_SECURE` | `true` |
| **Variable** | Zeitzone | Key `TZ` | `Europe/Berlin` |

Optional: `BACKUP_HOUR` (Standard `3`, also 3:00 Uhr) und `BACKUP_KEEP` (Standard `30` Sicherungen).

Dann **Apply** klicken. Beim ersten Start legt die App die Datenbank an und übernimmt alle Daten aus deiner Excel-Datei.

> Alternativ kannst du `unraid/yaris-wartung.xml` nach `/boot/config/plugins/dockerMan/templates-user/` kopieren (z. B. über die Netzwerkfreigabe `flash`). Dann erscheint „yaris-wartung“ unter **Add Container → Template** mit allen Feldern vorausgefüllt.

**Kurztest im Heimnetz:** Setze `COOKIE_SECURE` vorübergehend auf `false` und öffne `http://UNRAID-IP:8085`. Danach wieder auf `true` stellen.

## 3. Tailscale

1. **Unraid:** Unter **Apps** das Plugin **„Tailscale“** installieren (bei Unraid 7 ist es unter *Settings → Tailscale* schon eingebaut) und mit deinem Tailscale-Konto anmelden.
2. In der Tailscale-Admin-Konsole (login.tailscale.com) die **Tailscale-IP** des Servers notieren, zum Beispiel `100.101.102.103`.
3. **Beide Handys:** Die App **Tailscale** aus dem App Store bzw. Play Store installieren und mit demselben Konto anmelden. Am besten „VPN On Demand“ (iOS) oder „Always-on VPN“ (Android) einschalten. Dann klappt der Zugriff zu Hause und unterwegs auf dieselbe Weise.

## 4. Domain und DNS

Du brauchst eine Domain, deren DNS-Einträge du bearbeiten kannst. Am einfachsten geht das mit **Cloudflare** (kostenlos) oder **DuckDNS**.

- Einen **A-Record** anlegen: `wartung.deine-domain.de` → **Tailscale-IP des Servers** (`100.x.y.z`).
  Diese Adresse ist im Internet nicht erreichbar, nur über Tailscale.
- Bei Cloudflare: **Proxy-Status = „DNS only“** (graue Wolke).
- Für die Zertifikate einen **API-Token** erstellen (Cloudflare: *My Profile → API Tokens → „Edit zone DNS“*).

## 5. Nginx Proxy Manager

Falls noch nicht vorhanden: Unter **Apps** „Nginx-Proxy-Manager-Official“ installieren.

> **Achtung, Port-Konflikt:** Die Unraid-Oberfläche belegt normalerweise die Ports 80/443. Entweder stellst du unter *Settings → Management Access* die Unraid-Ports um (z. B. auf 8008/8443) und gibst dem Proxy Manager 80/443. Oder du lässt den Proxy Manager auf seinem Port (z. B. 18443) und rufst die App über `https://wartung.deine-domain.de:18443` auf.

**SSL Certificates → Add SSL Certificate → Let's Encrypt**
- Domain: `wartung.deine-domain.de`
- **Use a DNS Challenge** einschalten → Anbieter (z. B. Cloudflare) → API-Token eintragen → Save

**Hosts → Proxy Hosts → Add Proxy Host**

| Reiter | Einstellung |
|---|---|
| Details | Domain `wartung.deine-domain.de` · Scheme `http` · Forward Hostname/IP = **LAN-IP von Unraid** (z. B. `192.168.178.10`) · Forward Port `8085` · ✔ Block Common Exploits |
| SSL | Das eben erstellte Zertifikat · ✔ Force SSL · ✔ HTTP/2 · ✔ HSTS |

Das Login übernimmt die App selbst. Eine *Access List* im Proxy Manager ist nicht nötig und würde die Installation auf dem Homescreen eher stören.

## 6. App auf den Handys installieren

Die Tailscale-App muss eingeschaltet sein, dann `https://wartung.deine-domain.de` öffnen und anmelden.

- **iPhone (Safari):** Teilen-Symbol → **„Zum Home-Bildschirm“**
- **Android (Chrome):** ⋮ → **„App installieren“** bzw. „Zum Startbildschirm hinzufügen“

Die App startet dann wie eine normale App im Vollbild. Die Anmeldung bleibt 180 Tage gespeichert.

**Synchronisation:** Beide Handys fragen alle 15 Sekunden und beim Öffnen der App nach Änderungen.
**Offline:** Ohne Verbindung zeigt die App den zuletzt geladenen Stand an, mit dem Hinweis „Offline – Stand vom …“. Neue Einträge sind erst wieder mit Verbindung möglich.

## 7. Datensicherung und Wiederherstellung

- **Automatisch:** jeden Tag um 3:00 Uhr nach `/mnt/user/appdata/yaris-wartung/backups/`. Die letzten 30 Sicherungen bleiben erhalten. War der Server um 3 Uhr aus, wird die Sicherung beim nächsten Start nachgeholt.
- **In der App:** *Mehr → Datensicherung*. Dort kannst du sofort sichern, eine Sicherung aufs Handy herunterladen, eine bestehende Sicherung wiederherstellen oder eine Datei einspielen.
- Vor jeder Wiederherstellung sichert die App den aktuellen Stand automatisch („Vor Wiederherstellung“).
- **Zusätzlich empfohlen:** Das Plugin *Appdata Backup* sichert den Ordner `appdata` auch auf ein anderes Laufwerk.

## 8. Updates

**Docker → yaris-wartung → Update** klicken (bzw. „Check for Updates“). Die Daten in `/mnt/user/appdata/yaris-wartung` bleiben dabei unverändert.

## 9. Passwort vergessen?

1. **Docker → yaris-wartung → Edit**
2. Bei `APP_USER` und `APP_PASSWORD` die gewünschten Zugangsdaten eintragen.
3. Eine Variable `RESET_PASSWORD` mit dem Wert `true` hinzufügen, dann **Apply** klicken.
4. Mit den neuen Daten anmelden. Danach `RESET_PASSWORD` wieder auf `false` stellen und erneut **Apply** klicken.

Deine Wartungsdaten bleiben dabei unverändert.
