import { describe, expect, it } from "vitest";
import { DAY, classify, consumptionChange, dailyDemand, excessValue, forecast, imbalance, outlier, repeatedMoves, replenishment, safetyStock, simulate, suggestTransfers } from "./stock-pro";

describe("séries et prévision", () => {
  it("regroupe les ventes par jour, nettes des retours, jamais négatives", () => {
    const f = 10 * DAY; expect(dailyDemand([{ at: f + 1, qty: 3 }, { at: f + 2, qty: -1 }, { at: f + DAY + 5, qty: -4 }, { at: f - 5, qty: 9 }], f, 3)).toEqual([2, 0, 0]);
  });
  it("refuse de prévoir sans historique suffisant (explication, pas de chiffre inventé)", () => {
    const a = forecast(Array(30).fill(0), 0, 14); expect(a.ok).toBe(false); const b = forecast([...Array(20).fill(0), 1, 2, 1, 0, 3], 0, 14); expect(b.ok).toBe(false); expect(!b.ok && b.reason).toMatch(/insuffisant/);
  });
  it("demande constante : prévision ≈ niveau, intervalle étroit, confiance moyenne puis élevée", () => {
    const f30 = forecast(Array(30).fill(4), 0, 7); expect(f30.ok && f30.daily).toBeCloseTo(4, 1); expect(f30.ok && f30.confidence).toBe("moyenne"); expect(f30.ok && f30.seasonal).toBe(false);
    const f70 = forecast(Array(70).fill(4), 0, 7); expect(f70.ok && f70.confidence).toBe("élevée"); expect(f70.ok && f70.seasonal).toBe(true); expect(f70.ok && f70.low).toBeCloseTo(f70.ok ? f70.high : 0, 0);
  });
  it("saisonnalité hebdomadaire détectée avec ≥ 8 semaines : le samedi pèse plus que le lundi", () => {
    const s = Array.from({ length: 84 }, (_, i) => (i % 7 === 5 ? 20 : 2)); const f5 = forecast(s, 0, 1); const sat = forecast(s.slice(0, 84), 0, 1); expect(f5.ok && f5.seasonal).toBe(true); void sat;
    const nextDayIsMonday = forecast(s, 0, 1); const sixDays = forecast(s, 0, 7); expect(nextDayIsMonday.ok && sixDays.ok && sixDays.total).toBeGreaterThan(nextDayIsMonday.ok ? nextDayIsMonday.total * 2 : 0);
  });
  it("signale ventes sporadiques, historique court, et porte toujours ses limites", () => {
    const f = forecast([1, ...Array(20).fill(0), 1, ...Array(5).fill(0)], 0, 7); expect(f.limits.join(" ")).toMatch(/jamais une certitude/); expect(f.ok && f.limits.join(" ")).toMatch(/sporadiques/);
  });
});

describe("réapprovisionnement", () => {
  it("stock de sécurité = 1,65 σ √délai", () => expect(safetyStock(2, 9)).toBeCloseTo(9.9, 1));
  it("quantité = demande × (délai + couverture) + sécurité − (stock + commandé + transit)", () => {
    const r = replenishment({ qty: 10, onOrder: 20, inTransit: 5, daily: 5, sd: 0, lead: 7, cover: 14, whole: true }); expect(r.position).toBe(35); expect(r.suggestedQty).toBe(70); expect(r.reorderPoint).toBe(35); expect(r.risk).toBe("medium");
    expect(replenishment({ qty: 500, onOrder: 0, inTransit: 0, daily: 5, sd: 0, lead: 7, cover: 14 }).suggestedQty).toBe(0);
  });
  it("risque : rupture, élevé quand la couverture est sous le délai, aucun sans demande", () => {
    expect(replenishment({ qty: 0, onOrder: 0, inTransit: 0, daily: 3, sd: 1, lead: 5, cover: 7 }).risk).toBe("out"); expect(replenishment({ qty: 6, onOrder: 0, inTransit: 0, daily: 3, sd: 0, lead: 5, cover: 7 }).risk).toBe("high");
    expect(replenishment({ qty: 6, onOrder: 100, inTransit: 0, daily: 3, sd: 0, lead: 5, cover: 7 }).risk).toBe("low"); expect(replenishment({ qty: 6, onOrder: 0, inTransit: 0, daily: 0, sd: 0, lead: 5, cover: 7 }).risk).toBe("none");
  });
});

