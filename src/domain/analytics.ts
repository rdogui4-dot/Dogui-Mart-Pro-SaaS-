import { lineTotal, toFcfa } from "./money";
import { methodsOf } from "./reports";
import { addDays, daysIn, dayKeyer } from "./overview";
import { utcToZoned } from "./promotions";

/** Analyses Pro : fonctions PURES (serveur, exports, tests). Jours en heure de l'entreprise. Aucune donnée n'est inventée :
 *  tout indicateur dont une entrée manque vaut `null` et s'accompagne de la raison. Le chiffre d'affaires ne compte que les ventes « paid ». */
export type RawSale = { id: string; number: string; shopId: string; cashierId: string; soldAt: string; status: string; total: number; vat: number; customerId?: string; payments: { method: string; amount: number }[]; lines: { productId: string; name: string; qty: number; unitPrice: number; discountPct?: number; amount?: number; unitCost?: number; variantId?: string }[] };
export type LineFact = { productId: string; name: string; category: string; supplierId: string; qty: number; revenue: number; revenueHt: number; cost: number | null; unitPrice: number; unitCost: number | null };
export type Fact = { saleId: string; number: string; shopId: string; cashierId: string; soldAt: string; day: string; hour: number; total: number; vat: number; methods: Record<string, number>; lines: LineFact[] };
export type Filters = { categories: string[]; articles: string[]; suppliers: string[]; sellers: string[]; shops: string[]; methods: string[] };
export const EMPTY_FILTERS: Filters = { categories: [], articles: [], suppliers: [], sellers: [], shops: [], methods: [] };
export type Ctx = { tz: string; categoryOf: (id: string) => string; supplierOf: (id: string) => string };

/** Aplatit les ventes TERMINÉES en faits (une ligne par ligne de vente, TVA répartie au prorata de la vente). */
export function buildFacts(sales: RawSale[], c: Ctx, status: "paid" | "open" = "paid"): Fact[] {
  const key = dayKeyer(c.tz); const hourCache = new Map<number, number>(); const hourOf = (iso: string) => { const slot = Math.floor(Date.parse(iso) / 300_000); let h = hourCache.get(slot); if (h === undefined) { h = Number(utcToZoned(new Date(slot * 300_000).toISOString(), c.tz).slice(11, 13)); hourCache.set(slot, h); } return h; };
  return sales.filter((s) => (status === "paid" ? s.status === "paid" : s.status === "pending" || s.status === "posted")).map((s) => {
    const ht = s.total > 0 ? (s.total - s.vat) / s.total : 1;
    return { saleId: s.id, number: s.number, shopId: s.shopId, cashierId: s.cashierId, soldAt: s.soldAt, day: key(s.soldAt), hour: hourOf(s.soldAt), total: s.total, vat: s.vat, methods: methodsOf(s),
      lines: s.lines.map((l) => { const rev = lineTotal({ productId: l.productId, name: l.name, unitPrice: l.unitPrice, qty: l.qty, discountPct: l.discountPct, amount: l.amount }); const known = typeof l.unitCost === "number" && l.unitCost > 0;
        return { productId: l.productId, name: l.name, category: c.categoryOf(l.productId) || "Sans catégorie", supplierId: c.supplierOf(l.productId), qty: l.qty, revenue: rev, revenueHt: Math.round(rev * ht), cost: known ? toFcfa(l.qty * l.unitCost!) : null, unitPrice: l.qty > 0 ? rev / l.qty : 0, unitCost: known ? l.unitCost! : null }; }) };
  });
}

const has = (list: string[], v: string) => !list.length || list.includes(v);
/** Applique les filtres. Vente : vendeur, magasin, mode de paiement (au moins un paiement de ce mode). Ligne : catégorie, article, fournisseur.
 *  Si un filtre de ligne est actif, la vente est réduite à ses lignes correspondantes (montants = somme de ces lignes) et disparaît si aucune ne correspond. */
