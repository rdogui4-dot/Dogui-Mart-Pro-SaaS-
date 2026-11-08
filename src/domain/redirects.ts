/** URL de redirection après un paiement Selar : ramène le client à l'écran d'abonnement, formule et période déjà choisies.
 *  Elle n'active rien et ne prouve aucun paiement (elle est publique) : l'activation reste soumise à la validation manuelle. */
import { PERIODS, type Period, type PlanId } from "./subscriptions";

export const REDIRECT_PATH = "/reglages";
/** Valeur affichée tant que le domaine de l'application n'est pas connu : à remplacer avant publication. */
export const PLACEHOLDER_ORIGIN = "https://VOTRE-DOMAINE";

/** Adresse de base (https) de l'application : un domaine, ou un domaine + sous-chemin (GitHub Pages : https://compte.github.io/depot).
 *  Refuse http, les identifiants, la requête et le fragment. Le résultat n'a pas de barre finale. */
export function normalizeAppBase(base: string): string {
  let u: URL; try { u = new URL(base.trim()); } catch { throw new Error("Adresse de l'application invalide"); }
  if (u.protocol !== "https:") throw new Error("L'adresse de l'application doit être en https");
  if (u.username || u.password) throw new Error("L'adresse ne doit pas contenir d'identifiants");
  if (u.search || u.hash) throw new Error("L'adresse ne doit contenir ni « ? » ni « # » (exemple : https://compte.github.io/depot)");
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

/** URL de redirection d'un produit Selar. Selar propose une redirection par produit (donc par formule) : la période, choisie par le client
 *  sur la page Selar, n'est pas connue ici ; `period` n'est ajoutée que pour une adresse construite à la main. */
export function redirectUrl(plan: PlanId, base?: string, period?: Period): string {
  const origin = base ? normalizeAppBase(base) : PLACEHOLDER_ORIGIN;
  return `${origin}${REDIRECT_PATH}?onglet=abonnement&formule=${plan}${period ? `&periode=${period}` : ""}`;
}

export type DeepLink = { tab?: "subscription"; plan?: PlanId; period?: Period };
/** Lit les paramètres d'arrivée. Toute valeur inconnue est ignorée (jamais d'erreur, jamais d'action déclenchée). */
export function parseDeepLink(search: string, planIds: string[]): DeepLink {
  const q = new URLSearchParams(search); const out: DeepLink = {};
  if (q.get("onglet") === "abonnement") out.tab = "subscription";
  const plan = q.get("formule"), period = q.get("periode");
  if (plan && planIds.includes(plan)) out.plan = plan as PlanId;
  if (period && (PERIODS as string[]).includes(period)) out.period = period as Period;
  return out;
}