describe("classement du stock", () => {
  it("sans vente, surstock, rotation lente, normal", () => {
    expect(classify({ qty: 10, sold: 0, days: 90 }).cls).toBe("dead"); expect(classify({ qty: 900, sold: 90, days: 90 }).cls).toBe("overstock"); expect(classify({ qty: 60, sold: 90, days: 90 }).cls).toBe("slow"); expect(classify({ qty: 20, sold: 90, days: 90 })).toMatchObject({ cls: "normal", rotation: 4.5, coverDays: 20 }); expect(classify({ qty: 0, sold: 5, days: 90 }).cls).toBe("nodata");
  });
  it("variation de consommation : base significative requise", () => {
    expect(consumptionChange(30, 10)).toEqual({ pct: 200, flag: "hausse" }); expect(consumptionChange(1, 3).flag).toBeNull(); expect(consumptionChange(2, 10).flag).toBe("baisse");
  });
  it("immobilisation : valeur au-delà de la couverture cible", () => { expect(excessValue(100, 1, 500, 30)).toBe(35000); expect(excessValue(20, 1, 500, 30)).toBe(0); expect(excessValue(100, 1, 0, 30)).toBe(0); });
});

describe("multi-magasins", () => {
  const A = { shopId: "A", qty: 200, inTransit: 0, daily: 1, min: 10 }, B = { shopId: "B", qty: 2, inTransit: 0, daily: 3, min: 5 };
  it("suggère un transfert depuis l'excédent, sans entamer le minimum de l'origine ni dépasser le besoin", () => {
    const t = suggestTransfers([A, B], { needDays: 14, keepDays: 30 }); expect(t).toHaveLength(1); expect(t[0]).toMatchObject({ fromShopId: "A", toShopId: "B" }); expect(t[0]!.qty).toBe(45); expect(200 - t[0]!.qty).toBeGreaterThan(30);
  });
  it("tient compte du transit entrant et ne suggère rien sans excédent", () => {
    expect(suggestTransfers([A, { ...B, inTransit: 100 }], { needDays: 14, keepDays: 30 })).toEqual([]); expect(suggestTransfers([{ ...A, qty: 20 }, B], { needDays: 14, keepDays: 30 })).toEqual([]);
  });
  it("déséquilibre", () => { expect(imbalance([A, B]).imbalanced).toBe(true); expect(imbalance([A, { ...B, qty: 100 }]).imbalanced).toBe(false); });
});

describe("simulation", () => {
  const base = { qty: 10, daily: 2, sd: 1, horizon: 10, price: 1000, cost: 600 };
  it("sans commande : rupture au jour 6, ventes manquées estimées ; avec commande à temps : aucune", () => {
    const a = simulate({ ...base, orders: [] }); expect(a.stockoutDay).toBe(6); expect(a.lostUnits).toBe(10); expect(a.lostRevenue).toBe(10000); expect(a.lostMargin).toBe(4000);
    const b = simulate({ ...base, orders: [{ day: 4, qty: 20 }] }); expect(b.stockoutDay).toBeNull(); expect(b.lostUnits).toBe(0); expect(b.endQty).toBe(10);
  });
  it("scénario pessimiste ≥ scénario moyen", () => { const a = simulate({ ...base, orders: [{ day: 6, qty: 20 }] }); expect(a.lostUnitsHigh).toBeGreaterThanOrEqual(a.lostUnits); });
});

describe("anomalies", () => {
  it("mouvements répétés dans la fenêtre", () => {
    const m = (id: string, at: number, key = "a") => ({ id, at, key }); const g = repeatedMoves([m("1", 0), m("2", 60_000), m("3", 120_000), m("4", 3_600_000), m("5", 0, "b")]); expect(g).toHaveLength(1); expect(g[0]!.map((x) => x.id)).toEqual(["1", "2", "3"]); expect(repeatedMoves([m("1", 0), m("2", 20 * 60_000), m("3", 40 * 60_000)])).toEqual([]);
  });
  it("valeur inhabituelle : historique suffisant requis", () => { expect(outlier(100, [1, 2, 3]).flag).toBe(false); expect(outlier(50, [4, 5, 6, 5, 4, 6, 5]).flag).toBe(true); expect(outlier(6, [4, 5, 6, 5, 4, 6, 5]).flag).toBe(false); });
});
