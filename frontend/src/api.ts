export type Status = "overdue" | "soon" | "ok" | "missing" | "info";

export interface Item {
  id: number;
  name: string;
  kind: "replace" | "check" | "inspection_check" | "info";
  status: Status;
  interval_km: number | null;
  interval_months: number | null;
  first_interval_km: number | null;
  first_interval_months: number | null;
  soon_months: number | null;
  plan_mode: "every_inspection" | "plan_step" | null;
  part_of_inspection: boolean;
  note: string | null;
  active: boolean;
  sort_order: number;
  last_date: string | null;
  last_date_exact: boolean | null;
  last_km: number | null;
  last_event_id: number | null;
  base_is_registration: boolean;
  due_km: number | null;
  due_date: string | null;
  projected_km_date: string | null;
  remaining_km: number | null;
  remaining_days: number | null;
  plan_due_this_step: boolean | null;
}

export interface Vehicle {
  name: string;
  model_code: string | null;
  engine: string | null;
  transmission: string | null;
  first_registration: string;
  first_registration_exact: number | boolean;
  vin: string | null;
  license_plate: string | null;
  notes: string | null;
}

export interface Dashboard {
  today: string;
  odometer: { km: number | null; date: string | null; km_per_year: number | null };
  plan_step: number | null;
  plan_next: { km: number; year: number } | null;
  soon_months: number;
  counts: Record<Status, number>;
  overall: Status;
  items: Item[];
  vehicle: Vehicle | null;
  version: number;
  last_service: { date: string; km: number } | null;
  records_this_year: number;
}

export interface ServiceEvent {
  id: number;
  date: string;
  date_exact: number;
  km: number;
  workshop: string | null;
  cost_eur: number | null;
  note: string | null;
  items: { id: number; name: string }[];
}

export interface OdometerReading {
  id: number;
  date: string;
  km: number;
  source: "manual" | "service" | "import";
  note: string | null;
  event_id: number | null;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Zeitpunkt der zuletzt vom Server gelieferten Daten (für die Offline-Anzeige). */
export const freshness = { lastServerDate: null as Date | null, fromCache: false };
type Listener = () => void;
const listeners = new Set<Listener>();
export const onFreshness = (l: Listener) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
let unauthorizedHandler: () => void = () => {};
export const setUnauthorizedHandler = (h: () => void) => (unauthorizedHandler = h);

export async function api<T = unknown>(path: string, opts: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...init } = opts;
  const headers = new Headers(init.headers);
  if (json !== undefined) headers.set("Content-Type", "application/json");
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      credentials: "same-origin",
      ...init,
      headers,
      body: json !== undefined ? JSON.stringify(json) : init.body,
    });
  } catch {
    throw new ApiError(0, "Keine Verbindung zum Server.");
  }

  if ((init.method ?? "GET") === "GET" && res.ok) {
    const d = res.headers.get("date");
    const served = d ? new Date(d) : new Date();
    // Eine Antwort aus dem Offline-Cache trägt das alte Server-Datum.
    const stale = Date.now() - served.getTime() > 90_000;
    const changed = freshness.fromCache !== stale;
    freshness.fromCache = stale;
    freshness.lastServerDate = served;
    if (changed) listeners.forEach((l) => l());
  }

  if (res.status === 401 && !path.startsWith("/auth/login")) {
    unauthorizedHandler();
  }
  if (!res.ok) {
    let msg = `Fehler ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") msg = body.detail;
      else if (Array.isArray(body.detail)) msg = "Bitte Eingaben prüfen.";
    } catch {
      /* ignore */
    }
    if (!navigator.onLine && (init.method ?? "GET") !== "GET") msg = "Offline – Änderungen sind erst mit Verbindung möglich.";
    throw new ApiError(res.status, msg);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
