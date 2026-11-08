/** Liens de paiement Selar pour les abonnements. Chez Selar, un abonnement est un produit par FORMULE : le client choisit la période
 *  (jour, semaine, mois, trimestre, année) dans une liste sur la page Selar. Il y a donc 3 liens, un par formule. */
import { type Period } from "./subscriptions";

export type SelarLinks = Record<string, string>;

/** Libellé de l'option de période tel que Selar l'affiche (« Chaque month (CFA40 000) ») : l'intervalle y est en anglais. */
export const SELAR_INTERVAL: Record<Period, string> = { day: "day", week: "week", month: "month", quarter: "quarter", year: "year" };
export const selarOptionLabel = (period: Period): string => `Chaque ${SELAR_INTERVAL[period]}`;

/** Hôtes Selar connus. Un autre hôte n'est pas refusé (domaine personnalisé possible) mais signalé à l'administrateur. */
export const isSelarHost = (host: string): boolean => /(^|\.)selar\.(co|com)$/i.test(host);

/** Valide une saisie de liens (clé = identifiant de formule) et la fusionne dans `current`. Valeur vide = suppression. Lève sur toute entrée invalide. */
export function mergeSelarLinks(current: SelarLinks, input: unknown, planIds: string[]): { links: SelarLinks; warnings: string[] } {
  if (input == null || typeof input !== "object" || Array.isArray(input)) throw new Error("Liens invalides");
  const links = { ...current }; const warnings: string[] = [];
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!planIds.includes(key)) throw new Error(`Clé de lien invalide : ${key} (attendu : ${planIds.join(", ")})`);
    if (typeof raw !== "string") throw new Error(`Lien invalide (${key})`);
    const value = raw.trim();
    if (value === "") { delete links[key]; continue; }
    if (value.length > 500) throw new Error(`Lien trop long (${key})`);
    let u: URL; try { u = new URL(value); } catch { throw new Error(`Lien invalide (${key})`); }
    if (u.protocol !== "https:") throw new Error(`Le lien doit être en https (${key})`);
    if (u.username || u.password) throw new Error(`Le lien ne doit pas contenir d'identifiants (${key})`);
    if (!isSelarHost(u.hostname)) warnings.push(`${key} : ${u.hostname} n'est pas un domaine Selar connu — vérifiez le lien`);
    links[key] = u.toString();
  }
  return { links, warnings };
}

export const parseLinks = (raw: unknown): SelarLinks => {
  try { const o = JSON.parse(String(raw || "{}")); return o && typeof o === "object" && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === "string")) as SelarLinks : {}; }
  catch { return {}; }
};
export const isEmail = (s: string): boolean => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(s) && s.length <= 160;
