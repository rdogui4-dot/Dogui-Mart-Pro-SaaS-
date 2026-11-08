import { useState } from "react";
import { account, ID, teams } from "@/lib/appwrite";
import { useSession } from "@/lib/session";
import { api } from "@/lib/api";
import { Logo } from "@/components/Logo";
import { ScanLine, Boxes, WifiOff } from "lucide-react";

export function AuthPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [f, setF] = useState({ name: "", shop: "", email: "", password: "" });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const { refresh } = useSession();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    // Les employés se connectent avec un identifiant (sans @) : il correspond à une adresse technique @staff.invalid.
    const login = f.email.includes("@") ? f.email.trim() : `${f.email.trim().toLowerCase()}@staff.invalid`;
    try {
      if (mode === "signup") {
        await account.create({ userId: ID.unique(), email: login, password: f.password, name: f.name });
        await account.createEmailPasswordSession({ email: login, password: f.password });
        // Un commerçant = une Team (tenant) ; le créateur en est "owner".
        const team = await teams.create({ teamId: ID.unique(), name: f.shop || f.name, roles: ["owner"] });
        // Si le serveur est momentanément indisponible, l'inscription aboutit quand même : la première boutique sera recréée à la connexion.
        await api({ userId: "", name: f.name, tenantId: team.$id, shopId: "", role: "owner", shops: [], modules: [] }, "tenant.init", { name: f.shop || f.name }).catch(() => undefined);
      } else await account.createEmailPasswordSession({ email: login, password: f.password });
      // Pas de redirection forcée : la page demandée (par exemple le retour de Selar) s'affiche dès que la session est chargée.
      await refresh();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="min-h-full flex flex-col justify-center gap-6 p-6 max-w-sm mx-auto" style={{ background: "radial-gradient(120% 60% at 50% 0%, rgba(212,175,55,.14), transparent 60%)" }}>
      <div className="flex flex-col items-center gap-3 text-center pt-4">
        <Logo size={64} />
        <p className="text-white/60 text-sm">Caisse, stock, achats, clients et compta dans votre poche.</p>
        <ul className="flex gap-4 text-xs text-white/50">
          <li className="flex items-center gap-1"><ScanLine size={14} className="text-[var(--gold)]" />Caisse</li>
          <li className="flex items-center gap-1"><Boxes size={14} className="text-[var(--gold)]" />Multi-boutiques</li>
          <li className="flex items-center gap-1"><WifiOff size={14} className="text-[var(--gold)]" />Hors ligne</li>
        </ul>
      </div>
      <form onSubmit={submit} className="card flex flex-col gap-3">
        <h1 className="text-lg font-bold">{mode === "login" ? "Connexion" : "Créer mon commerce"}</h1>
        {mode === "signup" && <>
          <input className="input" placeholder="Votre nom" value={f.name} onChange={set("name")} required />
          <input className="input" placeholder="Nom de la boutique" value={f.shop} onChange={set("shop")} required />
        </>}
        <input className="input" type={mode === "signup" ? "email" : "text"} autoCapitalize="none" placeholder={mode === "signup" ? "E-mail" : "E-mail ou identifiant"} value={f.email} onChange={set("email")} required />
        <input className="input" type="password" placeholder="Mot de passe (8+)" minLength={8} value={f.password} onChange={set("password")} required />
        {err && <p className="text-red-400 text-sm">{err}</p>}
        <button className="btn" disabled={busy}>{mode === "login" ? "Se connecter" : "Créer mon commerce"}</button>
        <button type="button" className="btn-ghost" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
          {mode === "login" ? "Nouveau commerçant ?" : "J'ai déjà un compte"}
        </button>
      </form>
    </div>
  );
}
