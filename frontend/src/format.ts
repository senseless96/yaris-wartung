import type { Item, Status } from "./api";

const nf = new Intl.NumberFormat("de-DE");
export const km = (v: number | null | undefined) => (v == null ? "–" : `${nf.format(v)} km`);
export const num = (v: number) => nf.format(v);

export function date(iso: string | null | undefined, exact: boolean | number | null = true): string {
  if (!iso) return "–";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!exact) return y;
  return `${d}.${m}.${y}`;
}

export function monthYear(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("de-DE", { month: "short", year: "numeric" });
}

export function interval(it: Pick<Item, "interval_km" | "interval_months">): string {
  const parts: string[] = [];
  if (it.interval_km) parts.push(km(it.interval_km));
  if (it.interval_months) parts.push(months(it.interval_months));
  return parts.length ? parts.join(" / ") : "kein festes Intervall";
}

export function months(m: number): string {
  if (m % 12 === 0) return m === 12 ? "1 Jahr" : `${m / 12} Jahre`;
  return m === 1 ? "1 Monat" : `${m} Monate`;
}

export function relDays(days: number): string {
  const a = Math.abs(days);
  if (a < 45) return `${a} ${a === 1 ? "Tag" : "Tagen"}`;
  const m = Math.round(a / 30.44);
  if (m < 18) return `${m} ${m === 1 ? "Monat" : "Monaten"}`;
  const y = Math.round((a / 365.25) * 10) / 10;
  return `${String(y).replace(".", ",")} Jahren`;
}

export const STATUS_LABEL: Record<Status, string> = {
  overdue: "Überfällig",
  soon: "Bald fällig",
  ok: "In Ordnung",
  missing: "Ohne Daten",
  info: "Info",
};

/** Kurzer Text, wann eine Position fällig ist bzw. wie lange sie schon überfällig ist. */
export function dueLine(it: Item): string {
  if (it.status === "info") return it.kind === "inspection_check" ? "Wird bei jeder Inspektion geprüft" : it.note ?? "Keine feste Vorgabe";
  if (it.status === "missing") return "Noch keine Durchführung eingetragen";
  const parts: string[] = [];
  if (it.due_km != null) parts.push(km(it.due_km));
  if (it.due_date) parts.push(monthYear(it.due_date));
  const when = parts.join(" oder ");
  if (it.status === "overdue") {
    const over: string[] = [];
    if (it.remaining_km != null && it.remaining_km <= 0) over.push(`${num(-it.remaining_km)} km`);
    if (it.due_date && it.remaining_days != null && it.remaining_days <= 0) over.push(relDays(it.remaining_days));
    return over.length ? `Überfällig seit ${over.join(" bzw. ")}` : `Fällig bei ${when}`;
  }
  return `Fällig bei ${when}`;
}

export function remainingLine(it: Item): string | null {
  if (it.status !== "ok" && it.status !== "soon") return null;
  const parts: string[] = [];
  if (it.remaining_km != null) parts.push(`noch ${num(it.remaining_km)} km`);
  if (it.remaining_days != null) parts.push(`ca. ${relDays(it.remaining_days)}`);
  return parts.join(" · ");
}

/** Anteil des verbrauchten Intervalls (0..1) für den Fortschrittsbalken. */
export function progress(it: Item, currentKm: number | null, todayIso: string): number | null {
  if (it.status === "info" || it.status === "missing") return null;
  if (it.status === "overdue") return 1;
  const fr: number[] = [];
  const baseKm = it.base_is_registration ? 0 : it.last_km;
  if (it.due_km != null && baseKm != null && currentKm != null && it.due_km > baseKm) {
    fr.push((currentKm - baseKm) / (it.due_km - baseKm));
  }
  if (it.due_date && it.remaining_days != null) {
    const total = (it.base_is_registration ? it.first_interval_months : it.interval_months) ?? 0;
    if (total > 0) fr.push(1 - Math.max(0, (new Date(it.due_date).getTime() - new Date(todayIso).getTime()) / 86400000) / (total * 30.44));
  }
  return fr.length ? Math.min(1, Math.max(0, Math.max(...fr))) : null;
}

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
