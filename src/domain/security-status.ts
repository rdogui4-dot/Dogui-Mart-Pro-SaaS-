/** État de la sécurité d'un commerce : contrôles MESURÉS, chacun avec sa preuve, l'heure de mesure et sa source.
 *  Règle de base : sans mesure, l'état est « inconnu » — jamais « ok ». Un contrôle qui ne s'applique pas est « sans objet » et ne compte pas.
 *  Le score est calculé par règles visibles (poids de chaque contrôle) sur les seuls contrôles mesurés ; la couverture dit quelle part du total est réellement mesurée. */
export type CheckState = "ok" | "watch" | "critical" | "unknown" | "na";
export type Check = { id: string; title: string; weight: number; state: CheckState; evidence: string; measuredAt: string | null; source: string; advice?: string };
export type StatusInput = {
  now: string;
  /** Propriétaires et leur 2FA ; null = annuaire illisible */
  owners: { userId: string; mfa: boolean | null }[] | null;
  subscription: { status: string; renewsAt?: string } | null;
  /** null = abonnement illisible ; hosted=false : le cloud est la référence */
  host: { hosted: boolean; name?: string } | null;
  /** Mesures vues depuis le poste (absent : lu depuis le cloud) */
  station?: { lastSyncOkAt: string | null; pending: number; sessionOk: boolean; openConflicts: number; alertHours: number } | null;
  backups?: { lastOkAt: string | null; hasBackups: boolean; externalError: string | null } | null;
  /** Événements du journal : refus des 24 dernières heures et total ; null = journal illisible */
  journal: { denied24h: number; total: number } | null;
  chain: { ok: boolean; checked: number; problems: string[]; fromStart: boolean } | null;
};
const H = 3_600_000; const ago = (iso: string | null, now: string) => (iso && !Number.isNaN(Date.parse(iso)) ? (Date.parse(now) - Date.parse(iso)) / H : null);
const mk = (c: Omit<Check, "measuredAt"> & { measuredAt?: string | null }, now: string): Check => ({ ...c, measuredAt: c.state === "unknown" || c.state === "na" ? null : (c.measuredAt ?? now) });

