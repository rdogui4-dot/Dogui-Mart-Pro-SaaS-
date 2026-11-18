import { describe, expect, it } from "vitest";
import { bestLongPeriod, perMonth, subscriptionInsights } from "./subscription-kit";
import { DEFAULT_PLANS, entitlement } from "./subscriptions";

const now = new Date("2026-11-18T10:00:00Z");
const ent = (plan: string, period: "day" | "week" | "month" | "quarter" | "year", days: number, status: "trial" | "paid" | "lifetime" = "paid") =>
  entitlement({ plan: plan as never, period, status, renewsAt: new Date(now.getTime() + days * 864e5).toISOString() }, DEFAULT_PLANS, now);

describe("constats Abonnement", () => {
  it("prix ramené au mois et meilleure durée longue sur les tarifs réels", () => {
    const starter = DEFAULT_PLANS[0]!;
    expect(perMonth(starter, "month")).toBe(7_500);
    expect(Math.round(perMonth(starter, "year")!)).toBe(5_753); // 70 000 / 365 × 30
    expect(bestLongPeriod(starter)).toEqual({ period: "year", pct: 23 });
    expect(bestLongPeriod({ ...starter, prices: { ...starter.prices, quarter: 30_000, year: 100_000 } })).toBeNull();
  });
  it("limite atteinte → formule supérieure réelle ; proche de la limite à 80 %", () => {
    const i = subscriptionInsights(ent("starter", "year", 100), { shops: 1, users: 2, products: 170 }, DEFAULT_PLANS);
    expect(i.find((x) => x.id === "lim-shops")!.text).toBe("Boutiques : 1 sur 1, limite atteinte. La formule Business en permet 3.");
    expect(i.find((x) => x.id === "lim-users")!.text).toContain("La formule Business en permet 10");
    expect(i.find((x) => x.id === "near-products")!.text).toBe("Produits : 170 sur 200 (85 % de la limite).");
    expect(i.some((x) => x.id === "saving")).toBe(false); // déjà à l'année
  });
  it("échéance proche, essai, grâce, verrouillé, économie au mois, à vie", () => {
    const soon = subscriptionInsights(ent("business", "month", 5), { shops: 1, users: 1, products: 1 }, DEFAULT_PLANS);
    expect(soon[0]).toMatchObject({ id: "soon", tone: "warn" });
    expect(soon.find((x) => x.id === "saving")!.text).toContain("−23 %"); // 140 000/365×30 = 11 507 vs 15 000
    expect(subscriptionInsights(ent("business", "month", 10, "trial"), { shops: 1, users: 1, products: 1 }, DEFAULT_PLANS)[0]!.id).toBe("trial");
    expect(subscriptionInsights(ent("business", "month", -1), { shops: 1, users: 1, products: 1 }, DEFAULT_PLANS)[0]!.id).toBe("grace");
    expect(subscriptionInsights(ent("business", "month", -10), { shops: 1, users: 1, products: 1 }, DEFAULT_PLANS)[0]!.id).toBe("locked");
    expect(subscriptionInsights(ent("pro", "year", 0, "lifetime"), { shops: 50, users: 1, products: 1 }, DEFAULT_PLANS)).toEqual([expect.objectContaining({ id: "life" })]);
    expect(subscriptionInsights(ent("pro", "year", 200), { shops: 1, users: 1, products: 1 }, DEFAULT_PLANS)).toEqual([expect.objectContaining({ id: "ok" })]);
  });
});
