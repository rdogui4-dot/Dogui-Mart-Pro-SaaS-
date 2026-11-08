import { lineTotal, toFcfa } from "./money";

/** Rapports de ventes : agrégation pure d'une liste de ventes (partagée serveur / tests). */
export type SaleLineRow = { productId: string; name: string; qty: number; unitPrice: number; discountPct?: number; unitCost?: number; amount?: number };
export type SaleRow = { total: number; vat: number; soldAt: string; status: string; payments: { method: string; amount: number }[]; lines: SaleLineRow[] };
export type ProductSales = { key: string; name: string; qty: number; revenueTtc: number };
export type SalesAggregate = {
  count: number; revenueTtc: number; vat: number; revenueHt: number; avgBasket: number;
  /** null si au moins une ligne n'a pas de coût enregistré (ventes antérieures au suivi des coûts) : jamais de marge inventée. */
  cogs: number | null; grossMargin: number | null; marginPct: number | null;
  /** Marge sur les seules lignes dont le coût est connu, et part du chiffre d'affaires qu'elles représentent (100 = marge complète). */
  indicativeMargin: number; costCoveragePct: number; costedRevenueTtc: number; lineRevenueTtc: number;
  byMethod: Record<string, number>; daily: { date: string; revenueTtc: number; count: number }[]; products: ProductSales[];
};

export const DAY_MS = 86_400_000;
const dayOf = (iso: string) => iso.slice(0, 10);
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []; for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10)); return out;
}
/** Clé de regroupement d'un produit entre boutiques : code-barres s'il existe, sinon le nom. */
export const productKey = (name: string, barcode?: string): string => (barcode ? `b:${barcode}` : `n:${name.trim().toLowerCase()}`);

/** Répartition des encaissements : la monnaie rendue n'est pas un encaissement (les paiements sont plafonnés au total). */
export function methodsOf(sale: Pick<SaleRow, "total" | "payments">): Record<string, number> {
  let left = sale.total; const out: Record<string, number> = {};
  for (const p of sale.payments) { const a = Math.min(toFcfa(p.amount), left); if (a <= 0) continue; left -= a; out[p.method] = (out[p.method] ?? 0) + a; }
  return out;
}

export function aggregateSales(rows: SaleRow[], range: { from: string; to: string }, barcodes: Record<string, string> = {}): SalesAggregate {
  const sales = rows.filter((r) => r.status === "paid" && dayOf(r.soldAt) >= range.from && dayOf(r.soldAt) <= range.to);
  const daily = new Map(daysBetween(range.from, range.to).map((d) => [d, { date: d, revenueTtc: 0, count: 0 }]));
  const byMethod: Record<string, number> = {}; const prod = new Map<string, ProductSales>();
  let revenueTtc = 0, vat = 0, cogs = 0, costKnown = true, costedTtc = 0, lineTtc = 0, indicative = 0;
  for (const s of sales) {
    revenueTtc += s.total; vat += s.vat;
    const d = daily.get(dayOf(s.soldAt)); if (d) { d.revenueTtc += s.total; d.count++; }
    for (const [m, a] of Object.entries(methodsOf(s))) byMethod[m] = (byMethod[m] ?? 0) + a;
    const htRatio = s.total > 0 ? (s.total - s.vat) / s.total : 1;
    for (const l of s.lines) {
      const lt = lineTotal({ productId: l.productId, name: l.name, unitPrice: l.unitPrice, qty: l.qty, discountPct: l.discountPct, amount: l.amount });
      lineTtc += lt;
      if (typeof l.unitCost === "number") { cogs += l.qty * l.unitCost; costedTtc += lt; indicative += lt * htRatio - l.qty * l.unitCost; } else costKnown = false;
      const key = productKey(l.name, barcodes[l.productId]); const p = prod.get(key) ?? { key, name: l.name, qty: 0, revenueTtc: 0 };
      p.qty += l.qty; p.revenueTtc += lineTotal({ productId: l.productId, name: l.name, unitPrice: l.unitPrice, qty: l.qty, discountPct: l.discountPct, amount: l.amount }); prod.set(key, p);
    }
  }
  const revenueHt = revenueTtc - vat;
  const margin = costKnown ? revenueHt - toFcfa(cogs) : null;
  return {
    count: sales.length, revenueTtc, vat, revenueHt, avgBasket: sales.length ? Math.round(revenueTtc / sales.length) : 0,
    cogs: costKnown ? toFcfa(cogs) : null, grossMargin: margin, marginPct: margin !== null && revenueHt > 0 ? Math.round((margin / revenueHt) * 1000) / 10 : null,
    indicativeMargin: Math.round(indicative), costedRevenueTtc: costedTtc, lineRevenueTtc: lineTtc, costCoveragePct: lineTtc > 0 ? Math.round((costedTtc / lineTtc) * 100) : 100,
    byMethod, daily: [...daily.values()], products: [...prod.values()].sort((a, b) => b.revenueTtc - a.revenueTtc),
  };
}

