import { describe, expect, it } from "vitest";
import { aging, agingKey, balanceOf, budgetState, classifyJournal, dedupe, routing, suggestMatches, validDay, validMonth, type Account, type Flow, type Transfer } from "./fin";

const acc = (id: string, methods: string[], over: Partial<Account> = {}): Account => ({ id, name: id, kind: "cash", methods, openingBalance: 1000, openingDate: "2026-01-01", active: true, ...over });
const flow = (key: string, method: string, amount: number, date = "2026-02-01"): Flow => ({ key, source: "sale", ref: key, date, method, amount, label: "", by: "", status: "ok" });

describe("fin domaine", () => {
  it("valide les dates", () => { expect(validDay("2026-02-30")).toBeNull(); expect(validDay("2026-02-28")).toBe("2026-02-28"); expect(validDay("x")).toBeNull(); expect(validMonth("2026-13")).toBeNull(); expect(validMonth("2026-12")).toBe("2026-12"); });
  it("classe les écritures", () => {
    expect(classifyJournal("RF-F1", "Règlement F1")).toBe("supplier_payment"); expect(classifyJournal("R-AB12", "Remboursement crédit Awa")).toBe("credit_repay");
    expect(classifyJournal("V-1", "Remboursement vente V-1")).toBe("refund"); expect(classifyJournal("V-2", "Vente V-2")).toBe("sale"); expect(classifyJournal("Z", "?")).toBe("other");
  });
  it("compte non configuré : aucun solde", () => { const a = acc("a", ["cash"], { openingBalance: null, openingDate: null }); expect(balanceOf(a, [flow("1", "cash", 500)], [], routing([a])).balance).toBeNull(); });
  it("solde = ouverture + flux affectés, flux antérieurs à l'ouverture ignorés", () => {
    const a = acc("a", ["cash"]); const r = routing([a]); const b = balanceOf(a, [flow("1", "cash", 500), flow("2", "cash", -200), flow("3", "cash", 999, "2025-12-31"), flow("4", "wave", 700)], [], r);
    expect(b.balance).toBe(1300); expect(b.inflow).toBe(500); expect(b.outflow).toBe(200);
  });
  it("un moyen n'est affecté qu'à un seul compte", () => { const a = acc("a", ["cash"]); const b = acc("b", ["cash", "wave"]); const r = routing([a, b]); expect(r.get("cash")).toBe("a"); expect(r.get("wave")).toBe("b"); });
  it("comptes inactifs non routés", () => { expect(routing([acc("a", ["cash"], { active: false })]).size).toBe(0); });
  it("virements : seuls les confirmés comptent, et ils ne changent pas le total", () => {
    const a = acc("a", ["cash"]); const b = acc("b", ["card"], { kind: "bank" }); const r = routing([a, b]);
    const tr: Transfer[] = [{ id: "1", fromId: "a", toId: "b", amount: 300, date: "2026-02-02", status: "confirmed" }, { id: "2", fromId: "a", toId: "b", amount: 900, date: "2026-02-02", status: "pending" }, { id: "3", fromId: "a", toId: "b", amount: 50, date: "2026-02-02", status: "cancelled" }];
    const ba = balanceOf(a, [], tr, r), bb = balanceOf(b, [], tr, r); expect(ba.balance).toBe(700); expect(bb.balance).toBe(1300); expect(ba.balance! + bb.balance!).toBe(2000);
  });
  it("calcul à une date", () => { const a = acc("a", ["cash"]); expect(balanceOf(a, [flow("1", "cash", 500, "2026-03-01")], [], routing([a]), "2026-02-15").balance).toBe(1000); });
  it("dédoublonne les flux", () => { expect(dedupe([flow("1", "cash", 5), flow("1", "cash", 5), flow("2", "cash", 5)])).toHaveLength(2); });
  it("échéances", () => {
    expect(agingKey(null, "2026-05-10")).toBe("noDue"); expect(agingKey("2026-05-10", "2026-05-10")).toBe("notDue"); expect(agingKey("2026-05-01", "2026-05-10")).toBe("d30"); expect(agingKey("2026-03-20", "2026-05-10")).toBe("d60"); expect(agingKey("2026-01-01", "2026-05-10")).toBe("d90p");
    const g = aging([{ due: "2026-05-01", remaining: 100 }, { due: "2026-06-01", remaining: 50 }, { due: null, remaining: 10 }, { due: "2026-05-01", remaining: 0 }], "2026-05-10"); expect(g.d30).toBe(100); expect(g.notDue).toBe(50); expect(g.noDue).toBe(10);
  });
  it("suggestions de rapprochement : montant égal, date proche, chaque flux une fois", () => {
    const fl = [flow("a", "card", 500, "2026-02-01"), flow("b", "card", 500, "2026-02-04"), flow("c", "card", 700, "2026-02-01")];
    const s = suggestMatches([{ date: "2026-02-01", amount: 500, label: "x" }, { date: "2026-02-01", amount: 500, label: "y" }, { date: "2026-03-01", amount: 700, label: "z" }], fl);
    expect(s.map((x) => x.flowKey)).toEqual(["a", "b"]); expect(s[0]!.score).toBe(100);
  });
  it("budgets", () => { expect(budgetState(50, 100)).toBe("ok"); expect(budgetState(85, 100)).toBe("warn"); expect(budgetState(101, 100)).toBe("over"); expect(budgetState(1, 0)).toBe("over"); });
});
