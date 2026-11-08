/** Liens de paiement Selar pour les abonnements. Un lien Selar est une offre à prix fixe : il faut donc un lien par couple (formule, période). */
import { PERIODS, type Period } from "./subscriptions";

export const linkKey = (plan: string, period: Period): string => `${plan}:${period}`;
export type SelarLinks = Record<string, string>;

/** Hôtes Selar connus. Un autre hôte n'est pas refusé (domaine personnalisé possible) mais signalé à l'administrateur. */
export const isSelarHost = (host: string): boolean => /(^|\.)selar\.(co|com)$/i.test(host);

/** Valide une saisie de liens et la fusionne dans `current`. Valeur vide = suppression du lien. Lève sur toute entrée invalide. */
export function mergeSelarLinks(current: SelarLinks, input: unknown, planIds: string[]): { links: SelarLinks; warnings: string[] } {
  if (input == null || typeof input !== "object" || Array.isArray(input)) throw new Error("Liens invalides");
  const links = { ...current }; const warnings: string[] = [];
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    const [plan, period] = key.split(":");
    if (!plan || !planIds.includes(plan) || !PERIODS.includes(period as Period) || key.split(":").length !== 2) throw new Error(`Clé de lien invalide : ${key}`);
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
