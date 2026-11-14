import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type Item, type ServiceEvent, type Status } from "../api";
import { EventSheet } from "../components/forms";
import { ItemCard } from "../components/ItemCard";
import { date, dueLine, interval, km, months, monthYear } from "../format";
import { useData, useResource } from "../store";
import { Field, Icon, Loading, PageHeader, Sheet, StatusPill, Toggle, confirmDialog, useToast } from "../ui";

const FILTERS: { key: "all" | Status; label: string }[] = [
  { key: "all", label: "Alle" },
  { key: "overdue", label: "Überfällig" },
  { key: "soon", label: "Bald" },
  { key: "ok", label: "OK" },
  { key: "missing", label: "Ohne Daten" },
];

export default function Items() {
  const { dash } = useData();
  const [params, setParams] = useSearchParams();
  const f = (params.get("f") ?? "all") as "all" | Status;
  const [detailId, setDetailId] = useState<number | null>(null);

  const list = useMemo(() => {
    const items = dash?.items ?? [];
    return f === "all" ? items : items.filter((i) => i.status === f);
  }, [dash, f]);
  const detail = dash?.items.find((i) => i.id === detailId) ?? null;

  if (!dash) return <Loading />;
  return (
    <div className="page">
      <PageHeader title="Wartungen" sub={`${dash.items.length} Positionen · Vorwarnung ${months(dash.soon_months)} vorher`} />
      <div className="chips" role="tablist">
        {FILTERS.map((x) => (
          <button key={x.key} role="tab" aria-selected={f === x.key} className={`chip ${f === x.key ? "on" : ""}`} onClick={() => setParams(x.key === "all" ? {} : { f: x.key })}>
            {x.label}
            {x.key !== "all" && <span className="chip-n">{dash.counts[x.key]}</span>}
          </button>
        ))}
      </div>
      <div className="list">
        {list.length ? list.map((it) => <ItemCard key={it.id} it={it} onClick={() => setDetailId(it.id)} />) : <div className="empty">Keine Positionen in diesem Filter.</div>}
      </div>
      <ItemDetail item={detail} onClose={() => setDetailId(null)} />
    </div>
  );
}

