import { describe, expect, it } from "vitest";
import { amountFor, normalizeRule, resolvePrice, type PriceInput, type PriceRule } from "./pricing";

const at = "2026-11-10T12:00:00.000Z";
const input = (o: Partial<PriceInput> = {}): PriceInput => ({ basePrice: 1000, qty: 1, baseQty: 1, at, ...o });
const R = (o: Partial<PriceRule> & { id: string; kind: PriceRule["kind"]; price: number }): PriceRule => ({ active: true, createdAt: "2026-01-01T00:00:00.000Z", ...o });

describe("moteur de prix : règles et priorités", () => {
  it("sans règle : prix de base × quantité", () => { expect(resolvePrice([], input({ qty: 3, baseQty: 3 }))).toMatchObject({ amount: 3000, unitPrice: 1000, source: "base" }); });
  it("palier de quantité : le plus grand palier atteint l'emporte", () => {
    const rules = [R({ id: "q10", kind: "quantity", price: 900, minQty: 10 }), R({ id: "q50", kind: "quantity", price: 800, minQty: 50 })];
    expect(resolvePrice(rules, input({ qty: 9, baseQty: 9 })).source).toBe("base");
    expect(resolvePrice(rules, input({ qty: 10, baseQty: 10 }))).toMatchObject({ ruleId: "q10", amount: 9000 });
    expect(resolvePrice(rules, input({ qty: 60, baseQty: 60 }))).toMatchObject({ ruleId: "q50", amount: 48000 });
  });
  it("catégorie de clients : seulement pour cette catégorie", () => {
    const rules = [R({ id: "g", kind: "category", price: 850, customerCategory: "wholesale" })];
    expect(resolvePrice(rules, input()).source).toBe("base"); expect(resolvePrice(rules, input({ customerCategory: "reseller" })).source).toBe("base");
    expect(resolvePrice(rules, input({ customerCategory: "wholesale" }))).toMatchObject({ ruleId: "g", amount: 850 });
  });
  it("promotion : seulement dans sa période [début, fin[", () => {
    const rules = [R({ id: "p", kind: "promo", price: 700, startsAt: "2026-11-10T00:00:00.000Z", endsAt: "2026-11-11T00:00:00.000Z" })];
    expect(resolvePrice(rules, input({ at: "2026-11-09T23:59:59.999Z" })).source).toBe("base"); expect(resolvePrice(rules, input({ at: "2026-11-10T00:00:00.000Z" })).ruleId).toBe("p");
    expect(resolvePrice(rules, input({ at: "2026-11-10T23:59:59.999Z" })).ruleId).toBe("p"); expect(resolvePrice(rules, input({ at: "2026-11-11T00:00:00.000Z" })).source).toBe("base");
  });
  it("priorité : promotion > catégorie > quantité > base, quelles que soient les valeurs", () => {
    const rules = [R({ id: "q", kind: "quantity", price: 100, minQty: 1 }), R({ id: "c", kind: "category", price: 500, customerCategory: "wholesale" }), R({ id: "p", kind: "promo", price: 900, startsAt: "2026-11-01T00:00:00.000Z", endsAt: "2026-12-01T00:00:00.000Z" })];
    expect(resolvePrice(rules, input({ customerCategory: "wholesale" })).ruleId).toBe("p");
    expect(resolvePrice(rules.slice(0, 2), input({ customerCategory: "wholesale" })).ruleId).toBe("c");
    expect(resolvePrice(rules.slice(0, 1), input()).ruleId).toBe("q");
    expect(resolvePrice(rules, input({ at: "2027-01-01T00:00:00.000Z", customerCategory: "wholesale" })).ruleId).toBe("c"); // promo terminée
  });
  it("à rang égal : priorité saisie, puis règle réservée à une catégorie, puis plus récente, puis identifiant", () => {
    const a = R({ id: "a", kind: "quantity", price: 100, minQty: 5 }), b = R({ id: "b", kind: "quantity", price: 200, minQty: 5, priority: 1 });
    expect(resolvePrice([a, b], input({ qty: 5, baseQty: 5 })).ruleId).toBe("b"); expect(resolvePrice([b, a], input({ qty: 5, baseQty: 5 })).ruleId).toBe("b");
    const g = R({ id: "g", kind: "quantity", price: 300, minQty: 5, customerCategory: "wholesale" }); expect(resolvePrice([a, g], input({ qty: 5, baseQty: 5, customerCategory: "wholesale" })).ruleId).toBe("g");
    const old = R({ id: "o", kind: "promo", price: 1, startsAt: "2026-01-01T00:00:00.000Z", endsAt: "2027-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z" }); const neu = { ...old, id: "n", price: 2, createdAt: "2026-06-01T00:00:00.000Z" };
    expect(resolvePrice([old, neu], input()).ruleId).toBe("n"); expect(resolvePrice([neu, old], input()).ruleId).toBe("n");
    const x = R({ id: "x", kind: "category", price: 5, customerCategory: "reseller" }), y = { ...x, id: "y", price: 6 }; expect(resolvePrice([x, y], input({ customerCategory: "reseller" })).ruleId).toBe("y");
  });
  it("règle inactive ignorée", () => { expect(resolvePrice([R({ id: "q", kind: "quantity", price: 1, minQty: 1, active: false })], input()).source).toBe("base"); });
  it("conditionnement : prix propre au carton, palier en cartons, jamais appliqué à une autre unité", () => {
    const rules = [R({ id: "c1", kind: "quantity", price: 4800, unit: "carton", minQty: 1 }), R({ id: "c5", kind: "quantity", price: 4500, unit: "carton", minQty: 5 })];
    const carton = (n: number) => input({ basePrice: 400, unit: "carton", factor: 12, qty: n, baseQty: n * 12 });
    expect(resolvePrice(rules, carton(2))).toMatchObject({ ruleId: "c1", amount: 9600, soldUnitPrice: 4800, unitPrice: 400 });
    expect(resolvePrice(rules, carton(5))).toMatchObject({ ruleId: "c5", amount: 22500, soldUnitPrice: 4500 });
    expect(resolvePrice(rules, input({ basePrice: 400, qty: 12, baseQty: 12 })).source).toBe("base"); // vente à la pièce : règle carton ignorée
    expect(resolvePrice(rules, input({ basePrice: 400, unit: "paquet", factor: 6, qty: 2, baseQty: 12 })).source).toBe("base");
    expect(resolvePrice([], carton(2))).toMatchObject({ amount: 9600, soldUnitPrice: 4800 }); // sans règle : prix de base × coefficient
  });
  it("règle en unité de base appliquée aussi à une vente en carton (prix par pièce × quantité de base)", () => {
    const rules = [R({ id: "p", kind: "promo", price: 300, startsAt: "2026-11-01T00:00:00.000Z", endsAt: "2026-12-01T00:00:00.000Z" })];
    expect(resolvePrice(rules, input({ basePrice: 400, unit: "carton", factor: 12, qty: 2, baseQty: 24 }))).toMatchObject({ amount: 7200, soldUnitPrice: 3600 });
  });
  it("palier d'une règle en unité de base compté en quantité de base (2 cartons de 12 = 24)", () => {
    const rules = [R({ id: "q", kind: "quantity", price: 350, minQty: 20 })];
    expect(resolvePrice(rules, input({ basePrice: 400, unit: "carton", factor: 12, qty: 2, baseQty: 24 })).ruleId).toBe("q");
    expect(resolvePrice(rules, input({ basePrice: 400, unit: "carton", factor: 12, qty: 1, baseQty: 12 })).source).toBe("base");
  });
  it("montants au franc sans dérive, y compris en quantités décimales", () => {
    expect(amountFor(1500, 1.5)).toBe(2250); expect(amountFor(25, 0.58)).toBe(15); expect(resolvePrice([R({ id: "q", kind: "quantity", price: 45, minQty: 0.5 })], input({ qty: 0.7, baseQty: 0.7 })).amount).toBe(32);
  });
});

