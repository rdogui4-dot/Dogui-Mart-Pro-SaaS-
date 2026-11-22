/** Centre de sécurité — logique d'affichage pure (aucune valeur inventée : tout vient de `security.status` et `security.events`). */
import type { CheckState } from "./security-status";
import type { ReportData } from "./exports";

export type StatusTone = "ok" | "info" | "warn" | "bad" | "muted" | "progress";
export const STATE_TONE: Record<CheckState, StatusTone> = { ok: "ok", watch: "warn", critical: "bad", unknown: "muted", na: "muted" };
export const STATE_LABEL: Record<CheckState, string> = { ok: "Conforme", watch: "À surveiller", critical: "Critique", unknown: "Inconnu", na: "Sans objet" };
export const SEVERITY_LABEL: Record<string, string> = { info: "Information", warning: "Avertissement", critical: "Critique" };
export const SEVERITY_TONE: Record<string, StatusTone> = { info: "info", warning: "warn", critical: "bad" };
export const OUTCOME_LABEL: Record<string, string> = { accepted: "Accepté", denied: "Refusé", failed: "Échec" };
export const ROLE_LABEL: Record<string, string> = { owner: "Propriétaire", manager: "Gérant", cashier: "Caissier", stockkeeper: "Magasinier", accountant: "Comptable", viewer: "Consultant", platform: "Plateforme" };

/** Niveau lisible d'un score. Sans score (aucun contrôle mesuré) : jamais de niveau. */
export function levelOf(score: number | null): { label: string; tone: StatusTone } | null {
  if (score === null) return null;
  return score >= 90 ? { label: "Excellent", tone: "ok" } : score >= 75 ? { label: "Bon", tone: "ok" } : score >= 50 ? { label: "À renforcer", tone: "warn" } : { label: "Critique", tone: "bad" };
}

/** Page où traiter chaque constat (liens existants de l'application ; aucun lien vers une page qui n'existe pas). */
export const CHECK_LINK: Record<string, { to: string; onglet?: string; label: string }> = {
  mfa_owner: { to: "/reglages", onglet: "equipe", label: "Voir l'équipe et les comptes" },
  privileges: { to: "/reglages", onglet: "equipe", label: "Voir l'équipe et les rôles" },
  subscription: { to: "/reglages", onglet: "abonnement", label: "Voir l'abonnement" },
  sync: { to: "/reglages", onglet: "synchronisation", label: "Ouvrir la synchronisation" },
  backups: { to: "/reglages", onglet: "sauvegardes", label: "Ouvrir les sauvegardes" },
  conflicts: { to: "/reglages", onglet: "synchronisation", label: "Examiner les constats" },
};

export type EventRow = { seq: number; at: string; kind: string; label: string; severity: string; outcome: string; actorId: string; actorRole: string; target: string; requestId: string; source: string; count: number; lastAt: string };
export type Chain = { ok: boolean; checked: number; fromStart: boolean; problems: string[] };
export const filterEvents = (rows: EventRow[], f: { kind: string; severity: string; q: string }): EventRow[] => {
  const q = f.q.trim().toLowerCase();
  return rows.filter((e) => (!f.kind || e.kind === f.kind) && (!f.severity || e.severity === f.severity) && (!q || `${e.label} ${e.actorId} ${e.target} ${e.requestId}`.toLowerCase().includes(q)));
};
const fr = (iso: string) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "medium", timeZone: "UTC" }) + " UTC";
/** Export du journal : mêmes lignes que l'écran (filtres appliqués), avec l'état de la chaîne en note. Réutilise le format d'export des rapports (CSV, PDF). */
export function journalReport(rows: EventRow[], chain: Chain | null, shown: { kind: string; severity: string; q: string }, now: Date, scope: string): ReportData {
  const day = now.toISOString().slice(0, 10); const f: Record<string, string[]> = {};
  if (shown.kind) f.type = [shown.kind]; if (shown.severity) f.gravite = [SEVERITY_LABEL[shown.severity] ?? shown.severity]; if (shown.q.trim()) f.recherche = [shown.q.trim()];
  const dates = rows.map((r) => r.at).sort();
  return {
    title: "Journal de sécurité", generatedAt: now.toISOString(), tz: "UTC", period: { from: (dates[0] ?? day).slice(0, 10), to: (dates[dates.length - 1] ?? day).slice(0, 10) }, scope: [scope], filters: f,
    notes: [chain ? (chain.ok ? `Chaîne d'empreintes vérifiée : ${chain.checked} événement(s) intacts${chain.fromStart ? " depuis l'origine" : ""}.` : `ATTENTION — chaîne rompue : ${chain.problems.slice(0, 3).join(" ; ")}`) : "Chaîne non vérifiée.", "Aucun texte libre ni donnée personnelle n'est enregistré dans ce journal ; les identifiants sont ceux des comptes.", "Les refus répétés d'un même compte sont regroupés (colonne « Répétitions »)."],
    sections: [{ name: "Événements", columns: ["N°", "Date (UTC)", "Événement", "Gravité", "Résultat", "Acteur", "Rôle", "Cible", "Source", "Répétitions", "Requête"], rows: rows.map((e) => [e.seq, fr(e.at), e.label, SEVERITY_LABEL[e.severity] ?? e.severity, OUTCOME_LABEL[e.outcome] ?? e.outcome, e.actorId || "—", ROLE_LABEL[e.actorRole] ?? (e.actorRole || "—"), e.target || "—", e.source === "poste" ? "Poste" : "Cloud", e.count, e.requestId || "—"]) }],
  } as ReportData;
}
