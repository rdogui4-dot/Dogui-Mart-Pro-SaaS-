import { describe, expect, it } from "vitest";
import { baseUnitCost, canMove, canReceive, duplicateInvoice, invoiceView, isFreelyEditable, isLateDelivery, lineNet, normRef, poState, poTotals, priceTrend, receiptDiff, supplierBalance, toDeliver } from "./purchasing-plus";

describe("commande : montants", () => {
  it("net de ligne avec remise, arrondi au FCFA ; remise invalide refusée ; coût de base par unité", () => {
    expect(lineNet(10, 1000, 10)).toBe(9000); expect(lineNet(3, 333, 0)).toBe(999); expect(lineNet(3, 333.33, 15)).toBe(850); expect(() => lineNet(1, 1, 101)).toThrow("Remise"); expect(() => lineNet(1, 1, -1)).toThrow(); expect(baseUnitCost(72000, 12)).toBe(6000); expect(baseUnitCost(100, 3)).toBe(33); expect(baseUnitCost(100, 0)).toBe(0);
  });
  it("totaux : frais explicites seulement, taxes uniquement si un taux est configuré", () => {
    const L = [{ lineHt: 9000, qty: 10, unitCost: 900 }, { qty: 2, unitCost: 500 }]; expect(poTotals(L, 1500, 500, 0)).toEqual({ goodsHt: 10000, transport: 1500, otherFees: 500, fees: 2000, totalHt: 12000, taxRatePct: 0, tax: 0, totalTtc: 12000, taxed: false });
    expect(poTotals(L, 0, 0, 18)).toMatchObject({ totalHt: 10000, tax: 1800, totalTtc: 11800, taxed: true }); expect(poTotals(L, 1000, 0, 18)).toMatchObject({ tax: 1980, totalTtc: 12980 }); expect(poTotals([], 0, 0, -5).taxed).toBe(false);
  });
});
describe("statuts de commande", () => {
  it("anciennes commandes « ordered » = validées ; transitions autorisées ; modification libre seulement en brouillon ; réception seulement validée/partielle", () => {
    expect(poState("ordered")).toBe("validated"); expect(poState("draft")).toBe("draft"); expect(poState(undefined)).toBe("validated"); expect(canMove("draft", "pending")).toBe(true); expect(canMove("pending", "validated")).toBe(true); expect(canMove("validated", "draft")).toBe(false); expect(canMove("received", "cancelled")).toBe(false); expect(canMove("cancelled", "draft")).toBe(false);
    expect(isFreelyEditable("draft")).toBe(true); expect(isFreelyEditable("validated")).toBe(false); expect(canReceive("validated")).toBe(true); expect(canReceive("partial")).toBe(true); for (const s of ["draft", "pending", "received", "cancelled"] as const) expect(canReceive(s)).toBe(false);
  });
});
describe("réception : écarts", () => {
  it("manquant = commandé − déjà accepté − accepté du jour ; refusé/endommagé jamais comptés ; dépassement détecté", () => {
    const line = { qty: 100, received: 30 }; expect(toDeliver(line)).toBe(70); expect(receiptDiff(line, { accepted: 50, damaged: 5, refused: 3 })).toEqual({ ordered: 100, receivedBefore: 30, accepted: 50, damaged: 5, refused: 3, delivered: 58, missingAfter: 20, over: false });
    expect(receiptDiff(line, { accepted: 71, damaged: 0, refused: 0 })).toMatchObject({ over: true, missingAfter: 0 }); expect(receiptDiff({ qty: 1.5, received: 0.5 }, { accepted: 1, damaged: 0, refused: 0 }).missingAfter).toBe(0);
  });
});
describe("factures fournisseurs", () => {
  it("statut, reste dû, retard, litige ; solde fournisseur = factures − paiements", () => {
    expect(invoiceView({ total: 1000, paid: 0, dueOn: "2026-11-20" }, "2026-11-10")).toEqual({ state: "to_pay", remaining: 1000, overdue: false, lateDays: 0 }); expect(invoiceView({ total: 1000, paid: 400, dueOn: "2026-11-01" }, "2026-11-10")).toEqual({ state: "partial", remaining: 600, overdue: true, lateDays: 9 }); expect(invoiceView({ total: 1000, paid: 1000, dueOn: "2026-11-01" }, "2026-11-10")).toMatchObject({ state: "paid", overdue: false });
    expect(invoiceView({ total: 1000, paid: 0, disputed: true }, "2026-11-10").state).toBe("dispute"); expect(invoiceView({ total: 1000, paid: 1000, disputed: true }, "2026-11-10").state).toBe("paid"); expect(supplierBalance([{ total: 1000, paid: 400 }, { total: 500, paid: 500 }, { total: 200, paid: 0 }])).toBe(800); expect(supplierBalance([])).toBe(0);
  });
  it("doublon : même référence (insensible à la casse et aux séparateurs) ou même montant à ≤ 3 jours", () => {
    const ex = [{ id: "a", ref: "FA-2026/001", total: 50000, issuedOn: "2026-11-01", number: "FF-1" }]; expect(normRef(" fa 2026-001 ")).toBe("FA2026001"); expect(duplicateInvoice(ex, { ref: "fa2026 001", total: 1, issuedOn: "2027-01-01" })).toMatchObject({ kind: "same_ref", of: { id: "a" } });
    expect(duplicateInvoice(ex, { ref: "X-9", total: 50000, issuedOn: "2026-11-03" })).toMatchObject({ kind: "same_amount" }); expect(duplicateInvoice(ex, { ref: "X-9", total: 50000, issuedOn: "2026-11-05" })).toBeNull(); expect(duplicateInvoice(ex, { ref: "", total: 50001, issuedOn: "2026-11-01" })).toBeNull(); expect(duplicateInvoice([], { ref: "A", total: 1, issuedOn: "2026-11-01" })).toBeNull();
  });
  it("retard de livraison seulement s'il reste à recevoir ; évolution du prix d'achat", () => {
    expect(isLateDelivery("2026-11-05", "2026-11-10", 5)).toBe(true); expect(isLateDelivery("2026-11-05", "2026-11-10", 0)).toBe(false); expect(isLateDelivery("2026-11-10", "2026-11-10", 5)).toBe(false); expect(isLateDelivery(undefined, "2026-11-10", 5)).toBe(false); expect(priceTrend(1000, 1100)).toBe(10); expect(priceTrend(1000, 900)).toBe(-10); expect(priceTrend(0, 900)).toBeNull();
  });
});
