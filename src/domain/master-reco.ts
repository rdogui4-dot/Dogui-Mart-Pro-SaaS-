/** MASTER DOGUI : moteur de recommandations suivies (cahier §8). Domaine pur : cycle de vie, règles, seuils, mesure du suivi.
 *  Aucune promesse de résultat ; l'évolution mesurée n'est jamais attribuée à l'action. */
export type RStatus = "new" | "accepted" | "refused" | "snoozed" | "doing" | "done" | "noeffect";
export const STATUS_LABEL: Record<RStatus, string> = { new: "Nouvelle", accepted: "Acceptée", refused: "Refusée", snoozed: "Reportée", doing: "En cours", done: "Réalisée", noeffect: "Sans effet mesurable" };
/** Transitions autorisées (le serveur les applique). « refused », « done » et « noeffect » sont terminaux : une refusée n'est recréée que par de nouveaux faits (nouvelle empreinte). */
export const NEXT: Record<RStatus, RStatus[]> = { new: ["accepted", "refused", "snoozed"], snoozed: ["new", "accepted", "refused"], accepted: ["doing", "done", "noeffect"], doing: ["done", "noeffect"], refused: [], done: [], noeffect: [] };
export const canMove = (from: string, to: string): boolean => (NEXT[from as RStatus] ?? []).includes(to as RStatus);
export type Prio = "critical" | "high" | "medium" | "opportunity" | "info";
export const PRIO_RANK: Record<Prio, number> = { critical: 0, high: 1, medium: 2, opportunity: 3, info: 4 };
export type Conf = "high" | "medium" | "low";
export const CONF_LABEL: Record<Conf, string> = { high: "Confiance élevée", medium: "Confiance moyenne", low: "Confiance faible" };
export type Rule = { id: string; label: string; module: string; theme: string; pro: boolean; need: string };
/** Règles initiales (liste fermée, déterministes). `theme` relie la règle aux priorités du profil (réordonnancement seul). */
export const RULES: Rule[] = [
  { id: "stock_out", label: "Rupture ou stock négatif", module: "Stock", theme: "stock", pro: false, need: "Au moins un article avec du mouvement ou un seuil défini" },
  { id: "replenish", label: "Réapprovisionnement conseillé", module: "Stock Pro", theme: "stock", pro: true, need: "Historique de ventes suffisant pour chaque article (calculé par le module Stock Pro)" },
  { id: "cash_variance", label: "Écarts de caisse répétés", module: "Caisse", theme: "tresorerie", pro: false, need: "Au moins 5 sessions clôturées sur la période" },
  { id: "expenses", label: "Dépenses à contrôler", module: "Dépenses Pro", theme: "depenses", pro: true, need: "Historique de dépenses suffisant (calculé par le module Dépenses Pro)" },
  { id: "client_credit", label: "Encours client au plafond", module: "Clients", theme: "tresorerie", pro: false, need: "Clients avec un plafond de crédit défini" },
  { id: "po_late", label: "Commandes fournisseurs en retard", module: "Achats", theme: "fournisseurs", pro: false, need: "Commandes avec date de livraison prévue" },
  { id: "promo", label: "Suggestions promotionnelles", module: "Promotions Pro", theme: "volume", pro: true, need: "60 jours de ventes (calculé par le module Promotions Pro)" },
  { id: "report", label: "Recommandation d'un rapport MASTER", module: "Rapports MASTER", theme: "", pro: false, need: "Rapport d'ouverture ou de clôture généré" },
];
export const ruleOf = (id: string): Rule | undefined => RULES.find((r) => r.id === id);
/** Seuils paramétrables par l'entreprise (valeurs par défaut documentées). */
export type RecoCfg = { snoozeDays: number; followDays: number; cashWindowDays: number; cashMinSessions: number; cashVarianceCount: number; creditPct: number };
export const DEFAULT_CFG: RecoCfg = { snoozeDays: 7, followDays: 14, cashWindowDays: 30, cashMinSessions: 5, cashVarianceCount: 3, creditPct: 90 };
export const CFG_HELP: Record<keyof RecoCfg, { label: string; min: number; max: number }> = {
  snoozeDays: { label: "Report par défaut (jours)", min: 1, max: 60 }, followDays: { label: "Délai de suivi après acceptation (jours)", min: 3, max: 90 }, cashWindowDays: { label: "Fenêtre d'analyse des écarts de caisse (jours)", min: 7, max: 90 },
  cashMinSessions: { label: "Sessions minimum pour analyser les écarts", min: 3, max: 50 }, cashVarianceCount: { label: "Nombre d'écarts hors tolérance pour alerter", min: 2, max: 30 }, creditPct: { label: "Encours client signalé à partir de (% du plafond)", min: 50, max: 100 },
};
export function normalizeCfg(raw: unknown): { ok: true; cfg: RecoCfg } | { ok: false; error: string } {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>; const cfg = { ...DEFAULT_CFG };
  for (const k of Object.keys(CFG_HELP) as (keyof RecoCfg)[]) { if (src[k] === undefined || src[k] === "") continue; const n = Number(src[k]); const h = CFG_HELP[k]; if (!Number.isInteger(n) || n < h.min || n > h.max) return { ok: false, error: `${h.label} : entier entre ${h.min} et ${h.max}` }; cfg[k] = n; }
  return { ok: true, cfg };
}
export const cfgFrom = (raw: unknown): RecoCfg => { try { const r = normalizeCfg(typeof raw === "string" ? JSON.parse(raw) : raw); return r.ok ? r.cfg : DEFAULT_CFG; } catch { return DEFAULT_CFG; } };
/** Mesure suivie par une règle : un compteur dont la baisse est favorable. Texte factuel, sans causalité ni promesse. */
export type Measure = { label: string; value: number };
export function outcomeText(before: Measure | null, after: { value: number; at: string } | null, beforeAt: string | null): string {
  if (!before || !after) return "Aucune mesure comparable pour cette recommandation.";
  const d = (s: string | null) => (s ? new Date(s).toLocaleDateString("fr-FR") : "—"); const diff = after.value - before.value;
  const trend = diff === 0 ? "inchangé" : diff < 0 ? `en baisse de ${-diff}` : `en hausse de ${diff}`;
  return `${before.label} : ${before.value} le ${d(beforeAt)} -> ${after.value} le ${d(after.at)} (${trend}). Évolution observée entre deux dates ; elle n'est pas attribuée à cette action.`;
}
export const followDue = (acceptedAt: string | null, followDays: number, now = Date.now()): boolean => !!acceptedAt && now - Date.parse(acceptedAt) >= followDays * 864e5;
/** Ordre d'affichage : priorité, puis thème prioritaire du profil (réordonnancement seul), puis ancienneté. */
export function sortRecos<T extends { prio: Prio; ruleId: string; createdAt: string }>(rows: T[], profilePriorities: string[]): T[] {
  const boost = (r: T) => { const t = ruleOf(r.ruleId)?.theme ?? ""; const i = t ? profilePriorities.indexOf(t) : -1; return i < 0 ? 99 : i; };
  return [...rows].sort((a, b) => PRIO_RANK[a.prio] - PRIO_RANK[b.prio] || boost(a) - boost(b) || a.createdAt.localeCompare(b.createdAt));
}
