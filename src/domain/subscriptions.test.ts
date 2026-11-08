import { describe, expect, it } from "vitest";
import { DEFAULT_PLANS, GRACE_DAYS, PERIODS, PERIOD_DAYS, PERIOD_LABEL, addPeriod, canAdd, entitlement, mergePlans, planById, priceFor, renewal, validCount, type Sub } from "./subscriptions";

const NOW = new Date("2026-06-01T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();
const sub = (over: Partial<Sub> = {}): Sub => ({ plan: "business", period: "month", status: "paid", renewsAt: day(20), ...over });

describe("périodes", () => {
  it("les cinq périodes demandées, en français, avec des durées fixes", () => {
    expect(PERIODS.map((p) => PERIOD_LABEL[p])).toEqual(["Jour", "Semaine", "Mensuel", "Trimestre", "Annuel"]);
    expect(PERIODS.map((p) => PERIOD_DAYS[p])).toEqual([1, 7, 30, 90, 365]);
    expect(addPeriod(NOW, "week", 2).toISOString()).toBe("2026-06-15T12:00:00.000Z");
  });
  it("le tarif de chaque formule est croissant avec la durée mais dégressif au prix unitaire", () => {
    for (const p of DEFAULT_PLANS) {
      const v = PERIODS.map((k) => p.prices[k]);
      expect(v).toEqual([...v].sort((a, b) => a - b));
      expect(p.prices.year / 365).toBeLessThan(p.prices.month / 30);
      expect(p.prices.month / 30).toBeLessThan(p.prices.day);
    }
  });
  it("quantités achetables bornées", () => {
    expect(validCount("day", 31)).toBe(true); expect(validCount("day", 32)).toBe(false);
    expect(validCount("year", 3)).toBe(true); expect(validCount("year", 4)).toBe(false);
    expect(validCount("month", 1.5)).toBe(false); expect(validCount("month", 0)).toBe(false);
    expect(priceFor(planById(DEFAULT_PLANS, "starter")!, "week", 3)).toBe(7_500);
  });
});

describe("accès", () => {
  it("actif → bientôt expiré → grâce → verrouillé", () => {
    const plans = DEFAULT_PLANS;
    expect(entitlement(sub({ renewsAt: day(20) }), plans, NOW).state).toBe("active");
    expect(entitlement(sub({ renewsAt: day(2) }), plans, NOW)).toMatchObject({ state: "expiring", daysLeft: 2, writable: true });
    expect(entitlement(sub({ renewsAt: day(-2) }), plans, NOW)).toMatchObject({ state: "grace", writable: true });
    expect(entitlement(sub({ renewsAt: day(-4) }), plans, NOW)).toMatchObject({ state: "locked", writable: false });
  });
  it("le délai de grâce dépend de la période, et l'essai n'en a aucun", () => {
    expect(GRACE_DAYS.day).toBe(0);
    expect(entitlement(sub({ period: "day", renewsAt: day(-0.1) }), DEFAULT_PLANS, NOW).state).toBe("locked");
    expect(entitlement(sub({ period: "week", renewsAt: day(-0.9) }), DEFAULT_PLANS, NOW).state).toBe("grace");
    expect(entitlement(sub({ status: "trial", renewsAt: day(-0.1) }), DEFAULT_PLANS, NOW).state).toBe("locked");
  });
  it("quotas, -1 = illimité", () => {
    expect(canAdd(2, 3)).toBe(true); expect(canAdd(3, 3)).toBe(false); expect(canAdd(99_999, -1)).toBe(true);
    expect(entitlement(sub({ plan: "pro" }), DEFAULT_PLANS, NOW).limits.maxProducts).toBe(-1);
  });
});

describe("renouvellement", () => {
  it("même formule encore active : on prolonge à partir de l'échéance", () => {
    const r = renewal(sub({ renewsAt: day(10) }), "business", "month", 1, NOW);
    expect(r.extended).toBe(true); expect(r.end.toISOString()).toBe(addPeriod(new Date(day(10)), "month", 1).toISOString());
  });
  it("expiré, changement de formule ou première souscription : on repart de maintenant", () => {
    expect(renewal(sub({ renewsAt: day(-1) }), "business", "month", 1, NOW).start).toEqual(NOW);
    expect(renewal(sub({ renewsAt: day(10) }), "pro", "month", 1, NOW)).toMatchObject({ extended: false, start: NOW });
    expect(renewal(null, "starter", "day", 1, NOW).end.toISOString()).toBe(day(1));
  });
});

describe("surcharge des tarifs", () => {
  it("applique une surcharge valide et conserve le reste", () => {
    const p = mergePlans([{ id: "starter", prices: { month: 9_000 }, limits: { maxShops: 2 } }]);
    expect(planById(p, "starter")!.prices.month).toBe(9_000); expect(planById(p, "starter")!.prices.day).toBe(500);
    expect(planById(p, "starter")!.limits).toMatchObject({ maxShops: 2, maxUsers: 2 });
    expect(planById(p, "pro")).toEqual(planById(DEFAULT_PLANS, "pro"));
  });
  it("refuse toute valeur invalide au lieu de l'ignorer", () => {
    expect(() => mergePlans([{ id: "nope" }])).toThrow(/inconnue/);
    expect(() => mergePlans([{ id: "pro", prices: { day: -5 } }])).toThrow(/Prix/);
    expect(() => mergePlans([{ id: "pro", prices: { day: 1.5 } }])).toThrow(/Prix/);
    expect(() => mergePlans([{ id: "pro", limits: { maxShops: 0 } }])).toThrow(/Limite/);
    expect(() => mergePlans("x")).toThrow();
    expect(mergePlans(null)).toEqual(DEFAULT_PLANS);
  });
});
