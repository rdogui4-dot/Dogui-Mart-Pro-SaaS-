import { describe, expect, it } from "vitest";
import { addDays, boundsOf, dayKeyer, monthStart, resolvePeriod, summarize, todayIn, type SaleIn } from "./overview";

const sale = (o: Partial<SaleIn> = {}): SaleIn => ({ total: 1180, vat: 180, soldAt: "2026-11-10T10:00:00Z", status: "paid", payments: [{ method: "cash", amount: 1180 }], lines: [{ productId: "a", name: "A", qty: 2, unitPrice: 590, unitCost: 300 }], ...o });
describe("périodes", () => {
  it("présélections en jours calendaires de l'entreprise (fin de mois, janvier, mois précédent)", () => {
    const r = (p: string, t: string) => { const x = resolvePeriod(p, t); if (!x.ok) throw new Error(x.error); return `${x.period.from}→${x.period.to}`; };
    expect(r("today", "2026-03-01")).toBe("2026-03-01→2026-03-01"); expect(r("yesterday", "2026-03-01")).toBe("2026-02-28→2026-02-28"); expect(r("last7", "2026-03-03")).toBe("2026-02-25→2026-03-03"); expect(r("last30", "2026-03-30")).toBe("2026-03-01→2026-03-30");
    expect(r("month", "2026-11-09")).toBe("2026-11-01→2026-11-09"); expect(r("lastMonth", "2026-01-15")).toBe("2025-12-01→2025-12-31"); expect(r("lastMonth", "2026-03-31")).toBe("2026-02-01→2026-02-28"); expect(r("inconnu", "2026-03-31")).toBe("2026-03-02→2026-03-31");
  });
  it("période personnalisée : validée, bornée à aujourd'hui, 92 jours au plus", () => {
    expect(resolvePeriod("custom", "2026-11-09", { from: "2026-11-01", to: "2027-01-01" })).toMatchObject({ ok: true, period: { to: "2026-11-09" } });
    for (const c of [{ from: "2026-02-30", to: "2026-03-01" }, { from: "2026-03-05", to: "2026-03-01" }, { from: "2027-01-01", to: "2027-02-01" }, { from: "2026-01-01", to: "2026-11-09" }, {}]) expect(resolvePeriod("custom", "2026-11-09", c).ok).toBe(false);
  });
  it("bornes UTC et jour de l'entreprise selon le fuseau", () => {
    expect(boundsOf("2026-11-10", "2026-11-10", "Africa/Lagos")).toEqual({ gte: "2026-11-09T23:00:00.000Z", lt: "2026-11-10T23:00:00.000Z" }); expect(todayIn(new Date("2026-11-09T23:30:00Z"), "Africa/Lagos")).toBe("2026-11-10"); expect(todayIn(new Date("2026-11-09T23:30:00Z"), "Africa/Dakar")).toBe("2026-11-09");
    const k = dayKeyer("Asia/Kolkata"); expect(k("2026-11-09T18:29:59Z")).toBe("2026-11-09"); expect(k("2026-11-09T18:30:00Z")).toBe("2026-11-10"); expect(addDays("2026-12-31", 1)).toBe("2027-01-01"); expect(monthStart("2026-11-09")).toBe("2026-11-01");
  });
});
describe("agrégats", () => {
  const range = { from: "2026-11-10", to: "2026-11-10" };
  it("ne compte que les ventes terminées de la plage ; marge seulement si tout le coût est connu", () => {
    const s = summarize([sale(), sale({ status: "pending" }), sale({ status: "cancelled" }), sale({ soldAt: "2026-11-11T10:00:00Z" })], range, "Africa/Dakar");
    expect(s).toMatchObject({ count: 1, revenue: 1180, vat: 180, avgBasket: 1180, encaisse: 1180, credit: 0 }); expect(s.margin).toMatchObject({ known: true, amount: 1000 - 600, pct: 40 });
    const m = summarize([sale({ lines: [{ productId: "a", name: "A", qty: 1, unitPrice: 1180 }] })], range, "Africa/Dakar").margin; expect(m).toMatchObject({ known: false, amount: null, pct: null, linesWithoutCost: 1 });
    expect(summarize([], range, "Africa/Dakar")).toMatchObject({ count: 0, revenue: 0, avgBasket: 0 }); expect(summarize([], range, "Africa/Dakar").margin.known).toBe(false);
  });
  it("paiements fractionnés, crédit et monnaie rendue : la somme encaissé + crédit égale le chiffre d'affaires", () => {
    const s = summarize([sale({ total: 3000, vat: 0, payments: [{ method: "cash", amount: 1000 }, { method: "card", amount: 500 }, { method: "credit", amount: 1500 }] }), sale({ total: 1000, vat: 0, payments: [{ method: "cash", amount: 5000 }] })], range, "Africa/Dakar");
    expect(s.byMethod).toEqual({ cash: 2000, card: 500, credit: 1500 }); expect(s.encaisse + s.credit).toBe(s.revenue);
  });
  it("top 5, catégories actuelles et séries à zéro sur les jours sans vente", () => {
    const rows = ["a", "b", "c", "d", "e", "f"].map((id, i) => sale({ total: 100 * (i + 1), vat: 0, payments: [], lines: [{ productId: id, name: id.toUpperCase(), qty: 1, unitPrice: 100 * (i + 1) }] }));
    const s = summarize(rows, { from: "2026-11-09", to: "2026-11-11" }, "Africa/Dakar", (id) => (id < "d" ? "X" : ""));
    expect(s.top.map((x) => x.name)).toEqual(["F", "E", "D", "C", "B"]); expect(s.byCategory).toEqual([{ category: "Sans catégorie", revenue: 1500, qty: 3 }, { category: "X", revenue: 600, qty: 3 }]); expect(s.daily.map((d) => d.count)).toEqual([0, 6, 0]);
  });
});
