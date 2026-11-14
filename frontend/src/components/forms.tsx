import { useEffect, useMemo, useState } from "react";
import { api, type Item, type ServiceEvent } from "../api";
import { todayIso, interval } from "../format";
import { useData } from "../store";
import { Field, Icon, Sheet, Toggle, confirmDialog, useToast } from "../ui";

/* ======================= Wartung eintragen / bearbeiten ======================= */
export function EventSheet({
  open, onClose, event, preselect,
}: { open: boolean; onClose: () => void; event?: ServiceEvent | null; preselect?: number[] }) {
  const { dash, reload } = useData();
  const toast = useToast();
  const items = useMemo(() => (dash?.items ?? []).filter((i) => i.kind !== "info"), [dash]);
  const inspectionIds = useMemo(() => items.filter((i) => i.part_of_inspection).map((i) => i.id), [items]);

  const [d, setD] = useState(todayIso());
  const [exact, setExact] = useState(true);
  const [kmVal, setKm] = useState("");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [workshop, setWorkshop] = useState("");
  const [cost, setCost] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (event) {
      setD(event.date);
      setExact(!!event.date_exact);
      setKm(String(event.km));
      setSel(new Set(event.items.map((i) => i.id)));
      setWorkshop(event.workshop ?? "");
      setCost(event.cost_eur != null ? String(event.cost_eur).replace(".", ",") : "");
      setNote(event.note ?? "");
    } else {
      setD(todayIso());
      setExact(true);
      setKm(dash?.odometer.km != null ? String(dash.odometer.km) : "");
      setSel(new Set(preselect ?? []));
      setWorkshop("");
      setCost("");
      setNote("");
    }
    // Nur beim Öffnen vorbelegen – eine Synchronisation im Hintergrund soll die Eingaben nicht überschreiben.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event]);

  const allInspection = inspectionIds.length > 0 && inspectionIds.every((id) => sel.has(id));
  const toggleInspection = (on: boolean) => {
    const s = new Set(sel);
    inspectionIds.forEach((id) => (on ? s.add(id) : s.delete(id)));
    setSel(s);
  };
  const toggle = (id: number) => {
    const s = new Set(sel);
    s.has(id) ? s.delete(id) : s.add(id);
    setSel(s);
  };

  const save = async () => {
    const kmNum = parseInt(kmVal.replace(/\D/g, ""), 10);
    if (!sel.size) return toast("Bitte mindestens eine Arbeit auswählen.", "err");
    if (Number.isNaN(kmNum)) return toast("Bitte den Kilometerstand eintragen.", "err");
    setBusy(true);
    try {
      const body = {
        date: d, date_exact: exact, km: kmNum, item_ids: [...sel],
        workshop: workshop.trim() || null,
        cost_eur: cost.trim() ? parseFloat(cost.replace(/\./g, "").replace(",", ".")) : null,
        note: note.trim() || null,
      };
      if (event) await api(`/events/${event.id}`, { method: "PUT", json: body });
      else await api("/events", { method: "POST", json: body });
      await reload();
      toast(event ? "Eintrag gespeichert" : "Wartung eingetragen");
      onClose();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!event || !confirmDialog("Diesen Eintrag wirklich löschen? Die Fälligkeiten werden neu berechnet.")) return;
    try {
      await api(`/events/${event.id}`, { method: "DELETE" });
      await reload();
      toast("Eintrag gelöscht");
      onClose();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={event ? "Eintrag bearbeiten" : "Wartung eintragen"}
      footer={
        <div className="btn-row">
          {event && (
            <button className="btn btn-ghost danger" onClick={remove} aria-label="Löschen">
              <Icon name="trash" size={20} />
            </button>
          )}
          <button className="btn btn-primary grow" onClick={save} disabled={busy}>
            {busy ? "Speichert …" : "Speichern"}
          </button>
        </div>
      }
    >
      <div className="grid2">
        <Field label="Datum">
          <input type="date" value={d} max={todayIso()} onChange={(e) => setD(e.target.value)} />
        </Field>
        <Field label="Kilometerstand">
          <input inputMode="numeric" value={kmVal} onChange={(e) => setKm(e.target.value)} placeholder="z. B. 105000" />
        </Field>
      </div>
      {event && !event.date_exact && (
        <Toggle checked={exact} onChange={setExact} label="Datum ist genau" hint="Aus Excel war nur das Jahr bekannt. Echtes Datum eintragen und einschalten." />
      )}

      <div className="section-label">Durchgeführte Arbeiten</div>
      <button type="button" className={`chip-toggle ${allInspection ? "on" : ""}`} onClick={() => toggleInspection(!allInspection)}>
        <Icon name="check" size={18} /> Komplette Inspektion ({inspectionIds.length} Positionen)
      </button>
      <ul className="checklist">
        {items.map((it: Item) => (
          <li key={it.id}>
            <label className={sel.has(it.id) ? "on" : ""}>
              <input type="checkbox" checked={sel.has(it.id)} onChange={() => toggle(it.id)} />
              <span className="cbox"><Icon name="check" size={16} /></span>
              <span className="cl-text">
                <span>{it.name}</span>
                <small className="muted">{interval(it)}</small>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <div className="grid2">
        <Field label="Werkstatt (optional)">
          <input value={workshop} onChange={(e) => setWorkshop(e.target.value)} placeholder="z. B. Toyota Autohaus" />
        </Field>
        <Field label="Kosten € (optional)">
          <input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0,00" />
        </Field>
      </div>
      <Field label="Notiz (optional)">
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Sheet>
  );
}

/* ======================= Kilometerstand eintragen ======================= */
export function OdometerSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { dash, reload } = useData();
  const toast = useToast();
  const [d, setD] = useState(todayIso());
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setD(todayIso());
      setV("");
    }
  }, [open]);
  const save = async () => {
    const n = parseInt(v.replace(/\D/g, ""), 10);
    if (Number.isNaN(n)) return toast("Bitte einen Kilometerstand eintragen.", "err");
    setBusy(true);
    try {
      await api("/odometer", { method: "POST", json: { date: d, km: n } });
      await reload();
      toast("Kilometerstand gespeichert");
      onClose();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Kilometerstand"
      footer={
        <button className="btn btn-primary grow" onClick={save} disabled={busy}>
          {busy ? "Speichert …" : "Speichern"}
        </button>
      }
    >
      <Field label="Aktueller Kilometerstand" hint={dash?.odometer.km != null ? `Zuletzt: ${dash.odometer.km.toLocaleString("de-DE")} km` : undefined}>
        <input className="big-input" inputMode="numeric" autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder={dash?.odometer.km?.toString() ?? "0"} />
      </Field>
      <Field label="Datum">
        <input type="date" value={d} max={todayIso()} onChange={(e) => setD(e.target.value)} />
      </Field>
    </Sheet>
  );
}
