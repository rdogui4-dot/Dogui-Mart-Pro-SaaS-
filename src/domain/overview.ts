import { lineTotal, toFcfa } from "./money";
import { methodsOf } from "./reports";
import { utcToZoned, zonedToUtc } from "./promotions";

/** Tableau de bord Business : agrégations pures (serveur et tests). Jours en HEURE DE L'ENTREPRISE ; seules les ventes « paid » comptent (une vente
 *  annulée, en attente ou non finalisée n'est jamais du chiffre d'affaires). Aucun remboursement ni annulation n'existant dans l'application, rien n'est « déduit » à ce titre. */
export const PRESETS = [{ id: "today", label: "Aujourd'hui" }, { id: "yesterday", label: "Hier" }, { id: "last7", label: "7 derniers jours" }, { id: "last30", label: "30 derniers jours" }, { id: "month", label: "Ce mois" }, { id: "lastMonth", label: "Mois précédent" }, { id: "custom", label: "Période personnalisée" }] as const;
export type PresetId = (typeof PRESETS)[number]["id"];
export const MAX_RANGE_DAYS = 92;

const DAY = 86_400_000;
export const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const monthStart = (day: string): string => `${day.slice(0, 8)}01`;
export const daysIn = (from: string, to: string): string[] => { const out: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
export const todayIn = (now: Date, tz: string): string => utcToZoned(now.toISOString(), tz).slice(0, 10);

export type Period = { preset: PresetId; label: string; from: string; to: string; days: number };
/** Période choisie, en jours calendaires de l'entreprise (bornes incluses). */
export function resolvePeriod(preset: unknown, today: string, custom?: { from?: unknown; to?: unknown }, maxDays: number = MAX_RANGE_DAYS): { ok: true; period: Period } | { ok: false; error: string } {
  const p = (PRESETS.find((x) => x.id === preset)?.id ?? "last30") as PresetId; let from = today, to = today;
  if (p === "yesterday") from = to = addDays(today, -1); else if (p === "last7") from = addDays(today, -6); else if (p === "last30") from = addDays(today, -29);
  else if (p === "month") from = monthStart(today); else if (p === "lastMonth") { to = addDays(monthStart(today), -1); from = monthStart(to); }
  else if (p === "custom") { if (!isDay(custom?.from) || !isDay(custom?.to)) return { ok: false, error: "Période personnalisée : dates invalides" }; from = custom.from; to = custom.to; if (to < from) return { ok: false, error: "La fin précède le début" }; if (to > today) to = today; if (from > to) return { ok: false, error: "La période est dans le futur" }; }
  const days = daysIn(from, to).length; if (days > maxDays) return { ok: false, error: `Période de ${maxDays} jours au maximum` };
  return { ok: true, period: { preset: p, label: PRESETS.find((x) => x.id === p)!.label, from, to, days } };
}
/** Bornes UTC [gte, lt[ d'une plage de jours de l'entreprise. */
export const boundsOf = (from: string, to: string, tz: string): { gte: string; lt: string } => ({ gte: zonedToUtc(`${from}T00:00`, tz), lt: zonedToUtc(`${addDays(to, 1)}T00:00`, tz) });

/** Jour de l'entreprise d'un instant ; mis en cache par tranche de 5 minutes (les changements de jour des fuseaux tombent sur des multiples de 15 min : le résultat est exact). */
export function dayKeyer(tz: string): (iso: string) => string {
  const cache = new Map<string, string>();
  return (iso) => { const t = Date.parse(iso); const slot = Math.floor(t / 300_000); let d = cache.get(String(slot)); if (!d) { d = utcToZoned(new Date(slot * 300_000).toISOString(), tz).slice(0, 10); cache.set(String(slot), d); } return d; };
}

export type SaleIn = { id?: string; number?: string; total: number; vat: number; soldAt: string; status: string; payments: { method: string; amount: number }[]; lines: { productId: string; name: string; qty: number; unitPrice: number; discountPct?: number; amount?: number; unitCost?: number }[] };
export type Summary = {
  count: number; revenue: number; vat: number; avgBasket: number; byMethod: Record<string, number>; encaisse: number; credit: number;
  daily: { date: string; revenue: number; count: number }[]; top: { key: string; name: string; qty: number; revenue: number }[]; byCategory: { category: string; revenue: number; qty: number }[];
  margin: { known: boolean; amount: number | null; pct: number | null; linesWithoutCost: number; coveragePct: number; indicative: number };
};
/** Agrège les ventes payées d'une plage de jours (heure de l'entreprise). `categoryOf` : catégorie ACTUELLE de l'article (les ventes n'en gardent pas). */
export function summarize(rows: SaleIn[], range: { from: string; to: string }, tz: string, categoryOf: (productId: string) => string = () => ""): Summary {
  const key = dayKeyer(tz); const sales = rows.filter((r) => r.status === "paid" && key(r.soldAt) >= range.from && key(r.soldAt) <= range.to);
  const daily = new Map(daysIn(range.from, range.to).map((d) => [d, { date: d, revenue: 0, count: 0 }])); const byMethod: Record<string, number> = {}; const prod = new Map<string, { key: string; name: string; qty: number; revenue: number }>(); const cat = new Map<string, { category: string; revenue: number; qty: number }>();
  let revenue = 0, vat = 0, cogs = 0, noCost = 0, lineAll = 0, lineCosted = 0, indicative = 0;
  for (const s of sales) {
    revenue += s.total; vat += s.vat; const d = daily.get(key(s.soldAt))!; d.revenue += s.total; d.count++;
    for (const [m, a] of Object.entries(methodsOf(s))) byMethod[m] = (byMethod[m] ?? 0) + a; // paiements fractionnés : chaque encaissement compté une fois, monnaie rendue exclue
    const ht = s.total > 0 ? (s.total - s.vat) / s.total : 1;
    for (const l of s.lines) {
      const lt = lineTotal({ productId: l.productId, name: l.name, unitPrice: l.unitPrice, qty: l.qty, discountPct: l.discountPct, amount: l.amount }); lineAll += lt;
      if (typeof l.unitCost === "number" && l.unitCost > 0) { cogs += l.qty * l.unitCost; lineCosted += lt; indicative += lt * ht - l.qty * l.unitCost; } else noCost++;
      const k = l.productId; const p = prod.get(k) ?? { key: k, name: l.name, qty: 0, revenue: 0 }; p.qty += l.qty; p.revenue += lt; prod.set(k, p);
      const c = categoryOf(l.productId) || "Sans catégorie"; const cc = cat.get(c) ?? { category: c, revenue: 0, qty: 0 }; cc.revenue += lt; cc.qty += l.qty; cat.set(c, cc);
    }
  }
  const ratio = lineAll > 0 ? Math.round(lineCosted / lineAll * 100) : 100; const known = sales.length > 0 && noCost === 0; const margin = known ? (revenue - vat) - toFcfa(cogs) : null;
  const credit = byMethod.credit ?? 0; const encaisse = Object.entries(byMethod).filter(([m]) => m !== "credit").reduce((a, [, v]) => a + v, 0);
  return { count: sales.length, revenue, vat, avgBasket: sales.length ? Math.round(revenue / sales.length) : 0, byMethod, encaisse, credit, daily: [...daily.values()],
    top: [...prod.values()].sort((a, b) => b.revenue - a.revenue || b.qty - a.qty).slice(0, 5), byCategory: [...cat.values()].sort((a, b) => b.revenue - a.revenue),
    margin: { known, amount: margin, pct: margin !== null && revenue - vat > 0 ? Math.round(margin / (revenue - vat) * 1000) / 10 : null, linesWithoutCost: noCost, coveragePct: ratio, indicative: Math.round(indicative) } };
}