/** Somme de plusieurs agrégats (boutiques). La marge n'est connue que si elle l'est pour toutes. */
export function mergeAggregates(list: SalesAggregate[], range: { from: string; to: string }): SalesAggregate {
  const revenueTtc = list.reduce((s, a) => s + a.revenueTtc, 0), vat = list.reduce((s, a) => s + a.vat, 0), count = list.reduce((s, a) => s + a.count, 0);
  const costed = list.reduce((s, a) => s + a.costedRevenueTtc, 0), lines = list.reduce((s, a) => s + a.lineRevenueTtc, 0);
  const known = list.every((a) => a.grossMargin !== null);
  const margin = known ? list.reduce((s, a) => s + (a.grossMargin ?? 0), 0) : null; const revenueHt = revenueTtc - vat;
  const byMethod: Record<string, number> = {}; for (const a of list) for (const [m, v] of Object.entries(a.byMethod)) byMethod[m] = (byMethod[m] ?? 0) + v;
  const daily = daysBetween(range.from, range.to).map((date, i) => ({ date, revenueTtc: list.reduce((s, a) => s + (a.daily[i]?.revenueTtc ?? 0), 0), count: list.reduce((s, a) => s + (a.daily[i]?.count ?? 0), 0) }));
  const prod = new Map<string, ProductSales>();
  for (const a of list) for (const p of a.products) { const c = prod.get(p.key) ?? { ...p, qty: 0, revenueTtc: 0 }; c.qty += p.qty; c.revenueTtc += p.revenueTtc; prod.set(p.key, c); }
  return {
    count, revenueTtc, vat, revenueHt, avgBasket: count ? Math.round(revenueTtc / count) : 0,
    cogs: known ? list.reduce((s, a) => s + (a.cogs ?? 0), 0) : null, grossMargin: margin, marginPct: margin !== null && revenueHt > 0 ? Math.round((margin / revenueHt) * 1000) / 10 : null,
    indicativeMargin: list.reduce((s, a) => s + a.indicativeMargin, 0), costedRevenueTtc: costed, lineRevenueTtc: lines,
    costCoveragePct: lines > 0 ? Math.round((costed / lines) * 100) : 100,
    byMethod, daily, products: [...prod.values()].sort((a, b) => b.revenueTtc - a.revenueTtc),
  };
}

export const MAX_REPORT_DAYS = 92;
/** Valide une période « de ... à ... » (jours UTC, inclusive). Renvoie les bornes ISO pour interroger la base (fin exclusive). */
export function parsePeriod(from: unknown, to: unknown): { ok: true; from: string; to: string; gte: string; lt: string; days: number } | { ok: false; error: string } {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (typeof from !== "string" || typeof to !== "string" || !re.test(from) || !re.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return { ok: false, error: "Période invalide (AAAA-MM-JJ)" };
  if (new Date(from).toISOString().slice(0, 10) !== from || new Date(to).toISOString().slice(0, 10) !== to) return { ok: false, error: "Date inexistante" };
  if (to < from) return { ok: false, error: "La fin précède le début" };
  const days = (Date.parse(to) - Date.parse(from)) / DAY_MS + 1;
  if (days > MAX_REPORT_DAYS) return { ok: false, error: `Période trop longue (${MAX_REPORT_DAYS} jours maximum)` };
  return { ok: true, from, to, gte: `${from}T00:00:00.000Z`, lt: new Date(Date.parse(to) + DAY_MS).toISOString(), days };
}

/** Réponse de l'action serveur `report.consolidated` (partagée avec l'interface et le PDF). */
export type ShopReport = Omit<SalesAggregate, "daily" | "products"> & {
  id: string; name: string; openCredit: number; receivables: number; payables: number;
  stockValue: number | null; stockouts: number | null; truncated: { sales: boolean; stock: boolean };
};
export type ConsolidatedReport = {
  period: { from: string; to: string; days: number; note: string };
  shops: ShopReport[];
  totals: Omit<SalesAggregate, "daily" | "products"> & { openCredit: number; receivables: number; payables: number; stockValue: number | null; stockouts: number | null };
  daily: SalesAggregate["daily"]; topProducts: ProductSales[]; partial: boolean;
};
