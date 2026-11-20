/** Connexion, création de compte et récupération du mot de passe (kit écrans 02-04) : deux colonnes (message et modules à gauche, formulaire à droite), une colonne sur mobile.
 *  Aucun faux élément : pas de connexion Google/Microsoft/Apple (non configurée), pas de code SMS (Appwrite envoie un lien), pas de « se souvenir de moi » (la session est déjà conservée). */
import { useState } from "react";
import { Boxes, Calculator, CheckCircle2, Eye, EyeOff, Lock, Mail, Send, ShieldCheck, ShoppingCart, TrendingUp, Users, Wallet, Zap, ArrowRight, ArrowLeft, UserRound, type LucideIcon } from "lucide-react";
import { account } from "@/lib/appwrite";
import { identity } from "@/lib/identity";
import { useSession } from "@/lib/session";
import { authMessage } from "@/lib/auth-errors";
import { Logo } from "@/components/Logo";
import { Stepper } from "@/components/kit";
import { passwordStrength } from "@/domain/signup";
import { hasRealEmail, sendVerification, takeVerifyResult } from "@/lib/verify";
import { legalHref } from "./legal";
import { MasterSymbol } from "./master";

type Mode = "login" | "signup" | "forgot" | "reset";
/** Paramètres d'adresse lus au chargement de l'application : la redirection de la racine vers /accueil les supprime ensuite
 *  (lien de réinitialisation reçu par e-mail, bouton « S'inscrire » de la présentation). */
const LANDING_SEARCH = typeof window !== "undefined" ? window.location.search : "";
const MODULES: [LucideIcon, string][] = [[ShoppingCart, "Ventes & Caisse"], [Boxes, "Stocks & Inventaires"], [Wallet, "Finance (FinI)"], [Calculator, "Comptabilité (ICompta)"], [TrendingUp, "Investissement & Projection (IProj-Invest)"], [Users, "CRM — Clients & Fidélisation"]];
const SECURITY: [LucideIcon, string][] = [[ShieldCheck, "Compte sécurisé"], [Zap, "Procédure rapide"], [Mail, "Lien de réinitialisation par e-mail"], [Lock, "Nouveau mot de passe en toute sécurité"]];
const COPY: Record<Mode, { title: string; lead: string; hl: string }> = {
  login: { title: "Connectez-vous à votre espace de", hl: "gestion intelligente.", lead: "Accédez à tous vos outils : ventes, stocks, finance, comptabilité, CRM et investissement, avec MASTER DOGUI." },
  signup: { title: "Créez votre compte et lancez votre", hl: "gestion intelligente.", lead: "Rejoignez les commerçants et entreprises qui pilotent leur activité avec DOGUI MART PRO. Essai gratuit de 14 jours." },
  forgot: { title: "Récupérez l'accès à", hl: "votre compte", lead: "Aucun souci ! Réinitialisez votre mot de passe en quelques étapes simples et sécurisées." },
  reset: { title: "Récupérez l'accès à", hl: "votre compte", lead: "Choisissez un nouveau mot de passe pour retrouver votre espace." },
};

function Side({ mode }: { mode: Mode }) {
  const c = COPY[mode]; const list = mode === "forgot" || mode === "reset" ? SECURITY : MODULES;
  return (
    <aside data-theme="dark" className="hidden lg:flex flex-col justify-between gap-6 p-10 xl:p-14 text-[var(--nav-text)] bg-[radial-gradient(ellipse_at_30%_20%,#1d4ed8_0%,#0b1f3a_55%,#07142a_100%)]">
      <Logo size={48} />
      <div className="flex flex-col gap-5 max-w-lg">
        <MasterSymbol size={84} className="text-[var(--gold)]" />
        <h2 className="text-4xl font-extrabold leading-tight">{c.title} <span className="text-[var(--gold)]">{c.hl}</span></h2>
        <p className="text-base opacity-85">{c.lead}</p>
        <ul className="flex flex-col gap-2.5">{list.map(([I, t]) => <li key={t} className="flex items-center gap-3 text-sm"><span className="size-9 rounded-lg bg-white/10 grid place-items-center shrink-0"><I size={18} aria-hidden="true" /></span>{t}</li>)}</ul>
      </div>
      <p className="text-xs opacity-70">Vos données restent isolées par commerce et protégées par des droits vérifiés côté serveur.</p>
    </aside>
  );
}

