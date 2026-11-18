import { describe, expect, it } from "vitest";
import { bundleAvailable, componentNeeds, kindOf, normalizeComponents } from "./bundles";

describe("bundles (domaine)", () => {
  it("kindOf : simple par défaut", () => { expect(kindOf({})).toBe("simple"); expect(kindOf({ kind: "bundle" })).toBe("bundle"); expect(kindOf(null)).toBe("simple"); });
  it("normalise et valide la composition", () => {
    expect(normalizeComponents([{ productId: "a", qty: "2" }, { productId: "b", qty: 1 }])).toEqual([{ productId: "a", qty: 2 }, { productId: "b", qty: 1 }]);
    for (const bad of [[], "x", [{ productId: "", qty: 1 }], [{ productId: "a", qty: 0 }], [{ productId: "a", qty: 1.5555 }], [{ productId: "a", qty: 10000 }], [{ productId: "a", qty: -1 }], [{ productId: "a", qty: 1 }, { productId: "a", qty: 2 }]]) expect(() => normalizeComponents(bad)).toThrow();
    expect(normalizeComponents([{ productId: "a", qty: "1,5" }, { productId: "a", variantId: "v1", qty: 2 }, { productId: "a", variantId: "v2", qty: 2 }])).toEqual([{ productId: "a", qty: 1.5 }, { productId: "a", variantId: "v1", qty: 2 }, { productId: "a", variantId: "v2", qty: 2 }]);
    expect(() => normalizeComponents([{ productId: "a", variantId: "v1", qty: 1 }, { productId: "a", variantId: "v1", qty: 1 }])).toThrow("double");
    expect(() => normalizeComponents([{ productId: "self", qty: 1 }], "self")).toThrow("lui-même");
    expect(() => normalizeComponents(Array.from({ length: 21 }, (_, i) => ({ productId: `p${i}`, qty: 1 })))).toThrow("20");
  });
  it("disponibilité = min des composants, jamais négative", () => {
    const st: Record<string, number> = { a: 10, b: 5, c: -2 };
    expect(bundleAvailable([{ productId: "a", qty: 2 }, { productId: "b", qty: 1 }], (id) => st[id] ?? 0)).toBe(5);
    expect(bundleAvailable([{ productId: "a", qty: 3 }], (id) => st[id] ?? 0)).toBe(3);
    expect(bundleAvailable([{ productId: "c", qty: 1 }], (id) => st[id] ?? 0)).toBe(0); expect(bundleAvailable([], () => 9)).toBe(0);
    expect(bundleAvailable([{ productId: "k", qty: 0.1 }], () => 0.3)).toBe(3); // 0,3 ÷ 0,1 = 3 (pas 2,999…)
    expect(bundleAvailable([{ productId: "k", qty: 1.5 }, { productId: "v", variantId: "x", qty: 2 }], (id, v) => (v === "x" ? 7 : 10))).toBe(3);
  });
  it("besoins pour n bundles", () => { expect(componentNeeds([{ productId: "a", qty: 2 }, { productId: "b", qty: 0.5 }], 3)).toEqual([{ productId: "a", qty: 6 }, { productId: "b", qty: 1.5 }]); });
});

import { bundleGross, bundleSummary, discountPct, priceForDiscount } from "./bundles";
describe("prix d'un bundle (remise, économie client)", () => {
  const LINES = [{ unitPrice: 2950, qty: 1 }, { unitPrice: 1700, qty: 1 }, { unitPrice: 900, qty: 1 }, { unitPrice: 500, qty: 1 }, { unitPrice: 600, qty: 1 }];
  it("exemple Pack Cuisine Essentiel : 6 650 F sans remise, prix 6 000 F → économie 650 F (−9,8 %)", () => {
    expect(bundleGross(LINES)).toBe(6650); expect(bundleSummary(LINES, 6000)).toEqual({ lines: 5, units: 5, gross: 6650, price: 6000, saving: 650, savingPct: 9.8 });
  });
  it("remise ↔ prix réciproques, quantités décimales, total nul", () => {
    expect(priceForDiscount(6650, 9.8)).toBe(5998); expect(discountPct(6650, priceForDiscount(6650, 10))).toBe(10); expect(priceForDiscount(1000, 150)).toBe(0);
    expect(bundleGross([{ unitPrice: 1200, qty: 0.5 }, { unitPrice: 300, qty: 2 }])).toBe(1200); expect(discountPct(0, 100)).toBeNull(); expect(discountPct(1000, 1100)).toBe(-10);
  });
});
