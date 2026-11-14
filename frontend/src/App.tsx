import { useEffect, useState } from "react";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { api, setUnauthorizedHandler } from "./api";
import Dashboard from "./pages/Dashboard";
import History from "./pages/History";
import Items from "./pages/Items";
import Login from "./pages/Login";
import Odometer from "./pages/Odometer";
import Settings from "./pages/Settings";
import { DataProvider, useData } from "./store";
import { Icon, Loading, ToastProvider, type IconName } from "./ui";

const TABS: { to: string; label: string; icon: IconName }[] = [
  { to: "/", label: "Übersicht", icon: "home" },
  { to: "/wartungen", label: "Wartungen", icon: "wrench" },
  { to: "/historie", label: "Historie", icon: "history" },
  { to: "/kilometer", label: "Kilometer", icon: "gauge" },
  { to: "/einstellungen", label: "Mehr", icon: "settings" },
];

function OfflineBanner() {
  const { offline, offlineSince } = useData();
  if (!offline) return null;
  return (
    <div className="offline">
      <Icon name="cloudOff" size={16} />
      Offline{offlineSince ? ` – Stand vom ${offlineSince.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}` : ""}
    </div>
  );
}

function Shell({ onLogout }: { onLogout: () => void }) {
  return (
    <DataProvider>
      <OfflineBanner />
      <main className="content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/wartungen" element={<Items />} />
          <Route path="/historie" element={<History />} />
          <Route path="/kilometer" element={<Odometer />} />
          <Route path="/einstellungen" element={<Settings onLogout={onLogout} />} />
          <Route path="*" element={<Dashboard />} />
        </Routes>
      </main>
      <nav className="tabbar">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.to === "/"} className={({ isActive }) => (isActive ? "tab on" : "tab")}>
            <Icon name={t.icon} />
            <span>{t.label}</span>
          </NavLink>
        ))}
      </nav>
    </DataProvider>
  );
}

export default function App() {
  const [auth, setAuth] = useState<"unknown" | "in" | "out">("unknown");

  useEffect(() => {
    setUnauthorizedHandler(() => setAuth("out"));
    api("/auth/me")
      .then(() => setAuth("in"))
      .catch((e) => setAuth(e.status === 0 ? "in" : "out")); // offline: zwischengespeicherte Daten zeigen
  }, []);

  return (
    <ToastProvider>
      <BrowserRouter>
        {auth === "unknown" ? <Loading /> : auth === "in" ? <Shell onLogout={() => setAuth("out")} /> : <Login onLogin={() => setAuth("in")} />}
      </BrowserRouter>
    </ToastProvider>
  );
}