export function applyFilters(facts: Fact[], f: Filters): Fact[] {
  const lineFilter = !!(f.categories.length || f.articles.length || f.suppliers.length);
  return facts.filter((s) => has(f.sellers, s.cashierId) && has(f.shops, s.shopId) && (!f.methods.length || f.methods.some((m) => (s.methods[m] ?? 0) > 0))).map((s) => {
    if (!lineFilter) return s;
    const lines = s.lines.filter((l) => has(f.categories, l.category) && has(f.articles, l.productId) && has(f.suppliers, l.supplierId)); if (!lines.length) return null;
    const rev = lines.reduce((a, l) => a + l.revenue, 0); const ratio = s.total > 0 ? rev / s.lines.reduce((a, l) => a + l.revenue, 0) : 0;
    return { ...s, lines, total: Math.round(s.total * ratio), vat: Math.round(s.vat * ratio), methods: Object.fromEntries(Object.entries(s.methods).map(([m, a]) => [m, Math.round(a * ratio)])) };
  }).filter((s): s is Fact => !!s);
}

export type Totals = {
  count: number; revenue: number; vat: number; revenueHt: number; basket: number; encaisse: number; credit: number; byMethod: Record<string, number>;
  /** Coût des marchandises vendues : null si au moins une ligne n'a pas de coût connu (jamais de coût partiel présenté comme complet). */
  cogs: number | null; margin: number | null; marginRate: number | null; markup: number | null;
  cost: { complete: boolean; linesTotal: number; linesWithoutCost: number; coveragePct: number; costedRevenueHt: number; costedCogs: number; indicativeMargin: number };
};
const r1 = (n: number) => Math.round(n * 10) / 10;
export function totalsOf(facts: Fact[]): Totals {
  let revenue = 0, vat = 0, cogs = 0, noCost = 0, lines = 0, costedHt = 0, costedCogs = 0, revHt = 0; const byMethod: Record<string, number> = {};
  for (const s of facts) { revenue += s.total; vat += s.vat; for (const [m, a] of Object.entries(s.methods)) byMethod[m] = (byMethod[m] ?? 0) + a;
    for (const l of s.lines) { lines++; revHt += l.revenueHt; if (l.cost === null) noCost++; else { cogs += l.cost; costedHt += l.revenueHt; costedCogs += l.cost; } } }
  const credit = byMethod.credit ?? 0; const encaisse = Object.entries(byMethod).filter(([m]) => m !== "credit").reduce((a, [, v]) => a + v, 0);
  const ht = revenue - vat; const complete = facts.length > 0 && noCost === 0; const margin = complete ? ht - cogs : null;
  return { count: facts.length, revenue, vat, revenueHt: ht, basket: facts.length ? Math.round(revenue / facts.length) : 0, encaisse, credit, byMethod, cogs: complete ? cogs : null, margin,
    marginRate: margin !== null && ht > 0 ? r1(margin / ht * 100) : null, markup: margin !== null && cogs > 0 ? r1(margin / cogs * 100) : null,
    cost: { complete, linesTotal: lines, linesWithoutCost: noCost, coveragePct: revHt > 0 ? Math.round(costedHt / revHt * 100) : 100, costedRevenueHt: costedHt, costedCogs, indicativeMargin: costedHt - costedCogs } };
}

export type Gran = "day" | "week" | "month" | "year";
/** Lundi de la semaine d'un jour (AAAA-MM-JJ). */
export const weekStart = (day: string): string => { const d = new Date(`${day}T00:00:00Z`).getUTCDay(); return addDays(day, -((d + 6) % 7)); };
export const bucketOf = (day: string, g: Gran): string => (g === "day" ? day : g === "week" ? weekStart(day) : g === "month" ? day.slice(0, 7) : day.slice(0, 4));
export function bucketsIn(from: string, to: string, g: Gran): string[] { return [...new Set(daysIn(from, to).map((d) => bucketOf(d, g)))]; }
export type SeriesPoint = { key: string; revenue: number; count: number; margin: number | null; cogs: number | null };
export function series(facts: Fact[], range: { from: string; to: string }, g: Gran): SeriesPoint[] {
  const by = new Map<string, Fact[]>(bucketsIn(range.from, range.to, g).map((k) => [k, []])); for (const f of facts) by.get(bucketOf(f.day, g))?.push(f);
  return [...by].map(([key, fs]) => { const t = totalsOf(fs); return { key, revenue: t.revenue, count: t.count, margin: t.margin, cogs: t.cogs }; });
}

