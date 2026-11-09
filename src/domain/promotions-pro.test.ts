import { describe, expect, it } from "vitest";
import { evaluatePromotions, findOverlaps, parsePromotion, utcToZoned, zonedToUtc, isAdvanced, isTimezone, dayInZone, type EvalLine, type Promo } from "./promotions";

const P = (o: Partial<Promo> = {}): Promo => ({ id: "p1", name: "Promo", kind: "percent", scope: "items", value: 10, itemIds: ["a"], startAt: "2026-01-01T00:00:00Z", endAt: "2027-01-01T00:00:00Z", status: "enabled", usageCount: 0, priority: 0, allowBelowMargin: true, createdAt: "2026-01-01T00:00:00Z", ...o });
const L = (index: number, productId: string, qty: number, baseAmount: number, o: Partial<EvalLine> = {}): EvalLine => ({ index, productId, qty, baseAmount, eligible: true, ...o });
const ctx = { now: new Date("2026-06-01T12:00:00Z"), minMarginPct: 0, pro: true };

describe("fuseau horaire de l'entreprise", () => {
  it("convertit une saisie locale en instant UTC et inversement (Dakar = UTC, Paris = UTC+1 l'hiver / +2 l'été, Lagos = UTC+1)", () => {
    expect(zonedToUtc("2026-11-10T08:00", "Africa/Dakar")).toBe("2026-11-10T08:00:00.000Z"); expect(zonedToUtc("2026-01-10T08:00", "Europe/Paris")).toBe("2026-01-10T07:00:00.000Z"); expect(zonedToUtc("2026-07-10T08:00", "Europe/Paris")).toBe("2026-07-10T06:00:00.000Z"); expect(zonedToUtc("2026-07-10T08:00", "Africa/Lagos")).toBe("2026-07-10T07:00:00.000Z");
    for (const tz of ["Africa/Dakar", "Europe/Paris", "Africa/Lagos"]) expect(utcToZoned(zonedToUtc("2026-03-29T10:30", tz), tz)).toBe("2026-03-29T10:30");
    expect(dayInZone("2026-07-10T23:30:00Z", "Africa/Lagos")).toBe("2026-07-11"); expect(isTimezone("Mars/Olympus")).toBe(false); expect(isTimezone("Africa/Dakar")).toBe(true);
  });
});
describe("moteur partagé : activation selon la date, gel Pro", () => {
  it("campagne avancée gelée hors Pro (jamais appliquée), simple toujours appliquée ; programmée/terminée refusées avec raison", () => {
    const adv = P({ id: "adv", family: "tiers", tiers: [{ minQty: 1, kind: "percent", value: 10 }] }), simple = P({ id: "s", itemIds: ["b"] });
    expect(isAdvanced(adv)).toBe(true); expect(isAdvanced(simple)).toBe(false);
    const r = evaluatePromotions([adv, simple], [L(0, "a", 1, 1000), L(1, "b", 1, 1000)], { ...ctx, pro: false }); expect(r.lines.map((l) => l.discount)).toEqual([0, 100]); expect(r.decisions.find((d) => d.promoId === "adv")?.reason).toBe("frozen");
    const f = evaluatePromotions([P({ startAt: "2026-07-01T00:00:00Z" }), P({ id: "e", endAt: "2026-05-01T00:00:00Z" })], [L(0, "a", 1, 1000)], ctx); expect(f.lines[0]!.discount).toBe(0); expect(f.decisions.map((d) => d.reason)).toEqual(["not_active", "not_active"]);
  });
});
describe("invariants (aléatoires, reproductibles)", () => {
  it("jamais de remise négative ni supérieure à la ligne ; parties = remise de ligne ; budget et plafonds respectés ; non cumulable jamais empilé", () => {
    let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]!;
    const keys = ["a", "b", "c", "d"]; const fams = ["simple", "tiers", "bogo", "combo", "requires", "cart"] as const;
    for (let it = 0; it < 400; it++) {
      const promos: Promo[] = Array.from({ length: 1 + Math.floor(rnd() * 5) }, (_, i) => { const fam = pick([...fams]); const kind = pick(["percent", "amount"] as const);
        return P({ id: `p${i}`, family: fam, kind: fam === "combo" ? "price" : kind, value: fam === "combo" ? 1 + Math.floor(rnd() * 3000) : kind === "percent" ? 1 + Math.floor(rnd() * 90) : 1 + Math.floor(rnd() * 500), itemIds: keys.filter(() => rnd() < 0.5), priority: Math.floor(rnd() * 5), stackable: (fam === "simple" || fam === "tiers") && rnd() < 0.5,
          tiers: [{ minQty: 1 + Math.floor(rnd() * 3), kind: "percent", value: 1 + Math.floor(rnd() * 50) }], bogo: { buy: 1 + Math.floor(rnd() * 2), get: 1, pct: 100 }, comboItems: [{ key: "a", qty: 1 }, { key: "b", qty: 1 }], requireItems: [{ key: "c", qty: 1 }], minCart: rnd() < 0.3 ? 1000 : undefined,
          maxLinePct: rnd() < 0.3 ? 30 : undefined, budget: rnd() < 0.3 ? 500 : undefined, createdAt: `2026-0${1 + i}-01T00:00:00Z` }); });
      const lines = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, i) => { const qty = 1 + Math.floor(rnd() * 5); return L(i, pick(keys), qty, qty * (100 + Math.floor(rnd() * 2000)), { unitCost: rnd() < 0.5 ? 50 : undefined }); });
      const r = evaluatePromotions(promos, lines, { ...ctx, maxCartPct: rnd() < 0.3 ? 20 : undefined, strategy: rnd() < 0.5 ? "best" : "priority", budgetUsed: () => 0 });
      for (const l of r.lines) { const base = lines.find((x) => x.index === l.index)!.baseAmount; expect(l.discount).toBeGreaterThanOrEqual(0); expect(l.discount).toBeLessThanOrEqual(base); expect(l.parts.reduce((a, p) => a + p.discount, 0)).toBe(l.discount); expect(Number.isInteger(l.discount)).toBe(true);
        if (l.parts.length > 1) for (const pt of l.parts) expect(promos.find((p) => p.id === pt.promoId)!.stackable).toBe(true); }
      for (const a of r.applied) { const p = promos.find((x) => x.id === a.promoId)!; if (p.budget !== undefined) expect(a.discount).toBeLessThanOrEqual(p.budget); expect(a.discount).toBe(a.lineIndexes.reduce((s, i) => s + r.lines.find((l) => l.index === i)!.parts.filter((x) => x.promoId === a.promoId).reduce((q, x) => q + x.discount, 0), 0)); }
      const cartBase = lines.reduce((a, l) => a + l.baseAmount, 0); if (it >= 0) expect(r.lines.reduce((a, l) => a + l.discount, 0)).toBeLessThanOrEqual(cartBase);
      expect(evaluatePromotions(promos, lines, { ...ctx, budgetUsed: () => 0, strategy: "best" })).toEqual(evaluatePromotions(promos, lines, { ...ctx, budgetUsed: () => 0, strategy: "best" })); // déterministe
    }
  });
});
describe("saisie avancée et chevauchements", () => {
  const ok = { name: "Soldes", kind: "percent", scope: "items", value: 10, startAt: "2026-11-10T08:00:00Z", endAt: "2026-11-20T20:00:00Z" };
  it("valide paliers, X+Y, packs, panier, plafonds, ciblage ; refuse les incohérences", () => {
    expect(parsePromotion({ ...ok, family: "tiers", tiers: [{ minQty: 10, kind: "percent", value: 20 }, { minQty: 3, kind: "percent", value: 10 }] }).tiers.map((t) => t.minQty)).toEqual([3, 10]);
    expect(parsePromotion({ ...ok, family: "bogo", bogoBuy: 2, bogoGet: 1 }).bogo).toEqual({ buy: 2, get: 1, pct: 100 }); expect(parsePromotion({ ...ok, family: "combo", comboPrice: 1500 }).value).toBe(1500);
    expect(parsePromotion({ ...ok, family: "cart", minCart: 5000, maxCartDiscount: 1000, budget: 50000 })).toMatchObject({ minCart: 5000, maxCartDiscount: 1000, budget: 50000 });
    for (const bad of [{ family: "tiers", tiers: [] }, { family: "tiers", tiers: [{ minQty: 2, kind: "percent", value: 10 }, { minQty: 2, kind: "percent", value: 20 }] }, { family: "bogo", bogoBuy: 0, bogoGet: 1 }, { family: "cart" }, { family: "cart", minCart: 100, kind: "price" }, { family: "bogo", bogoBuy: 1, bogoGet: 1, stackable: true }, { family: "x" }, { storeScope: "mars" }, { customerRules: { categories: [], customerIds: [], loyalty: ["platine"] } }, { budget: 0 }, { maxLinePct: 101 }])
      expect(() => parsePromotion({ ...ok, ...bad }), JSON.stringify(bad)).toThrow();
  });
  it("détecte les chevauchements (articles, catégories, panier) et ignore les périodes disjointes ou magasins distincts", () => {
    const a = P({ id: "a", itemIds: ["x"] }), b = P({ id: "b", itemIds: ["x", "y"] }), c = P({ id: "c", itemIds: ["z"] }), d = P({ id: "d", itemIds: ["x"], startAt: "2028-01-01T00:00:00Z", endAt: "2028-02-01T00:00:00Z" });
    expect(findOverlaps([a, b, c, d]).map((o) => `${o.a}${o.b}`)).toEqual(["ab"]); expect(findOverlaps([P({ id: "e", scope: "category", category: "Eau", itemIds: [] }), P({ id: "f", scope: "category", category: "eau", itemIds: [] })])).toHaveLength(1);
    expect(findOverlaps([P({ id: "g", homeShopId: "s1" }), P({ id: "h", homeShopId: "s2" })])).toHaveLength(0); expect(findOverlaps([P({ id: "g", homeShopId: "s1" }), P({ id: "h", homeShopId: "s2", storeScope: "all" })])).toHaveLength(1);
  });
});