export function evaluateStatus(i: StatusInput): Check[] {
  const now = i.now; const out: Check[] = [];
  // 1. Double authentification des propriétaires
  out.push(mk(!i.owners ? { id: "mfa_owner", title: "Double authentification des propriétaires", weight: 20, state: "unknown", evidence: "Annuaire des comptes illisible : non mesuré.", source: "Annuaire Appwrite" }
    : i.owners.some((o) => o.mfa === null) ? { id: "mfa_owner", title: "Double authentification des propriétaires", weight: 20, state: "unknown", evidence: "La double authentification d'au moins un propriétaire n'est pas mesurable depuis cette machine (elle est gérée par l'annuaire du cloud).", source: "Annuaire Appwrite" }
    : i.owners.length === 0 ? { id: "mfa_owner", title: "Double authentification des propriétaires", weight: 20, state: "unknown", evidence: "Aucun propriétaire trouvé dans l'annuaire.", source: "Annuaire Appwrite" }
    : i.owners.every((o) => o.mfa) ? { id: "mfa_owner", title: "Double authentification des propriétaires", weight: 20, state: "ok", evidence: `Activée pour ${i.owners.length} propriétaire(s) sur ${i.owners.length}.`, source: "Annuaire Appwrite" }
    : { id: "mfa_owner", title: "Double authentification des propriétaires", weight: 20, state: "watch", evidence: `Non activée pour ${i.owners.filter((o) => !o.mfa).length} propriétaire(s) sur ${i.owners.length}.`, source: "Annuaire Appwrite", advice: "Activer la double authentification sur le compte propriétaire." }, now));
  // 2. Abonnement
  { const s = i.subscription; const left = s?.renewsAt ? (Date.parse(s.renewsAt) - Date.parse(now)) / (24 * H) : null;
    out.push(mk(!s ? { id: "subscription", title: "Abonnement", weight: 10, state: "unknown", evidence: "Abonnement illisible : non mesuré.", source: "Abonnement du commerce" }
      : s.status === "expired" ? { id: "subscription", title: "Abonnement", weight: 10, state: "critical", evidence: "Abonnement expiré : les écritures sont suspendues.", source: "Abonnement du commerce", advice: "Renouveler l'abonnement." }
      : s.status === "grace" || (left !== null && left <= 3 && left >= 0) ? { id: "subscription", title: "Abonnement", weight: 10, state: "watch", evidence: s.status === "grace" ? "Abonnement en délai de grâce." : `Échéance dans ${Math.ceil(left!)} jour(s).`, source: "Abonnement du commerce", advice: "Renouveler l'abonnement avant l'échéance." }
      : { id: "subscription", title: "Abonnement", weight: 10, state: "ok", evidence: `Abonnement ${s.status === "trial" ? "en essai" : "actif"}.`, source: "Abonnement du commerce" }, now)); }
  // 3. Synchronisation du poste
  { const w = 15, t = "Synchronisation du poste avec le cloud", src = "Poste Windows";
    if (!i.host) out.push(mk({ id: "sync", title: t, weight: w, state: "unknown", evidence: "État d'hébergement illisible.", source: "Abonnement du commerce" }, now));
    else if (!i.host.hosted) out.push(mk({ id: "sync", title: t, weight: w, state: "na", evidence: "Le cloud est la référence : pas de poste à synchroniser.", source: "Abonnement du commerce" }, now));
    else if (!i.station) out.push(mk({ id: "sync", title: t, weight: w, state: "unknown", evidence: `Le poste « ${i.host.name ?? "?"} » héberge le commerce ; sa synchronisation n'est visible que depuis ce poste.`, source: src }, now));
    else { const hrs = ago(i.station.lastSyncOkAt, now); const lim = Math.max(1, i.station.alertHours);
      out.push(mk(hrs === null ? { id: "sync", title: t, weight: w, state: "critical", evidence: "Aucune synchronisation réussie enregistrée.", source: src, advice: "Lancer « Synchroniser maintenant » sur le poste." }
        : hrs > lim * 3 ? { id: "sync", title: t, weight: w, state: "critical", evidence: `Dernière synchronisation réussie il y a ${Math.round(hrs)} h (seuil ${lim} h).`, source: src, advice: "Vérifier Internet et la session cloud du poste." }
        : hrs > lim || !i.station.sessionOk || i.station.pending > 0 && hrs > 1 ? { id: "sync", title: t, weight: w, state: "watch", evidence: `Dernière synchronisation réussie il y a ${Math.round(hrs)} h ; ${i.station.pending} élément(s) en attente${i.station.sessionOk ? "" : " ; session cloud expirée"}.`, source: src, advice: "Lancer « Synchroniser maintenant » ou reconnecter le poste au cloud." }
        : { id: "sync", title: t, weight: w, state: "ok", evidence: `Dernière synchronisation réussie il y a ${Math.max(0, Math.round(hrs))} h ; ${i.station.pending} élément(s) en attente.`, source: src }, now)); } }
  // 4. Sauvegardes du poste
  { const w = 20, t = "Sauvegardes du poste", src = "Poste Windows";
    if (!i.backups) out.push(mk({ id: "backups", title: t, weight: w, state: "unknown", evidence: "Les sauvegardes ne sont visibles que depuis le poste Windows ; aucune sauvegarde du cloud n'est mesurable par l'application.", source: src }, now));
    else { const hrs = ago(i.backups.lastOkAt, now);
      out.push(mk(!i.backups.hasBackups || hrs === null ? { id: "backups", title: t, weight: w, state: "critical", evidence: "Aucune sauvegarde valide.", source: src, advice: "Lancer « Sauvegarder maintenant »." }
        : hrs > 24 * 7 ? { id: "backups", title: t, weight: w, state: "critical", evidence: `Dernière sauvegarde valide il y a ${Math.round(hrs / 24)} jours.`, source: src, advice: "Vérifier les sauvegardes automatiques." }
        : hrs > 48 || i.backups.externalError ? { id: "backups", title: t, weight: w, state: "watch", evidence: hrs > 48 ? `Dernière sauvegarde valide il y a ${Math.round(hrs)} h.` : `Copie externe en échec : ${i.backups.externalError}`, source: src, advice: hrs > 48 ? "Lancer une sauvegarde." : "Reconnecter le dossier ou la clé de copie externe." }
        : { id: "backups", title: t, weight: w, state: "ok", evidence: `Dernière sauvegarde valide il y a ${Math.round(hrs)} h.`, source: src }, now)); } }
  // 5. Constats de synchronisation
  { const w = 5, t = "Constats de synchronisation à examiner", src = "Poste Windows";
    if (!i.host) out.push(mk({ id: "conflicts", title: t, weight: w, state: "unknown", evidence: "État d'hébergement illisible.", source: src }, now));
    else if (!i.host.hosted) out.push(mk({ id: "conflicts", title: t, weight: w, state: "na", evidence: "Sans objet : pas de poste.", source: src }, now));
    else if (!i.station) out.push(mk({ id: "conflicts", title: t, weight: w, state: "unknown", evidence: "Visible depuis le poste.", source: src }, now));
    else out.push(mk(i.station.openConflicts === 0 ? { id: "conflicts", title: t, weight: w, state: "ok", evidence: "Aucun constat en attente.", source: src } : { id: "conflicts", title: t, weight: w, state: "watch", evidence: `${i.station.openConflicts} constat(s) à examiner.`, source: src, advice: "Ouvrir Paramètres → Synchronisation → Constats." }, now)); }
  // 6. Refus d'accès récents (membres du commerce)
  out.push(mk(!i.journal ? { id: "denials", title: "Refus d'accès (24 h)", weight: 10, state: "unknown", evidence: "Journal illisible : non mesuré.", source: "Journal de sécurité" }
    : i.journal.denied24h >= 100 ? { id: "denials", title: "Refus d'accès (24 h)", weight: 10, state: "critical", evidence: `${i.journal.denied24h} refus en 24 h.`, source: "Journal de sécurité", advice: "Examiner le journal : un compte insiste sur des actions interdites." }
    : i.journal.denied24h >= 20 ? { id: "denials", title: "Refus d'accès (24 h)", weight: 10, state: "watch", evidence: `${i.journal.denied24h} refus en 24 h.`, source: "Journal de sécurité", advice: "Examiner le journal." }
    : { id: "denials", title: "Refus d'accès (24 h)", weight: 10, state: "ok", evidence: `${i.journal.denied24h} refus en 24 h.`, source: "Journal de sécurité" }, now));
  // 7. Continuité du journal
  out.push(mk(!i.chain || !i.journal ? { id: "journal_chain", title: "Intégrité du journal de sécurité", weight: 20, state: "unknown", evidence: "Journal illisible : non vérifié.", source: "Journal de sécurité" }
    : i.journal.total === 0 ? { id: "journal_chain", title: "Intégrité du journal de sécurité", weight: 20, state: "unknown", evidence: "Aucun événement enregistré : rien à vérifier.", source: "Journal de sécurité" }
    : i.chain.ok ? { id: "journal_chain", title: "Intégrité du journal de sécurité", weight: 20, state: "ok", evidence: `${i.chain.checked} événement(s) vérifié(s)${i.chain.fromStart ? " depuis l'origine" : " depuis le premier événement conservé"} : chaîne intacte.`, source: "Journal de sécurité" }
    : { id: "journal_chain", title: "Intégrité du journal de sécurité", weight: 20, state: "critical", evidence: `Rupture de chaîne : ${i.chain.problems[0] ?? "anomalie"}`, source: "Journal de sécurité", advice: "Le journal a été modifié ou des événements ont été supprimés : contacter l'administrateur de la plateforme." }, now));
  return out;
}