export type Group = { key: string; name: string; revenue: number; revenueHt: number; qty: number; tickets: number; cogs: number | null; margin: number | null; marginRate: number | null; markup: number | null; coveragePct: number; indicativeMargin: number; linesWithoutCost: number };
/** Regroupe les lignes par clé (article, catégorie, vendeur, magasin…). Marge connue seulement si toutes les lignes du groupe ont un coût. */
export function groupBy(facts: Fact[], keyOf: (s: Fact, l: LineFact) => { key: string; name: string }): Group[] {
  const m = new Map<string, { name: string; rev: number; ht: number; qty: number; sales: Set<string>; cogs: number; no: number; costedHt: number; costed: number; lines: number }>();
  for (const s of facts) for (const l of s.lines) { const k = keyOf(s, l); const a = m.get(k.key) ?? { name: k.name, rev: 0, ht: 0, qty: 0, sales: new Set(), cogs: 0, no: 0, costedHt: 0, costed: 0, lines: 0 }; a.rev += l.revenue; a.ht += l.revenueHt; a.qty += l.qty; a.sales.add(s.saleId); a.lines++; if (l.cost === null) a.no++; else { a.cogs += l.cost; a.costed += l.cost; a.costedHt += l.revenueHt; } m.set(k.key, a); }
  return [...m].map(([key, a]) => { const complete = a.no === 0; const margin = complete ? a.ht - a.cogs : null;
    return { key, name: a.name, revenue: a.rev, revenueHt: a.ht, qty: a.qty, tickets: a.sales.size, cogs: complete ? a.cogs : null, margin, marginRate: margin !== null && a.ht > 0 ? r1(margin / a.ht * 100) : null, markup: margin !== null && a.cogs > 0 ? r1(margin / a.cogs * 100) : null, coveragePct: a.ht > 0 ? Math.round(a.costedHt / a.ht * 100) : 100, indicativeMargin: a.costedHt - a.costed, linesWithoutCost: a.no }; })
    .sort((x, y) => y.revenue - x.revenue || x.name.localeCompare(y.name));
}
export const byArticle = (f: Fact[]) => groupBy(f, (_s, l) => ({ key: l.productId, name: l.name }));
export const byCategory = (f: Fact[]) => groupBy(f, (_s, l) => ({ key: l.category, name: l.category }));
export const byShop = (f: Fact[], name: (id: string) => string) => groupBy(f, (s) => ({ key: s.shopId, name: name(s.shopId) }));
export const bySeller = (f: Fact[], name: (id: string) => string) => groupBy(f, (s) => ({ key: s.cashierId || "?", name: name(s.cashierId) }));
export function byMethod(facts: Fact[]): { method: string; amount: number; sales: number }[] {
  const m = new Map<string, { amount: number; sales: number }>(); for (const s of facts) for (const [k, a] of Object.entries(s.methods)) { const x = m.get(k) ?? { amount: 0, sales: 0 }; x.amount += a; x.sales++; m.set(k, x); }
  return [...m].map(([method, v]) => ({ method, ...v })).sort((a, b) => b.amount - a.amount);
}
/** Ventes par tranche horaire (0–23, heure de l'entreprise). */
export const byHour = (facts: Fact[]): { hour: number; revenue: number; count: number }[] => Array.from({ length: 24 }, (_, h) => { const fs = facts.filter((f) => f.hour === h); return { hour: h, revenue: fs.reduce((a, f) => a + f.total, 0), count: fs.length }; });

