import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Cloud, CloudOff, ListChecks, RefreshCw, Settings2, ShieldAlert } from "lucide-react";
import { Panel, StatusBadge, ErrorState, LoadingState } from "@/components/kit";
import { localCloud, type SyncConflict } from "@/lib/local-backend";
import { sinceText, syncAlert } from "@/domain/sync-alert";

const KIND: Record<string, { label: string; help: string }> = {
  deleted_on_cloud: { label: "Supprimé côté cloud", help: "La ligne a été retirée de ce poste parce qu'elle n'existait plus au cloud. La version supprimée est gardée ci-dessous." },
  cloud_version_overwritten: { label: "Version du cloud remplacée", help: "La ligne avait aussi changé au cloud ; la version de ce poste l'a emporté. Celle du cloud est gardée ci-dessous." },
  cloud_changed_while_local_pending: { label: "Modifié des deux côtés", help: "Le cloud a changé cette ligne alors que ce poste avait une modification en attente : la version de ce poste est conservée." },
  rejected_by_cloud: { label: "Refusé par le cloud", help: "Le cloud n'a pas accepté cet élément (format, taille ou droits). Il n'est pas renvoyé." },
  cloud_deletions_suspicious: { label: "Suppressions suspectes ignorées", help: "Trop de lignes manquaient d'un coup au cloud : rien n'a été supprimé sur ce poste. Vérifiez le cloud." },
};
const TABLE: Record<string, string> = { products: "Articles", shops: "Boutiques", suppliers: "Fournisseurs", users: "Comptes", files: "Fichiers" };
const when = (iso: string) => { try { return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }); } catch { return iso; } };
const show = (v: unknown) => { try { return JSON.stringify(v, null, 2); } catch { return String(v); } };

