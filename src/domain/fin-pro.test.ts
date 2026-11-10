import { describe, expect, it } from "vitest";
import type { Flow } from "./fin";
import { MIN_HISTORY_DAYS, canAt, clampAdj, normRules, pctDelta, project, rangeOf, requiredLevel, runRate, suggestGroups, validKey } from "./fin-pro";

const fl = (key: string, source: Flow["source"], amount: number, date: string): Flow => ({ key, source, ref: key, date, method: "cash", amount, label: "", by: "", status: "ok" });
describe("FinI Pro — domaine", () => {
  it("seuils : niveaux requis et droits", () => {
    const r = normRules({ minCash: 5000, transfer: { managerFrom: 100_000, ownerFrom: 1_000_000 } }); expect(requiredLevel(50_000, r.transfer)).toBe("any"); expect(requiredLevel(100_000, r.transfer)).toBe("manager"); expect(requiredLevel(1_000_000, r.transfer)).toBe("owner");
    expect(canAt("manager", "manager")).toBe(true); expect(canAt("owner", "manager")).toBe(false); expect(canAt("owner", "owner")).toBe(true); expect(canAt("manager", "other")).toBe(false); expect(canAt("any", "other")).toBe(true);
    expect(() => normRules({ transfer: { managerFrom: 500, ownerFrom: 100 } })).toThrow(); expect(() => normRules({ minCash: -1 })).toThrow(); expect(requiredLevel(1e9, normRules({}).plan)).toBe("any");
  });
  it("cadence : fenêtre depuis le premier flux, sources récurrentes seulement, refuse si historique court", () => {
    const flows: Flow[] = []; for (let i = 0; i < 20; i++) { const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10); flows.push(fl(`s${i}`, "sale", 1000, d), fl(`e${i}`, "expense", -400, d)); } flows.push(fl("sp", "supplier_payment", -99_999, "2026-01-05"), fl("ci", "customer_invoice", 88_888, "2026-01-06"), fl("ep:1", "expense", -77_777, "2026-01-07"));
    const r = runRate(flows, "2026-01-20"); expect(r).toMatchObject({ days: 20, ok: true, inMean: 1000, outMean: 400 }); expect(runRate(flows.slice(28, 40), "2026-01-20").ok).toBe(false); expect(MIN_HISTORY_DAYS).toBe(14); expect(runRate([], "2026-01-20").ok).toBe(false);
  });
  it("projection : ouverture + cadence + échéances, fourchette croissante, alerte sous le seuil", () => {
    const run = { days: 30, inMean: 1000, outMean: 800, netSd: 100, ok: true };
    const f = project({ from: "2026-02-01", days: 10, opening: 5000, run, minCash: 4000, sched: [{ on: "2026-02-04", amount: 3000, label: "Fournisseur", kind: "out", layer: "committed" }, { on: "2026-02-08", amount: 500, label: "Client", kind: "in", layer: "committed" }] });
    expect(f.relative).toBe(false); expect(f.series[0]).toMatchObject({ date: "2026-02-02", central: 5200 }); expect(f.series[2]!.central).toBe(5600 - 3000 + 200 * 0 + 0 + 0 - 0 + 0 - 0 + 0 - 0 + 0); // 5000 + 3×200 − 3000
    expect(f.firstBelow).toBe("2026-02-04"); expect(f.layers).toMatchObject({ committedOut: 3000, committedIn: 500 }); const w1 = f.series[0]!.high - f.series[0]!.low, w9 = f.series[9]!.high - f.series[9]!.low; expect(w9).toBeGreaterThan(w1); expect(f.min!.value).toBeLessThan(3000);
  });
  it("sans ouverture connue : variation cumulée, jamais un solde ; historique insuffisant : seules les échéances", () => {
    const f = project({ from: "2026-02-01", days: 3, opening: null, run: { days: 3, inMean: 9, outMean: 0, netSd: 0, ok: false }, minCash: 0, sched: [{ on: "2026-02-02", amount: 100, label: "x", kind: "in", layer: "planned" }] }); expect(f.relative).toBe(true); expect(f.series.at(-1)!.central).toBe(100); expect(f.firstBelow).toBeNull(); expect(f.min).toBeNull();
  });
  it("scénario : ventes −50 %, retard des créances, dépense supplémentaire", () => {
    const run = { days: 30, inMean: 1000, outMean: 0, netSd: 0, ok: true }; const base = project({ from: "2026-02-01", days: 5, opening: 0, run, minCash: 0, sched: [{ on: "2026-02-02", amount: 1000, label: "c", kind: "in", layer: "committed" }] });
    const sc = project({ from: "2026-02-01", days: 5, opening: 0, run, minCash: 0, sched: [{ on: "2026-02-02", amount: 1000, label: "c", kind: "in", layer: "committed" }], adj: { salesDeltaPct: -50, receivableDelayDays: 10, extra: [{ on: "2026-02-03", amount: -200, label: "Panne" }] } });
    expect(base.end!.central).toBe(6000); expect(sc.end!.central).toBe(2500 - 200); expect(sc.layers.scenarioNet).toBe(-200); expect(clampAdj({ salesDeltaPct: 999, receivableDelayDays: -5 })).toMatchObject({ salesDeltaPct: 300, receivableDelayDays: 0 });
  });
  it("périodes de budget", () => { expect(validKey("quarter", "2026-Q4")).toBe("2026-Q4"); expect(validKey("quarter", "2026-Q5")).toBeNull(); expect(validKey("month", "2026-13")).toBeNull(); expect(rangeOf("quarter", "2026-Q1")).toEqual({ from: "2026-01-01", to: "2026-03-31" }); expect(rangeOf("month", "2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" }); expect(rangeOf("year", "2026").to).toBe("2026-12-31"); expect(pctDelta(100, 150)).toBe(50); expect(pctDelta(0, 5)).toBeNull(); });
  it("rapprochement groupé : somme de 2 ou 3 flux, sans réutiliser un flux", () => {
    const flows = [fl("a", "sale", 300, "2026-02-01"), fl("b", "sale", 700, "2026-02-02"), fl("c", "sale", 50, "2026-02-02")]; const g = suggestGroups([{ date: "2026-02-02", amount: 1000 }, { date: "2026-02-02", amount: 1000 }], flows, new Set(), new Set()); expect(g).toHaveLength(1); expect(g[0]!.flowKeys.sort()).toEqual(["a", "b"]); expect(suggestGroups([{ date: "2026-02-02", amount: 123 }], flows, new Set(), new Set())).toHaveLength(0);
  });
});
