import { useEffect, useRef, useState } from "react";
import { api, type Item, type Vehicle } from "../api";
import { interval } from "../format";
import { useData, useResource } from "../store";
import { Field, Icon, PageHeader, Sheet, StatusDot, Toggle, confirmDialog, useToast } from "../ui";
import { ItemEditSheet } from "./Items";

export default function Settings({ onLogout }: { onLogout: () => void }) {
  const { dash } = useData();
  const [sheet, setSheet] = useState<null | "vehicle" | "warn" | "password" | "backup" | "users">(null);
  const { data: items } = useResource<Item[]>("/items");
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [newItem, setNewItem] = useState(false);

  const logout = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    onLogout();
  };

  return (
    <div className="page">
      <PageHeader title="Einstellungen" />

      <section className="menu card">
        <MenuRow icon="home" title="Fahrzeugdaten" sub={dash?.vehicle ? `${dash.vehicle.name} · EZ ${dash.vehicle.first_registration.slice(0, 4)}` : ""} onClick={() => setSheet("vehicle")} />
        <MenuRow icon="history" title="Vorwarnung „bald fällig“" sub={dash ? `${dash.soon_months} Monate vor Fälligkeit` : ""} onClick={() => setSheet("warn")} />
        <MenuRow icon="download" title="Datensicherung" sub="Tägliches Backup, Wiederherstellung" onClick={() => setSheet("backup")} />
        <MenuRow icon="settings" title="Mein Zugang" sub="Eigenen Namen und Passwort ändern" onClick={() => setSheet("password")} />
        <MenuRow icon="plus" title="Benutzer" sub="Weitere Personen mit Zugriff" onClick={() => setSheet("users")} />
      </section>

      <div className="section-head">
        <h2>Wartungspositionen</h2>
        <button className="link" onClick={() => setNewItem(true)}>+ Neu</button>
      </div>
      <section className="menu card">
        {(items ?? []).map((it) => (
          <button key={it.id} className={`menu-row ${it.active ? "" : "inactive"}`} onClick={() => setEditItem(it)}>
            <StatusDot s={it.status} />
            <span className="menu-text">
              <span>{it.name}</span>
              <small className="muted">{it.active ? interval(it) : "deaktiviert"}</small>
            </span>
            <Icon name="chevron" size={18} />
          </button>
        ))}
      </section>

      <button className="btn btn-ghost block danger" onClick={logout}>
        <Icon name="logout" size={18} /> Abmelden
      </button>
      <p className="muted small center">Yaris Wartung · Version 1.0</p>

      <VehicleSheet open={sheet === "vehicle"} onClose={() => setSheet(null)} />
      <WarnSheet open={sheet === "warn"} onClose={() => setSheet(null)} />
      <PasswordSheet open={sheet === "password"} onClose={() => setSheet(null)} />
      <BackupSheet open={sheet === "backup"} onClose={() => setSheet(null)} />
      <UsersSheet open={sheet === "users"} onClose={() => setSheet(null)} />
      <ItemEditSheet open={!!editItem || newItem} item={editItem} onClose={() => { setEditItem(null); setNewItem(false); }} />
    </div>
  );
}

function MenuRow({ icon, title, sub, onClick }: { icon: Parameters<typeof Icon>[0]["name"]; title: string; sub?: string; onClick: () => void }) {
  return (
    <button className="menu-row" onClick={onClick}>
      <span className="menu-icon"><Icon name={icon} size={20} /></span>
      <span className="menu-text">
        <span>{title}</span>
        {sub && <small className="muted">{sub}</small>}
      </span>
      <Icon name="chevron" size={18} />
    </button>
  );
}