/** Synchronisation du poste avec le cloud (version Windows) : état réel, boutons, constats à examiner, retour au cloud, restauration. Tout vient du serveur local. */
export function SyncSection() {
  const api = localCloud(); const qc = useQueryClient(); const [err, setErr] = useState(""); const [info, setInfo] = useState(""); const [busy, setBusy] = useState(""); const [pw, setPw] = useState(""); const [hours, setHours] = useState(""); const [confirm, setConfirm] = useState(""); const [restoreName, setRestoreName] = useState("");
  const st = useQuery({ queryKey: ["local-cloud"], enabled: !!api, refetchInterval: 15_000, queryFn: () => api!.status() });
  const cf = useQuery({ queryKey: ["local-cloud-conflicts"], enabled: !!api && !!st.data?.hosted, queryFn: () => api!.conflicts() });
  if (!api) return <div className="card text-sm">La synchronisation n'est disponible que dans la version Windows de Dogui Mart Pro.</div>;
  if (st.isLoading) return <LoadingState label="Lecture de l'état de la synchronisation" />;
  if (st.error || !st.data) return <ErrorState message={(st.error as Error)?.message} onRetry={() => void st.refetch()} />;
  const s = st.data; const now = Date.now(); const al = syncAlert(s, now);
  const refresh = async () => { await qc.invalidateQueries({ queryKey: ["local-cloud"] }); await qc.invalidateQueries({ queryKey: ["local-cloud-conflicts"] }); };
  const run = async (key: string, fn: () => Promise<string | void>) => { setBusy(key); setErr(""); setInfo(""); try { const m = await fn(); if (m) setInfo(m); await refresh(); } catch (e) { setErr((e as Error).message || "Opération impossible"); } finally { setBusy(""); } };
  if (!s.hosted) return (
    <Panel title="Synchronisation avec le cloud" icon={CloudOff} action={<StatusBadge tone="muted">Non rattaché</StatusBadge>}>
      <p className="text-sm text-soft">Ce poste n'est rattaché à aucun commerce du cloud : toutes les données restent sur cet ordinateur. Pour rattacher un poste à un commerce existant, utilisez l'écran de première connexion d'un poste vierge (« Rattacher à mon commerce cloud »).</p>
      {info && <p role="status" className="text-sm text-ok">{info}</p>}
      {err && <p role="alert" className="text-sm text-bad">{err}</p>}
    </Panel>);
  const tone = al.level === "bad" || !s.sessionOk ? "bad" : al.level === "warn" || s.failures > 0 ? "warn" : "ok";
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Synchronisation avec le cloud" icon={tone === "ok" ? Cloud : CloudOff} action={<StatusBadge tone={tone}>{tone === "ok" ? "À jour" : tone === "warn" ? "Attention" : "Action requise"}</StatusBadge>}>
        {al.level !== "none" && <div role="alert" className={`rounded-xl border px-3 py-2 text-sm ${al.level === "bad" ? "border-bad/40 bg-bad-bg text-bad" : "border-warn/40 bg-warn-bg text-warn"}`}><b>{al.title}</b><br />{al.detail}</div>}
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex gap-2"><dt className="text-muted">Poste</dt><dd className="font-semibold">{s.stationName}</dd></div>
          <div className="flex gap-2"><dt className="text-muted">Rattaché</dt><dd>{s.attachedAt ? when(s.attachedAt) : "—"}</dd></div>
          <div className="flex gap-2"><dt className="text-muted">Dernière synchronisation réussie</dt><dd>{sinceText(s.lastSyncOkAt, now)}</dd></div>
          <div className="flex gap-2"><dt className="text-muted">En attente d'envoi</dt><dd>{s.pending} élément{s.pending > 1 ? "s" : ""}</dd></div>
          <div className="flex gap-2"><dt className="text-muted">Connexion au cloud</dt><dd>{s.sessionOk ? "active" : "à rétablir"}</dd></div>
          {s.failures > 0 && <div className="flex gap-2"><dt className="text-muted">Échecs consécutifs</dt><dd>{s.failures}{s.nextTryAt ? ` · prochain essai automatique ${new Date(s.nextTryAt).toLocaleTimeString("fr-FR", { timeStyle: "short" })}` : ""}</dd></div>}
          {s.lastError && <div className="flex gap-2 sm:col-span-2"><dt className="text-muted">Dernière erreur</dt><dd className="text-bad">{s.lastError}</dd></div>}
        </dl>
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}
        {info && <p role="status" className="text-sm text-ok">{info}</p>}
        {!s.sessionOk ? (
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run("reconnect", async () => { await api.reconnect(pw); setPw(""); return "Poste reconnecté au cloud."; }); }}>
            <label className="flex flex-col gap-1 text-sm"><span className="text-soft">Mot de passe du propriétaire ({s.cloudEmail ?? "compte cloud"})</span><input className="input" type="password" autoComplete="current-password" aria-label="Mot de passe du propriétaire" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
            <button className="btn" disabled={busy === "reconnect" || !pw}>Reconnecter au cloud</button><span className="text-xs text-muted w-full">Le mot de passe sert uniquement à ouvrir la session ; il n'est pas conservé.</span>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2"><button type="button" className="btn inline-flex items-center gap-2" disabled={busy === "sync"} onClick={() => void run("sync", async () => { const r = await api.sync(); if (r.report.error) throw new Error(r.report.error); return `Synchronisation terminée : ${r.report.pushed} envoyé${r.report.pushed > 1 ? "s" : ""}, ${r.report.pulled} reçu${r.report.pulled > 1 ? "s" : ""}.`; })}><RefreshCw size={16} aria-hidden="true" className={busy === "sync" ? "animate-spin" : ""} />Synchroniser maintenant</button></div>
        )}
        <p className="text-xs text-muted">Ce poste est la référence : les ventes, le stock et la caisse sont saisis ici et copiés au cloud, qui sert de miroir (consultation, rapports, sauvegarde). Sans Internet, tout continue de fonctionner et part à la reconnexion.</p>
      </Panel>

      <Panel title={`Constats à examiner (${cf.data?.length ?? 0})`} icon={ListChecks} action={(cf.data?.length ?? 0) > 1 ? <button type="button" className="btn-ghost !min-h-8 !px-3 !py-1 text-xs" disabled={busy === "all"} onClick={() => void run("all", async () => { await api.review("all"); })}>Tout marquer comme examiné</button> : undefined}>
        {cf.isLoading ? <LoadingState label="Lecture des constats" rows={2} /> : !cf.data?.length ? <p className="text-sm text-muted inline-flex items-center gap-2"><CheckCircle2 size={16} aria-hidden="true" />Rien à examiner : aucun conflit ni refus depuis la dernière vérification.</p> :
          <ul className="flex flex-col divide-y divide-[var(--line)]">{cf.data.map((c: SyncConflict) => { const k = KIND[c.kind] ?? { label: c.kind, help: "" }; return (
            <li key={c.id} className="py-3 flex flex-col gap-1 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2 font-semibold"><AlertTriangle size={16} aria-hidden="true" className="text-warn" />{k.label}<span className="font-normal text-muted">· {TABLE[c.table] ?? c.table}{c.rowId !== "*" ? ` · ${c.rowId}` : ""} · {when(c.at)}</span></span>
                <button type="button" className="btn-ghost !min-h-8 !px-3 !py-1 text-xs" disabled={busy === `r${c.id}`} aria-label={`Marquer comme examiné : ${k.label}`} onClick={() => void run(`r${c.id}`, async () => { await api.review(c.id); })}>Marquer comme examiné</button></div>
              <p className="text-soft">{k.help}</p>
              <details className="text-xs"><summary className="cursor-pointer text-accent-text">Voir les versions gardées</summary><div className="grid gap-2 pt-2 md:grid-cols-2"><div><b>Ce poste</b><pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-[var(--surface-2)] p-2 whitespace-pre-wrap break-all">{show(c.local)}</pre></div><div><b>Cloud</b><pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-[var(--surface-2)] p-2 whitespace-pre-wrap break-all">{show(c.cloud)}</pre></div></div></details>
            </li>); })}</ul>}
        <p className="text-xs text-muted">Rien n'est appliqué automatiquement : ces constats sont là pour vérification. « Marquer comme examiné » les retire de la liste sans rien modifier.</p>
      </Panel>

      <Panel title="Alerte de synchronisation" icon={Settings2}>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run("hours", async () => { await api.setAlertHours(Number(hours)); setHours(""); return "Seuil d'alerte enregistré."; }); }}>
          <label className="flex flex-col gap-1 text-sm"><span className="text-soft">Prévenir si aucune synchronisation réussie depuis (heures)</span><input className="input w-28" inputMode="numeric" aria-label="Seuil d'alerte en heures" placeholder={String(s.alertHours)} value={hours} onChange={(e) => setHours(e.target.value.replace(/\D/g, ""))} /></label>
          <button className="btn-ghost" disabled={busy === "hours" || !hours}>Enregistrer</button>
        </form>
        <p className="text-xs text-muted">Seuil actuel : {s.alertHours} h. Le bandeau d'alerte n'est affiché qu'au propriétaire.</p>
      </Panel>

      <Panel title="Opérations sensibles" icon={ShieldAlert}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2"><b className="text-sm">Rétablir depuis le cloud</b>
            <p className="text-xs text-muted">À utiliser si les données de ce poste sont abîmées : le commerce est téléchargé de nouveau depuis le cloud. Une copie de sécurité de la base actuelle est faite avant. Refusé tant que des éléments ne sont pas envoyés (ils seraient perdus).</p>
            <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (!window.confirm("Rétablir ce poste depuis le cloud ? Une copie de sécurité est faite avant.")) return; void run("restore", async () => { await api.restore(restoreName); setRestoreName(""); return "Poste rétabli depuis le cloud (copie de sécurité conservée dans le dossier « sauvegardes »)."; }); }}>
              <label className="flex flex-col gap-1 text-sm"><span className="text-soft">Tapez le nom du poste pour confirmer ({s.stationName})</span><input className="input" aria-label="Nom du poste pour confirmer la restauration" value={restoreName} onChange={(e) => setRestoreName(e.target.value)} /></label>
              <button className="btn-ghost" disabled={busy === "restore" || restoreName.trim() !== s.stationName || s.pending > 0}>Rétablir depuis le cloud</button>
            </form>
          </div>
          <div className="flex flex-col gap-2"><b className="text-sm">Rendre le commerce au cloud</b>
            <p className="text-xs text-muted">Le cloud redevient le lieu de saisie ; ce poste cesse de synchroniser. Refusé s'il reste des éléments à envoyer. Vos données ne sont pas supprimées.</p>
            <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (!window.confirm("Rendre le commerce au cloud ? Ce poste cessera de synchroniser.")) return; void run("release", async () => { await api.release(); setConfirm(""); return "Commerce rendu au cloud."; }); }}>
              <label className="flex flex-col gap-1 text-sm"><span className="text-soft">Tapez « RENDRE » pour confirmer</span><input className="input" aria-label="Confirmation du retour au cloud" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
              <button className="btn-ghost" disabled={busy === "release" || confirm.trim() !== "RENDRE"}>Rendre au cloud</button>
            </form>
          </div>
        </div>
      </Panel>
    </div>
  );
}

