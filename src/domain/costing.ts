/** Coûts, marges et fournisseurs (Pro). Tout est en FCFA entiers, calculé de façon déterministe côté serveur et affiché par l'appli avec le même code. */
import { lineTotal, toFcfa } from "./money";

/** Méthode de valorisation du stock : UNE par boutique (jamais deux méthodes sur un même périmètre). Le changement s'applique aux réceptions suivantes ;
 *  les ventes passées gardent le coût figé dans leurs lignes. */
export const COST_METHODS = [
  { id: "cmup", label: "Coût moyen pondéré (CMUP)", help: "À chaque réception, le coût est la moyenne pondérée du stock existant et des quantités reçues." },
  { id: "last", label: "Dernier prix d'achat", help: "Le coût est celui de la dernière réception (frais d'approvisionnement inclus)." },
] as const;
export type CostMethod = (typeof COST_METHODS)[number]["id"];
export const isCostMethod = (m: unknown): m is CostMethod => COST_METHODS.some((x) => x.id === m);
export const methodLabel = (m?: string): string => COST_METHODS.find((x) => x.id === m)?.label ?? COST_METHODS[0].label;

/** Marge brute, taux de marge (marge / coût d'achat) et taux de marque (marge / prix de vente). null quand la base du ratio est nulle. */
export function marginStats(price: number, cost: number): { amount: number; markupPct: number | null; markPct: number | null } {
  const amount = price - cost, r = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
  return { amount, markupPct: r(amount, cost), markPct: r(amount, price) };
}

/** Répartit des frais (FCFA entiers) au prorata des valeurs ; la somme des parts est EXACTEMENT le total (plus forts restes). */
export function allocateFees(values: number[], total: number): number[] {
  if (!values.length) return [];
  const sum = values.reduce((a, b) => a + b, 0);
  const raw = values.map((v) => (sum > 0 ? (total * v) / sum : total / values.length));
  const parts = raw.map(Math.floor); let left = total - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, rem: r - Math.floor(r) })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const o of order) { if (left <= 0) break; parts[o.i]! += 1; left--; }
  return parts;
}
/** Coût de revient unitaire d'une ligne reçue : (valeur + frais proportionnels + part des frais de la réception) / quantité, arrondi au franc. */
export const landedUnitCost = (value: number, qty: number, pctFees: number, allocatedFees: number): number => (qty > 0 ? toFcfa((value + pctFees + allocatedFees) / qty) : 0);

/** Nouveau coût de l'article après une réception, selon la méthode de la boutique. */
export function nextCost(method: CostMethod, stock: number, cost: number, qty: number, landedUnit: number): number {
  if (method === "last") return toFcfa(landedUnit);
  const base = Math.max(0, stock), total = base + qty;
  return total > 0 ? toFcfa((base * cost + qty * landedUnit) / total) : toFcfa(landedUnit);
}

export type Offer = { id: string; price: number; feePct?: number; leadDays?: number; minQty?: number; status?: string };
/** Prix d'achat chez un fournisseur, frais proportionnels compris. */
export const effectivePrice = (o: Pick<Offer, "price" | "feePct">): number => Math.round(o.price * (1 + (o.feePct ?? 0) / 100) * 100) / 100;
/** Classe les offres actives : prix effectif, puis délai, puis quantité minimale. La première est la plus avantageuse. Les offres inactives suivent, sans rang. */
export function rankOffers<T extends Offer>(offers: T[]): (T & { effective: number; best: boolean; rank: number | null })[] {
  const act = offers.filter((o) => o.status !== "inactive").map((o) => ({ ...o, effective: effectivePrice(o) }))
    .sort((a, b) => a.effective - b.effective || (a.leadDays ?? 9999) - (b.leadDays ?? 9999) || (a.minQty ?? 0) - (b.minQty ?? 0) || a.id.localeCompare(b.id));
  const off = offers.filter((o) => o.status === "inactive").map((o) => ({ ...o, effective: effectivePrice(o), best: false, rank: null }));
  return [...act.map((o, i) => ({ ...o, best: i === 0, rank: i + 1 })), ...off];
}

// ---------------------------------------------------------------- rentabilité
export type ProfitLine = { productId: string; variantId?: string; name: string; qty: number; unitPrice: number; discountPct?: number; unitCost?: number; amount?: number };
export type ProfitSale = { total: number; vat: number; status: string; soldAt: string; lines: ProfitLine[] };
export type ProfitRow = { key: string; productId: string; variantId?: string; name: string; category: string; qty: number; revenueHt: number; cogs: number; margin: number; marginPct: number | null; markupPct: number | null; costedPct: number };
const roundPct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

/** Rentabilité par article (ou variante) et par catégorie. Le CA est hors TVA ; la marge ne porte que sur les lignes dont le coût est connu (`costedPct` = part du CA couverte) : jamais de marge inventée. */
export function aggregateProfit(sales: ProfitSale[], range: { from: string; to: string }, info: Record<string, { category?: string; name?: string }>): { items: ProfitRow[]; categories: ProfitRow[] } {
  type Acc = { key: string; productId: string; variantId?: string; name: string; category: string; qty: number; revenueHt: number; costedRev: number; cogs: number };
  const items = new Map<string, Acc>(), cats = new Map<string, Acc>();
  for (const s of sales) {
    const d = s.soldAt.slice(0, 10); if (s.status !== "paid" || d < range.from || d > range.to) continue;
    const htRatio = s.total > 0 ? (s.total - s.vat) / s.total : 1;
    for (const l of s.lines) {
      const ht = lineTotal({ productId: l.productId, name: l.name, unitPrice: l.unitPrice, qty: l.qty, discountPct: l.discountPct, amount: l.amount }) * htRatio;
      const category = info[l.productId]?.category || "Sans catégorie"; const key = `${l.productId}:${l.variantId ?? ""}`;
      for (const [map, k, name] of [[items, key, l.name], [cats, category, category]] as const) {
        const a = map.get(k) ?? { key: k, productId: l.productId, variantId: l.variantId, name, category, qty: 0, revenueHt: 0, costedRev: 0, cogs: 0 };
        a.qty += l.qty; a.revenueHt += ht;
        if (typeof l.unitCost === "number") { a.costedRev += ht; a.cogs += l.qty * l.unitCost; }
        map.set(k, a);
      }
    }
  }
  const out = (a: Acc): ProfitRow => { const margin = Math.round(a.costedRev - a.cogs), rev = Math.round(a.revenueHt); return { key: a.key, productId: a.productId, variantId: a.variantId, name: a.name, category: a.category, qty: Math.round(a.qty * 1000) / 1000, revenueHt: rev, cogs: Math.round(a.cogs), margin, marginPct: roundPct(margin, Math.round(a.costedRev)), markupPct: roundPct(margin, Math.round(a.cogs)), costedPct: a.revenueHt > 0 ? Math.round((a.costedRev / a.revenueHt) * 100) : 100 }; };
  const byMargin = (a: ProfitRow, b: ProfitRow) => b.margin - a.margin || a.name.localeCompare(b.name);
  return { items: [...items.values()].map(out).sort(byMargin), categories: [...cats.values()].map(out).sort(byMargin) };
}
