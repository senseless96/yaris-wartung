import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Item, Status } from "../api";
import { EventSheet, OdometerSheet } from "../components/forms";
import { ItemCard } from "../components/ItemCard";
import { ItemDetail } from "./Items";
import { date, num } from "../format";
import { useData } from "../store";
import { Icon, Loading } from "../ui";

const HERO: Record<Status, { title: string; text: string }> = {
  overdue: { title: "Wartung überfällig", text: "Mindestens eine Wartung ist fällig – bitte Termin vereinbaren." },
  soon: { title: "Bald Wartung", text: "In den nächsten Monaten steht etwas an." },
  ok: { title: "Alles in Ordnung", text: "Aktuell ist keine Wartung fällig." },
  missing: { title: "Daten ergänzen", text: "Für einige Positionen fehlt die letzte Durchführung." },
  info: { title: "Alles in Ordnung", text: "" },
};

const ORDER: Record<Status, number> = { overdue: 0, soon: 1, ok: 2, missing: 3, info: 4 };

export default function Dashboard() {
  const { dash, error } = useData();
  const [odoOpen, setOdoOpen] = useState(false);
  const [evOpen, setEvOpen] = useState(false);
  const [detail, setDetail] = useState<Item | null>(null);

  const next = useMemo(() => {
    if (!dash) return [];
    return dash.items
      .filter((i) => i.status !== "info")
      .sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.remaining_days ?? 1e9) - (b.remaining_days ?? 1e9))
      .slice(0, 5);
  }, [dash]);

  if (!dash) return error ? <div className="empty">{error}</div> : <Loading />;
  const v = dash.vehicle;
  const hero = HERO[dash.overall];
  const c = dash.counts;

  return (
    <div className="page">
      <header className="dash-head">
        <div>
          <p className="eyebrow">{v?.model_code ?? "Fahrzeug"}</p>
          <h1>{v?.name ?? "Mein Auto"}</h1>
        </div>
        {v?.license_plate && <span className="plate">{v.license_plate}</span>}
      </header>

      <button className="odo-card" onClick={() => setOdoOpen(true)}>
        <span className="muted small">Kilometerstand</span>
        <span className="odo-value">
          {dash.odometer.km != null ? num(dash.odometer.km) : "–"} <small>km</small>
        </span>
        <span className="muted small">
          Stand {date(dash.odometer.date)}
          {dash.odometer.km_per_year ? ` · ca. ${num(dash.odometer.km_per_year)} km/Jahr` : ""}
        </span>
        <span className="odo-edit"><Icon name="plus" size={18} /> Aktualisieren</span>
      </button>

      <section className={`hero hero-${dash.overall}`}>
        <div className="hero-icon">
          <Icon name={dash.overall === "ok" ? "check" : "wrench"} size={26} />
        </div>
        <div>
          <h2>{hero.title}</h2>
          <p>{hero.text}</p>
        </div>
      </section>

      <section className="stats">
        <Link to="/wartungen?f=overdue" className="stat st-overdue"><b>{c.overdue}</b><span>Überfällig</span></Link>
        <Link to="/wartungen?f=soon" className="stat st-soon"><b>{c.soon}</b><span>Bald fällig</span></Link>
        <Link to="/wartungen?f=ok" className="stat st-ok"><b>{c.ok}</b><span>Erledigt</span></Link>
        {c.missing > 0 && <Link to="/wartungen?f=missing" className="stat st-missing"><b>{c.missing}</b><span>Ohne Daten</span></Link>}
      </section>

      <button className="btn btn-primary block" onClick={() => setEvOpen(true)}>
        <Icon name="plus" size={20} /> Wartung eintragen
      </button>

      <section>
        <div className="section-head">
          <h2>Als Nächstes</h2>
          <Link to="/wartungen" className="link">Alle</Link>
        </div>
        <div className="list">
          {next.map((it) => (
            <ItemCard key={it.id} it={it} onClick={() => setDetail(it)} />
          ))}
        </div>
      </section>

      {dash.plan_step && dash.plan_next && (
        <section className="card info-card">
          <div className="info-row">
            <span className="muted">Toyota-Planstufe</span>
            <b>{dash.plan_step}</b>
          </div>
          <div className="info-row">
            <span className="muted">Plantermin</span>
            <b>{num(dash.plan_next.km)} km oder {dash.plan_next.year}</b>
          </div>
          {dash.last_service && (
            <div className="info-row">
              <span className="muted">Letzte Wartung</span>
              <b>{date(dash.last_service.date)} · {num(dash.last_service.km)} km</b>
            </div>
          )}
        </section>
      )}

      <OdometerSheet open={odoOpen} onClose={() => setOdoOpen(false)} />
      <EventSheet open={evOpen} onClose={() => setEvOpen(false)} />
      <ItemDetail item={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