/** Bandeau d'alerte du PROPRIÉTAIRE seulement (poste local rattaché) : aucune action automatique, il renvoie vers Paramètres → Synchronisation. */
export function SyncBanner() {
  const api = localCloud(); const q = useQuery({ queryKey: ["local-cloud"], enabled: !!api, refetchInterval: 60_000, retry: false, queryFn: () => api!.status() });
  if (!api || !q.data) return null; const a = syncAlert(q.data, Date.now()); if (a.level === "none") return null;
  return <div role="alert" className={`text-sm py-1.5 px-3 text-center ${a.level === "bad" ? "bg-bad-bg text-bad" : "bg-warn-bg text-warn"}`}><b>{a.title}.</b> {a.detail} <a className="underline" href="/reglages?onglet=synchronisation">Ouvrir la synchronisation</a></div>;
}

/** Poste vierge : rattacher ce poste à un commerce du cloud (le propriétaire se connecte au cloud, le poste télécharge le commerce et en devient l'hébergeur). Mot de passe jamais conservé. */
export function AttachPoste({ onBack }: { onBack: () => void }) {
  const api = localCloud(); const [f, setF] = useState({ email: "", password: "", stationName: "Caisse principale" }); const [choose, setChoose] = useState<{ id: string; name: string }[]>([]); const [tenantId, setTenantId] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  if (!api) return null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      const r = await api.attach({ ...f, tenantId: tenantId || undefined });
      if (!r.ok) { if (r.choose?.length) { setChoose(r.choose); setTenantId(r.choose[0]!.id); setErr("Plusieurs commerces : choisissez celui que ce poste hébergera."); } else setErr(r.error); return; }
      const { identity } = await import("@/lib/identity"); await identity().login(f.email.trim(), f.password); window.location.assign("/");
    } catch (x) { setErr((x as Error).message || "Rattachement impossible"); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-label="Rattacher ce poste à un commerce cloud">
      <p className="text-sm text-soft">Ce poste devient la <b>référence</b> de votre commerce : le commerce est téléchargé depuis le cloud, puis les ventes saisies ici y sont copiées. Le cloud passe en consultation (rapports, abonnement) tant que ce poste héberge. Vous pourrez le rendre au cloud à tout moment.</p>
      <label className="flex flex-col gap-1 text-sm"><span className="text-soft">E-mail du compte propriétaire (cloud)</span><input className="input" type="email" autoComplete="username" aria-label="E-mail du compte cloud" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></label>
      <label className="flex flex-col gap-1 text-sm"><span className="text-soft">Mot de passe</span><input className="input" type="password" autoComplete="current-password" aria-label="Mot de passe du compte cloud" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></label>
      <label className="flex flex-col gap-1 text-sm"><span className="text-soft">Nom de ce poste</span><input className="input" aria-label="Nom de ce poste" value={f.stationName} maxLength={60} onChange={(e) => setF({ ...f, stationName: e.target.value })} required /></label>
      {choose.length > 0 && <label className="flex flex-col gap-1 text-sm"><span className="text-soft">Commerce à héberger</span><select className="input" aria-label="Commerce à héberger" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>{choose.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      {err && <p role="alert" className="text-sm text-bad">{err}</p>}
      {busy && <p role="status" className="text-sm text-soft">Téléchargement du commerce en cours : cela peut prendre quelques minutes, ne fermez pas cette fenêtre.</p>}
      <button className="btn" disabled={busy}>{busy ? "Rattachement…" : "Rattacher ce poste"}</button>
      <button type="button" className="btn-ghost" onClick={onBack} disabled={busy}>Retour</button>
      <p className="text-xs text-muted">Le mot de passe sert uniquement à ouvrir la session cloud ; il n'est pas conservé.</p>
    </form>
  );
}
