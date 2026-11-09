import { describe, expect, it } from "vitest";
import * as A from "./analytics";

const L = (productId: string, qty: number, unitPrice: number, unitCost?: number, name = productId) => ({ productId, name, qty, unitPrice, ...(unitCost !== undefined ? { unitCost } : {}) });
const S = (o: Partial<A.RawSale> & { lines: A.RawSale["lines"] }): A.RawSale => { const total = o.total ?? o.lines.reduce((a, l) => a + l.qty * l.unitPrice, 0); return { id: Math.random().toString(36).slice(2), number: "V-1", shopId: "s1", cashierId: "u1", soldAt: "2026-11-10T10:00:00Z", status: "paid", total, vat: 0, payments: [{ method: "cash", amount: total }], ...o }; };
const ctx: A.Ctx = { tz: "Africa/Dakar", categoryOf: (id) => ({ a: "Boissons", b: "Boissons", c: "Hygiène" })[id] ?? "", supplierOf: (id) => ({ a: "f1", b: "f1", c: "f2" })[id] ?? "" };

describe("faits et filtres", () => {
  const sales = [S({ lines: [L("a", 2, 500, 300), L("c", 1, 1000, 400)], cashierId: "u1" }), S({ lines: [L("b", 1, 1000, 600)], cashierId: "u2", payments: [{ method: "card", amount: 1000 }] }), S({ status: "pending", lines: [L("a", 9, 500, 300)] }), S({ status: "cancelled", lines: [L("a", 9, 500, 300)] })];
  it("seules les ventes terminées deviennent des faits (non finalisées à part)", () => { expect(A.buildFacts(sales, ctx)).toHaveLength(2); expect(A.buildFacts(sales, ctx, "open")).toHaveLength(1); });
  it("filtres de vente (vendeur, mode) et de ligne (catégorie, article, fournisseur) : la vente est réduite à ses lignes", () => {
    const f = A.buildFacts(sales, ctx); expect(A.applyFilters(f, { ...A.EMPTY_FILTERS, sellers: ["u2"] })).toHaveLength(1); expect(A.applyFilters(f, { ...A.EMPTY_FILTERS, methods: ["card"] })).toHaveLength(1);
    const cat = A.applyFilters(f, { ...A.EMPTY_FILTERS, categories: ["Hygiène"] }); expect(cat).toHaveLength(1); expect(cat[0]!.lines).toHaveLength(1); expect(A.totalsOf(cat).revenue).toBe(1000); expect(A.totalsOf(A.applyFilters(f, { ...A.EMPTY_FILTERS, suppliers: ["f1"] })).revenue).toBe(2000);
    expect(A.totalsOf(A.applyFilters(f, { ...A.EMPTY_FILTERS, categories: ["Boissons"], sellers: ["u1"] })).revenue).toBe(1000);
  });
});
describe("totaux, marge et coûts", () => {
  it("marge = HT − coût figé, seulement si tous les coûts sont connus ; sinon marge indicative séparée", () => {
    const ok = A.totalsOf(A.buildFacts([S({ vat: 180, total: 1180, lines: [L("a", 2, 590, 300)] })], ctx)); expect(ok).toMatchObject({ revenue: 1180, revenueHt: 1000, cogs: 600, margin: 400, marginRate: 40, markup: 66.7 });
    const bad = A.totalsOf(A.buildFacts([S({ lines: [L("a", 1, 1000, 400), L("b", 1, 1000)] })], ctx)); expect(bad).toMatchObject({ cogs: null, margin: null, marginRate: null, markup: null }); expect(bad.cost).toMatchObject({ complete: false, linesWithoutCost: 1, coveragePct: 50, indicativeMargin: 600 });
    expect(A.totalsOf([])).toMatchObject({ count: 0, revenue: 0, margin: null, basket: 0 });
  });
  it("paiements : encaissé + crédit = CA ; fractionnés comptés une fois ; monnaie exclue", () => {
    const t = A.totalsOf(A.buildFacts([S({ total: 3000, lines: [L("a", 1, 3000, 1)], payments: [{ method: "cash", amount: 1000 }, { method: "card", amount: 500 }, { method: "credit", amount: 1500 }] }), S({ total: 1000, lines: [L("a", 1, 1000, 1)], payments: [{ method: "cash", amount: 5000 }] })], ctx));
    expect(t.byMethod).toEqual({ cash: 2000, card: 500, credit: 1500 }); expect(t.encaisse + t.credit).toBe(t.revenue);
  });
});
describe("séries, regroupements, horaires, panier", () => {
  const f = A.buildFacts([S({ soldAt: "2026-11-09T09:00:00Z", lines: [L("a", 1, 1000, 500)] }), S({ soldAt: "2026-11-15T23:30:00Z", lines: [L("a", 1, 2000, 500)] }), S({ soldAt: "2026-12-01T10:00:00Z", lines: [L("b", 1, 500, 100)] })], ctx);
  it("jour / semaine (lundi) / mois / année, zéro-remplies", () => {
    expect(A.weekStart("2026-11-15")).toBe("2026-11-09"); expect(A.weekStart("2026-11-09")).toBe("2026-11-09");
    const w = A.series(f, { from: "2026-11-01", to: "2026-12-05" }, "week"); expect(w.map((p) => p.key)).toEqual(["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]); expect(w[2]).toMatchObject({ revenue: 3000, count: 2 }); expect(w[0]!.revenue).toBe(0);
    expect(A.series(f, { from: "2026-11-01", to: "2026-12-31" }, "month").map((p) => [p.key, p.revenue])).toEqual([["2026-11", 3000], ["2026-12", 500]]); expect(A.series(f, { from: "2026-01-01", to: "2026-12-31" }, "year")).toHaveLength(1);
  });
  it("tranches horaires selon le fuseau de l'entreprise", () => {
    const lagos = A.buildFacts([S({ soldAt: "2026-11-10T23:30:00Z", lines: [L("a", 1, 100, 1)] })], { ...ctx, tz: "Africa/Lagos" }); expect(lagos[0]!.hour).toBe(0); expect(lagos[0]!.day).toBe("2026-11-11"); expect(A.byHour(f)[9]).toMatchObject({ count: 1, revenue: 1000 }); expect(A.byHour(f)).toHaveLength(24);
  });
  it("regroupements : somme des groupes = total (aucun double compte)", () => {
    const t = A.totalsOf(f); const arts = A.byArticle(f), cats = A.byCategory(f), sellers = A.bySeller(f, (x) => x); expect(arts.reduce((a, g) => a + g.revenue, 0)).toBe(t.revenue); expect(cats.reduce((a, g) => a + g.revenue, 0)).toBe(t.revenue); expect(sellers.reduce((a, g) => a + g.revenue, 0)).toBe(t.revenue);
    expect(arts[0]).toMatchObject({ key: "a", revenue: 3000, margin: 2000, marginRate: 66.7 }); expect(A.byMethod(f)).toEqual([{ method: "cash", amount: 3500, sales: 3 }]);
  });
  it("panier : quantiles observés ; variation sur base nulle = null", () => {
    const b = A.basketStats(A.buildFacts([100, 200, 300, 400, 1000].map((v) => S({ lines: [L("a", 1, v, 1)] })), ctx)); expect(b).toMatchObject({ count: 5, avg: 400, median: 300, min: 100, max: 1000, avgItems: 1 }); expect(A.basketStats([])).toMatchObject({ count: 0, avg: 0 });
    expect(A.delta(150, 100)).toBe(50); expect(A.delta(50, 100)).toBe(-50); expect(A.delta(5, 0)).toBeNull(); expect(A.delta(null, 3)).toBeNull();
  });
});
describe("stocks", () => {
  it("rotation, couverture, classes", () => {
    expect(A.rotation(30, 20, 20)).toBe(1.5); expect(A.rotation(10, 0, 0)).toBeNull(); expect(A.coverageDays(60, 30, 30)).toBe(60); expect(A.coverageDays(10, 0, 30)).toBeNull(); expect(A.coverageDays(0, 5, 30)).toBe(0);
    const t = { slowDays: 90, fastDays: 15, overDays: 180 }; expect(A.classifyStock(0, 5, 30, t)).toBe("out"); expect(A.classifyStock(10, 0, 30, t)).toBe("dormant"); expect(A.classifyStock(10, 30, 30, t)).toBe("fast"); expect(A.classifyStock(60, 30, 30, t)).toBe("normal"); expect(A.classifyStock(120, 30, 30, t)).toBe("slow"); expect(A.classifyStock(400, 30, 30, t)).toBe("overstock");
  });
  it("épisodes de rupture reconstitués depuis les mouvements", () => {
    const D = 864e5; const m = [{ at: 2 * D, delta: -5 }, { at: 4 * D, delta: 10 }, { at: 6 * D, delta: -10 }, { at: 8 * D, delta: 3 }];
    expect(A.stockoutStats(m, 5, 0, 10 * D)).toEqual({ episodes: 2, daysOut: 4 }); expect(A.stockoutStats([], 0, 0, 3 * D)).toEqual({ episodes: 1, daysOut: 3 }); expect(A.stockoutStats([], 5, 0, 3 * D)).toEqual({ episodes: 0, daysOut: 0 });
  });
});
describe("tendances, fiabilité, anomalies de prix", () => {
  it("tendance : hausse / baisse / stable / indéterminée (moins de 4 points) ; fiabilité jamais « certaine »", () => {
    expect(A.trendOf([10, 12, 14, 16, 18, 20, 22, 24]).kind).toBe("hausse"); expect(A.trendOf([24, 22, 20, 18, 16, 14, 12, 10]).kind).toBe("baisse"); expect(A.trendOf([10, 10, 10, 10, 10]).kind).toBe("stable"); expect(A.trendOf([1, 2]).kind).toBe("indéterminée");
    expect(A.reliability([1, 2])).toBe("insuffisante"); expect(A.reliability([10, 11, 10, 12, 11, 10, 12, 11], 0.9)).toBe("correcte"); expect(A.reliability([1, 50, 2, 80, 3, 90], 0.05)).not.toBe("correcte");
  });
  it("anomalies : pic détecté sur historique stable ; historique bruité ou trop court : rien", () => {
    const at = (i: number) => `2026-0${1 + i}-01`; const stable = [700, 705, 695, 700].map((price, i) => ({ at: at(i), price })); expect(A.priceAnomalies([...stable, { at: at(4), price: 1200 }])).toMatchObject([{ price: 1200, baseline: 700, deviationPct: 71.4 }]);
    expect(A.priceAnomalies([...stable, { at: at(4), price: 720 }])).toEqual([]); expect(A.priceAnomalies([{ at: at(0), price: 100 }, { at: at(1), price: 900 }, { at: at(2), price: 100 }])).toEqual([]);
    expect(A.priceAnomalies([100, 300, 100, 300, 100, 300].map((price, i) => ({ at: at(i), price })))).toEqual([]);
  });
});