const quantile = (sorted: number[], q: number): number => { if (!sorted.length) return 0; const pos = (sorted.length - 1) * q; const lo = Math.floor(pos), hi = Math.ceil(pos); return Math.round(sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo)); };
/** Analyse du panier : moyenne, médiane, quartiles/déciles observés, articles par ticket (aucun seuil inventé : les tranches viennent des données). */
export function basketStats(facts: Fact[]) {
  const t = facts.map((f) => f.total).sort((a, b) => a - b); const items = facts.map((f) => f.lines.reduce((a, l) => a + l.qty, 0));
  return { count: t.length, avg: t.length ? Math.round(t.reduce((a, b) => a + b, 0) / t.length) : 0, median: quantile(t, 0.5), p10: quantile(t, 0.1), p25: quantile(t, 0.25), p75: quantile(t, 0.75), p90: quantile(t, 0.9), min: t[0] ?? 0, max: t.at(-1) ?? 0, avgItems: items.length ? r1(items.reduce((a, b) => a + b, 0) / items.length) : 0 };
}
/** Variation en % entre deux valeurs ; null si la référence est nulle (pas de pourcentage sur une base de zéro). */
export const delta = (cur: number | null, ref: number | null): number | null => (cur === null || ref === null || ref === 0 ? null : r1((cur - ref) / Math.abs(ref) * 100));

// ---- stocks
/** Rotation = quantités vendues ÷ stock moyen de la période (stock moyen = (ouverture + clôture) ÷ 2, reconstitué depuis les mouvements). null si le stock moyen est nul. */
export const rotation = (soldQty: number, openQty: number, closeQty: number): number | null => { const avg = (Math.max(0, openQty) + Math.max(0, closeQty)) / 2; return avg > 0 ? r1(soldQty / avg) : null; };
/** Couverture estimée (jours) = stock actuel ÷ ventes moyennes par jour sur la fenêtre ; null s'il n'y a eu aucune vente (couverture indéfinie, pas « infinie »). */
export const coverageDays = (stock: number, soldQty: number, days: number): number | null => (soldQty > 0 && days > 0 && stock > 0 ? Math.round(stock / (soldQty / days)) : stock <= 0 ? 0 : null);
export type StockClass = "dormant" | "slow" | "fast" | "normal" | "overstock" | "out";
/** Classement d'un article : rupture (stock ≤ 0) ; dormant (stock sans AUCUNE vente sur la fenêtre) ; surstock (couverture > `overDays`) ; rotation lente (> `slowDays`) ; forte (≤ `fastDays`). */
export function classifyStock(stock: number, soldQty: number, days: number, t: { slowDays: number; fastDays: number; overDays: number }): StockClass {
  if (stock <= 0) return "out"; if (soldQty <= 0) return "dormant"; const c = coverageDays(stock, soldQty, days)!;
  return c > t.overDays ? "overstock" : c > t.slowDays ? "slow" : c <= t.fastDays ? "fast" : "normal";
}
/** Rejoue les mouvements d'un article (triés par date) : épisodes de rupture (passage à ≤ 0) et nombre de jours en rupture dans la fenêtre. */
export function stockoutStats(moves: { at: number; delta: number }[], opening: number, fromMs: number, toMs: number): { episodes: number; daysOut: number } {
  const ev = [...moves].filter((m) => m.at >= fromMs && m.at < toMs).sort((a, b) => a.at - b.at); let q = opening, t = fromMs, out = q <= 0, daysOut = 0, episodes = out ? 1 : 0;
  for (const m of ev) { if (out) daysOut += (m.at - t) / 864e5; t = m.at; q += m.delta; const nowOut = q <= 0; if (nowOut && !out) episodes++; out = nowOut; }
  if (out) daysOut += (toMs - t) / 864e5; return { episodes, daysOut: Math.round(daysOut * 10) / 10 };
}

