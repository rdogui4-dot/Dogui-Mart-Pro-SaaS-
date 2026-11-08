import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { can, useSession } from "@/lib/session";

export function SettingsPage() {
  const { session, logout } = useSession(); const s = session!;
  const [f, setF] = useState({ waveTemplate: "", orangeTemplate: "", expiryMinutes: "15" });
  const [msg, setMsg] = useState("");
  useEffect(() => { void api<{ expiryMinutes: number }>(s, "payments.settings.get").then((r) => setF((x) => ({ ...x, expiryMinutes: String(r.expiryMinutes) }))).catch(() => {}); }, [s]);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    try { await api(s, "payments.settings.save", { ...(f.waveTemplate && { waveTemplate: f.waveTemplate }), ...(f.orangeTemplate && { orangeTemplate: f.orangeTemplate }), expiryMinutes: Number(f.expiryMinutes) }); setMsg("Enregistré"); setF((x) => ({ ...x, waveTemplate: "", orangeTemplate: "" })); }
    catch (x) { setMsg((x as Error).message); }
  }
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-bold">Réglages</h1>
      <div className="card text-sm">Connecté : <b>{s.name}</b> · rôle {s.role}<br />Boutique : {s.shopId}</div>
      {can(s.role, "settings") && (
        <form className="card flex flex-col gap-2" onSubmit={save}>
          <h2 className="font-semibold">Paiement par QR code</h2>
          <p className="text-xs text-white/50">Collez le modèle de lien de votre compte Wave Business / Orange Business. Variables : <code>{"{amount}"}</code> (obligatoire) et <code>{"{ref}"}</code>. Les modèles déjà enregistrés ne sont jamais réaffichés ; un champ laissé vide reste inchangé.</p>
          <input className="input" placeholder="Modèle de lien Wave Business (https://…{amount}…)" value={f.waveTemplate} onChange={(e) => setF({ ...f, waveTemplate: e.target.value })} />
          <input className="input" placeholder="Modèle de lien Orange Business (https://…{amount}…)" value={f.orangeTemplate} onChange={(e) => setF({ ...f, orangeTemplate: e.target.value })} />
          <input className="input" inputMode="numeric" placeholder="Validité du lien (minutes)" value={f.expiryMinutes} onChange={(e) => setF({ ...f, expiryMinutes: e.target.value })} />
          <button className="btn">Enregistrer</button>
          {msg && <p className="text-sm text-amber-300">{msg}</p>}
        </form>
      )}
      <button className="btn-ghost" onClick={() => void logout()}>Se déconnecter</button>
    </div>
  );
}
