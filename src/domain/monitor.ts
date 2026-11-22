/** Moniteur indépendant (SEC-C3-04) : décision pure à partir d'observations. Aucune entrée-sortie ici : tout est testable.
 *  Le moniteur ne détient aucun identifiant Appwrite ; il observe de l'extérieur, comme un visiteur, et compare à ce que le pipeline a publié. */
export type Probe = { reachable: boolean; latencyMs?: number; version?: string; /** ancre du journal de la plateforme ; null = la fonction répond mais pas la base */ journalSeq?: number | null; error?: string };
export type SiteProbe = { reachable: boolean; status?: number; csp?: boolean; version?: string; error?: string };
export type TlsProbe = { host: string; daysLeft: number | null; error?: string };
export type DeployInfo = { latestSuccessSha: string | null; latestSuccessAt: string | null; inProgressSince: string | null };
export type Observation = { at: string; api: Probe; hooks: Probe; site: SiteProbe; tls: TlsProbe[]; deploy: DeployInfo | null; previousSeq: number | null };
export type Alert = { id: string; severity: "warning" | "critical"; title: string; detail: string };

export const GRACE_MIN = 20; export const TLS_WARN_DAYS = 14; export const TLS_CRIT_DAYS = 3; export const SLOW_MS = 8_000;
const mins = (a: string, b: string) => (Date.parse(a) - Date.parse(b)) / 60_000;

/** Alertes à émettre. Une liste vide = tout va bien. Chaque alerte a un identifiant stable (un seul ticket ouvert par identifiant, clos au rétablissement). */
export function decide(o: Observation): Alert[] {
  const out: Alert[] = []; const add = (a: Alert) => out.push(a);
  for (const [id, label, p] of [["api_down", "la fonction dmp-api", o.api], ["hooks_down", "la fonction dmp-hooks (webhook de paiement)", o.hooks]] as const) {
    if (!p.reachable) add({ id, severity: "critical", title: `${label} ne répond pas`, detail: p.error ?? "aucune réponse" });
    else if (p.journalSeq === null) add({ id: id === "api_down" ? "api_db_down" : "hooks_db_down", severity: "critical", title: `${label} répond mais la base Appwrite ne répond pas`, detail: "la lecture du pointeur du journal a échoué" });
    else if ((p.latencyMs ?? 0) > SLOW_MS) add({ id: id === "api_down" ? "api_slow" : "hooks_slow", severity: "warning", title: `${label} répond lentement`, detail: `${Math.round(p.latencyMs!)} ms (seuil ${SLOW_MS} ms)` });
  }
  if (!o.site.reachable || (o.site.status ?? 0) !== 200) add({ id: "site_down", severity: "critical", title: "le site public ne répond pas correctement", detail: o.site.error ?? `statut HTTP ${o.site.status ?? "inconnu"}` });
  else if (o.site.csp === false) add({ id: "site_no_csp", severity: "critical", title: "la politique de sécurité du contenu (CSP) a disparu du site", detail: "la balise Content-Security-Policy n'est plus dans la page d'accueil" });
  // Dérive : ce qui tourne doit être ce que le dernier déploiement réussi a publié (tolérance pendant un déploiement et le temps de propagation).
  const d = o.deploy;
  if (!d || !d.latestSuccessSha) add({ id: "deploy_unknown", severity: "warning", title: "le dernier déploiement réussi est introuvable", detail: "impossible de comparer les versions en ligne à la version publiée" });
  else {
    const deploying = !!d.inProgressSince && mins(o.at, d.inProgressSince) < GRACE_MIN; const fresh = !!d.latestSuccessAt && mins(o.at, d.latestSuccessAt) < GRACE_MIN;
    if (!deploying && !fresh) for (const [id, label, v] of [["drift_api", "dmp-api", o.api.reachable ? o.api.version : undefined], ["drift_hooks", "dmp-hooks", o.hooks.reachable ? o.hooks.version : undefined], ["drift_site", "le site", o.site.reachable ? o.site.version : undefined]] as const)
      if (v !== undefined && v !== d.latestSuccessSha) add({ id, severity: "critical", title: `dérive : ${label} ne tourne pas la version publiée`, detail: `en ligne : ${String(v).slice(0, 12)} · publiée : ${d.latestSuccessSha.slice(0, 12)}` });
  }
  for (const t of o.tls) {
    if (t.daysLeft === null) add({ id: `tls_unknown_${t.host}`, severity: "warning", title: `certificat de ${t.host} illisible`, detail: t.error ?? "lecture impossible" });
    else if (t.daysLeft < TLS_WARN_DAYS) add({ id: `tls_${t.host}`, severity: t.daysLeft < TLS_CRIT_DAYS ? "critical" : "warning", title: `certificat de ${t.host} proche de l'expiration`, detail: `${Math.max(0, Math.floor(t.daysLeft))} jour(s) restant(s)` });
  }
  // Ancre du journal : le numéro de la plateforme ne recule jamais (une troncature totale du journal serait sinon invisible).
  for (const [who, p] of [["dmp-api", o.api], ["dmp-hooks", o.hooks]] as const)
    if (typeof p.journalSeq === "number" && o.previousSeq !== null && p.journalSeq < o.previousSeq) { add({ id: "journal_rewind", severity: "critical", title: "le journal de sécurité de la plateforme a reculé", detail: `${who} : n° ${p.journalSeq} alors que le dernier relevé était n° ${o.previousSeq} (événements supprimés ?)` }); break; }
  if (typeof o.api.journalSeq === "number" && typeof o.hooks.journalSeq === "number" && o.api.journalSeq !== o.hooks.journalSeq)
    add({ id: "journal_mismatch", severity: "warning", title: "les deux fonctions ne lisent pas le même journal", detail: `dmp-api : n° ${o.api.journalSeq} · dmp-hooks : n° ${o.hooks.journalSeq}` });
  return out;
}

/** Ancre à mémoriser pour la prochaine exécution : le plus grand numéro vu (jamais moins que le précédent, pour qu'un recul reste détectable tant qu'il n'est pas résolu). */
export const nextAnchor = (o: Observation): number | null => { const v = [o.api.journalSeq, o.hooks.journalSeq, o.previousSeq].filter((x): x is number => typeof x === "number"); return v.length ? Math.max(...v) : null; };

export const ISSUE_LABEL = "alerte-securite";
export const issueTitle = (id: string, simulation = false) => `${simulation ? "[SIMULATION] " : ""}[Alerte sécurité] ${id}`;
export const issueIdOf = (title: string): { id: string; simulation: boolean } | null => { const m = /^(\[SIMULATION\] )?\[Alerte sécurité\] (.+)$/.exec(title); return m ? { id: m[2]!, simulation: !!m[1] } : null; };

/** Bilan : le moniteur lui-même doit être vivant (SEC-C3-05). Une tâche planifiée peut être retardée ou désactivée sans bruit : trop peu d'exécutions sur la période = moniteur muet. */
export const EXPECTED_PER_HOUR = 4; // une exécution toutes les 15 minutes
export function silentMonitor(runs: number, hours: number): Alert | null {
  const expected = Math.round(hours * EXPECTED_PER_HOUR);
  return runs < expected * 0.5 ? { id: "moniteur_muet", severity: "critical", title: "le moniteur indépendant ne tourne plus normalement", detail: `${runs} exécution(s) en ${hours} h au lieu d'environ ${expected} : la tâche planifiée est peut-être désactivée (dépôt inactif, réglage Actions) ou retardée` } : null;
}