// ---- prévisions et anomalies
export type Fit = { n: number; slope: number; mean: number; r2: number };
/** Régression linéaire simple sur une série régulière (indice = temps). */
export function linearFit(y: number[]): Fit {
  const n = y.length; if (n < 2) return { n, slope: 0, mean: n ? y[0]! : 0, r2: 0 }; const mx = (n - 1) / 2, my = y.reduce((a, b) => a + b, 0) / n; let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (i - mx) * (y[i]! - my); sxx += (i - mx) ** 2; syy += (y[i]! - my) ** 2; } const slope = sxx ? sxy / sxx : 0; return { n, slope, mean: my, r2: syy ? Math.round((sxy * sxy) / (sxx * syy) * 100) / 100 : 0 };
}
export type Reliability = "insuffisante" | "faible" | "moyenne" | "correcte";
/** Fiabilité d'une prévision : nombre de points, régularité (coefficient de variation) et, pour une tendance, qualité d'ajustement. Jamais « certaine ». */
export function reliability(values: number[], r2?: number): Reliability {
  const n = values.length; if (n < 4) return "insuffisante"; const mean = values.reduce((a, b) => a + b, 0) / n; if (mean <= 0) return "insuffisante";
  const cv = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n) / mean; const score = (n >= 8 ? 1 : 0) + (cv < 0.5 ? 1 : 0) + (r2 !== undefined ? (r2 >= 0.5 ? 1 : 0) : 0);
  return score >= (r2 !== undefined ? 3 : 2) ? "correcte" : score >= 1 ? "moyenne" : "faible";
}
export type TrendKind = "hausse" | "baisse" | "stable" | "indéterminée";
/** Tendance d'une série hebdomadaire : pente rapportée à la moyenne ; « indéterminée » si moins de 4 points ou ajustement très faible. */
export function trendOf(weekly: number[]): { kind: TrendKind; pctPerWeek: number | null; fit: Fit } {
  const fit = linearFit(weekly); if (weekly.length < 4 || fit.mean <= 0) return { kind: "indéterminée", pctPerWeek: null, fit };
  const pct = r1(fit.slope / fit.mean * 100); if (fit.r2 < 0.2) return { kind: "stable", pctPerWeek: pct, fit };
  return { kind: pct >= 5 ? "hausse" : pct <= -5 ? "baisse" : "stable", pctPerWeek: pct, fit };
}
const median = (a: number[]): number => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
/** Variations anormales d'un prix d'achat : chaque observation est comparée à la médiane des observations PRÉCÉDENTES (au moins `minObs`) ; anormale si l'écart dépasse `threshold`, 3 × l'écart absolu médian ET 3 × le coefficient de variation de l'historique. */
export function priceAnomalies(obs: { at: string; price: number; ref?: string }[], o: { minObs?: number; threshold?: number } = {}): { at: string; price: number; ref?: string; baseline: number; deviationPct: number }[] {
  const minObs = o.minObs ?? 3, th = o.threshold ?? 0.15; const s = [...obs].sort((a, b) => a.at.localeCompare(b.at)); const out: { at: string; price: number; ref?: string; baseline: number; deviationPct: number }[] = [];
  for (let i = minObs; i < s.length; i++) { const prev = s.slice(0, i).map((x) => x.price); const base = median(prev); if (base <= 0) continue; const dev = (s[i]!.price - base) / base; const mad = median(prev.map((p) => Math.abs(p - base))) / base; const mean = prev.reduce((a, b) => a + b, 0) / prev.length; const cv = Math.sqrt(prev.reduce((a, b) => a + (b - mean) ** 2, 0) / prev.length) / base;
    if (Math.abs(dev) > th && Math.abs(dev) > 3 * mad && Math.abs(dev) > 3 * cv) out.push({ ...s[i]!, baseline: Math.round(base), deviationPct: r1(dev * 100) }); }
  return out;
}
