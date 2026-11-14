import { useState, type FormEvent } from "react";
import { api } from "../api";

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/auth/login", { method: "POST", json: { username: u, password: p } });
      onLogin();
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <img src="/icon.svg" alt="" width={72} height={72} />
        <h1>Yaris Wartung</h1>
        <p className="muted">Bitte anmelden</p>
        <input autoComplete="username" placeholder="Benutzername" value={u} onChange={(e) => setU(e.target.value)} autoCapitalize="none" />
        <input type="password" autoComplete="current-password" placeholder="Passwort" value={p} onChange={(e) => setP(e.target.value)} />
        {err && <div className="form-err">{err}</div>}
        <button className="btn btn-primary block" disabled={busy || !u || !p}>
          {busy ? "Anmelden …" : "Anmelden"}
        </button>
      </form>
    </div>
  );
}
