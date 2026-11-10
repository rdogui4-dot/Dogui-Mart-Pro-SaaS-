import { describe, expect, it } from "vitest";
import { allocate, budgetBreaches, budgetCovers, budgetUse, categoryVariation, detectRecurring, findDuplicates, matchRule, nextLevel, occurrences, periodBounds, periodKey, project, type Budget, type Rule } from "./expenses-pro";

const B = (o: Partial<Budget> = {}): Budget => ({ id: "b", shopId: "", kind: "month", key: "2026-11", category: "", service: "", amount: 100000, mode: "approval", active: true, ...o });
describe("périodes", () => {
  it("clés et bornes mensuelles, trimestrielles, annuelles (fin de mois, T4, bissextile)", () => {
    expect(periodKey("month", "2026-11-09")).toBe("2026-11"); expect(periodKey("quarter", "2026-11-09")).toBe("2026-Q4"); expect(periodKey("quarter", "2026-01-01")).toBe("2026-Q1"); expect(periodKey("year", "2026-06-30")).toBe("2026");
    expect(periodBounds("month", "2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" }); expect(periodBounds("month", "2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" }); expect(periodBounds("month", "2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(periodBounds("quarter", "2026-Q1")).toEqual({ from: "2026-01-01", to: "2026-03-31" }); expect(periodBounds("quarter", "2026-Q2")).toEqual({ from: "2026-04-01", to: "2026-06-30" }); expect(periodBounds("quarter", "2026-Q3")).toEqual({ from: "2026-07-01", to: "2026-09-30" }); expect(periodBounds("quarter", "2026-Q4")).toEqual({ from: "2026-10-01", to: "2026-12-31" }); expect(periodBounds("year", "2026")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
});
describe("budgets", () => {
  const rows = [{ shopId: "A", category: "transport", amount: 30000, spentOn: "2026-11-02", status: "approved" }, { shopId: "A", category: "eau", amount: 5000, spentOn: "2026-11-03", status: "approved" }, { shopId: "B", category: "transport", amount: 20000, spentOn: "2026-11-04", status: "pending" }, { shopId: "A", category: "transport", amount: 9000, spentOn: "2026-11-20", status: "planned" }, { shopId: "A", category: "transport", amount: 7000, spentOn: "2026-10-30", status: "approved" }, { shopId: "A", category: "transport", amount: 1, spentOn: "2026-11-05", status: "cancelled" }, { shopId: "A", category: "transport", amount: 1, spentOn: "2026-11-05", status: "rejected" }];
  it("portée boutique/catégorie/service/période ; réalisé, en attente, planifié distincts ; annulé et rejeté ignorés", () => {
    expect(budgetCovers(B({ shopId: "A", category: "transport" }), { shopId: "B", category: "transport", amount: 1, spentOn: "2026-11-05" })).toBe(false); expect(budgetCovers(B({ active: false }), rows[0]!)).toBe(false); expect(budgetCovers(B({ service: "Atelier" }), { ...rows[0]!, service: "Atelier" })).toBe(true); expect(budgetCovers(B({ service: "Atelier" }), rows[0]!)).toBe(false);
    const u = budgetUse(B(), rows); expect(u).toMatchObject({ realized: 35000, pending: 20000, planned: 9000, committed: 55000, remaining: 45000, usedPct: 55, over: false }); const t = budgetUse(B({ shopId: "A", category: "transport" }), rows); expect(t).toMatchObject({ realized: 30000, pending: 0, planned: 9000 });
    expect(budgetUse(B({ kind: "quarter", key: "2026-Q4" }), rows).realized).toBe(42000); expect(budgetUse(B({ amount: 0 }), rows).usedPct).toBeNull();
  });
  it("dépassement : engagé + nouvelle dépense > plafond", () => {
    expect(budgetBreaches([B()], rows, { shopId: "A", category: "eau", amount: 45000, spentOn: "2026-11-09" })).toEqual([]); const x = budgetBreaches([B()], rows, { shopId: "A", category: "eau", amount: 45001, spentOn: "2026-11-09" }); expect(x[0]).toMatchObject({ after: 100001, excess: 1 });
    expect(budgetBreaches([B({ amount: 50000 }), B({ id: "t", category: "transport", amount: 200000 })], rows, { shopId: "A", category: "transport", amount: 100, spentOn: "2026-11-09" }).map((b) => b.use.budget.id)).toEqual(["b"]);
  });
});
describe("circuit d'approbation", () => {
  const rules: Rule[] = [{ id: "1", name: "Gros", minAmount: 100000, category: "", shopId: "", levels: ["manager", "owner"], active: true }, { id: "2", name: "Salaires", minAmount: 0, category: "salaires", shopId: "", levels: ["owner"], active: true }, { id: "3", name: "Moyen", minAmount: 20000, category: "", shopId: "", levels: ["manager"], active: true }, { id: "4", name: "Off", minAmount: 0, category: "", shopId: "", levels: ["owner"], active: false }];
  it("règle la plus spécifique puis au plus gros seuil ; inactive ignorée ; aucune règle sous le seuil", () => {
    expect(matchRule(rules, { amount: 500, category: "eau", shopId: "A" })).toBeNull(); expect(matchRule(rules, { amount: 25000, category: "eau", shopId: "A" })?.id).toBe("3"); expect(matchRule(rules, { amount: 150000, category: "eau", shopId: "A" })?.id).toBe("1"); expect(matchRule(rules, { amount: 150000, category: "salaires", shopId: "A" })?.id).toBe("2");
  });
  it("niveaux : un gérant ne franchit pas un niveau propriétaire ; un utilisateur ne valide pas deux niveaux (sauf propriétaire)", () => {
    const L: ("manager" | "owner")[] = ["manager", "owner"]; expect(nextLevel(L, [], { id: "g1", tier: "manager" })).toEqual({ index: 0 }); const a1 = [{ by: "g1", tier: "manager" as const, at: "", via: "decision" as const }];
    expect((nextLevel(L, a1, { id: "g2", tier: "manager" }) as { error: string }).error).toContain("propriétaire"); expect((nextLevel(L, a1, { id: "g1", tier: "manager" }) as { error: string }).error).toContain("déjà validé"); expect(nextLevel(L, a1, { id: "o", tier: "owner" })).toEqual({ index: 1 });
    expect(nextLevel(["manager", "manager"], a1, { id: "g2", tier: "manager" })).toEqual({ index: 1 }); expect(nextLevel(["owner", "manager"], [{ by: "o", tier: "owner", at: "", via: "code" }], { id: "o", tier: "owner" })).toEqual({ index: 1 }); expect((nextLevel(["manager"], a1, { id: "x", tier: "owner" }) as { error: string }).error).toContain("déjà validés");
  });
});
describe("récurrence", () => {
  it("mensuel avec jour 31 ramené à la fin des mois courts ; trimestriel ; annuel ; hebdomadaire ; borne de fin", () => {
    expect(occurrences({ startOn: "2026-01-31", frequency: "monthly" }, "2026-01-01", "2026-04-30")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]); expect(occurrences({ startOn: "2026-01-05", frequency: "quarterly" }, "2026-01-01", "2026-12-31")).toEqual(["2026-01-05", "2026-04-05", "2026-07-05", "2026-10-05"]);
    expect(occurrences({ startOn: "2025-03-10", frequency: "yearly" }, "2026-01-01", "2027-12-31")).toEqual(["2026-03-10", "2027-03-10"]); expect(occurrences({ startOn: "2026-11-02", frequency: "weekly" }, "2026-11-09", "2026-11-30")).toEqual(["2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]);
    expect(occurrences({ startOn: "2026-01-01", endOn: "2026-02-15", frequency: "monthly" }, "2026-01-01", "2026-12-31")).toEqual(["2026-01-01", "2026-02-01"]); expect(occurrences({ startOn: "2026-12-15", frequency: "monthly" }, "2026-12-01", "2027-02-28")).toEqual(["2026-12-15", "2027-01-15", "2027-02-15"]);
  });
});
describe("anomalies", () => {
  const R = (id: string, o: object = {}) => ({ id, label: "Loyer", beneficiary: "Bailleur", category: "loyer", amount: 150000, spentOn: "2026-01-05", createdBy: "u", shopId: "A", ...o });
  it("variation : pas d'alerte sans 3 mois d'historique ; alerte si ≥ 2× la moyenne et > 1 écart-type", () => {
    expect(categoryVariation(100000, [10000, 12000]).unusual).toBe(false); expect(categoryVariation(25000, [10000, 11000, 9000, 10000])).toMatchObject({ unusual: true, ratio: 2.5 }); expect(categoryVariation(15000, [10000, 11000, 9000, 10000]).unusual).toBe(false); expect(categoryVariation(1, [0, 0, 0]).ratio).toBeNull();
  });
  it("doublons : même montant, libellé et bénéficiaire à ≤ 3 jours ; accents et casse ignorés ; au-delà, pas de doublon", () => {
    expect(findDuplicates([R("a"), R("b", { spentOn: "2026-01-07", label: "LOYER" }), R("c", { spentOn: "2026-01-20" })]).map((g) => g.map((x) => x.id))).toEqual([["a", "b"]]); expect(findDuplicates([R("a"), R("b", { amount: 150001 })])).toEqual([]);
  });
  it("récurrence détectée sur ≥ 3 mensualités régulières et stables ; irrégulier ou montants variables ignorés ; prochaine date estimée", () => {
    const m = [R("1", { spentOn: "2026-08-05" }), R("2", { spentOn: "2026-09-05" }), R("3", { spentOn: "2026-10-05", amount: 152000 })]; const d = detectRecurring(m); expect(d.length).toBe(1); expect(d[0]).toMatchObject({ occurrences: 3, nextOn: "2026-11-05", amount: 150000 });
    expect(detectRecurring([R("1", { spentOn: "2026-08-05" }), R("2", { spentOn: "2026-09-25" }), R("3", { spentOn: "2026-10-05" })])).toEqual([]); expect(detectRecurring([R("1", { spentOn: "2026-08-05" }), R("2", { spentOn: "2026-09-05", amount: 90000 }), R("3", { spentOn: "2026-10-05" })])).toEqual([]); expect(detectRecurring(m.slice(0, 2))).toEqual([]);
  });
});
describe("prévision de trésorerie", () => {
  it("solde projeté = ouverture + entrées − sorties ; premier jour négatif et minimum ; entrées nulles", () => {
    const p = project({ from: "2026-11-10", days: 5, opening: 10000, inflowPerDay: 1000, flows: [{ on: "2026-11-11", amount: 8000, label: "Loyer", kind: "payable" }, { on: "2026-11-13", amount: 9000, label: "Salaires", kind: "planned" }] });
    expect(p.days.map((d) => d.balance)).toEqual([11000, 4000, 5000, -3000, -2000]); expect(p).toMatchObject({ minBalance: -3000, minOn: "2026-11-13", firstNegativeOn: "2026-11-13", totalOut: 17000, totalIn: 5000 });
    expect(project({ from: "2026-11-10", days: 2, opening: 500, inflowPerDay: 0, flows: [] }).firstNegativeOn).toBeNull();
  });
  it("solde d'ouverture inconnu : jamais de solde inventé (null partout), flux conservés", () => {
    const p = project({ from: "2026-11-10", days: 3, opening: null, inflowPerDay: 100, flows: [{ on: "2026-11-11", amount: 500, label: "x", kind: "payable" }] }); expect(p.days.every((d) => d.balance === null)).toBe(true); expect(p.minBalance).toBeNull(); expect(p.firstNegativeOn).toBeNull(); expect(p.totalOut).toBe(500);
  });
});
describe("ventilation entre boutiques", () => {
  it("pourcentages (reliquat d'arrondi à la première), montants exacts, erreurs explicites", () => {
    expect(allocate(100000, [{ shopId: "A", pct: 33.33 }, { shopId: "B", pct: 33.33 }, { shopId: "C", pct: 33.34 }])).toEqual([{ shopId: "A", amount: 33330 }, { shopId: "B", amount: 33330 }, { shopId: "C", amount: 33340 }]); expect(allocate(10, [{ shopId: "A", pct: 50 }, { shopId: "B", pct: 50 }])).toEqual([{ shopId: "A", amount: 5 }, { shopId: "B", amount: 5 }]);
    expect(allocate(101, [{ shopId: "A", pct: 50 }, { shopId: "B", pct: 50 }])).toEqual([{ shopId: "A", amount: 51 }, { shopId: "B", amount: 50 }]); expect(allocate(100, [{ shopId: "A", amount: 60 }, { shopId: "B", amount: 40 }])).toEqual([{ shopId: "A", amount: 60 }, { shopId: "B", amount: 40 }]);
    expect(allocate(100, [{ shopId: "A", amount: 60 }, { shopId: "B", amount: 30 }])).toHaveProperty("error"); expect(allocate(100, [{ shopId: "A", pct: 60 }, { shopId: "B", pct: 30 }])).toHaveProperty("error"); expect(allocate(100, [{ shopId: "A", pct: 50 }, { shopId: "A", pct: 50 }])).toHaveProperty("error"); expect(allocate(100, [])).toHaveProperty("error");
  });
});