/* ---------------- Fahrzeug ---------------- */
function VehicleSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { reload } = useData();
  const toast = useToast();
  const [v, setV] = useState<Vehicle | null>(null);
  useEffect(() => {
    if (open) api<Vehicle>("/vehicle").then(setV).catch((e) => toast(e.message, "err"));
  }, [open, toast]);
  if (!v) return null;
  const set = (k: keyof Vehicle) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const save = async () => {
    try {
      await api("/vehicle", { method: "PUT", json: { ...v, first_registration_exact: !!v.first_registration_exact } });
      await reload();
      toast("Fahrzeugdaten gespeichert");
      onClose();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Fahrzeugdaten" footer={<button className="btn btn-primary grow" onClick={save}>Speichern</button>}>
      <Field label="Bezeichnung"><input value={v.name} onChange={set("name")} /></Field>
      <div className="grid2">
        <Field label="Kennzeichen"><input value={v.license_plate ?? ""} onChange={set("license_plate")} autoCapitalize="characters" /></Field>
        <Field label="Typ / Code"><input value={v.model_code ?? ""} onChange={set("model_code")} /></Field>
      </div>
      <div className="grid2">
        <Field label="Motor"><input value={v.engine ?? ""} onChange={set("engine")} /></Field>
        <Field label="Getriebe"><input value={v.transmission ?? ""} onChange={set("transmission")} /></Field>
      </div>
      <Field label="Erstzulassung" hint="Wird für Planstufe und Kühlmittel-Erstwechsel genutzt">
        <input type="date" value={v.first_registration} onChange={set("first_registration")} />
      </Field>
      <Toggle checked={!!v.first_registration_exact} onChange={(x) => setV({ ...v, first_registration_exact: x })} label="Datum ist genau" hint="Aus: nur das Jahr ist bekannt" />
      <Field label="FIN"><input value={v.vin ?? ""} onChange={set("vin")} autoCapitalize="characters" /></Field>
      <Field label="Notizen"><textarea rows={2} value={v.notes ?? ""} onChange={set("notes")} /></Field>
    </Sheet>
  );
}

/* ---------------- Vorwarnung ---------------- */
function WarnSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { dash, reload } = useData();
  const toast = useToast();
  const [m, setM] = useState("3");
  useEffect(() => {
    if (open && dash) setM(String(dash.soon_months));
  }, [open, dash]);
  const save = async () => {
    try {
      await api("/settings", { method: "PUT", json: { soon_months: parseInt(m, 10) || 0 } });
      await reload();
      toast("Gespeichert");
      onClose();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Vorwarnung" footer={<button className="btn btn-primary grow" onClick={save}>Speichern</button>}>
      <Field label="Monate vor Fälligkeit" hint="Orange wird angezeigt, wenn das Fälligkeitsdatum – oder das aus der Fahrleistung geschätzte Datum für die km-Grenze – innerhalb dieses Zeitraums liegt. Einzelne Positionen können eine eigene Vorwarnung haben.">
        <input inputMode="numeric" value={m} onChange={(e) => setM(e.target.value)} />
      </Field>
    </Sheet>
  );
}

/* ---------------- Passwort ---------------- */
function PasswordSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ old: "", nu: "", nu2: "", user: "" });
  useEffect(() => {
    if (open) api<{ username: string }>("/auth/me").then((r) => setF({ old: "", nu: "", nu2: "", user: r.username })).catch(() => {});
  }, [open]);
  const save = async () => {
    if (f.nu.length < 8) return toast("Das neue Passwort braucht mindestens 8 Zeichen.", "err");
    if (f.nu !== f.nu2) return toast("Die Passwörter stimmen nicht überein.", "err");
    try {
      await api("/auth/password", { method: "POST", json: { old_password: f.old, new_password: f.nu, new_username: f.user } });
      toast("Zugangsdaten geändert. Andere Geräte mit diesem Zugang müssen sich neu anmelden.");
      onClose();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Mein Zugang" footer={<button className="btn btn-primary grow" onClick={save}>Ändern</button>}>
      <Field label="Benutzername"><input value={f.user} autoCapitalize="none" onChange={(e) => setF({ ...f, user: e.target.value })} /></Field>
      <Field label="Bisheriges Passwort"><input type="password" autoComplete="current-password" value={f.old} onChange={(e) => setF({ ...f, old: e.target.value })} /></Field>
      <Field label="Neues Passwort" hint="mindestens 8 Zeichen"><input type="password" autoComplete="new-password" value={f.nu} onChange={(e) => setF({ ...f, nu: e.target.value })} /></Field>
      <Field label="Neues Passwort wiederholen"><input type="password" autoComplete="new-password" value={f.nu2} onChange={(e) => setF({ ...f, nu2: e.target.value })} /></Field>
    </Sheet>
  );
}

/* ---------------- Datensicherung ---------------- */
interface BackupList { backups: { name: string; size: number; created: string }[]; keep: number; hour: number }

function BackupSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { reload } = useData();
  const toast = useToast();
  const [list, setList] = useState<BackupList | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const load = () => api<BackupList>("/backups").then(setList).catch((e) => toast(e.message, "err"));
  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const create = async () => {
    try {
      await api("/backups", { method: "POST" });
      toast("Sicherung erstellt");
      load();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const restore = async (name: string) => {
    if (!confirmDialog(`Sicherung „${name}“ wiederherstellen?\n\nDer aktuelle Stand wird vorher automatisch gesichert.`)) return;
    try {
      await api(`/backups/${encodeURIComponent(name)}/restore`, { method: "POST" });
      await reload();
      toast("Wiederhergestellt");
      load();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const upload = async (file: File) => {
    if (!confirmDialog(`Datei „${file.name}“ einspielen?\n\nDer aktuelle Stand wird vorher automatisch gesichert.`)) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      await api("/backups-upload/restore", { method: "POST", body: fd });
      await reload();
      toast("Wiederhergestellt");
      load();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const label = (n: string) => {
    const m = n.match(/wartung_(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(?:_(.+))?\.db/);
    if (!m) return n;
    const kind = m[6] === "manuell" ? "Manuell" : m[6] === "vor-wiederherstellung" ? "Vor Wiederherstellung" : "Automatisch";
    return `${m[3]}.${m[2]}.${m[1]}, ${m[4]}:${m[5]} · ${kind}`;
  };

  return (
    <Sheet open={open} onClose={onClose} title="Datensicherung">
      <p className="muted small">
        Automatisch jeden Tag um {list?.hour ?? 3}:00 Uhr. Die letzten {list?.keep ?? 30} automatischen Sicherungen werden behalten. Gespeichert in <code>/data/backups</code> auf dem Unraid-Server.
      </p>
      <div className="btn-row">
        <button className="btn btn-ghost grow" onClick={create}><Icon name="plus" size={18} /> Jetzt sichern</button>
        <button className="btn btn-ghost grow" onClick={() => fileRef.current?.click()}><Icon name="upload" size={18} /> Datei einspielen</button>
        <input ref={fileRef} type="file" accept=".db,application/octet-stream" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </div>
      <ul className="backup-list">
        {(list?.backups ?? []).map((b) => (
          <li key={b.name}>
            <div>
              <b>{label(b.name)}</b>
              <span className="muted small">{Math.round(b.size / 1024)} KB</span>
            </div>
            <div className="odo-right">
              <a className="icon-btn subtle" href={`/api/backups/${encodeURIComponent(b.name)}`} download aria-label="Herunterladen"><Icon name="download" size={18} /></a>
              <button className="btn btn-small" onClick={() => restore(b.name)}>Wiederherstellen</button>
            </div>
          </li>
        ))}
        {list && !list.backups.length && <li className="muted">Noch keine Sicherung vorhanden.</li>}
      </ul>
    </Sheet>
  );
}

/* ---------------- Benutzer ---------------- */
interface AppUser { id: number; username: string; created_at: string; is_me: boolean }

function UsersSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const load = () => api<AppUser[]>("/users").then(setUsers).catch((e) => toast(e.message, "err"));
  useEffect(() => {
    if (open) {
      load();
      setName("");
      setPw("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const add = async () => {
    if (name.trim().length < 2) return toast("Bitte einen Benutzernamen eingeben.", "err");
    if (pw.length < 8) return toast("Das Passwort braucht mindestens 8 Zeichen.", "err");
    try {
      await api("/users", { method: "POST", json: { username: name.trim(), password: pw } });
      toast(`Benutzer „${name.trim()}“ angelegt`);
      setName("");
      setPw("");
      load();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const remove = async (u: AppUser) => {
    if (!confirmDialog(`Benutzer „${u.username}“ löschen? Die Wartungsdaten bleiben erhalten.`)) return;
    try {
      await api(`/users/${u.id}`, { method: "DELETE" });
      toast("Benutzer gelöscht");
      load();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Benutzer" footer={<button className="btn btn-primary grow" onClick={add}><Icon name="plus" size={18} /> Benutzer anlegen</button>}>
      <p className="muted small">Alle Benutzer sehen und bearbeiten dieselben Daten. Jeder meldet sich mit eigenem Namen und Passwort an.</p>
      <ul className="backup-list">
        {users.map((u) => (
          <li key={u.id}>
            <div>
              <b>{u.username}</b>
              <span className="muted small">{u.is_me ? "Du (angemeldet)" : `seit ${u.created_at.slice(8, 10)}.${u.created_at.slice(5, 7)}.${u.created_at.slice(0, 4)}`}</span>
            </div>
            {!u.is_me && (
              <button className="icon-btn subtle" onClick={() => remove(u)} aria-label="Löschen">
                <Icon name="trash" size={18} />
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="section-label">Neuer Benutzer</div>
      <Field label="Benutzername"><input value={name} autoCapitalize="none" autoComplete="off" onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Passwort" hint="mindestens 8 Zeichen – kann der Benutzer später selbst ändern"><input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
    </Sheet>
  );
}
