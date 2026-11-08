import { describe, expect, it } from "vitest";
import { aggregateProfit, allocateFees, effectivePrice, landedUnitCost, marginStats, nextCost, rankOffers } from "./costing";

describe("marges", () => {
  it("marge, taux de marge (sur coût) et taux de marque (sur prix)", () => { expect(marginStats(1500, 1000)).toEqual({ amount: 500, markupPct: 50, markPct: 33.3 }); });
  it("ratios nuls sans base ; marge négative conservée", () => { expect(marginStats(0, 0)).toEqual({ amount: 0, markupPct: null, markPct: null }); expect(marginStats(800, 1000)).toEqual({ amount: -200, markupPct: -20, markPct: -25 }); expect(marginStats(500, 0).markupPct).toBeNull(); });
});
describe("frais d'approvisionnement", () => {
  it("répartition au prorata dont la somme est exactement le total", () => {
    for (const [vals, total] of [[[1000, 2000, 3000], 100], [[1, 1, 1], 10], [[333, 333, 334], 1], [[500], 77], [[0, 0], 9], [[7, 11, 13, 17], 1001]] as const) { const p = allocateFees([...vals], total); expect(p.reduce((a, b) => a + b, 0), JSON.stringify([vals, total])).toBe(total); expect(p.every((x) => Number.isInteger(x) && x >= 0)).toBe(true); }
    expect(allocateFees([1000, 2000, 3000], 600)).toEqual([100, 200, 300]);
  });
  it("coût de revient unitaire arrondi au franc", () => { expect(landedUnitCost(10000, 10, 500, 100)).toBe(1060); expect(landedUnitCost(1000, 3, 0, 0)).toBe(333); expect(landedUnitCost(0, 0, 0, 0)).toBe(0); });
});
describe("méthodes de valorisation", () => {
  it("CMUP : moyenne pondérée du stock et de la réception", () => { expect(nextCost("cmup", 10, 1000, 10, 1200)).toBe(1100); expect(nextCost("cmup", 0, 999, 5, 1200)).toBe(1200); expect(nextCost("cmup", -4, 999, 5, 1200)).toBe(1200); });
  it("dernier prix : le coût est celui de la dernière réception", () => { expect(nextCost("last", 100, 1, 5, 1234.6)).toBe(1235); });
});
describe("comparaison des fournisseurs", () => {
  const o = (id: string, price: number, extra: object = {}) => ({ id, price, ...extra });
  it("prix effectif avec frais proportionnels", () => { expect(effectivePrice({ price: 1000, feePct: 5 })).toBe(1050); expect(effectivePrice({ price: 1000 })).toBe(1000); });
  it("classe par prix effectif puis délai puis minimum ; l'inactif n'a pas de rang", () => {
    const r = rankOffers([o("a", 1000, { feePct: 10, leadDays: 2 }), o("b", 1050, { leadDays: 5 }), o("c", 1050, { leadDays: 1 }), o("d", 900, { status: "inactive" }), o("e", 1050, { leadDays: 1, minQty: 5 })]);
    expect(r.map((x) => x.id)).toEqual(["c", "e", "b", "a", "d"]); // 1050 effectif pour b, c, e ; délai puis quantité minimale départagent ; a = 1100 ; d inactif en dernier
    expect(r.find((x) => x.best)!.id).toBe("c"); expect(r.map((x) => x.rank)).toEqual([1, 2, 3, 4, null]);
    expect(r.at(-1)).toMatchObject({ id: "d", best: false, rank: null });
  });
  it("un fournisseur moins cher mais avec frais peut perdre", () => { const r = rankOffers([o("a", 1000, { feePct: 20 }), o("b", 1100)]); expect(r[0]!.id).toBe("b"); });
  it("aucune offre : liste vide ; une seule : meilleure", () => { expect(rankOffers([])).toEqual([]); expect(rankOffers([o("x", 5)])[0]).toMatchObject({ best: true, rank: 1 }); });
});
describe("rentabilité par article et catégorie", () => {
  const sale = (lines: object[], total: number, vat = 0, soldAt = "2026-11-05T10:00:00.000Z", status = "paid") => ({ total, vat, status, soldAt, lines: lines as never });
  const range = { from: "2026-11-01", to: "2026-11-30" };
  it("marge hors TVA sur le coût figé, regroupée par article et catégorie", () => {
    const sales = [sale([{ productId: "p1", name: "Riz", qty: 10, unitPrice: 1180, unitCost: 700 }, { productId: "p2", name: "Savon", qty: 4, unitPrice: 590, unitCost: 300 }], 14160, 2160)];
    const r = aggregateProfit(sales, range, { p1: { category: "Épicerie" }, p2: { category: "Hygiène" } });
    expect(r.items[0]).toMatchObject({ name: "Riz", qty: 10, revenueHt: 10000, cogs: 7000, margin: 3000, marginPct: 30, markupPct: 42.9, costedPct: 100 });
    expect(r.items[1]).toMatchObject({ name: "Savon", revenueHt: 2000, cogs: 1200, margin: 800 }); expect(r.categories.map((c) => c.name)).toEqual(["Épicerie", "Hygiène"]);
  });
  it("lignes sans coût connu : marge sur la part chiffrée seulement, couverture indiquée", () => {
    const r = aggregateProfit([sale([{ productId: "p1", name: "Riz", qty: 5, unitPrice: 1000, unitCost: 600 }, { productId: "p1", name: "Riz", qty: 5, unitPrice: 1000 }], 10000)], range, {});
    expect(r.items[0]).toMatchObject({ revenueHt: 10000, cogs: 3000, margin: 2000, costedPct: 50, marginPct: 40 }); expect(r.categories[0]!.name).toBe("Sans catégorie");
  });
  it("variantes séparées, ventes hors période ou non payées ignorées, prix par règle (amount) respecté", () => {
    const sales = [sale([{ productId: "t", variantId: "m", name: "Tee M", qty: 2, unitPrice: 5500, unitCost: 3000 }, { productId: "t", variantId: "l", name: "Tee L", qty: 3, unitPrice: 5000, amount: 15000, unitCost: 3200 }], 26000),
      sale([{ productId: "t", variantId: "m", name: "Tee M", qty: 9, unitPrice: 1, unitCost: 1 }], 9, 0, "2026-10-31T23:00:00.000Z"), sale([{ productId: "t", variantId: "m", name: "Tee M", qty: 9, unitPrice: 1, unitCost: 1 }], 9, 0, "2026-11-05T00:00:00.000Z", "pending")];
    const r = aggregateProfit(sales, range, {}); expect(r.items.map((i) => [i.name, i.revenueHt, i.margin])).toEqual([["Tee L", 15000, 5400], ["Tee M", 11000, 5000]]);
  });
  it("remise sur la ligne déduite du chiffre d'affaires", () => { const r = aggregateProfit([sale([{ productId: "p", name: "X", qty: 10, unitPrice: 1000, discountPct: 10, unitCost: 500 }], 9000)], range, {}); expect(r.items[0]).toMatchObject({ revenueHt: 9000, margin: 4000 }); });
});
