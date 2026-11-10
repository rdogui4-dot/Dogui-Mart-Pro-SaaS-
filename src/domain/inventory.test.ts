import { describe, expect, it } from "vitest";
import { canCount, canMove, checkThreshold, isConflict, isDoubleTap, isSignificant, movesBetween, progress, revealsTheoretical, theoreticalAt, validationBlockers, varianceOf, varianceValue } from "./inventory";

const M = (kind: any, qty: number, at: number) => ({ kind, qty, at });
describe("stock théorique à une date", () => {
  it("somme les mouvements jusqu'à l'instant de référence (inclus), ignore les suivants", () => {
    const mv = [M("adjust", 10, 1), M("purchase", 5, 2), M("sale", 3, 3), M("sale", 4, 10)];
    expect(theoreticalAt(mv, 3)).toBe(12); expect(theoreticalAt(mv, 10)).toBe(8); expect(theoreticalAt(mv, 0)).toBe(0);
  });
  it("regroupe ce qui s'est passé pendant le comptage (ventes, réceptions, retours, transferts, autres) et signale le récent", () => {
    const mv = [M("sale", 2, 100), M("purchase", 6, 150), M("return", 1, 160), M("transfer_out", 4, 170), M("loss", 1, 180), M("sale", 9, 50), M("sale", 7, 999)];
    const r = movesBetween(mv, 100, 200); expect(r.net).toEqual({ sales: 0, receipts: 6, returns: 1, transfers: -4, other: -1 }); expect(r.count).toBe(4); expect(r.recent).toBe(4);
  });
});
describe("écarts", () => {
  it("écart = compté − théorique, valorisé au coût", () => { expect(varianceOf(8, 10)).toBe(-2); expect(varianceValue(-2, 750)).toBe(-1500); expect(varianceValue(0.5, 333)).toBe(167); });
  it("écart important : valeur OU pourcentage ; théorique nul = important ; aucun écart = jamais", () => {
    expect(isSignificant(0, 10, 0)).toBe(false); expect(isSignificant(-1, 100, -500)).toBe(false); expect(isSignificant(-10, 100, -500)).toBe(true); expect(isSignificant(-1, 100, -60_000)).toBe(true); expect(isSignificant(2, 0, 100)).toBe(true);
    expect(isSignificant(-5, 100, -100, { pct: 3, value: 1_000_000 })).toBe(true);
  });
  it("valide le seuil configurable", () => { expect(checkThreshold(undefined)).toEqual({ pct: 10, value: 50_000 }); expect(checkThreshold({ pct: 5, value: 1000.4 })).toEqual({ pct: 5, value: 1000 }); expect(() => checkThreshold({ pct: -1 })).toThrow(); expect(() => checkThreshold({ value: "abc" })).toThrow(); });
});
describe("statuts et saisie", () => {
  it("transitions autorisées uniquement ; comptage seulement en cours ; écart révélé après la fin du comptage", () => {
    expect(canMove("draft", "in_progress")).toBe(true); expect(canMove("draft", "validated")).toBe(false); expect(canMove("closed", "in_progress")).toBe(false); expect(canMove("validated", "cancelled")).toBe(false); expect(canMove("validated", "closed")).toBe(true);
    expect(canCount("in_progress")).toBe(true); expect(canCount("counted")).toBe(false); expect(revealsTheoretical("in_progress")).toBe(false); expect(revealsTheoretical("counted")).toBe(true);
  });
  it("double appui (même agent, même quantité, < 5 s) ignoré ; deux agents en désaccord = conflit", () => {
    expect(isDoubleTap({ by: "a", qty: 5, at: 1000 }, { by: "a", qty: 5, at: 2000 })).toBe(true); expect(isDoubleTap({ by: "a", qty: 5, at: 1000 }, { by: "a", qty: 5, at: 9000 })).toBe(false); expect(isDoubleTap({ by: "a", qty: 5, at: 1000 }, { by: "a", qty: 6, at: 1500 })).toBe(false); expect(isDoubleTap(null, { by: "a", qty: 1, at: 1 })).toBe(false);
    expect(isConflict({ by: "a", qty: 5 }, { by: "b", qty: 6 })).toBe(true); expect(isConflict({ by: "a", qty: 5 }, { by: "b", qty: 5 })).toBe(false); expect(isConflict({ by: "a", qty: 5 }, { by: "a", qty: 6 })).toBe(false);
  });
  it("avancement et obstacles à la validation", () => {
    expect(progress([{ status: "counted", counted: 1 }, { status: "pending", counted: null }, { status: "recount", counted: 2 }])).toEqual({ total: 3, counted: 1, pending: 1, recount: 1, pct: 33 });
    expect(validationBlockers([{ status: "counted", diff: -2, significant: false }, { status: "recount", diff: 1, significant: true }, { status: "approved", diff: 3, significant: false, reason: "" }, { status: "pending", diff: null, significant: false }])).toHaveLength(3);
    expect(validationBlockers([{ status: "approved", diff: 3, significant: false, reason: "casse" }, { status: "rejected", diff: 1, significant: false }, { status: "counted", diff: 0, significant: false }, { status: "pending", diff: null, significant: false }])).toEqual([]);
  });
});
