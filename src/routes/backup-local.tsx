import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, CheckCircle2, Download, FolderOutput, HardDrive, RotateCcw, Upload } from "lucide-react";
import { Panel, StatusBadge, ErrorState, LoadingState } from "@/components/kit";
import { localBackup, type BackupItem, type BackupStatus } from "@/lib/local-backend";
import { sinceText } from "@/domain/sync-alert";

const KIND: Record<BackupItem["kind"], string> = { auto: "Automatique", manuel: "Manuelle", "avant-restauration": "Avant une restauration" };
const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} Ko` : `${(n / 1048576).toFixed(1)} Mo`);
const when = (iso: string) => { try { return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }); } catch { return iso; } };
const MIN_PHRASE = 8;

/** Après une restauration : la base (et ses sessions) a été remplacée, on revient à l'écran de connexion. */
function backToLogin() { try { localStorage.removeItem("dmp.local.token"); } catch { /* stockage indisponible */ } window.location.assign("/"); }

/** Sauvegardes du poste (version Windows) : liste vérifiée, sauvegarde manuelle, export chiffré, restauration, copie externe. Propriétaire seulement. */
export function BackupSection() {
  const api = localBackup(); const qc = useQueryClient(); const [err, setErr] = useState(""); const [info, setInfo] = useState(""); const [busy, setBusy] = useState("");
  const [exp, setExp] = useState({ source: "", pass: "", pass2: "" }); const [file, setFile] = useState<File | null>(null); const [peek, setPeek] = useState(""); const [filePass, setFilePass] = useState(""); const [confirmFile, setConfirmFile] = useState(""); const [confirmList, setConfirmList] = useState({ name: "", text: "" });
  const [keep, setKeep] = useState(""); const [ext, setExt] = useState("");
  const q = useQuery({ queryKey: ["local-backup"], enabled: !!api, refetchInterval: 30_000, queryFn: () => api!.status() });
  if (!api) return <div className="card text-sm">Les sauvegardes ne sont gérées ici que dans la version Windows de Dogui Mart Pro.</div>;
  if (q.isLoading) return <LoadingState label="Lecture des sauvegardes" />;
  if (q.error || !q.data) return <ErrorState message={(q.error as Error)?.message} onRetry={() => void q.refetch()} />;
  const s: BackupStatus = q.data; const now = Date.now(); const tone = s.alert.level === "bad" ? "bad" : s.alert.level === "warn" ? "warn" : "ok";
  const refresh = () => qc.invalidateQueries({ queryKey: ["local-backup"] });
  const run = async (key: string, fn: () => Promise<string | void>) => { setBusy(key); setErr(""); setInfo(""); try { const m = await fn(); if (m) setInfo(m); await refresh(); } catch (e) { setErr((e as Error).message || "Opération impossible"); } finally { setBusy(""); } };
  const phraseOk = exp.pass.length >= MIN_PHRASE && exp.pass === exp.pass2;

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Sauvegardes de ce poste" icon={Archive} action={<StatusBadge tone={tone}>{tone === "ok" ? "À jour" : tone === "warn" ? "Attention" : "Action requise"}</StatusBadge>}>
        {s.alert.level !== "none" && <div role="alert" className={`rounded-xl border px-3 py-2 text-sm ${s.alert.level === "bad" ? "border-bad/40 bg-bad-bg text-bad" : "border-warn/40 bg-warn-bg text-warn"}`}><b>{s.alert.title}</b><br />{s.alert.detail}</div>}
        <p className="text-sm text-soft">Dernière sauvegarde valide : <b>{sinceText(s.lastOkAt ?? undefined, now)}</b>. Une copie est faite automatiquement chaque jour ({s.settings.keep} gardées) et vérifiée aussitôt (contrôle d'intégrité de la base).</p>
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}{info && <p role="status" className="text-sm text-ok">{info}</p>}
        <div><button type="button" className="btn inline-flex items-center gap-2" disabled={busy === "now"} onClick={() => void run("now", async () => { const r = await api.now(); void r; return "Sauvegarde faite et vérifiée."; })}><HardDrive size={16} aria-hidden="true" />Sauvegarder maintenant</button></div>
        {s.backups.length === 0 ? <p className="text-sm text-muted">Aucune sauvegarde pour le moment.</p> : (
          <ul className="flex flex-col divide-y divide-[var(--line)]">{s.backups.map((b) => (
            <li key={b.name} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0"><b>{KIND[b.kind]}</b> · {when(b.at)} · {size(b.size)} · {b.verification?.ok ? <span className="text-ok inline-flex items-center gap-1"><CheckCircle2 size={14} aria-hidden="true" />vérifiée{b.verification.teamName ? ` (${b.verification.teamName}, ${b.verification.rows} lignes)` : ""}</span> : b.verification ? <span className="text-bad">invalide : {b.verification.error}</span> : <span className="text-muted">non vérifiée</span>}</span>
              <span className="flex gap-1">
                <button type="button" className="btn-ghost !min-h-8 !px-3 !py-1 text-xs" disabled={busy === `v${b.name}`} aria-label={`Vérifier la sauvegarde du ${when(b.at)}`} onClick={() => void run(`v${b.name}`, async () => { const r = await api.verify(b.name); void r; })}>Vérifier</button>
                <button type="button" className="btn-ghost !min-h-8 !px-3 !py-1 text-xs" aria-label={`Exporter la sauvegarde du ${when(b.at)}`} onClick={() => setExp({ ...exp, source: b.name })}>Exporter…</button>
                <button type="button" className="btn-ghost !min-h-8 !px-3 !py-1 text-xs" disabled={!s.canRestoreFile || !b.verification?.ok} title={s.canRestoreFile ? undefined : "Poste rattaché au cloud : utilisez « Rétablir depuis le cloud »"} aria-label={`Restaurer la sauvegarde du ${when(b.at)}`} onClick={() => setConfirmList({ name: b.name, text: "" })}>Restaurer…</button>
              </span>
            </li>))}</ul>)}
        {confirmList.name && (
          <form className="flex flex-wrap items-end gap-2 rounded-xl border border-warn/40 p-3" onSubmit={(e) => { e.preventDefault(); void run("restore", async () => { await api.restore(confirmList.name); backToLogin(); return "Restauration terminée : reconnexion…"; }); }}>
            <label className="flex flex-col gap-1 text-sm"><span className="text-soft">Cette sauvegarde remplacera TOUTES les données actuelles (une copie de sécurité est faite avant). Tapez RESTAURER pour confirmer.</span><input className="input" aria-label="Confirmation de la restauration" value={confirmList.text} onChange={(e) => setConfirmList({ ...confirmList, text: e.target.value })} /></label>
            <button className="btn" disabled={busy === "restore" || confirmList.text.trim() !== "RESTAURER"}>Restaurer cette sauvegarde</button><button type="button" className="btn-ghost" onClick={() => setConfirmList({ name: "", text: "" })}>Annuler</button>
          </form>)}
        {s.hosted && <p className="text-xs text-muted">Ce poste est rattaché au cloud : la restauration depuis un fichier ou une copie est désactivée (elle ferait reculer ce poste par rapport au cloud). Utilisez « Rétablir depuis le cloud » dans Synchronisation.</p>}
      </Panel>

      <Panel title="Exporter un fichier de sauvegarde chiffré" icon={Download}>
        <p className="text-sm text-soft">À copier sur une clé USB ou un autre PC. Le fichier est chiffré (AES-256) avec une <b>phrase secrète</b> que vous choisissez : elle n'est enregistrée nulle part. <b>Si vous la perdez, le fichier est irrécupérable.</b></p>
        <form className="grid gap-2 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void run("export", async () => { const r = await api.exportFile(exp.pass, exp.source || undefined); const a = document.createElement("a"); a.href = URL.createObjectURL(r.blob); a.download = r.filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10_000); setExp({ source: "", pass: "", pass2: "" }); return `Fichier « ${r.filename} » prêt : conservez-le avec votre phrase secrète.`; }); }}>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2"><span className="text-soft">Source</span><select className="input" aria-label="Source de l'export" value={exp.source} onChange={(e) => setExp({ ...exp, source: e.target.value })}><option value="">L'état actuel du poste (à l'instant)</option>{s.backups.filter((b) => b.verification?.ok).map((b) => <option key={b.name} value={b.name}>{KIND[b.kind]} · {when(b.at)}</option>)}</select></label>
          <label className="flex flex-col gap-1 text-sm"><span className="text-soft">Phrase secrète (8 caractères au moins)</span><input className="input" type="password" autoComplete="new-password" aria-label="Phrase secrète de l'export" value={exp.pass} onChange={(e) => setExp({ ...exp, pass: e.target.value })} /></label>
          <label className="flex flex-col gap-1 text-sm"><span className="text-soft">Confirmez la phrase secrète</span><input className="input" type="password" autoComplete="new-password" aria-label="Confirmation de la phrase secrète" value={exp.pass2} onChange={(e) => setExp({ ...exp, pass2: e.target.value })} /></label>
          {exp.pass2 && exp.pass !== exp.pass2 && <p className="text-xs text-bad sm:col-span-2">Les deux phrases ne sont pas identiques.</p>}
          <div className="sm:col-span-2"><button className="btn inline-flex items-center gap-2" disabled={busy === "export" || !phraseOk}><Download size={16} aria-hidden="true" />Exporter le fichier chiffré</button></div>
        </form>
      </Panel>

      <Panel title="Restaurer depuis un fichier" icon={RotateCcw}>
        {!s.canRestoreFile ? <p className="text-sm text-soft">Indisponible : ce poste est rattaché au cloud. Utilisez « Rétablir depuis le cloud » (Paramètres → Synchronisation).</p> : (
          <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (!file) return; void run("import", async () => { await api.importFile(file, filePass); backToLogin(); return "Restauration terminée : reconnexion…"; }); }}>
            <p className="text-sm text-soft">Le fichier remplace TOUTES les données actuelles (une copie de sécurité est faite avant). Il doit être celui du même commerce.</p>
            <label className="flex flex-col gap-1 text-sm"><span className="text-soft">Fichier de sauvegarde (.dmpbackup)</span><input type="file" accept=".dmpbackup" aria-label="Fichier de sauvegarde" onChange={async (e) => { const f = e.target.files?.[0] ?? null; setFile(f); setPeek(""); if (f) { try { const p = await api.peek(f); setPeek(`Sauvegarde du ${when(p.createdAt)}${p.teamName ? ` · ${p.teamName}` : ""}${p.rows !== undefined ? ` · ${p.rows} lignes` : ""}`); } catch (x) { setErr((x as Error).message); } } }} /></label>
            {peek && <p className="text-sm text-ok" role="status">{peek}</p>}
            <label className="flex flex-col gap-1 text-sm"><span className="text-soft">Phrase secrète du fichier</span><input className="input" type="password" autoComplete="off" aria-label="Phrase secrète du fichier à restaurer" value={filePass} onChange={(e) => setFilePass(e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-sm"><span className="text-soft">Tapez RESTAURER pour confirmer</span><input className="input" aria-label="Confirmation de la restauration du fichier" value={confirmFile} onChange={(e) => setConfirmFile(e.target.value)} /></label>
            <div><button className="btn-ghost inline-flex items-center gap-2" disabled={busy === "import" || !file || !filePass || confirmFile.trim() !== "RESTAURER"}><Upload size={16} aria-hidden="true" />Restaurer depuis ce fichier</button></div>
          </form>)}
      </Panel>

      <Panel title="Réglages" icon={FolderOutput}>
        <form className="grid gap-2 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void run("settings", async () => { await api.setSettings({ ...(keep ? { keep: Number(keep) } : {}), ...(ext !== "" ? { externalDir: ext === "-" ? null : ext } : {}) }); setKeep(""); setExt(""); return "Réglages enregistrés."; }); }}>
          <label className="flex flex-col gap-1 text-sm"><span className="text-soft">Sauvegardes automatiques à garder (3 à 60)</span><input className="input" inputMode="numeric" aria-label="Nombre de sauvegardes à garder" placeholder={String(s.settings.keep)} value={keep} onChange={(e) => setKeep(e.target.value.replace(/\D/g, ""))} /></label>
          <label className="flex flex-col gap-1 text-sm"><span className="text-soft">Copie externe : dossier complet (clé USB, disque réseau) — « - » pour désactiver</span><input className="input" aria-label="Dossier de copie externe" placeholder={s.settings.externalDir ?? "E:\\Sauvegardes"} value={ext} onChange={(e) => setExt(e.target.value)} /></label>
          <p className="text-xs text-muted sm:col-span-2">{s.settings.externalDir ? <>Copie externe active : <code>{s.settings.externalDir}</code>{s.settings.externalLastAt ? ` · dernière copie ${sinceText(s.settings.externalLastAt, now)}` : ""}.{s.settings.externalError ? <span className="text-warn"> {s.settings.externalError}</span> : null}</> : "Aucune copie externe : une panne du PC emporterait aussi les sauvegardes. Branchez une clé USB ou un disque et indiquez son dossier."}</p>
          <div className="sm:col-span-2"><button className="btn-ghost" disabled={busy === "settings" || (!keep && ext === "")}>Enregistrer</button></div>
        </form>
      </Panel>
    </div>
  );
}

/** Bandeau du PROPRIÉTAIRE (poste local) : aucune sauvegarde valide récente, ou copie externe en échec. Aucune action automatique. */
export function BackupBanner() {
  const api = localBackup(); const q = useQuery({ queryKey: ["local-backup"], enabled: !!api, refetchInterval: 60_000, retry: false, queryFn: () => api!.status() });
  if (!api || !q.data || q.data.alert.level === "none") return null; const a = q.data.alert;
  return <div role="alert" className={`text-sm py-1.5 px-3 text-center ${a.level === "bad" ? "bg-bad-bg text-bad" : "bg-warn-bg text-warn"}`}><b>{a.title}.</b> {a.detail} <a className="underline" href="/reglages?onglet=sauvegardes">Ouvrir les sauvegardes</a></div>;
}

/** Poste VIERGE (nouveau PC après une panne) : restaurer une sauvegarde exportée, sans compte. Les comptes de la sauvegarde sont retrouvés. */
export function RestoreFromFile({ onBack }: { onBack: () => void }) {
  const api = localBackup(); const [file, setFile] = useState<File | null>(null); const [peek, setPeek] = useState(""); const [pass, setPass] = useState(""); const [confirm, setConfirm] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  if (!api) return null;
  return (
    <form className="flex flex-col gap-3" aria-label="Restaurer une sauvegarde" onSubmit={async (e) => { e.preventDefault(); if (!file) return; setBusy(true); setErr(""); try { await api.importFile(file, pass); backToLogin(); } catch (x) { setErr((x as Error).message || "Restauration impossible"); } finally { setBusy(false); } }}>
      <p className="text-sm text-soft">Sur un PC neuf : choisissez le fichier <b>.dmpbackup</b> exporté depuis l'ancien poste et saisissez sa phrase secrète. Votre commerce et vos comptes (propriétaire, personnel) sont retrouvés tels qu'à la date de la sauvegarde.</p>
      <label className="flex flex-col gap-1 text-sm"><span className="text-soft">Fichier de sauvegarde (.dmpbackup)</span><input type="file" accept=".dmpbackup" aria-label="Fichier de sauvegarde" onChange={async (e) => { const f = e.target.files?.[0] ?? null; setFile(f); setPeek(""); setErr(""); if (f) { try { const p = await api.peek(f); setPeek(`Sauvegarde du ${when(p.createdAt)}${p.teamName ? ` · ${p.teamName}` : ""}${p.rows !== undefined ? ` · ${p.rows} lignes` : ""}`); } catch (x) { setErr((x as Error).message); } } }} /></label>
      {peek && <p className="text-sm text-ok" role="status">{peek}</p>}
      <label className="flex flex-col gap-1 text-sm"><span className="text-soft">Phrase secrète</span><input className="input" type="password" autoComplete="off" aria-label="Phrase secrète du fichier" value={pass} onChange={(e) => setPass(e.target.value)} /></label>
      <label className="flex flex-col gap-1 text-sm"><span className="text-soft">Tapez RESTAURER pour confirmer</span><input className="input" aria-label="Confirmation" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
      {err && <p role="alert" className="text-sm text-bad">{err}</p>}{busy && <p role="status" className="text-sm text-soft">Restauration en cours…</p>}
      <button className="btn" disabled={busy || !file || !pass || confirm.trim() !== "RESTAURER"}>Restaurer cette sauvegarde</button>
      <button type="button" className="btn-ghost" onClick={onBack} disabled={busy}>Retour</button>
      <p className="text-xs text-muted">La restauration remplace entièrement la base de ce poste. Les liens avec le cloud sont à refaire (Rattacher ce poste) si le commerce était rattaché.</p>
    </form>
  );
}
