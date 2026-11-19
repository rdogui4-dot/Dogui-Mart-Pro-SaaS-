/** Acceptation d'une invitation d'équipe (lien à usage unique, 7 jours) : page publique, sans compte. L'invité choisit son identifiant et son mot de passe ;
 *  le rôle, les accès et les boutiques ont été fixés par le propriétaire et sont appliqués par le serveur. */
import { useEffect, useState } from "react";
import { CheckCircle2, Eye, EyeOff, UserPlus } from "lucide-react";
import { Logo } from "@/components/Logo";
import { publicApi } from "@/lib/api";
import { account } from "@/lib/appwrite";

type Peek = { name: string; roleLabel: string; roleDescription: string; shops: string[]; company: string; expiresAt: string };
export const isInvitationPath = () => /\/invitation\/?$/.test(window.location.pathname);

export function InvitationPage() {
  const token = new URLSearchParams(window.location.search).get("t") ?? "";
  const [info, setInfo] = useState<Peek | null>(null); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ username: "", password: "", confirm: "" }); const [show, setShow] = useState(false); const [done, setDone] = useState("");
  useEffect(() => { publicApi<Peek>("invite.peek", { token }).then(setInfo).catch((e: Error) => setErr(e.message)); }, [token]);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (f.password !== f.confirm) { setErr("Les deux mots de passe sont différents"); return; }
    setBusy(true); setErr("");
    try { const r = await publicApi<{ login: string }>("invite.accept", { token, username: f.username, password: f.password }); setDone(r.login); await account.deleteSession({ sessionId: "current" }).catch(() => undefined); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <main className="min-h-dvh flex items-center justify-center p-4 bg-[var(--bg)]">
      <div className="card w-full max-w-md flex flex-col gap-4">
        <Logo />
        <h1 className="text-xl font-bold inline-flex items-center gap-2"><UserPlus size={22} aria-hidden="true" />Invitation à rejoindre l'équipe</h1>
        {done ? <div role="status" className="flex flex-col gap-3">
          <p className="text-ok inline-flex items-center gap-2 font-semibold"><CheckCircle2 size={20} aria-hidden="true" />Votre compte est créé.</p>
          <p className="text-sm">Identifiant de connexion : <b>{done}</b>. Connectez-vous avec le mot de passe que vous venez de choisir.</p>
          <a className="btn text-center" href={import.meta.env.BASE_URL}>Se connecter</a>
        </div> : !info ? (err ? <p role="alert" className="text-bad">{err}</p> : <p className="text-muted" aria-busy="true">Vérification du lien…</p>) : <>
          <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted">Commerce</dt><dd className="font-semibold">{info.company || "—"}</dd>
            <dt className="text-muted">Nom</dt><dd>{info.name}</dd>
            <dt className="text-muted">Rôle</dt><dd>{info.roleLabel}</dd>
            <dt className="text-muted">Boutique(s)</dt><dd>{info.shops.join(", ")}</dd>
            <dt className="text-muted">Valable jusqu'au</dt><dd>{new Date(info.expiresAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}</dd>
          </dl>
          <p className="text-xs text-muted">{info.roleDescription}</p>
          <form className="flex flex-col gap-2" onSubmit={submit}>
            <label className="text-sm">Identifiant de connexion<input className="input mt-1" autoCapitalize="none" autoComplete="username" required minLength={3} maxLength={24} pattern="[a-zA-Z0-9._\-]{3,24}" placeholder="ex. awa.ndiaye" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></label>
            <label className="text-sm">Mot de passe (8 caractères min.)<span className="relative block mt-1"><input className="input w-full pr-11" type={show ? "text" : "password"} autoComplete="new-password" required minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /><button type="button" className="icon-btn absolute right-1 top-1/2 -translate-y-1/2" aria-label={show ? "Masquer le mot de passe" : "Afficher le mot de passe"} onClick={() => setShow(!show)}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>
            <label className="text-sm">Confirmer le mot de passe<input className="input mt-1" type={show ? "text" : "password"} autoComplete="new-password" required minLength={8} value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></label>
            <button className="btn" disabled={busy}>Créer mon compte</button>
          </form>
          {err && <p role="alert" className="text-bad text-sm">{err}</p>}
        </>}
      </div>
    </main>
  );
}
