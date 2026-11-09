import { describe, expect, it } from "vitest";
import { evaluatePromotions, lineDiscount, parsePromotion, promoStatus, type EvalLine, type Promo } from "./promotions";

const NOW = new Date("2026-11-10T12:00:00Z");
const base: Promo = { id: "p1", name: "Promo", kind: "percent", scope: "items", value: 10, itemIds: ["a"], startAt: "2026-11-01T00:00:00Z", endAt: "2026-12-01T00:00:00Z", status: "enabled", usageCount: 0, priority: 0, allowBelowMargin: false, createdAt: "2026-10-30T00:00:00Z" };
const P = (o: Partial<Promo>): Promo => ({ ...base, ...o });
const L = (index: number, productId: string, baseAmount: number, o: Partial<EvalLine> = {}): EvalLine => ({ index, productId, qty: 1, baseAmount, eligible: true, ...o });
const ctx = { now: NOW, minMarginPct: 0 };
const disc = (r: ReturnType<typeof evaluatePromotions>) => r.lines.map((l) => l.discount);

describe("statut effectif", () => {
  it("dépend des dates et de l'état manuel", () => {
    expect(promoStatus(base, NOW)).toBe("active"); expect(promoStatus(base, new Date("2026-10-31T00:00:00Z"))).toBe("scheduled"); expect(promoStatus(base, new Date("2026-12-01T00:00:00Z"))).toBe("ended");
    expect(promoStatus({ ...base, status: "suspended" }, NOW)).toBe("suspended"); expect(promoStatus({ ...base, status: "draft" }, NOW)).toBe("draft"); expect(promoStatus({ ...base, status: "ended" }, NOW)).toBe("ended");
  });
});
describe("calcul de la remise", () => {
  it("pourcentage, montant par unité, prix promotionnel ; jamais plus que la ligne, jamais négatif", () => {
    expect(lineDiscount({ kind: "percent", value: 10 }, { qty: 1, baseAmount: 5000 })).toBe(500); expect(lineDiscount({ kind: "percent", value: 100 }, { qty: 1, baseAmount: 5000 })).toBe(5000);
    expect(lineDiscount({ kind: "amount", value: 1000 }, { qty: 3, baseAmount: 9000 })).toBe(3000); expect(lineDiscount({ kind: "amount", value: 1000 }, { qty: 3, baseAmount: 2500 })).toBe(2500);
    expect(lineDiscount({ kind: "price", value: 800 }, { qty: 2, baseAmount: 2000 })).toBe(400); expect(lineDiscount({ kind: "price", value: 1500 }, { qty: 2, baseAmount: 2000 })).toBe(0); // prix promo supérieur au prix : aucune remise
    expect(lineDiscount({ kind: "price", value: 0 }, { qty: 1, baseAmount: 1000 })).toBe(1000); expect(lineDiscount({ kind: "percent", value: 10 }, { qty: 1, baseAmount: 0 })).toBe(0);
    expect(lineDiscount({ kind: "percent", value: 15 }, { qty: 0.5, baseAmount: 333 })).toBe(50); // 49,95 arrondi
  });
});
describe("évaluation", () => {
  it("n'applique que la promotion active, aux articles choisis", () => {
    expect(disc(evaluatePromotions([P({})], [L(0, "a", 1000), L(1, "b", 1000)], ctx))).toEqual([100, 0]);
    for (const bad of [{ status: "suspended" as const }, { status: "draft" as const }, { status: "ended" as const }, { startAt: "2026-11-11T00:00:00Z" }, { endAt: "2026-11-10T12:00:00Z" }]) expect(disc(evaluatePromotions([P(bad)], [L(0, "a", 1000)], ctx))).toEqual([0]);
  });
  it("catégorie (sans tenir compte de la casse) et toute la vente avec code", () => {
    const cat = P({ scope: "category", category: "Boissons", itemIds: [] }); expect(disc(evaluatePromotions([cat], [L(0, "x", 1000, { category: "boissons" }), L(1, "y", 1000, { category: "Pain" })], ctx))).toEqual([100, 0]);
    const cart = P({ scope: "cart", code: "ETE10", itemIds: [] }); expect(disc(evaluatePromotions([cart], [L(0, "x", 1000), L(1, "y", 3000)], ctx))).toEqual([0, 0]); expect(disc(evaluatePromotions([cart], [L(0, "x", 1000), L(1, "y", 3000)], { ...ctx, code: " ete10 " }))).toEqual([100, 300]);
  });
  it("remise fixe sur toute la vente : répartie au prorata, somme exacte, plafonnée à la vente", () => {
    const cart = P({ scope: "cart", kind: "amount", value: 1000, code: "BON1000", itemIds: [] }); const r = evaluatePromotions([cart], [L(0, "x", 1000), L(1, "y", 2000), L(2, "z", 3000)], { ...ctx, code: "BON1000" }); expect(r.lines.reduce((a, l) => a + l.discount, 0)).toBe(1000); expect(r.applied[0]!.discount).toBe(1000);
    expect(evaluatePromotions([cart], [L(0, "x", 600)], { ...ctx, code: "BON1000" }).lines[0]!.discount).toBe(600);
  });
  it("conditions : quantité minimale, panier minimal, limite globale, limite par client", () => {
    expect(disc(evaluatePromotions([P({ minQty: 3 })], [L(0, "a", 3000, { qty: 2 })], ctx))).toEqual([0]); expect(disc(evaluatePromotions([P({ minQty: 3 })], [L(0, "a", 3000, { qty: 3 })], ctx))).toEqual([300]);
    expect(disc(evaluatePromotions([P({ minCart: 5000 })], [L(0, "a", 1000), L(1, "b", 3000)], ctx))).toEqual([0, 0]); expect(disc(evaluatePromotions([P({ minCart: 5000 })], [L(0, "a", 1000), L(1, "b", 4000)], ctx))).toEqual([100, 0]);
    expect(disc(evaluatePromotions([P({ usageLimit: 5, usageCount: 5 })], [L(0, "a", 1000)], ctx))).toEqual([0]); expect(disc(evaluatePromotions([P({ usageLimit: 5, usageCount: 4 })], [L(0, "a", 1000)], ctx))).toEqual([100]);
    const lim = P({ perCustomerLimit: 1 }); expect(disc(evaluatePromotions([lim], [L(0, "a", 1000)], ctx))).toEqual([0]); // client inconnu : limite impossible à contrôler → pas de remise
    expect(disc(evaluatePromotions([lim], [L(0, "a", 1000)], { ...ctx, customerId: "c1", customerUses: () => 1 }))).toEqual([0]); expect(disc(evaluatePromotions([lim], [L(0, "a", 1000)], { ...ctx, customerId: "c1", customerUses: () => 0 }))).toEqual([100]);
  });
  it("pas de cumul : une seule promotion par ligne — la plus forte, puis la priorité, puis la plus ancienne", () => {
    const a = P({ id: "a", value: 10 }), b = P({ id: "b", kind: "amount", value: 300 }), c = P({ id: "c", value: 10, priority: 5, createdAt: "2026-10-01T00:00:00Z" });
    expect(evaluatePromotions([a, b], [L(0, "a", 1000)], ctx).lines[0]).toEqual({ index: 0, promoId: "b", discount: 300 });
    expect(evaluatePromotions([a, c], [L(0, "a", 1000)], ctx).lines[0]!.promoId).toBe("c"); expect(evaluatePromotions([a, P({ id: "z", createdAt: "2026-10-01T00:00:00Z" })], [L(0, "a", 1000)], ctx).lines[0]!.promoId).toBe("z");
  });
  it("lignes inéligibles (prix de tarification spécial / remise manuelle) : aucune promotion", () => { expect(disc(evaluatePromotions([P({})], [L(0, "a", 1000, { eligible: false })], ctx))).toEqual([0]); });
  it("marge minimale : la promotion est ignorée si le prix final passe sous coût × (1 + marge), sauf autorisation explicite", () => {
    const l = L(0, "a", 1000, { unitCost: 850 }); expect(disc(evaluatePromotions([P({ value: 20 })], [l], ctx))).toEqual([0]); expect(disc(evaluatePromotions([P({ value: 20, allowBelowMargin: true })], [l], ctx))).toEqual([200]);
    expect(disc(evaluatePromotions([P({ value: 10 })], [l], ctx))).toEqual([100]); expect(disc(evaluatePromotions([P({ value: 10 })], [l], { ...ctx, minMarginPct: 10 }))).toEqual([0]); // 900 < 850 × 1,1
  });
  it("résumé des promotions appliquées", () => { const r = evaluatePromotions([P({})], [L(0, "a", 1000), L(1, "a", 2000)], ctx); expect(r.applied).toEqual([{ promoId: "p1", name: "Promo", discount: 300, lineIndexes: [0, 1] }]); });
});
describe("validation de la saisie", () => {
  const ok = { name: "Soldes", kind: "percent", scope: "items", value: 10, startAt: "2026-11-10T08:00", endAt: "2026-11-20T20:00" };
  it("accepte une promotion valide et nettoie les champs", () => { expect(parsePromotion({ ...ok, code: " soldes10 ", minQty: "2", usageLimit: "100" })).toMatchObject({ name: "Soldes", code: "SOLDES10", value: 10, minQty: 2, usageLimit: 100, priority: 0 }); });
  it("refuse les saisies incohérentes", () => {
    for (const bad of [{ name: "x" }, { kind: "bof" }, { scope: "monde" }, { value: 0 }, { value: 101 }, { value: 1.5 }, { code: "a b" }, { startAt: "" }, { endAt: "2026-11-10T07:00" }, { endAt: "2028-01-01T00:00" }, { kind: "price", scope: "category", category: "X" }, { scope: "cart" }, { scope: "category" }, { category: "X" }, { minQty: "0" }, { minCart: "-5" }, { usageLimit: "0" }, { perCustomerLimit: "1.5" }, { priority: 500 }])
      expect(() => parsePromotion({ ...ok, ...bad }), JSON.stringify(bad)).toThrow();
    expect(parsePromotion({ ...ok, kind: "price", value: 0 }).value).toBe(0); expect(() => parsePromotion({ ...ok, kind: "price", scope: "cart", code: "ABC" })).toThrow();
  });
});
