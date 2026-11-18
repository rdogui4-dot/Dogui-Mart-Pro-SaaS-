import { describe, expect, it } from "vitest";
import { clientsReport, lastMonths, monthly, projectRevenue } from "./analytics-kit";
import type { Fact } from "./analytics";
const F = (saleId: string, day: string, total: number, lines: { qty: number; ht: number; cost: number | null }[]): Fact => ({ saleId, number: saleId, shopId: "s", cashierId: "c", soldAt: `${day}T10:00:00Z`, day, hour: 10, total, vat: 0, methods: { cash: total }, lines: lines.map((l) => ({ productId: "p", name: "P", category: "C", supplierId: "", qty: l.qty, revenue: l.ht, revenueHt: l.ht, cost: l.cost, unitPrice: 0, unitCost: null })) });
describe("Rapports & Analyses — calculs du kit", () => {
  it("mois glissants, agrégat mensuel, croissance, marge seulement si coûts complets", () => {
    expect(lastMonths("2026-11-18", 3)).toEqual(["2026-09", "2026-10", "2026-11"]); expect(lastMonths("2026-01-05", 2)).toEqual(["2025-12", "2026-01"]);
    const m = monthly([F("a", "2026-10-02", 1000, [{ qty: 2, ht: 1000, cost: 600 }]), F("b", "2026-11-03", 1500, [{ qty: 1.5, ht: 1500, cost: null }])], ["2026-09", "2026-10", "2026-11"]);
    expect(m.map((r) => r.revenue)).toEqual([0, 1000, 1500]); expect(m[1]!.margin).toBe(400); expect(m[2]!.margin).toBeNull(); expect(m[0]!.margin).toBeNull(); expect(m[2]!.growthPct).toBe(50); expect(m[1]!.growthPct).toBeNull(); expect(m[2]!.qty).toBe(1.5);
  });
  it("projection : aucune sous 4 mois avec ventes ; tendance régulière prolongée sur 3 mois", () => {
    expect(projectRevenue([{ month: "2026-08", revenue: 100 }, { month: "2026-09", revenue: 200 }, { month: "2026-10", revenue: 0 }])).toBeNull();
    const p = projectRevenue(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((month, i) => ({ month, revenue: 1000 + i * 100 })))!;
    expect(p.points).toEqual([{ month: "2026-11", value: 1600 }, { month: "2026-12", value: 1700 }, { month: "2027-01", value: 1800 }]); expect(p.reliability).not.toBe("insuffisante");
  });
  it("clients : top, panier, comptoir à part, nouveaux, revenus, encours", () => {
    const cur = [F("v1", "2026-11-02", 3000, []), F("v2", "2026-11-05", 1000, []), F("v3", "2026-11-06", 500, [])], prev = [F("v0", "2026-10-02", 800, [])];
    const map = new Map<string, string | undefined>([["v1", "c1"], ["v2", "c1"], ["v3", undefined], ["v0", "c1"]]);
    const r = clientsReport(cur, prev, map, [{ id: "c1", name: "Awa", createdAt: "2026-09-01T00:00:00Z", credit: 2000 }, { id: "c2", name: "Koffi", createdAt: "2026-11-03T00:00:00Z", credit: 0 }], { from: "2026-11-01", to: "2026-11-30" });
    expect(r).toMatchObject({ buyers: 1, identifiedRevenue: 4000, walkInRevenue: 500, walkInSales: 1, identifiedSharePct: 88.9, basket: 2000, newCustomers: 1, returning: 1, credit: 2000, creditCustomers: 1 }); expect(r.top[0]).toMatchObject({ name: "Awa", revenue: 4000, count: 2, lastDay: "2026-11-05" });
  });
});