export function AuthPage() {
  // Retour du lien reçu par e-mail : Appwrite ajoute userId et secret à l'adresse de l'application.
  const recoveryParams = (() => { const q = new URLSearchParams(LANDING_SEARCH); return q.get("userId") && q.get("secret") && q.get("verify") !== "1" ? { userId: q.get("userId")!, secret: q.get("secret")! } : null; })();
  const [mode, setMode] = useState<Mode>(recoveryParams ? "reset" : new URLSearchParams(LANDING_SEARCH).get("inscription") === "1" ? "signup" : "login"); const [info, setInfo] = useState(takeVerifyResult() === "ok" ? "Adresse e-mail confirmée. Connectez-vous pour continuer." : ""); const [show, setShow] = useState(false);
  const [f, setF] = useState({ name: "", email: "", password: "" }); const [accept, setAccept] = useState(false); const [sent, setSent] = useState(false); const [resetDone, setResetDone] = useState(false);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const { refresh } = useSession();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const go = (m: Mode) => { setMode(m); setErr(""); setInfo(""); setSent(false); setResetDone(false); };
  const strength = passwordStrength(f.password);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(""); setInfo("");
    if (mode === "forgot") {
      try {
        if (identity().local) setInfo("Sur ce poste, les e-mails ne sont pas utilisés : demandez au propriétaire de réinitialiser votre mot de passe (Réglages → Équipe & accès).");
        else if (!f.email.includes("@")) setInfo("Un identifiant d'employé n'a pas d'e-mail : demandez à votre responsable de réinitialiser votre mot de passe (Réglages → Équipe & accès).");
        else { await account.createRecovery({ email: f.email.trim(), url: `${window.location.origin}${import.meta.env.BASE_URL}` }); setSent(true); setInfo("Si un compte existe pour cette adresse, un e-mail contenant un lien de réinitialisation vient d'être envoyé (valable 1 heure). Ouvrez ce lien pour choisir un nouveau mot de passe."); }
      } catch (x) { setErr(authMessage(x)); } finally { setBusy(false); }
      return;
    }
    if (mode === "reset" && recoveryParams) {
      try { await account.updateRecovery({ ...recoveryParams, password: f.password }); window.history.replaceState(null, "", `${window.location.pathname}`); setResetDone(true); setF({ ...f, password: "" }); }
      catch (x) { setErr(authMessage(x)); } finally { setBusy(false); }
      return;
    }
    // Les employés se connectent avec un identifiant (sans @) : il correspond à une adresse technique @staff.invalid.
    const login = f.email.includes("@") ? f.email.trim() : `${f.email.trim().toLowerCase()}@staff.invalid`;
    try {
      if (mode === "signup") {
        if (!accept) { setErr("Vous devez accepter les conditions d'utilisation et la politique de confidentialité."); return; }
        await identity().signup(login, f.password, f.name.trim());
        if (!identity().local && hasRealEmail(login)) void sendVerification().catch(() => undefined); // non bloquant : un rappel s'affiche dans l'application tant que l'adresse n'est pas confirmée
        // Le commerce (équipe Appwrite) est créé à l'étape suivante : l'assistant d'accueil (entreprise, boutique).
      } else await identity().login(login, f.password);
      // Pas de redirection forcée : la page demandée (par exemple le retour de Selar) s'affiche dès que la session est chargée.
      await refresh();
    } catch (x) { setErr(authMessage(x)); } finally { setBusy(false); }
  }
  const pwField = (label: string, hint: boolean) => (
    <label className="flex flex-col gap-1 text-sm"><span className="text-soft">{label}{mode === "signup" && <span className="text-bad" aria-hidden="true"> *</span>}</span>
      <span className="relative block"><Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input className="input !pl-10 pr-12 w-full" aria-label={label} aria-describedby={hint ? "pw-rule" : undefined} autoComplete={mode === "login" ? "current-password" : "new-password"} type={show ? "text" : "password"} required minLength={8} value={f.password} onChange={set("password")} />
        <button type="button" className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-muted" aria-label={show ? "Masquer le mot de passe" : "Afficher le mot de passe"} onClick={() => setShow(!show)}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>
      {hint && <><span className="flex gap-1" aria-hidden="true">{[1, 2, 3].map((n) => <span key={n} className={`h-1.5 flex-1 rounded ${strength.level >= n ? (strength.level === 3 ? "bg-ok" : strength.level === 2 ? "bg-warn" : "bg-bad") : "bg-subtle"}`} />)}</span>
        <span id="pw-rule" className={`text-xs ${strength.level === 3 ? "text-ok" : "text-muted"}`}>{f.password ? `Sécurité : ${strength.label}` : "8 caractères minimum."}</span></>}
    </label>
  );
  const stepsRecovery = ["Demande", "Nouveau mot de passe", "Confirmation"];
  return (
    <div className="min-h-dvh grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] bg-[var(--bg)]">
      <Side mode={mode} />
      <main className="flex flex-col justify-center gap-5 p-5 sm:p-10 max-w-xl w-full mx-auto">
        <div className="lg:hidden flex flex-col items-center gap-2 text-center"><Logo size={56} /><p className="text-muted text-sm">Caisse, stocks, achats, clients et compta dans votre poche.</p></div>
        <form onSubmit={submit} className="card flex flex-col gap-4 !p-6 sm:!p-8" noValidate={false}>
          <div className="flex flex-col gap-1"><h1 className="text-2xl font-extrabold">{mode === "login" ? "Se connecter" : mode === "signup" ? "Créer un compte" : mode === "forgot" ? "Mot de passe oublié ?" : resetDone ? "Mot de passe modifié" : "Nouveau mot de passe"}</h1>
            <p className="text-sm text-soft">{mode === "login" ? "Accédez à votre espace DOGUI MART PRO." : mode === "signup" ? "Commencez gratuitement et découvrez la puissance de DOGUI MART PRO." : mode === "forgot" ? "Entrez votre adresse e-mail pour recevoir un lien de réinitialisation." : resetDone ? "Vous pouvez maintenant vous connecter." : "Choisissez un nouveau mot de passe."}</p></div>
          {mode === "signup" && <Stepper steps={["Compte", "Entreprise", "Boutique"]} current={0} label="Étapes de création du compte" compact />}
          {(mode === "forgot" || mode === "reset") && <Stepper steps={stepsRecovery} current={resetDone ? 2 : mode === "reset" ? 1 : 0} label="Étapes de récupération du mot de passe" compact />}

          {resetDone ? <div role="status" className="flex flex-col gap-3"><p className="text-ok inline-flex items-center gap-2 font-semibold"><CheckCircle2 size={20} aria-hidden="true" />Votre nouveau mot de passe est enregistré.</p><button type="button" className="btn inline-flex items-center justify-center gap-2" onClick={() => go("login")}>Se connecter <ArrowRight size={18} aria-hidden="true" /></button></div> : <>
            {mode === "signup" && <label className="flex flex-col gap-1 text-sm"><span className="text-soft">Nom complet <span className="text-bad" aria-hidden="true">*</span></span><span className="relative block"><UserRound size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" /><input aria-label="Nom complet" autoComplete="name" className="input !pl-10 w-full" placeholder="Ex. : Awa Traoré" value={f.name} onChange={set("name")} required minLength={2} /></span></label>}
            {mode !== "reset" && <label className="flex flex-col gap-1 text-sm"><span className="text-soft">{mode === "login" ? "E-mail ou identifiant" : "Adresse e-mail"}{mode === "signup" && <span className="text-bad" aria-hidden="true"> *</span>}</span>
              <span className="relative block"><Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" /><input aria-label={mode === "login" ? "E-mail ou identifiant" : "Adresse e-mail"} className="input !pl-10 w-full" autoComplete={mode === "login" ? "username" : "email"} type={mode === "login" ? "text" : "email"} autoCapitalize="none" placeholder={mode === "login" ? "e-mail ou identifiant" : "exemple@votreentreprise.com"} value={f.email} onChange={set("email")} required /></span></label>}
            {mode !== "forgot" && pwField(mode === "reset" ? "Nouveau mot de passe" : "Mot de passe", mode !== "login")}
            {mode === "signup" && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 size-4 accent-[var(--accent)]" checked={accept} onChange={(e) => setAccept(e.target.checked)} required aria-required="true" /><span>J'accepte les <a className="text-accent-text underline" href={legalHref("conditions")} target="_blank" rel="noreferrer">Conditions d'utilisation</a> et la <a className="text-accent-text underline" href={legalHref("confidentialite")} target="_blank" rel="noreferrer">Politique de confidentialité</a> de DOGUI MART PRO. <span className="text-bad" aria-hidden="true">*</span></span></label>}
            {info && <p className="text-ok text-sm" role="status">{info}</p>}
            {err && <p className="text-bad text-sm" role="alert">{err}</p>}
            <button className="btn inline-flex items-center justify-center gap-2" disabled={busy || (mode === "signup" && !accept)}>{mode === "login" ? "Se connecter" : mode === "signup" ? "Créer mon compte" : mode === "forgot" ? (sent ? "Renvoyer le lien de réinitialisation" : "Envoyer le lien de réinitialisation") : "Enregistrer le mot de passe"}{mode === "forgot" ? <Send size={18} aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}</button>
            {mode === "login" && <button type="button" className="text-sm text-accent-text underline self-end" onClick={() => go("forgot")}>Mot de passe oublié ?</button>}
          </>}
          {!resetDone && <button type="button" className="btn-ghost inline-flex items-center justify-center gap-2" onClick={() => go(mode === "login" ? "signup" : "login")}>
            {mode === "login" ? "Pas encore de compte ? Créer un compte" : mode === "signup" ? "Vous avez déjà un compte ? Se connecter" : <><ArrowLeft size={16} aria-hidden="true" /> Retour à la connexion</>}
          </button>}
        </form>
        <p className="text-center text-xs text-muted"><a className="underline" href={`${import.meta.env.BASE_URL}presentation/`}>Découvrir DOGUI MART PRO</a> · <a className="underline" href={legalHref("conditions")}>Conditions</a> · <a className="underline" href={legalHref("confidentialite")}>Confidentialité</a></p>
      </main>
    </div>
  );
}
