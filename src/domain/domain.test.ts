import { describe, expect, it } from "vitest";
import { cartTotal, settle, lineTotal } from "./money";
import { tierFor, earnedPoints, redeemablePoints } from "./loyalty";
import { canExtendCredit, applyRepayment } from "./credit";
import { saleJournal, purchaseJournal, isBalanced } from "./accounting";
import { stockOf, reorderQty } from "./stock";
import { gatewayFor, isValidPhone } from "./mobile-money";

describe("money", () => {
  it("totalise avec remise", () => {
    expect(lineTotal({ productId: "a", name: "A", unitPrice: 1000, qty: 3, discountPct: 10 })).toBe(2700);
    expect(cartTotal([{ productId: "a", name: "A", unitPrice: 500, qty: 2 }])).toBe(1000);
  });
  it("refuse un paiement insuffisant et rend la monnaie en espèces seulement", () => {
    expect(settle(1000, [{ method: "cash", amount: 500 }]).ok).toBe(false);
    expect(settle(1000, [{ method: "cash", amount: 2000 }])).toMatchObject({ ok: true, change: 1000 });
    expect(settle(1000, [{ method: "momo", amount: 1500 }]).ok).toBe(false);
  });
});
describe("loyalty", () => {
  it("paliers et points bonus", () => {
    expect(tierFor(50_000)).toBe("bronze");
    expect(tierFor(600_000)).toBe("gold");
    expect(earnedPoints(10_000, "gold")).toBe(120);
  });
  it("plafonne l'utilisation des points", () => {
    expect(redeemablePoints(10_000, 10_000)).toBe(500);
    expect(redeemablePoints(100, 10_000)).toBe(100);
  });
});
describe("credit", () => {
  it("respecte le plafond", () => {
    expect(canExtendCredit({ balance: 8000, limit: 10_000 }, 3000).ok).toBe(false);
    expect(applyRepayment({ balance: 5000, limit: 10_000 }, 9000).balance).toBe(0);
  });
});
describe("accounting", () => {
  it("écritures de vente et d'achat équilibrées", () => {
    const s = saleJournal({ ref: "V1", date: "2026-01-01", totalTtc: 11_800, vatRatePct: 18, payments: [{ method: "cash", amount: 5000 }, { method: "credit", amount: 6800 }] });
    expect(isBalanced(s)).toBe(true);
    expect(isBalanced(purchaseJournal({ ref: "A1", date: "2026-01-01", totalTtc: 11_800, vatRatePct: 18 }))).toBe(true);
  });
});
describe("stock", () => {
  it("se déduit des mouvements", () => {
    expect(stockOf([{ productId: "a", qty: 10, kind: "purchase" }, { productId: "a", qty: 3, kind: "sale" }, { productId: "a", qty: -1, kind: "adjust" }])).toBe(6);
    expect(reorderQty(2, 60)).toBe(26);
  });
});
describe("mobile money", () => {
  it("échoue sans configuration (fail closed)", async () => {
    await expect(gatewayFor(undefined).requestToPay({ provider: "mtn", phone: "770000000", amount: 1, saleId: "s", idempotencyKey: "k" })).rejects.toThrow();
    expect(isValidPhone("+221 77 123 45 67")).toBe(true);
  });
});
