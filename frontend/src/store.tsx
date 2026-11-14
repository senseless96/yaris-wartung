import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, freshness, onFreshness, type Dashboard } from "./api";

interface Ctx {
  dash: Dashboard | null;
  error: string | null;
  /** erhöht sich bei jeder Datenänderung (eigene oder vom anderen Handy) */
  tick: number;
  reload: () => Promise<void>;
  offline: boolean;
  offlineSince: Date | null;
}

const DataCtx = createContext<Ctx>(null!);
export const useData = () => useContext(DataCtx);

const POLL_MS = 15_000;

export function DataProvider({ children }: { children: ReactNode }) {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [offline, setOffline] = useState(false);
  const [offlineSince, setOfflineSince] = useState<Date | null>(null);
  const version = useRef<number | null>(null);

  const reload = useCallback(async () => {
    try {
      const d = await api<Dashboard>("/dashboard");
      version.current = d.version;
      setDash(d);
      setError(null);
      setTick((t) => t + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // Synchronisation: regelmäßig den Änderungszähler abfragen (nur wenn die App sichtbar ist)
  useEffect(() => {
    reload();
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const { version: v } = await api<{ version: number }>("/version");
        if (version.current !== null && v !== version.current) await reload();
      } catch {
        /* offline – wird über freshness angezeigt */
      }
    };
    const id = window.setInterval(check, POLL_MS);
    const onVis = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", check);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", check);
    };
  }, [reload]);

  useEffect(() => {
    const upd = () => {
      setOffline(freshness.fromCache || !navigator.onLine);
      setOfflineSince(freshness.fromCache ? freshness.lastServerDate : null);
    };
    const off = onFreshness(upd);
    window.addEventListener("online", upd);
    window.addEventListener("offline", upd);
    return () => {
      off();
      window.removeEventListener("online", upd);
      window.removeEventListener("offline", upd);
    };
  }, []);

  return <DataCtx.Provider value={{ dash, error, tick, reload, offline, offlineSince }}>{children}</DataCtx.Provider>;
}

/** Lädt eine Liste und lädt sie automatisch neu, wenn sich Daten geändert haben. */
export function useResource<T>(path: string) {
  const { tick } = useData();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [path]);
  useEffect(() => {
    load();
  }, [load, tick]);
  return { data, error, reload: load };
}
