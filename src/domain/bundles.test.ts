import { describe, expect, it } from "vitest";
import { bundleAvailable, componentNeeds, kindOf, normalizeComponents } from "./bundles";

describe("bundles (domaine)", () => {
  it("kindOf : simple par défaut", () => { expect(kindOf({})).toBe("simple"); expect(kindOf({ kind: "bundle" })).toBe("bundle"); expect(kindOf(null)).toBe("simple"); });
  it("normalise et valide la composition", () => {
    expect(normalizeComponents([{ productId: "a", qty: "2" }, { productId: "b", qty: 1 }])).toEqual([{ productId: "a", qty: 2 }, { productId: "b", qty: 1 }]);
    for (const bad of [[], "x", [{ productId: "", qty: 1 }], [{ productId: "a", qty: 0 }], [{ productId: "a", qty: 1.5 }], [{ productId: "a", qty: 10000 }], [{ productId: "a", qty: 1 }, { productId: "a", qty: 2 }]]) expect(() => normalizeComponents(bad)).toThrow();
    expect(() => normalizeComponents([{ productId: "self", qty: 1 }], "self")).toThrow("lui-même");
    expect(() => normalizeComponents(Array.from({ length: 21 }, (_, i) => ({ productId: `p${i}`, qty: 1 })))).toThrow("20");
  });
  it("disponibilité = min des composants, jamais négative", () => {
    const st: Record<string, number> = { a: 10, b: 5, c: -2 };
    expect(bundleAvailable([{ productId: "a", qty: 2 }, { productId: "b", qty: 1 }], (id) => st[id] ?? 0)).toBe(5);
    expect(bundleAvailable([{ productId: "a", qty: 3 }], (id) => st[id] ?? 0)).toBe(3);
    expect(bundleAvailable([{ productId: "c", qty: 1 }], (id) => st[id] ?? 0)).toBe(0); expect(bundleAvailable([], () => 9)).toBe(0);
  });
  it("besoins pour n bundles", () => { expect(componentNeeds([{ productId: "a", qty: 2 }], 3)).toEqual([{ productId: "a", qty: 6 }]); });
});
