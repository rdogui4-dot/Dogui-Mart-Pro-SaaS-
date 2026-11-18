/** Abonnement & Facturation (kit écran 23) : constats MASTER calculés sur l'abonnement réel. Calculs purs, aucune valeur présumée. */
import { PERIOD_DAYS, PERIOD_LABEL, type Entitlement, type Period, type Plan } from "./subscriptions";

export type Usage = { shops: number; users: number; products: number };
export type SubInsight = { id: string; text: string; tone: "ok" | "warn" | "info" };
const fr = (n: number) => Math.round(n).toLocaleString("fr-FR");
const RES = [["shops", "maxShops", "Boutiques"], ["users", "maxUsers", "Utilisateurs"], ["products", "maxProducts", "Produits"]] as const;

/** Prix ramené à 30 jours pour comparer les durées entre elles (sur les tarifs réels de la formule). */
export const perMonth = (p: Plan, period: Period) => (p.prices[period] > 0 ? (p.prices[period] / PERIOD_DAYS[period]) * 30 : null);

/** Durée la plus avantageuse par rapport au mois (économie réelle en %), ou null si aucune durée longue n'est moins chère. */
export function bestLongPeriod(p: Plan): { period: Period; pct: number } | null {
  const m = perMonth(p, "month"); if (!m) return null; let best: { period: Period; pct: number } | null = null;
  for (const k of ["quarter", "year"] as Period[]) { const v = perMonth(p, k); if (!v) continue; const pct = Math.round((1 - v / m) * 100); if (pct > 0 && (!best || pct > best.pct)) best = { period: k, pct }; }
  return best;
}

/** Première formule (dans l'ordre de la plateforme) dont la limite dépasse l'usage actuel pour la ressource donnée. */
function planAbove(plans: Plan[], cur: Plan, key: (typeof RES)[number][1], used: number): Plan | undefined {
  const idx = plans.findIndex((p) => p.id === cur.id);
  return plans.slice(idx + 1).find((p) => p.limits[key] < 0 || p.limits[key] > used);
}

export function subscriptionInsights(e: Entitlement, usage: Usage, plans: Plan[]): SubInsight[] {
  const out: SubInsight[] = [];
  if (e.lifetime) return [{ id: "life", tone: "ok", text: "Accès à vie : aucune échéance ni limite ; aucun paiement n'est nécessaire." }];
  if (e.state === "locked") out.push({ id: "locked", tone: "warn", text: "Abonnement échu : l'accès est suspendu en écriture. Vos données sont conservées ; renouvelez pour reprendre l'activité." });
  else if (e.state === "grace") out.push({ id: "grace", tone: "warn", text: "Abonnement échu : vous êtes dans le délai de grâce. Renouvelez pour éviter la suspension." });
  else if (e.trial) out.push({ id: "trial", tone: e.daysLeft <= 3 ? "warn" : "info", text: `Période d'essai : ${e.daysLeft} jour(s) restant(s). Choisissez une formule avant la fin pour continuer sans interruption.` });
  else if (e.daysLeft <= 7) out.push({ id: "soon", tone: "warn", text: `Échéance dans ${e.daysLeft} jour(s). Le renouvellement est manuel : rien n'est prélevé automatiquement.` });
  for (const [u, k, label] of RES) {
    const max = e.limits[k], used = usage[u]; if (max < 0) continue;
    if (used >= max) { const up = planAbove(plans, e.plan, k, used); out.push({ id: `lim-${u}`, tone: "warn", text: `${label} : ${used} sur ${max}, limite atteinte.${up ? ` La formule ${up.name} en permet ${up.limits[k] < 0 ? "un nombre illimité" : up.limits[k]}.` : ""}` }); }
    else if (max > 0 && used / max >= 0.8) out.push({ id: `near-${u}`, tone: "info", text: `${label} : ${used} sur ${max} (${Math.round((used / max) * 100)} % de la limite).` });
  }
  if (!e.trial && (e.period === "day" || e.period === "week" || e.period === "month")) {
    const b = bestLongPeriod(e.plan); const m = perMonth(e.plan, "month");
    if (b && m) out.push({ id: "saving", tone: "info", text: `Payer en ${PERIOD_LABEL[b.period].toLowerCase()} revient à ${fr(perMonth(e.plan, b.period)!)} F par mois au lieu de ${fr(m)} F (−${b.pct} %), sur les tarifs actuels de la formule ${e.plan.name}.` });
  }
  if (!out.length) out.push({ id: "ok", tone: "ok", text: `Abonnement ${e.plan.name} actif, dans les limites de la formule.` });
  return out;
}

export type Receipt = { reference: string; txRef: string; payerEmail: string; plan: string; planName: string; period: Period; count: number; amount: number; requestedAt: string; startsAt: string; endsAt: string; customer: { name: string; companyName: string; legal: string; address: string; phone: string } };
