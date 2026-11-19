import { describe, expect, it } from "vitest";
import { activeCustomers, pctDelta, prevMonthSpan, previousSpan, trendSpans } from "./overview-compare";
import type { SaleIn } from "./overview";

describe("écarts et périodes de comparaison", () => {
  it("écart en % : arrondi au dixième, aucun écart sans référence", () => {
    expect(pctDelta(112_400, 100_000)).toBe(12.4); expect(pctDelta(80, 100)).toBe(-20); expect(pctDelta(5, 0)).toBeNull(); expect(pctDelta(0, 100)).toBe(-100);
  });
  it("mois précédent sur le même nombre de jours, borné à sa fin", () => {
    expect(prevMonthSpan("2026-11-18")).toEqual({ from: "2026-10-01", to: "2026-10-18" });
    expect(prevMonthSpan("2026-03-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(prevMonthSpan("2026-01-10")).toEqual({ from: "2025-12-01", to: "2025-12-10" });
  });
  it("période précédente de même durée ; courbes 7 j, 30 j, mois en cours", () => {
    expect(previousSpan({ from: "2026-11-12", days: 7 })).toEqual({ from: "2026-11-05", to: "2026-11-11" });
    expect(trendSpans("7", "2026-11-18")).toEqual({ cur: { from: "2026-11-12", to: "2026-11-18" }, prev: { from: "2026-11-05", to: "2026-11-11" } });
    expect(trendSpans("30", "2026-11-18").cur.from).toBe("2026-10-20");
    expect(trendSpans("month", "2026-11-18")).toEqual({ cur: { from: "2026-11-01", to: "2026-11-18" }, prev: { from: "2026-10-01", to: "2026-10-18" } });
  });
});
describe("clients actifs", () => {
  const sale = (id: string, soldAt: string, customerId?: string, status = "paid"): SaleIn & { customerId?: string } => ({ id, number: id, total: 1000, vat: 0, soldAt, status, payments: [], lines: [], customerId });
  it("clients distincts avec une vente terminée sur la période ; comptoir et ventes non finalisées exclus", () => {
    const rows = [sale("a", "2026-11-10T10:00:00Z", "c1"), sale("b", "2026-11-12T10:00:00Z", "c1"), sale("c", "2026-11-12T11:00:00Z", "c2"), sale("d", "2026-11-12T12:00:00Z"), sale("e", "2026-11-12T13:00:00Z", "c3", "pending"), sale("f", "2026-09-01T10:00:00Z", "c4")];
    expect(activeCustomers(rows, "Africa/Abidjan", { from: "2026-10-20", to: "2026-11-18" })).toBe(2);
    expect(activeCustomers(rows, "Africa/Abidjan", { from: "2026-08-20", to: "2026-09-18" })).toBe(1);
  });
});
