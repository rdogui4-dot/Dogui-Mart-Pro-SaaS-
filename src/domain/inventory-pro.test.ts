import { describe, expect, it } from "vitest";
import { accuracy, checkFreq, classifyAbc, compareCounts, consensus, countOrder, duplicateRefs, farFromTrend, identify, isDue, recurringLoss, statsOf, transferRisk, unitErrorSuspect, unusualVariance } from "./inventory-pro";

describe("classification ABC et cycles", () => {
  it("Pareto 80/95 ; valeur nulle = C ; déterministe", () => {
    const m = classifyAbc([{ id: "a", value: 800 }, { id: "b", value: 150 }, { id: "c", value: 30 }, { id: "d", value: 20 }, { id: "z", value: 0 }]); expect([...m.entries()].sort()).toEqual([["a", "A"], ["b", "B"], ["c", "C"], ["d", "C"], ["z", "C"]]);
    expect(classifyAbc([{ id: "x", value: 0 }]).get("x")).toBe("C");
  });
  it("fréquences : défauts, validation, ordre A ≤ B ≤ C", () => { expect(checkFreq(undefined)).toEqual({ A: 30, B: 90, C: 180 }); expect(checkFreq({ A: 15 }).A).toBe(15); expect(() => checkFreq({ A: 0 })).toThrow(); expect(() => checkFreq({ A: 200 })).toThrow(/A ≤ B ≤ C/); });
  it("échéance de comptage : jamais compté = dû sans ancienneté inventée", () => {
    expect(isDue(null, "2026-11-10", 30)).toEqual({ due: true, overdueDays: null, neverCounted: true }); expect(isDue("2026-10-01", "2026-11-10", 30)).toEqual({ due: true, overdueDays: 10, neverCounted: false }); expect(isDue("2026-11-01", "2026-11-10", 30).due).toBe(false);
  });
});
describe("comptages indépendants", () => {
  it("accord, écart, troisième contrôle selon les seuils ; consensus de deux sur trois", () => {
    const th = { pct: 10, value: 50_000 }; expect(compareCounts(10, 10, 500, th)).toMatchObject({ agree: true, needThird: false }); expect(compareCounts(100, 99, 500, th)).toMatchObject({ agree: false, needThird: false }); expect(compareCounts(100, 80, 500, th).needThird).toBe(true); expect(compareCounts(10, 9, 60_000, th).needThird).toBe(true);
    expect(consensus([10, 12, 12])).toBe(12); expect(consensus([10, 11, 12])).toBeNull(); expect(consensus([5])).toBeNull();
  });
});
describe("anomalies : seulement sur données suffisantes", () => {
  it("écart inhabituel : indéterminé sans historique, signalé au-delà de 2 écarts-types", () => {
    expect(unusualVariance(30, [5, 4]).flag).toBeNull(); expect(unusualVariance(30, [1, 2, 1.5, 2]).flag).toBe(true); expect(unusualVariance(2.5, [1, 2, 1.5, 2]).flag).toBe(false); expect(unusualVariance(30, [1, 2, 1.5]).basis).toMatch(/Moyenne historique/);
    expect(statsOf([2, 4]).mean).toBe(3);
  });
  it("pertes récurrentes (3 sur les 5 derniers)", () => { expect(recurringLoss([-1, 0, -2, 1, -1])).toEqual({ flag: true, losses: 3, of: 5 }); expect(recurringLoss([-1, 2])).toMatchObject({ flag: false }); expect(recurringLoss([1, -1, 1, 1, 1, 1, -1, -1]).flag).toBe(false); });
  it("erreur d'unité : ×12, ÷12, ×10 détectés ; écart ordinaire non", () => {
    expect(unitErrorSuspect(120, 10, [12])).toEqual({ factor: 12, direction: "plus" }); expect(unitErrorSuspect(1, 12, [12])).toEqual({ factor: 12, direction: "moins" }); expect(unitErrorSuspect(100, 10, [])).toEqual({ factor: 10, direction: "plus" }); expect(unitErrorSuspect(9, 10, [12])).toBeNull(); expect(unitErrorSuspect(0, 10, [12])).toBeNull();
  });
  it("loin de la tendance : indéterminé avec < 5 relevés ; > 3× la médiane signalé", () => { expect(farFromTrend(100, [10, 12])).toEqual({ flag: null, median: null }); expect(farFromTrend(100, [10, 12, 11, 9, 10]).flag).toBe(true); expect(farFromTrend(11, [10, 12, 11, 9, 10]).flag).toBe(false); expect(farFromTrend(1, [10, 12, 11, 9, 10]).flag).toBe(true); });
  it("références incohérentes : même code-barres sur deux articles", () => { expect(duplicateRefs([{ id: "1", name: "A", barcode: "123" }, { id: "2", name: "B", barcode: "123" }, { id: "3", name: "C", sku: "x" }])).toEqual([{ ref: "123", field: "barcode", names: ["A", "B"] }]); });
});
describe("précision, ordre, identification, transferts", () => {
  it("taux de précision en lignes et en valeur ; null sans comptage", () => { expect(accuracy([])).toEqual({ lines: null, value: null, counted: 0 }); expect(accuracy([{ diff: 0, theoreticalValue: 1000, valueDiff: 0 }, { diff: -2, theoreticalValue: 1000, valueDiff: -200 }, { diff: null, theoreticalValue: 5, valueDiff: 0 }])).toEqual({ lines: 50, value: 90, counted: 2 }); });
  it("ordre de comptage : zone, classe A d'abord, catégorie, valeur", () => {
    const o = countOrder([{ name: "z", zone: "B", abc: "A", category: "x", value: 1 }, { name: "c", zone: "A", abc: "C", category: "x", value: 9 }, { name: "a", zone: "A", abc: "A", category: "y", value: 5 }, { name: "b", zone: "A", abc: "A", category: "x", value: 3 }]); expect(o.map((x) => x.name)).toEqual(["b", "a", "c", "z"]);
  });
  it("identification : code exact > référence > mots ; jamais de suggestion sous 2 caractères", () => {
    const cat = [{ id: "1", name: "Riz parfumé 25kg", sku: "RZ25", barcode: "6001" }, { id: "2", name: "Riz brisé", barcode: "6002" }, { id: "3", name: "Huile" }]; expect(identify("6001", cat)[0]).toMatchObject({ id: "1", score: 100 }); expect(identify("rz25", cat)[0]!.why).toBe("référence identique"); expect(identify("riz 25kg", cat).map((x) => x.id)).toEqual(["1", "2"]); expect(identify("r", cat)).toEqual([]); expect(identify("zzzz", cat)).toEqual([]);
  });
  it("transfert pendant la campagne : double comptage, marchandise comptée nulle part, ou sans risque", () => {
    const t = { outAt: 100, inAt: 110 }; expect(transferRisk(t, 90, 120)).toBe("double"); expect(transferRisk(t, 105, 105)).toBe("missing"); expect(transferRisk(t, 120, 130)).toBe("ok"); expect(transferRisk(t, null, 130)).toBe("unknown");
  });
});