describe("validation d'une règle", () => {
  const ok = { kind: "quantity", price: 900, minQty: 10 };
  it("accepte et normalise", () => { expect(normalizeRule({ ...ok, price: "1 000", priority: "2", label: "  Gros  lot " })).toMatchObject({ kind: "quantity", price: 1000, minQty: 10, priority: 2, label: "Gros lot", active: true }); });
  it("refuse les incohérences", () => {
    for (const bad of [{ ...ok, kind: "x" }, { ...ok, price: -1 }, { ...ok, price: 10.5 }, { ...ok, price: 1e12 }, { ...ok, minQty: "abc" }, { kind: "quantity", price: 1 }, { kind: "category", price: 1 }, { kind: "category", price: 1, customerCategory: "vip" },
      { kind: "promo", price: 1 }, { kind: "promo", price: 1, startsAt: "2026-11-02", endsAt: "2026-11-01" }, { kind: "promo", price: 1, startsAt: "pas une date", endsAt: "2026-11-01" }, { ...ok, startsAt: "2026-11-01" }, { ...ok, priority: 500 }, { ...ok, priority: 1.5 }]) expect(() => normalizeRule(bad as never), JSON.stringify(bad)).toThrow();
  });
  it("promotion complète", () => { const r = normalizeRule({ kind: "promo", price: 700, startsAt: "2026-11-10T00:00:00Z", endsAt: "2026-11-12T00:00:00Z", customerCategory: "wholesale" }); expect(r).toMatchObject({ kind: "promo", customerCategory: "wholesale" }); expect(r.endsAt! > r.startsAt!).toBe(true); });
});