const VALUE: Record<CheckState, number | null> = { ok: 1, watch: 0.5, critical: 0, unknown: null, na: null };
export type Score = { score: number | null; measured: number; unknown: number; total: number; /** part du poids total réellement mesurée, 0–100 */ coverage: number };
/** Score = moyenne pondérée des contrôles MESURÉS (ok 100 %, à surveiller 50 %, critique 0). Aucun contrôle mesuré : pas de score. */
export function scoreOf(checks: Check[]): Score {
  const live = checks.filter((c) => c.state !== "na"); const measured = live.filter((c) => VALUE[c.state] !== null);
  const w = measured.reduce((s, c) => s + c.weight, 0); const tw = live.reduce((s, c) => s + c.weight, 0);
  return { score: measured.length ? Math.round(measured.reduce((s, c) => s + c.weight * (VALUE[c.state] as number), 0) / w * 100) : null, measured: measured.length, unknown: live.length - measured.length, total: live.length, coverage: tw ? Math.round(w / tw * 100) : 0 };
}
/** Ce que l'application NE PEUT PAS mesurer (réglages de la console Appwrite) : affiché tel quel, jamais présenté comme « ok ». */
export const UNMEASURED = [
  "Politique de mots de passe et durée des sessions : réglages de la console Appwrite, non lisibles depuis l'application.",
  "Sauvegardes du cloud (Appwrite) : non mesurables par l'application.",
  "Connexions échouées : gérées par Appwrite, hors de notre code.",
] as const;
