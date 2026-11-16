import { useState } from "react";
import { account, ID, teams } from "@/lib/appwrite";
import { useSession } from "@/lib/session";
import { api } from "@/lib/api";
import { authMessage } from "@/lib/auth-errors";
import { Logo } from "@/components/Logo";
import { ScanLine, Boxes, WifiOff, Eye, EyeOff } from "lucide-react";
import { hasRealEmail, sendVerification, takeVerifyResult } from "@/lib/verify";

export function AuthPage() {
  // Retour du lien reçu par e-mail : Appwrite ajoute userId et secret à l'adresse de l'application.
  const recoveryParams = (() => { const q = new URLSearchParams(window.location.search); return q.get("userId") && q.get("secret") && q.get("verify") !== "1" ? { userId: q.get("userId")!, secret: q.get("secret")! } : null; })();
  const [mode, setMode] = useState<"login" | "signup" | "forgot" | "reset">(recoveryParams ? "reset" : "login"); const [info, setInfo] = useState(takeVerifyResult() === "ok" ? "Adresse e-mail confirmée. Connectez-vous pour continuer." : ""); const [show, setShow] = useState(false);
  const [f, setF] = useState({ name: "", shop: "", email: "", password: "" });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const { refresh } = useSession();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(""); setInfo("");
    if (mode === "forgot") {
      try {
        if (!f.email.includes("@")) setInfo("Un identifiant d'employé n'a pas d'e-mail : demandez à votre gérant de réinitialiser votre mot de passe (Réglages → Équipe & accès).");
        else { await account.createRecovery({ email: f.email.trim(), url: `${window.location.origin}${import.meta.env.BASE_URL}` }); setInfo("Si un compte existe pour cette adresse, un e-mail de réinitialisation vient d'être envoyé (valable 1 heure)."); }
      } catch (x) { setErr(authMessage(x)); } finally { setBusy(false); }
      return;
    }
    if (mode === "reset" && recoveryParams) {
      try {
        await account.updateRecovery({ ...recoveryParams, password: f.password });
        window.history.replaceState(null, "", `${window.location.pathname}`); setMode("login"); setF({ ...f, password: "" }); setInfo("Mot de passe modifié : connectez-vous avec le nouveau.");
      } catch (x) { setErr(authMessage(x)); } finally { setBusy(false); }
      return;
    }
    // Les employés se connectent avec un identifiant (sans @) : il correspond à une adresse technique @staff.invalid.
    const login = f.email.includes("@") ? f.email.trim() : `${f.email.trim().toLowerCase()}@staff.invalid`;
    try {
      if (mode === "signup") {
        await account.create({ userId: ID.unique(), email: login, password: f.password, name: f.name });
        await account.createEmailPasswordSession({ email: login, password: f.password });
        if (hasRealEmail(login)) void sendVerification().catch(() => undefined); // non bloquant : un rappel s'affiche dans l'application tant que l'adresse n'est pas confirmée
        // Un commerçant = une Team (tenant) ; le créateur en est "owner".
        const team = await teams.create({ teamId: ID.unique(), name: f.shop || f.name, roles: ["owner"] });
        // Si le serveur est momentanément indisponible, l'inscription aboutit quand même : la première boutique sera recréée à la connexion.
        await api({ userId: "", name: f.name, tenantId: team.$id, shopId: "", role: "owner", shops: [], modules: [] }, "tenant.init", { name: f.shop || f.name }).catch(() => undefined);
      } else await account.createEmailPasswordSession({ email: login, password: f.password });
      // Pas de redirection forcée : la page demandée (par exemple le retour de Selar) s'affiche dès que la session est chargée.
      await refresh();
    } catch (x) { setErr(authMessage(x)); } finally { setBusy(false); }
  }
  return (
    <div className="min-h-full flex flex-col justify-center gap-6 p-6 max-w-sm mx-auto">
      <div className="flex flex-col items-center gap-3 text-center pt-4">
        <Logo size={64} />
        <p className="text-muted text-sm">Caisse, stock, achats, clients et compta dans votre poche.</p>
        <a className="text-sm text-accent-text underline" href={`${import.meta.env.BASE_URL}presentation/`}>Découvrir Dogui Mart Pro</a>
        <ul className="flex gap-4 text-xs text-muted">
          <li className="flex items-center gap-1"><ScanLine size={14} className="text-accent-text" />Caisse</li>
          <li className="flex items-center gap-1"><Boxes size={14} className="text-accent-text" />Multi-boutiques</li>
          <li className="flex items-center gap-1"><WifiOff size={14} className="text-accent-text" />Hors ligne</li>
        </ul>
      </div>
      <form onSubmit={submit} className="card flex flex-col gap-3">
        <h1 className="text-lg font-bold">{mode === "login" ? "Connexion" : mode === "signup" ? "Créer mon commerce" : mode === "forgot" ? "Mot de passe oublié" : "Nouveau mot de passe"}</h1>
        {mode === "signup" && <>
          <label className="flex flex-col gap-1 text-sm"><span className="text-soft">Nom de votre boutique</span><input autoComplete="organization" className="input" placeholder="Ex. : Boutique Awa" value={f.shop} onChange={set("shop")} required /></label>
          <label className="flex flex-col gap-1 text-sm"><span className="text-soft">Votre nom</span><input autoComplete="name" className="input" placeholder="Ex. : Awa Traoré" value={f.name} onChange={set("name")} required /></label>
        </>}
        {mode !== "reset" && <label className="flex flex-col gap-1 text-sm"><span className="text-soft">{mode === "login" ? "E-mail ou identifiant" : "Adresse e-mail"}</span><input className="input" autoComplete={mode === "login" ? "username" : "email"} type={mode === "login" ? "text" : "email"} autoCapitalize="none" placeholder={mode === "login" ? "E-mail ou identifiant d'employé" : "vous@exemple.com"} value={f.email} onChange={set("email")} required /></label>}
        {mode !== "forgot" && <label className="flex flex-col gap-1 text-sm"><span className="text-soft">{mode === "reset" ? "Nouveau mot de passe" : "Mot de passe"}</span>
          <span className="relative block"><input className="input pr-12" autoComplete={mode === "login" ? "current-password" : "new-password"} type={show ? "text" : "password"} minLength={8} required value={f.password} onChange={set("password")} />
            <button type="button" className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-muted" aria-label={show ? "Masquer le mot de passe" : "Afficher le mot de passe"} onClick={() => setShow(!show)}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>
          {mode !== "login" && <span className="text-xs text-muted">8 caractères minimum.</span>}</label>}
        {info && <p className="text-ok text-sm" role="status">{info}</p>}
        {err && <p className="text-bad text-sm" role="alert">{err}</p>}
        <button className="btn" disabled={busy}>{mode === "login" ? "Se connecter" : mode === "signup" ? "Créer mon commerce" : mode === "forgot" ? "Envoyer le lien" : "Enregistrer le mot de passe"}</button>
        {mode === "login" && <button type="button" className="text-sm text-muted underline" onClick={() => { setMode("forgot"); setErr(""); setInfo(""); }}>Mot de passe oublié ?</button>}
        <button type="button" className="btn-ghost" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setErr(""); setInfo(""); }}>
          {mode === "login" ? "Nouveau commerçant ?" : mode === "signup" ? "J'ai déjà un compte" : "Retour à la connexion"}
        </button>
      </form>
    </div>
  );
}
