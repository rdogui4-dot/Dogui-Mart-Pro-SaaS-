/** MASTER DOGUI — santé de l'activité : cinq indicateurs aux règles publiées, et un score sur 100 calculé seulement si au moins 3 indicateurs ont des données.
 *  Bon = 20 points, à surveiller = 10, mauvais = 0 ; score = points obtenus ÷ points possibles × 100 (indicateurs sans données exclus). Aucune valeur n'est présumée. */
export type HState = "ok" | "warn" | "bad";
export type HDim = { key: "sales" | "stock" | "cash" | "charges" | "margin"; label: string; state: HState | null; text: string; rule: string };
export type HealthIn = {
  revenue: number | null; prevRevenue: number | null;
  articles: number | null; out: number | null; low: number | null;
  cashBalance: number | null; payablesSoon: number | null;
  expenses: number | null; prevExpenses: number | null;
  netMarginPct: number | null; prevNetMarginPct: number | null;
};
const pct = (a: number, b: number) => Math.round(((a - b) / Math.abs(b)) * 1000) / 10;
const fr = (n: number) => n.toLocaleString("fr-FR");
export const POINTS: Record<HState, number> = { ok: 20, warn: 10, bad: 0 };
export const STATE_LABEL: Record<HState, string> = { ok: "Bon", warn: "À surveiller", bad: "À traiter" };

export function healthDims(h: HealthIn): HDim[] {
  const sales: HDim = { key: "sales", label: "Ventes", rule: "Chiffre d'affaires du mois comparé au mois précédent : bon au-dessus de −5 %, à surveiller jusqu'à −20 %, à traiter au-delà.", state: null, text: "Pas de mois précédent pour comparer." };
  if (h.revenue !== null && h.prevRevenue !== null && h.prevRevenue > 0) { const d = pct(h.revenue, h.prevRevenue); sales.state = d >= -5 ? "ok" : d >= -20 ? "warn" : "bad"; sales.text = `${d > 0 ? "+" : ""}${fr(d)} % par rapport au mois précédent`; }
  const stock: HDim = { key: "stock", label: "Stocks", rule: "Bon sans rupture et avec moins de 10 % des articles sous le seuil ; à traiter si 10 % des articles ou plus sont en rupture ; sinon à surveiller.", state: null, text: "Aucun article suivi." };
  if (h.articles && h.articles > 0 && h.out !== null && h.low !== null) { const outR = h.out / h.articles, lowR = h.low / h.articles; stock.state = outR >= 0.1 ? "bad" : h.out > 0 || lowR >= 0.1 ? "warn" : "ok"; stock.text = h.out || h.low ? `${h.out} en rupture, ${h.low} sous le seuil (sur ${h.articles})` : `Aucune rupture (sur ${h.articles} articles)`; }
  const cash: HDim = { key: "cash", label: "Trésorerie", rule: "Solde total des comptes financiers : à traiter s'il est négatif, à surveiller s'il ne couvre pas les dettes dues dans les 30 jours, bon sinon.", state: null, text: "Aucun compte financier paramétré." };
  if (h.cashBalance !== null) { const soon = h.payablesSoon ?? 0; cash.state = h.cashBalance < 0 ? "bad" : h.cashBalance < soon ? "warn" : "ok"; cash.text = soon > 0 ? `Solde ${fr(h.cashBalance)} F pour ${fr(soon)} F dus sous 30 jours` : `Solde ${fr(h.cashBalance)} F`; }
  const charges: HDim = { key: "charges", label: "Charges", rule: "Dépenses validées du mois comparées au mois précédent : bon jusqu'à +5 %, à surveiller jusqu'à +20 %, à traiter au-delà.", state: null, text: "Pas de mois précédent pour comparer." };
  if (h.expenses !== null && h.prevExpenses !== null && h.prevExpenses > 0) { const d = pct(h.expenses, h.prevExpenses); charges.state = d <= 5 ? "ok" : d <= 20 ? "warn" : "bad"; charges.text = `${d > 0 ? "+" : ""}${fr(d)} % par rapport au mois précédent`; }
  const margin: HDim = { key: "margin", label: "Rentabilité", rule: "Marge nette du mois : comparée au mois précédent (bon si stable ou en hausse, à surveiller jusqu'à −3 points, à traiter au-delà) ; sans mois précédent, bon si positive, à traiter si négative.", state: null, text: "Marge nette non calculable (coût d'achat inconnu ou dépenses en attente)." };
  if (h.netMarginPct !== null) {
    if (h.prevNetMarginPct !== null) { const d = Math.round((h.netMarginPct - h.prevNetMarginPct) * 10) / 10; margin.state = d >= 0 ? "ok" : d >= -3 ? "warn" : "bad"; margin.text = `${fr(h.netMarginPct)} % (${d >= 0 ? "+" : ""}${fr(d)} pt)`; }
    else { margin.state = h.netMarginPct >= 0 ? "ok" : "bad"; margin.text = `${fr(h.netMarginPct)} %`; }
  }
  return [sales, stock, cash, charges, margin];
}

export function healthScore(dims: HDim[]): { score: number | null; counted: number; label: string | null } {
  const set = dims.filter((d) => d.state !== null); if (set.length < 3) return { score: null, counted: set.length, label: null };
  const score = Math.round((set.reduce((s, d) => s + POINTS[d.state!], 0) / (set.length * 20)) * 100);
  return { score, counted: set.length, label: score >= 80 ? "Très bonne" : score >= 60 ? "Bonne" : score >= 40 ? "Fragile" : "Préoccupante" };
}