/* ---------------- Detailansicht einer Position ---------------- */
export function ItemDetail({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const { dash } = useData();
  const live = item ? dash?.items.find((i) => i.id === item.id) ?? item : null;
  const { data: events } = useResource<ServiceEvent[]>("/events");
  const [doneOpen, setDoneOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const pre = useMemo(() => (live ? [live.id] : []), [live?.id]);
  const hist = useMemo(() => (events ?? []).filter((e) => live && e.items.some((i) => i.id === live.id)), [events, live]);

  if (!live) return null;
  const isInfo = live.status === "info";
  return (
    <>
      <Sheet
        open={!!item && !doneOpen && !editOpen}
        onClose={onClose}
        title={live.name}
        footer={
          <div className="btn-row">
            <button className="btn btn-ghost" onClick={() => setEditOpen(true)}>
              <Icon name="edit" size={18} /> Bearbeiten
            </button>
            {live.kind !== "info" && (
              <button className="btn btn-primary grow" onClick={() => setDoneOpen(true)}>
                <Icon name="check" size={18} /> Erledigt
              </button>
            )}
          </div>
        }
      >
        <div className="detail-status">
          <StatusPill s={live.status} />
          <span className="muted">{dueLine(live)}</span>
        </div>
        <dl className="kv">
          <dt>Intervall</dt>
          <dd>{interval(live)}</dd>
          {(live.first_interval_km || live.first_interval_months) && (
            <>
              <dt>Erstes Intervall</dt>
              <dd>{interval({ interval_km: live.first_interval_km, interval_months: live.first_interval_months })}</dd>
            </>
          )}
          {!isInfo && (
            <>
              <dt>Zuletzt</dt>
              <dd>
                {live.last_date ? `${date(live.last_date, live.last_date_exact)} · ${km(live.last_km)}` : live.base_is_registration ? "noch nie" : "nicht eingetragen"}
              </dd>
              <dt>Nächste Fälligkeit</dt>
              <dd>
                {live.due_km != null && <div>{km(live.due_km)}</div>}
                {live.due_date && <div>{live.due_km != null ? "oder " : ""}{date(live.due_date)}</div>}
                {live.due_km == null && !live.due_date && "–"}
              </dd>
              {live.projected_km_date && (
                <>
                  <dt>km-Grenze erreicht ca.</dt>
                  <dd>{monthYear(live.projected_km_date)}</dd>
                </>
              )}
            </>
          )}
          {live.plan_due_this_step != null && dash?.plan_step && (
            <>
              <dt>Toyota-Plan (Stufe {dash.plan_step})</dt>
              <dd>{live.plan_mode === "every_inspection" ? "Jede Inspektion" : live.plan_due_this_step ? "Planmäßiger Termin" : "Nicht in dieser Stufe"}</dd>
            </>
          )}
        </dl>
        {live.note && <p className="note">{live.note}</p>}

        {!isInfo && (
          <>
            <div className="section-label">Verlauf</div>
            {hist.length ? (
              <ul className="mini-hist">
                {hist.map((e) => (
                  <li key={e.id}>
                    <span>{date(e.date, e.date_exact)}</span>
                    <span className="muted">{km(e.km)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">Noch keine Einträge.</p>
            )}
          </>
        )}
      </Sheet>
      <EventSheet open={doneOpen} onClose={() => setDoneOpen(false)} preselect={pre} />
      <ItemEditSheet open={editOpen} item={live} onClose={() => setEditOpen(false)} />
    </>
  );
}

/* ---------------- Position bearbeiten / anlegen ---------------- */
const toStr = (n: number | null | undefined) => (n == null ? "" : String(n));
const toNum = (s: string) => {
  const n = parseInt(s.replace(/\D/g, ""), 10);
  return Number.isNaN(n) || n <= 0 ? null : n;
};

export function ItemEditSheet({ open, item, onClose }: { open: boolean; item: Item | null; onClose: () => void }) {
  const { reload } = useData();
  const toast = useToast();
  const [f, setF] = useState({
    name: "", kind: "replace" as Item["kind"], interval_km: "", interval_months: "", first_interval_km: "",
    first_interval_months: "", soon_months: "", part_of_inspection: false, note: "", active: true,
  });
  useEffect(() => {
    if (!open) return;
    setF({
      name: item?.name ?? "",
      kind: item?.kind ?? "replace",
      interval_km: toStr(item?.interval_km),
      interval_months: toStr(item?.interval_months),
      first_interval_km: toStr(item?.first_interval_km),
      first_interval_months: toStr(item?.first_interval_months),
      soon_months: item?.soon_months == null ? "" : String(item.soon_months),
      part_of_inspection: item?.part_of_inspection ?? false,
      note: item?.note ?? "",
      active: item?.active ?? true,
    });
  }, [open, item]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    if (!f.name.trim()) return toast("Bitte eine Bezeichnung eingeben.", "err");
    const body = {
      name: f.name.trim(),
      kind: f.kind,
      interval_km: toNum(f.interval_km),
      interval_months: toNum(f.interval_months),
      first_interval_km: toNum(f.first_interval_km),
      first_interval_months: toNum(f.first_interval_months),
      plan_mode: item?.plan_mode ?? (f.part_of_inspection ? "every_inspection" : null),
      soon_months: f.soon_months.trim() === "" ? null : parseInt(f.soon_months, 10),
      part_of_inspection: f.part_of_inspection,
      note: f.note.trim() || null,
      active: f.active,
      sort_order: item?.sort_order,
    };
    try {
      if (item) await api(`/items/${item.id}`, { method: "PUT", json: body });
      else await api("/items", { method: "POST", json: body });
      await reload();
      toast("Gespeichert");
      onClose();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const remove = async () => {
    if (!item || !confirmDialog(`„${item.name}“ löschen?`)) return;
    try {
      await api(`/items/${item.id}`, { method: "DELETE" });
      await reload();
      toast("Gelöscht");
      onClose();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={item ? "Position bearbeiten" : "Neue Position"}
      footer={
        <div className="btn-row">
          {item && (
            <button className="btn btn-ghost danger" onClick={remove} aria-label="Löschen">
              <Icon name="trash" size={20} />
            </button>
          )}
          <button className="btn btn-primary grow" onClick={save}>Speichern</button>
        </div>
      }
    >
      <Field label="Bezeichnung">
        <input value={f.name} onChange={set("name")} />
      </Field>
      <Field label="Art">
        <select value={f.kind} onChange={set("kind")}>
          <option value="replace">Wechsel / Austausch</option>
          <option value="check">Prüfung mit Intervall</option>
          <option value="inspection_check">Prüfpunkt der Inspektion</option>
          <option value="info">Nur Hinweis (ohne Fälligkeit)</option>
        </select>
      </Field>
      {(f.kind === "replace" || f.kind === "check") && (
        <>
          <div className="grid2">
            <Field label="Intervall km">
              <input inputMode="numeric" value={f.interval_km} onChange={set("interval_km")} placeholder="leer = keins" />
            </Field>
            <Field label="Intervall Monate">
              <input inputMode="numeric" value={f.interval_months} onChange={set("interval_months")} placeholder="12 = 1 Jahr" />
            </Field>
          </div>
          <div className="grid2">
            <Field label="Erstes Intervall km" hint="optional, ab Erstzulassung">
              <input inputMode="numeric" value={f.first_interval_km} onChange={set("first_interval_km")} />
            </Field>
            <Field label="Erstes Intervall Monate">
              <input inputMode="numeric" value={f.first_interval_months} onChange={set("first_interval_months")} />
            </Field>
          </div>
          <Field label="Vorwarnung (Monate)" hint="leer = globale Einstellung">
            <input inputMode="numeric" value={f.soon_months} onChange={set("soon_months")} />
          </Field>
        </>
      )}
      <Toggle checked={f.part_of_inspection} onChange={(v) => setF({ ...f, part_of_inspection: v })} label="Teil der Inspektion" hint="Wird mit „Komplette Inspektion“ gemeinsam abgehakt" />
      <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Aktiv" hint="Inaktive Positionen werden ausgeblendet" />
      <Field label="Hinweis">
        <textarea rows={2} value={f.note} onChange={set("note")} />
      </Field>
    </Sheet>
  );
}
