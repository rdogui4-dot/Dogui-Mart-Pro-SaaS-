import { describe, expect, it } from "vitest";
import { MASTER, addMonths, applyPurchase, startTrial, viewOf } from "./master";
const D = (s: string) => new Date(s);
describe("MASTER DOGUI — licence (règles pures)", () => {
  it("tarifs du cahier des charges", () => { expect(MASTER).toMatchObject({ trialDays: 14, firstPrice: 15_000, firstMonths: 12, renewPrice: 2_500 }); });
  it("addMonths : fin de mois ramenée au dernier jour, passage d'année", () => { expect(addMonths("2026-01-31T10:00:00.000Z", 1)).toBe("2026-02-28T10:00:00.000Z"); expect(addMonths("2026-11-15T00:00:00.000Z", 3)).toBe("2027-02-15T00:00:00.000Z"); expect(addMonths("2028-01-31T00:00:00.000Z", 1)).toBe("2028-02-29T00:00:00.000Z"); });
  it("aucun essai : état « none », rien à analyser", () => { const v = viewOf({}, D("2026-11-11T00:00:00Z")); expect(v).toMatchObject({ state: "none", canAnalyze: false, trialUsed: false, nextDue: null }); });
  it("essai de 14 jours : dates, jours restants, facturation future affichée, aucun débit", () => { const lic = startTrial(D("2026-11-11T00:00:00Z")); expect(lic.trialEndsAt).toBe("2026-11-25T00:00:00.000Z"); const v = viewOf(lic, D("2026-11-20T00:00:00Z")); expect(v).toMatchObject({ state: "trial", phase: "trial", daysLeft: 5, canAnalyze: true, billingStartsAt: lic.trialEndsAt }); expect(v.nextDue).toMatchObject({ amount: 15_000, at: lic.trialEndsAt }); expect(v.consequence).toContain("Aucun débit automatique"); });
  it("essai terminé sans paiement : consultation seule ; l'essai reste « utilisé »", () => { const v = viewOf(startTrial(D("2026-11-11T00:00:00Z")), D("2026-12-01T00:00:00Z")); expect(v).toMatchObject({ state: "expired", consultOnly: true, canAnalyze: false, trialUsed: true }); expect(v.consequence).toContain("autres modules"); });
  it("première période : 12 mois à 15 000 FCFA à partir de la fin de l'essai ; renouvellement mensuel 2 500 ensuite", () => {
    const trial = startTrial(D("2026-11-11T00:00:00Z")); const a = applyPurchase(trial, { kind: "first", count: 1 }, D("2026-11-15T00:00:00Z")); expect(a.amount).toBe(15_000); expect(a.from).toBe("2026-11-25T00:00:00.000Z"); expect(a.to).toBe("2027-11-25T00:00:00.000Z");
    expect(viewOf(a.lic, D("2026-12-01T00:00:00Z"))).toMatchObject({ state: "active", phase: "first" }); expect(viewOf(a.lic, D("2027-11-01T00:00:00Z")).nextDue).toMatchObject({ amount: 2_500 });
    expect(() => applyPurchase(a.lic, { kind: "first", count: 1 }, D("2026-12-01T00:00:00Z"))).toThrow(/déjà/); const m = applyPurchase(a.lic, { kind: "month", count: 3 }, D("2027-11-01T00:00:00Z")); expect(m.amount).toBe(7_500); expect(m.from).toBe("2027-11-25T00:00:00.000Z"); expect(m.to).toBe("2028-02-25T00:00:00.000Z"); expect(viewOf(m.lic, D("2027-12-10T00:00:00Z"))).toMatchObject({ state: "active", phase: "renewal" });
  });
  it("renouvellement : impossible avant la première période, bornes de mois, reprise après expiration à partir de maintenant", () => {
    expect(() => applyPurchase({}, { kind: "month", count: 1 }, D("2026-11-11T00:00:00Z"))).toThrow(/première période/); const first = applyPurchase({}, { kind: "first", count: 1 }, D("2026-01-10T00:00:00Z")).lic; expect(() => applyPurchase(first, { kind: "month", count: 0 }, D("2027-02-01T00:00:00Z"))).toThrow(/1 à 12/); expect(() => applyPurchase(first, { kind: "month", count: 13 }, D("2027-02-01T00:00:00Z"))).toThrow();
    const lapsed = viewOf(first, D("2027-03-01T00:00:00Z")); expect(lapsed).toMatchObject({ state: "expired", consultOnly: true }); const back = applyPurchase(first, { kind: "month", count: 1 }, D("2027-03-01T00:00:00Z")); expect(back.from).toBe("2027-03-01T00:00:00.000Z"); expect(viewOf(back.lic, D("2027-03-10T00:00:00Z")).state).toBe("active");
  });
});
