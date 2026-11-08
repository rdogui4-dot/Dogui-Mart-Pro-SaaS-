import { describe, expect, it } from "vitest";
import { COMMON_FEATURES, NOT_AVAILABLE, buildOffers, offersMarkdown, postPurchaseMessage } from "./selar-offers";
import { DEFAULT_PLANS, PERIODS, PERIOD_DAYS } from "./subscriptions";
import { linkKey } from "./selar";

const offers = buildOffers();
const PRINTABLE = /^[ -~ -ÿ–—‘’“”…\n]*$/;

describe("offres Selar", () => {
  it("15 offres, une par formule et période, avec les clés attendues par l'application", () => {
    expect(offers).toHaveLength(15);
    expect(offers.map((o) => o.key).sort()).toEqual(DEFAULT_PLANS.flatMap((p) => PERIODS.map((k) => linkKey(p.id, k))).sort());
    expect(new Set(offers.map((o) => o.name)).size).toBe(15);
  });
  it("prix, durées et limites viennent du catalogue (aucune divergence possible)", () => {
    for (const o of offers) {
      const plan = DEFAULT_PLANS.find((p) => p.id === o.plan)!;
      expect(o.priceFcfa).toBe(plan.prices[o.period]); expect(o.durationDays).toBe(PERIOD_DAYS[o.period]);
    }
    const pro = offers.find((o) => o.key === "pro:year")!; expect(pro.limits).toEqual(["20 boutiques", "100 utilisateurs (vous compris)", "produits illimités"]);
    expect(offers.find((o) => o.key === "starter:day")!.limits[0]).toBe("1 boutique");
  });
  it("la description courte reste courte (≤ 200 caractères) et le nom lisible", () => {
    for (const o of offers) { expect(o.shortDescription.length, o.key).toBeLessThanOrEqual(200); expect(o.name.length).toBeLessThanOrEqual(80); }
  });
  it("l'économie annoncée est exacte, et absente pour le tarif de base", () => {
    expect(offers.find((o) => o.key === "starter:day")!.savingsPct).toBeNull();
    const y = offers.find((o) => o.key === "starter:year")!; expect(y.savingsPct).toBe(Math.round((1 - 70_000 / (7_500 * 12)) * 100)); expect(y.longDescription).toContain(`ÉCONOMIE : ${y.savingsPct} %`);
    const q = offers.find((o) => o.key === "business:quarter")!; expect(q.savingsPct).toBe(Math.round((1 - 40_000 / 45_000) * 100));
    expect(offers.find((o) => o.key === "starter:day")!.longDescription).not.toContain("ÉCONOMIE");
  });
  it("décrit la durée, la grâce et le renouvellement conformément aux règles de l'application", () => {
    expect(offers.find((o) => o.key === "pro:day")!.longDescription).toMatch(/l'accès est suspendu aussitôt/);
    expect(offers.find((o) => o.key === "pro:week")!.longDescription).toMatch(/1 jour de délai de grâce/);
    expect(offers.find((o) => o.key === "pro:month")!.longDescription).toMatch(/3 jours de délai de grâce/);
    for (const o of offers) { expect(o.longDescription).toMatch(/Si vous gardez la même formule, la nouvelle période s'ajoute/); expect(o.longDescription).toMatch(/Vos données sont conservées/); expect(o.longDescription).toMatch(/Essai gratuit de 14 jours/); }
  });
  it("ne promet aucune fonction absente et ne parle pas de « lecture seule » (l'accès est suspendu)", () => {
    const FORBIDDEN = [/bluetooth/i, /export[^.\n]*ohada/i, /(?<!sysc)ohada/i, /google play/i, /relances? automatiques?/i, /lecture seule/i, /grand livre/i, /devis/i, /avoir/i];
    for (const o of offers) for (const re of FORBIDDEN) expect(`${o.shortDescription}\n${o.longDescription}`, `${o.key} ${re}`).not.toMatch(re);
    expect(NOT_AVAILABLE.length).toBeGreaterThan(3);
    for (const f of COMMON_FEATURES) { expect(f).not.toMatch(/bluetooth/i); expect(f).not.toMatch(/export[^.\n]*ohada/i); }
    expect(offers[0]!.longDescription).toMatch(/SYSCOHADA/); // les écritures SYSCOHADA, elles, existent bel et bien
  });
  it("le message après achat explique les trois étapes et laisse deux champs à compléter, clairement marqués", () => {
    const m = postPurchaseMessage("Business", "Mensuel");
    expect(m).toMatch(/Réglages > Abonnement/); expect(m).toMatch(/Inutile de repayer/); expect(m).toMatch(/référence de commande/); expect(m).toMatch(/\[délai à préciser/); expect(m).toMatch(/\[contact à compléter/);
    for (const o of offers) expect(o.postPurchase).toContain(`${o.planName}`);
  });
  it("tous les textes sont affichables dans un PDF (aucun caractère hors police standard)", () => {
    for (const o of offers) for (const s of [o.name, o.shortDescription, o.longDescription, o.postPurchase]) expect(PRINTABLE.test(s), `${o.key}: ${s.match(/[^ -ÿ\n]/)?.[0]}`).toBe(true);
    for (const s of [...COMMON_FEATURES, ...NOT_AVAILABLE]) expect(PRINTABLE.test(s)).toBe(true);
  });
  it("la version Markdown contient les 15 offres", () => {
    const md = offersMarkdown(offers, new Date("2026-11-08T10:00:00Z"));
    expect(md.match(/^## \d+\. /gm)).toHaveLength(15); expect(md).toContain("`starter:day`"); expect(md).toContain("08/11/2026");
  });
});
