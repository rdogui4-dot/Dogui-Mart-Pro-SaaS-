import { describe, expect, it } from "vitest";
import { alertKey, buildAlerts } from "./alerts";

const day = "2026-11-10";
describe("alertes (domaine)", () => {
  it("rupture, stock bas, bundle bloqué ; un bundle n'est jamais « rupture »", () => {
    const a = buildAlerts({ day, lots: [], prices: [], stock: [
      { productId: "a", label: "Jus", qty: 0, minStock: 5 }, { productId: "b", label: "Pain", qty: 3, minStock: 5 }, { productId: "c", label: "Eau", qty: 50, minStock: 5 },
      { productId: "d", label: "Pack", qty: 0, minStock: 5, bundle: true }, { productId: "e", label: "Sans seuil", qty: 2, minStock: 0 }] });
    expect(a.map((x) => [x.type, x.label])).toEqual([["stock_out", "Jus"], ["bundle_blocked", "Pack"], ["stock_low", "Pain"]]);
  });
  it("lots : périmé (critique) et proche (avertissement), seulement s'il reste du stock", () => {
    const a = buildAlerts({ day, stock: [], prices: [], lots: [
      { lotId: "l1", productId: "p", lotNo: "A", label: "Yaourt", qty: 4, expiresAt: "2026-11-05" }, { lotId: "l2", productId: "p", lotNo: "B", label: "Yaourt", qty: 2, expiresAt: "2026-11-20" },
      { lotId: "l3", productId: "p", lotNo: "C", label: "Yaourt", qty: 0, expiresAt: "2026-11-01" }, { lotId: "l4", productId: "p", lotNo: "D", label: "Yaourt", qty: 9, expiresAt: "2027-06-01" }, { lotId: "l5", productId: "p", lotNo: "E", label: "Yaourt", qty: 9 }] });
    expect(a.map((x) => [x.type, x.refId, x.severity])).toEqual([["lot_expired", "l1", "critical"], ["lot_expiring", "l2", "warning"]]);
    expect(a[0]!.detail).toContain("5 jour"); expect(a[1]!.detail).toContain("10 jour");
    expect(buildAlerts({ day, stock: [], prices: [], lots: [{ lotId: "x", productId: "p", lotNo: "Z", label: "Y", qty: 1, expiresAt: day }] }).map((x) => x.type)).toEqual(["lot_expiring"]); // valable jusqu'au jour de péremption inclus : alerte, pas « périmé »
  });
  it("vente à perte seulement quand le coût est connu", () => {
    const a = buildAlerts({ day, stock: [], lots: [], prices: [{ productId: "a", label: "A", price: 100, cost: 150 }, { productId: "b", label: "B", price: 100, cost: 0 }, { productId: "c", label: "C", price: 100, cost: 100 }, { productId: "d", variantId: "v1", label: "D", price: 5, cost: 9 }] });
    expect(a.map((x) => x.refId)).toEqual(["a", "v1"]);
  });
  it("clé d'alerte stable par (type, objet, jour)", () => { expect(alertKey("stock_out", "a", day)).toBe("stock_out|a|2026-11-10"); });
});
