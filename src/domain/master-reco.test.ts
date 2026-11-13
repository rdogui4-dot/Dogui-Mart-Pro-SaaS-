import { describe, expect, it } from "vitest";
import { DEFAULT_CFG, NEXT, RULES, canMove, cfgFrom, followDue, normalizeCfg, outcomeText, ruleOf, sortRecos, type RStatus } from "./master-reco";

describe("recommandations (domaine)", () => {
  it("machine d'états : refusée, réalisée et sans effet sont terminales ; accepter avant de réaliser", () => {
    for (const s of ["refused", "done", "noeffect"] as RStatus[]) expect(NEXT[s]).toEqual([]); expect(canMove("new", "done")).toBe(false); expect(canMove("new", "accepted")).toBe(true); expect(canMove("snoozed", "new")).toBe(true); expect(canMove("accepted", "doing")).toBe(true); expect(canMove("doing", "refused")).toBe(false); expect(canMove("x", "new")).toBe(false);
  });
  it("règles : identifiants uniques et connus", () => { expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length); expect(ruleOf("stock_out")?.pro).toBe(false); expect(ruleOf("replenish")?.pro).toBe(true); expect(ruleOf("zzz")).toBeUndefined(); });
  it("seuils : défauts, bornes, valeur illisible -> défauts", () => {
    expect(normalizeCfg({})).toEqual({ ok: true, cfg: DEFAULT_CFG }); expect(normalizeCfg({ snoozeDays: 3 })).toMatchObject({ ok: true, cfg: { snoozeDays: 3, followDays: 14 } }); expect(normalizeCfg({ snoozeDays: 0 }).ok).toBe(false); expect(normalizeCfg({ creditPct: 101 }).ok).toBe(false); expect(normalizeCfg({ followDays: 2.5 }).ok).toBe(false); expect(cfgFrom("pas du json")).toEqual(DEFAULT_CFG); expect(cfgFrom(JSON.stringify({ snoozeDays: 5 })).snoozeDays).toBe(5);
  });
  it("suivi : texte factuel daté, jamais causal ; sans mesure : message explicite", () => {
    const t = outcomeText({ label: "Ruptures", value: 4 }, { value: 1, at: "2026-03-10T00:00:00Z" }, "2026-03-01T00:00:00Z"); expect(t).toContain("4"); expect(t).toContain("en baisse de 3"); expect(t).toContain("n'est pas attribuée"); expect(t).not.toMatch(/grâce|résultat de/); expect(outcomeText({ label: "x", value: 2 }, { value: 2, at: "2026-03-10T00:00:00Z" }, null)).toContain("inchangé"); expect(outcomeText(null, null, null)).toContain("Aucune mesure"); const start = outcomeText({ label: "Ruptures", value: 4 }, null, "2026-03-01T00:00:00Z"); expect(start).toContain("Mesure de départ"); expect(start).toContain("4"); expect(start).toContain("sans l'attribuer");
  });
  it("délai de suivi", () => { const now = Date.parse("2026-03-20T00:00:00Z"); expect(followDue("2026-03-01T00:00:00Z", 14, now)).toBe(true); expect(followDue("2026-03-10T00:00:00Z", 14, now)).toBe(false); expect(followDue(null, 14, now)).toBe(false); });
  it("ordre : priorité d'abord, puis priorités du profil, puis ancienneté", () => {
    const r = (ruleId: string, prio: any, createdAt: string) => ({ ruleId, prio, createdAt }); const rows = [r("promo", "high", "2"), r("stock_out", "high", "3"), r("po_late", "critical", "9"), r("cash_variance", "high", "1")];
    expect(sortRecos(rows, []).map((x) => x.ruleId)).toEqual(["po_late", "cash_variance", "promo", "stock_out"]); expect(sortRecos(rows, ["stock", "volume"]).map((x) => x.ruleId)).toEqual(["po_late", "stock_out", "promo", "cash_variance"]);
  });
});
