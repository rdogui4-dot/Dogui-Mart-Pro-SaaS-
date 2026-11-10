import { describe, expect, it } from "vitest";
import { isIdle, isXferLate, needsAction, receivable, stockStatus, valuation, xferCanMove, xferStatusAfterReceipt, xferTotals } from "./stock-intel";

describe("statut de stock", () => {
  it("négatif, rupture, faible (≤ minimum), à surveiller (≤ seuil d'alerte), disponible", () => {
    expect(stockStatus(-2, 5)).toBe("negative"); expect(stockStatus(0, 5)).toBe("out"); expect(stockStatus(5, 5)).toBe("low"); expect(stockStatus(8, 5, 10)).toBe("watch"); expect(stockStatus(11, 5, 10)).toBe("ok"); expect(stockStatus(3, 0)).toBe("ok"); expect(stockStatus(3, 0, 5)).toBe("watch");
    expect(needsAction("low") && needsAction("out") && needsAction("negative")).toBe(true); expect(needsAction("watch")).toBe(false);
  });
  it("sans mouvement : seulement un article en stock ; jamais de mouvement = dormant", () => { const now = Date.UTC(2026, 10, 10); expect(isIdle(5, now - 70 * 864e5, now, 60)).toEqual({ idle: true, days: 70 }); expect(isIdle(5, now - 10 * 864e5, now, 60).idle).toBe(false); expect(isIdle(0, now - 99 * 864e5, now, 60).idle).toBe(false); expect(isIdle(3, null, now, 60)).toEqual({ idle: true, days: null }); });
});
describe("valorisation", () => {
  it("quantité × coût ; sans coût et négatifs signalés, jamais valorisés", () => { expect(valuation([{ qty: 10, cost: 500 }, { qty: 4, cost: 0 }, { qty: -3, cost: 100 }, { qty: 0, cost: 0 }, { qty: 2.5, cost: 100 }])).toEqual({ value: 5250, missingCost: 1, negativeQty: 1 }); });
});
describe("transferts", () => {
  it("machine d'états : préparé → expédié → (partiel) → reçu ou clôturé avec écart ; annulation avant expédition seulement", () => {
    expect(xferCanMove("draft", "shipped")).toBe(true); expect(xferCanMove("draft", "received")).toBe(false); expect(xferCanMove("shipped", "cancelled")).toBe(false); expect(xferCanMove("partial", "partial")).toBe(true); expect(xferCanMove("received", "partial")).toBe(false); expect(xferCanMove("closed", "received")).toBe(false);
  });
  it("quantités expédiée, reçue, manquante, en transit ; statut après réception ; plafond de réception", () => {
    const lines = [{ qty: 10, received: 6 }, { qty: 5, received: 5 }]; expect(xferTotals(lines)).toEqual({ sent: 15, received: 11, missing: 4, inTransit: 4 }); expect(xferStatusAfterReceipt(lines)).toBe("partial"); expect(xferStatusAfterReceipt([{ qty: 2, received: 2 }])).toBe("received"); expect(receivable(lines[0]!)).toBe(4); expect(receivable({ qty: 1, received: 3 })).toBe(0);
  });
  it("transfert en retard seulement s'il est ouvert depuis plus que le délai", () => { const now = Date.now(); expect(isXferLate(now - 5 * 864e5, now, 3, "shipped")).toBe(true); expect(isXferLate(now - 2 * 864e5, now, 3, "partial")).toBe(false); expect(isXferLate(now - 9 * 864e5, now, 3, "received")).toBe(false); });
});
