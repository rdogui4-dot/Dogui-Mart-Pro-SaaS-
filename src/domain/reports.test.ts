import { describe, expect, it } from "vitest";
import { aggregateSales, daysBetween, mergeAggregates, methodsOf, parsePeriod, productKey, type SaleRow } from "./reports";

const R = { from: "2026-06-01", to: "2026-06-03" };
const sale = (over: Partial<SaleRow> = {}): SaleRow => ({ total: 2360, vat: 360, soldAt: "2026-06-01T10:00:00Z", status: "paid", payments: [{ method: "cash", amount: 2360 }], lines: [{ productId: "p1", name: "Riz", qty: 2, unitPrice: 1180, unitCost: 700 }], ...over });

describe("agrégation des ventes", () => {
  it("chiffre d'affaires, TVA, panier moyen et marge brute sur le HT", () => {
    const a = aggregateSales([sale(), sale({ total: 1180, vat: 180, lines: [{ productId: "p1", name: "Riz", qty: 1, unitPrice: 1180, unitCost: 700 }] })], R);
    expect(a).toMatchObject({ count: 2, revenueTtc: 3540, vat: 540, revenueHt: 3000, avgBasket: 1770, cogs: 2100, grossMargin: 900, marginPct: 30 });
  });
  it("ignore les ventes non finalisées et hors période", () => {
    const a = aggregateSales([sale({ status: "pending" }), sale({ soldAt: "2026-05-31T23:59:00Z" }), sale({ soldAt: "2026-06-04T00:00:00Z" }), sale({ soldAt: "2026-06-03T23:59:00Z" })], R);
    expect(a.count).toBe(1);
  });
  it("jamais de marge inventée : une ligne sans coût rend la marge inconnue", () => {
    const a = aggregateSales([sale(), sale({ lines: [{ productId: "p2", name: "Huile", qty: 1, unitPrice: 2000 }] })], R);
    expect(a.cogs).toBeNull(); expect(a.grossMargin).toBeNull(); expect(a.marginPct).toBeNull(); expect(a.revenueTtc).toBe(4720);
  });
  it("marge indicative sur les lignes dont le coût est connu, avec la part du chiffre d'affaires couverte", () => {
    // vente 1 : 2 × 1 180 TTC, coût 700 (ratio HT/TTC = 2 000/2 360) ; vente 2 : 1 × 2 000 TTC sans coût (HT 2 000/2 000)
    const a = aggregateSales([sale(), sale({ total: 2000, vat: 0, lines: [{ productId: "p2", name: "Huile", qty: 1, unitPrice: 2000 }] })], R);
    expect(a.costCoveragePct).toBe(54); // 2 360 / 4 360
    expect(a.indicativeMargin).toBe(Math.round(2360 * (2000 / 2360) - 2 * 700)); // 600
    const full = aggregateSales([sale()], R); expect(full.costCoveragePct).toBe(100); expect(full.indicativeMargin).toBe(full.grossMargin);
    const none = aggregateSales([], R); expect(none.costCoveragePct).toBe(100); expect(none.indicativeMargin).toBe(0);
    expect(mergeAggregates([a, full], R)).toMatchObject({ costedRevenueTtc: 4720, lineRevenueTtc: 6720, costCoveragePct: 70 });
  });
  it("série quotidienne continue, jours sans vente à zéro", () => {
    const a = aggregateSales([sale(), sale({ soldAt: "2026-06-03T08:00:00Z" })], R);
    expect(a.daily.map((d) => [d.date, d.count])).toEqual([["2026-06-01", 1], ["2026-06-02", 0], ["2026-06-03", 1]]);
    expect(daysBetween("2026-02-27", "2026-03-02")).toHaveLength(4);
  });
  it("encaissements par mode : la monnaie rendue n'est pas un encaissement", () => {
    expect(methodsOf({ total: 2000, payments: [{ method: "cash", amount: 2500 }] })).toEqual({ cash: 2000 });
    expect(methodsOf({ total: 5000, payments: [{ method: "wave", amount: 3000 }, { method: "credit", amount: 3000 }] })).toEqual({ wave: 3000, credit: 2000 });
    const a = aggregateSales([sale({ total: 2000, vat: 0, payments: [{ method: "cash", amount: 2500 }] })], R); expect(a.byMethod).toEqual({ cash: 2000 });
  });
  it("produits regroupés par code-barres (sinon par nom) et triés par chiffre d'affaires, remise comprise", () => {
    const a = aggregateSales([
      sale({ lines: [{ productId: "pA", name: "Riz 1kg", qty: 2, unitPrice: 1000, discountPct: 10, unitCost: 600 }] }),
      sale({ lines: [{ productId: "pB", name: "Riz parfumé", qty: 1, unitPrice: 1000, unitCost: 600 }, { productId: "pC", name: "Sucre", qty: 5, unitPrice: 500, unitCost: 300 }] }),
    ], R, { pA: "6001", pB: "6001" });
    // Riz 1kg (2 × 1 000 − 10 % = 1 800) et Riz parfumé (1 000) partagent le code-barres 6001 : 3 unités, 2 800.
    expect(a.products.map((p) => [p.name, p.qty, p.revenueTtc])).toEqual([["Riz 1kg", 3, 2800], ["Sucre", 5, 2500]]);
    expect(productKey("  Riz ", undefined)).toBe("n:riz");
  });
  it("fusion de plusieurs boutiques : sommes, séries alignées, marge inconnue si une boutique l'ignore", () => {
    const a = aggregateSales([sale()], R), b = aggregateSales([sale({ soldAt: "2026-06-02T10:00:00Z" })], R);
    const m = mergeAggregates([a, b], R);
    expect(m).toMatchObject({ count: 2, revenueTtc: 4720, grossMargin: 1200 });
    expect(m.daily.map((d) => d.count)).toEqual([1, 1, 0]);
    const noCost = aggregateSales([sale({ lines: [{ productId: "x", name: "X", qty: 1, unitPrice: 100 }] })], R);
    expect(mergeAggregates([a, noCost], R).grossMargin).toBeNull();
    expect(mergeAggregates([], R)).toMatchObject({ count: 0, revenueTtc: 0, avgBasket: 0 });
  });
});

describe("période de rapport", () => {
  it("valide les dates et borne la durée", () => {
    expect(parsePeriod("2026-06-01", "2026-06-30")).toMatchObject({ ok: true, days: 30, gte: "2026-06-01T00:00:00.000Z", lt: "2026-07-01T00:00:00.000Z" });
    expect(parsePeriod("2026-06-01", "2026-06-01")).toMatchObject({ ok: true, days: 1 });
    for (const [f, t] of [["2026-06-02", "2026-06-01"], ["2026-02-30", "2026-03-01"], ["juin", "2026-06-01"], ["2026-01-01", "2026-12-31"]] as const) expect(parsePeriod(f, t).ok).toBe(false);
    expect(parsePeriod(5, null).ok).toBe(false);
    expect(parsePeriod("2026-01-01", "2026-04-02")).toMatchObject({ ok: true, days: 92 }); expect(parsePeriod("2026-01-01", "2026-04-03").ok).toBe(false);
  });
});
