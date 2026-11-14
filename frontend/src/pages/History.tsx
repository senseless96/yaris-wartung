import { useMemo, useState } from "react";
import type { ServiceEvent } from "../api";
import { EventSheet } from "../components/forms";
import { date, km, num } from "../format";
import { useResource } from "../store";
import { Empty, Icon, Loading, PageHeader } from "../ui";

export default function History() {
  const { data, error } = useResource<ServiceEvent[]>("/events");
  const [edit, setEdit] = useState<ServiceEvent | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const groups = useMemo(() => {
    const g = new Map<string, ServiceEvent[]>();
    (data ?? []).forEach((e) => {
      const y = e.date.slice(0, 4);
      g.set(y, [...(g.get(y) ?? []), e]);
    });
    return [...g.entries()];
  }, [data]);

  return (
    <div className="page">
      <PageHeader
        title="Historie"
        sub={data ? `${data.length} Einträge` : undefined}
        action={
          <button className="icon-btn primary" onClick={() => setNewOpen(true)} aria-label="Wartung eintragen">
            <Icon name="plus" />
          </button>
        }
      />
      {!data ? (
        error ? <Empty>{error}</Empty> : <Loading />
      ) : !data.length ? (
        <Empty>Noch keine Wartung eingetragen.</Empty>
      ) : (
        groups.map(([year, evs]) => (
          <section key={year} className="timeline">
            <h2 className="year">{year}</h2>
            {evs.map((e) => (
              <button key={e.id} className="tl-item" onClick={() => setEdit(e)}>
                <span className="tl-dot" />
                <div className="tl-card">
                  <div className="tl-top">
                    <b>{e.date_exact ? date(e.date) : `${e.date.slice(0, 4)} · Datum unbekannt`}</b>
                    <span className="muted">{km(e.km)}</span>
                  </div>
                  <div className="tags">
                    {e.items.map((i) => (
                      <span key={i.id} className="tag">{i.name}</span>
                    ))}
                  </div>
                  {(e.workshop || e.cost_eur != null || e.note) && (
                    <div className="tl-meta muted small">
                      {[e.workshop, e.cost_eur != null ? `${num(e.cost_eur)} €` : null, e.note].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </section>
        ))
      )}
      <EventSheet open={!!edit} event={edit} onClose={() => setEdit(null)} />
      <EventSheet open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}
