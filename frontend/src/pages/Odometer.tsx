import { useState } from "react";
import { api, type OdometerReading } from "../api";
import { OdometerSheet } from "../components/forms";
import { date, num } from "../format";
import { useData, useResource } from "../store";
import { Empty, Icon, Loading, PageHeader, confirmDialog, useToast } from "../ui";

const SRC: Record<OdometerReading["source"], string> = { manual: "Eingabe", service: "Wartung", import: "Excel-Import" };

export default function Odometer() {
  const { dash, reload } = useData();
  const { data, error } = useResource<OdometerReading[]>("/odometer");
  const [open, setOpen] = useState(false);
  const toast = useToast();

  const del = async (r: OdometerReading) => {
    if (!confirmDialog(`Kilometerstand ${num(r.km)} km vom ${date(r.date)} löschen?`)) return;
    try {
      await api(`/odometer/${r.id}`, { method: "DELETE" });
      await reload();
      toast("Gelöscht");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  return (
    <div className="page">
      <PageHeader title="Kilometer" sub={dash?.odometer.km_per_year ? `Ø ca. ${num(dash.odometer.km_per_year)} km pro Jahr` : undefined} />
      <button className="odo-card" onClick={() => setOpen(true)}>
        <span className="muted small">Aktueller Stand</span>
        <span className="odo-value">{dash?.odometer.km != null ? num(dash.odometer.km) : "–"} <small>km</small></span>
        <span className="odo-edit"><Icon name="plus" size={18} /> Neuen Stand eintragen</span>
      </button>

      {!data ? (
        error ? <Empty>{error}</Empty> : <Loading />
      ) : (
        <ul className="odo-list card">
          {data.map((r, idx) => {
            const prev = data[idx + 1];
            const diff = prev ? r.km - prev.km : null;
            return (
              <li key={r.id}>
                <div>
                  <b>{num(r.km)} km</b>
                  <span className="muted small">
                    {date(r.date)} · {SRC[r.source]}
                  </span>
                </div>
                <div className="odo-right">
                  {diff != null && diff > 0 && <span className="delta">+{num(diff)}</span>}
                  {data.length > 1 && (
                    <button className="icon-btn subtle" onClick={() => del(r)} aria-label="Löschen">
                      <Icon name="trash" size={18} />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <OdometerSheet open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
