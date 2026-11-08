import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { account, ID, teams } from "@/lib/appwrite";
import { useSession } from "@/lib/session";

export function AuthPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [f, setF] = useState({ name: "", shop: "", email: "", password: "" });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const { refresh } = useSession(); const nav = useNavigate();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      if (mode === "signup") {
        await account.create({ userId: ID.unique(), email: f.email, password: f.password, name: f.name });
        await account.createEmailPasswordSession({ email: f.email, password: f.password });
        // Un commerçant = une Team (tenant) ; le créateur en est "owner".
        await teams.create({ teamId: ID.unique(), name: f.shop || f.name, roles: ["owner"] });
      } else await account.createEmailPasswordSession({ email: f.email, password: f.password });
      await refresh(); void nav({ to: "/pos" });
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="min-h-full flex flex-col justify-center gap-3 p-6 max-w-sm mx-auto">
      <h1 className="text-3xl font-bold text-[var(--gold)]">Dogui Mart Pro</h1>
      <p className="text-white/60 mb-2">Gestion de commerce, partout, même hors ligne.</p>
      {mode === "signup" && <>
        <input className="input" placeholder="Votre nom" value={f.name} onChange={set("name")} required />
        <input className="input" placeholder="Nom de la boutique" value={f.shop} onChange={set("shop")} required />
      </>}
      <input className="input" type="email" placeholder="E-mail" value={f.email} onChange={set("email")} required />
      <input className="input" type="password" placeholder="Mot de passe (8+)" minLength={8} value={f.password} onChange={set("password")} required />
      {err && <p className="text-red-400 text-sm">{err}</p>}
      <button className="btn" disabled={busy}>{mode === "login" ? "Se connecter" : "Créer mon commerce"}</button>
      <button type="button" className="btn-ghost" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
        {mode === "login" ? "Nouveau commerçant ?" : "J'ai déjà un compte"}
      </button>
    </form>
  );
}
