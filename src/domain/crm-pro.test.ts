import { describe, expect, it } from "vitest";
import { DAY } from "./crm";
import { attribute, campaignStats, cohorts, customerScore, eligibility, fScore, fillTemplate, leadScore, mScore, matches, median, normCriteria, normLoyalty, normRule, pipelineForecast, projectNext, rScore, retention, rfmKey, valueOf, type Profile } from "./crm-pro";
import { DEFAULT_RULES } from "./loyalty";

const P = (o: Partial<Profile> = {}): Profile => ({ id: "c1", kind: "customer", name: "Awa", phone: "770001122", email: "", salesCount: 5, total: 50000, spend365: 50000, freq365: 5, recencyDays: 10, firstSaleDays: 200, avgBasket: 10000, avgGapDays: 30, categories: ["Alimentaire"], usesPromo: false, usesCredit: false, creditBalance: 0, rfm: { r: 5, f: 3, m: 3 }, rfmKey: "occasional", tags: ["vip"], source: "referral", ownerId: "u1", consents: { sms: false, email: false, whatsapp: true }, lastContactedAt: null, segment: "active", ...o });
describe("RFM", () => {
  it("barèmes R, F, M documentés", () => { expect([rScore(10), rScore(30), rScore(60), rScore(120), rScore(300)]).toEqual([5, 4, 3, 2, 1]); expect([fScore(12), fScore(6), fScore(3), fScore(2), fScore(1)]).toEqual([5, 4, 3, 2, 1]); expect([mScore(300, 100), mScore(150, 100), mScore(80, 100), mScore(40, 100), mScore(10, 100)]).toEqual([5, 4, 3, 2, 1]); expect(median([5, 1, 3, 9])).toBe(4); });
  it("segments nommés, dans l'ordre des règles", () => {
    const k = (r: number, f: number, m: number, n = 5, fd: number | null = 200) => rfmKey({ r, f, m }, { salesCount: n, firstSaleDays: fd });
    expect(k(5, 5, 5)).toBe("champions"); expect(k(3, 4, 2)).toBe("loyal"); expect(k(4, 2, 5)).toBe("big"); expect(k(5, 2, 2)).toBe("promising"); expect(k(2, 3, 3)).toBe("atrisk"); expect(k(1, 1, 1, 2)).toBe("lost"); expect(k(3, 2, 3)).toBe("occasional"); expect(k(5, 1, 1, 1, 10)).toBe("new"); expect(k(5, 5, 5, 0, null)).toBe("never");
  });
});
describe("critères de segmentation", () => {
  it("validation stricte (bornes, inconnus, incohérences)", () => { expect(() => normCriteria({ rfm: ["zzz"] })).toThrow("RFM"); expect(() => normCriteria({ recencyMin: 50, recencyMax: 10 })).toThrow("Récence"); expect(() => normCriteria({ valueMin: -1 })).toThrow("invalide"); expect(() => normCriteria({ consent: "fax" })).toThrow("Canal"); expect(normCriteria({ recencyMax: "30", tag: " VIP ", foo: 1 })).toEqual({ recencyMax: 30, tag: "vip" }); });
  it("filtrage par récence, fréquence, valeur, catégorie, promotions, consentement, portefeuille", () => {
    expect(matches(normCriteria({ recencyMax: 30, freqMin: 3, valueMin: 40000 }), P())).toBe(true); expect(matches(normCriteria({ recencyMin: 30 }), P())).toBe(false); expect(matches(normCriteria({ category: "alimentaire" }), P())).toBe(true); expect(matches(normCriteria({ category: "Boissons" }), P())).toBe(false);
    expect(matches(normCriteria({ usesPromo: true }), P())).toBe(false); expect(matches(normCriteria({ usesPromo: false }), P())).toBe(true); expect(matches(normCriteria({ consent: "sms" }), P())).toBe(false); expect(matches(normCriteria({ consent: "whatsapp", ownerId: "u1" }), P())).toBe(true); expect(matches(normCriteria({ recencyMax: 30 }), P({ recencyDays: null }))).toBe(false); expect(matches(normCriteria({ neverBought: true }), P({ salesCount: 0 }))).toBe(true);
  });
});
describe("scores explicables", () => {
  it("client : somme des critères affichés, niveau, limites ; non évaluable sous 2 achats", () => {
    const s = customerScore(P()); expect(s.parts.reduce((a, x) => a + x.points, 0)).toBe(s.score); expect(s.parts.map((x) => x.key)).toEqual(["recency", "frequency", "value", "reach", "payment"]); expect(s.parts[0]!.why).toMatch(/rythme habituel/); expect(s.level).toBe("high"); expect(s.note).toMatch(/ni une prédiction certaine/);
    const u = customerScore(P({ salesCount: 1 })); expect(u).toMatchObject({ score: null, level: "unrated" }); expect(u.limits[0]).toMatch(/Moins de 2 achats/);
    expect(customerScore(P({ recencyDays: 200, avgGapDays: 30, freq365: 1, rfm: { r: 1, f: 1, m: 1 }, creditBalance: 500, consents: { sms: false, email: false, whatsapp: false }, phone: "" })).level).toBe("low");
  });
  it("prospect : critères et limites ; clôturé non évalué", () => {
    const f = { stage: "qualified", phone: "77", email: "a@b.sn", company: "X", address: "", source: "referral", consents: { sms: true, email: false, whatsapp: false }, lastActivityDays: 3, openOppValue: 100000, oppDue: true }; const s = leadScore(f); expect(s.score).toBe(20 + 15 + 10 + 20 + 15 + 10); expect(s.limits[0]).toMatch(/par convention/); expect(leadScore({ ...f, stage: "won" }).level).toBe("unrated"); expect(leadScore({ ...f, stage: "new", phone: "", email: "", company: "", consents: { sms: false, email: false, whatsapp: false }, lastActivityDays: null, openOppValue: 0, source: "" }).score).toBe(5);
  });
});
describe("éligibilité des campagnes", () => {
  const now = Date.now(); const base = { channel: "whatsapp" as const, phone: "77", email: "", consents: { sms: false, email: false, whatsapp: true }, lastContactedAt: null, now, freqDays: 14 };
  it("exige coordonnée, consentement du canal et respect de la fréquence", () => {
    expect(eligibility(base)).toEqual({ ok: true }); expect(eligibility({ ...base, phone: "" })).toEqual({ ok: false, reason: "no_contact" }); expect(eligibility({ ...base, channel: "sms" })).toEqual({ ok: false, reason: "no_consent" }); expect(eligibility({ ...base, channel: "email", email: "a@b.sn" })).toEqual({ ok: false, reason: "no_consent" });
    expect(eligibility({ ...base, lastContactedAt: now - 5 * DAY })).toEqual({ ok: false, reason: "frequency" }); expect(eligibility({ ...base, lastContactedAt: now - 20 * DAY })).toEqual({ ok: true });
  });
  it("modèle de message et attribution (fenêtre après contact) ; statistiques honnêtes", () => {
    expect(fillTemplate("Bonjour {prénom}, passez nous voir", "Awa Ndiaye")).toBe("Bonjour Awa, passez nous voir"); const t0 = Date.now(); expect(attribute(t0, 14, [{ at: t0 - DAY, net: 100 }, { at: t0 + 2 * DAY, net: 500 }, { at: t0 + 20 * DAY, net: 900 }])).toEqual({ count: 1, amount: 500 });
    const s = campaignStats([{ status: "contacted", attributed: 500, converted: true }, { status: "replied" }, { status: "optout" }, { status: "pending" }, { status: "skipped" }], 1000); expect(s).toMatchObject({ total: 5, contacted: 2, replied: 1, optout: 1, converted: 1, revenue: 500, roi: 0.5, replyRate: 50, conversionRate: 50 }); expect(campaignStats([], 0)).toMatchObject({ replyRate: null, roi: null });
  });
});
describe("analyses", () => {
  const now = Date.UTC(2026, 10, 10);
  it("rétention 90 j et réachat sur effectifs éligibles", () => {
    const cs = [{ saleAts: [now - 150 * DAY, now - 20 * DAY] }, { saleAts: [now - 140 * DAY] }, { saleAts: [now - 10 * DAY] }, { saleAts: [now - 200 * DAY, now - 180 * DAY] }]; const r = retention(cs, now); expect(r.retention90).toEqual({ base: 2, kept: 1, rate: 50 }); expect(r.repeat30.eligible).toBe(3); expect(r.repeat30.repeat).toBe(1); expect(r.repeat90.eligible).toBe(3); expect(retention([], now).retention90.rate).toBeNull();
  });
  it("cohortes mensuelles : seuls les clients âgés de 90 jours comptent", () => { const c = cohorts([{ saleAts: [now - 120 * DAY, now - 100 * DAY] }, { saleAts: [now - 5 * DAY] }], now, 6); expect(c).toHaveLength(6); expect(c.reduce((a, x) => a + x.size, 0)).toBe(2); expect(c.reduce((a, x) => a + x.eligible, 0)).toBe(1); });
  it("valeur client : historique exact, projection seulement avec ≥ 3 achats, méthode affichée", () => { expect(valueOf({ salesCount: 2, total: 100, firstSaleDays: 100, freq365: 2, avgBasket: 50 }).projected12).toBeNull(); const v = valueOf({ salesCount: 6, total: 60000, firstSaleDays: 400, freq365: 6, avgBasket: 10000 }); expect(v.projected12).toBe(60000); expect(v.method).toMatch(/ordre de grandeur/); });
  it("prévision du pipeline : taux de gain historique seulement avec ≥ 10 clôturées ; projection de ventes ≥ 3 mois", () => {
    const f = pipelineForecast([{ value: 1000, probability: 50, dueOn: "2026-12-05" }, { value: 2000, probability: 80, dueOn: "" }], { won: 3, lost: 2 }); expect(f).toMatchObject({ weighted: 2100, adjusted: null, winRate: null, confidence: "insuffisante" }); const g = pipelineForecast([{ value: 1000, probability: 50, dueOn: "2026-12-05" }], { won: 6, lost: 6 }); expect(g).toMatchObject({ weighted: 500, adjusted: 500, winRate: 0.5, confidence: "faible" }); expect(g.limits.join(" ")).toMatch(/déclarative/);
    expect(projectNext([100, 200]).value).toBeNull(); expect(projectNext([100, 200, 300, 400])).toMatchObject({ value: 300, low: 200, high: 400 });
  });
});
describe("règles d'automatisation et de fidélité", () => {
  it("règle validée : déclencheur, durée, tâche interne", () => { expect(() => normRule({ trigger: "x" })).toThrow("Déclencheur"); expect(() => normRule({ trigger: "inactive", params: { days: 3 }, task: { title: "Relancer {nom}" } })).toThrow("Durée"); expect(() => normRule({ trigger: "tier", params: {}, task: { title: "Relancer" } })).toThrow("Niveau"); expect(() => normRule({ trigger: "inactive", task: { title: "ab" } })).toThrow("Intitulé"); expect(normRule({ trigger: "inactive", params: { days: 90, tag: "VIP" }, task: { title: "Relancer {nom}", dueInDays: 2 } })).toMatchObject({ params: { days: 90, tag: "vip" }, task: { kind: "followup", dueInDays: 2, owner: "portfolio" } }); });
  it("fidélité : bornes, cohérence des niveaux, règles décrites en clair", () => {
    expect(() => normLoyalty({ silverThreshold: 600000 }, DEFAULT_RULES)).toThrow("Or doit dépasser"); expect(() => normLoyalty({ goldBonusPct: 5 }, DEFAULT_RULES)).toThrow("bonus Or"); expect(() => normLoyalty({ maxRedeemPct: 120 }, DEFAULT_RULES)).toThrow("invalide"); expect(() => normLoyalty({ cfaPerPoint: 1.5 }, DEFAULT_RULES)).toThrow("invalide");
    const c = normLoyalty({ cfaPerPoint: 200, perks: { gold: "Livraison offerte" } }, DEFAULT_RULES); expect(c).toMatchObject({ cfaPerPoint: 200, goldThreshold: 500000, perks: { gold: "Livraison offerte", silver: "" } });
  });
});
