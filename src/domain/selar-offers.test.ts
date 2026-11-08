import { describe, expect, it } from "vitest";
import { COMMON_FEATURES, NOT_AVAILABLE, buildProducts, postPurchaseMessage, productsMarkdown } from "./selar-offers";
import { DEFAULT_PLANS, PERIODS, PERIOD_DAYS } from "./subscriptions";

const products = buildProducts();
const PRINTABLE = /^[ -~ -ÿ–—‘’“”…\n]*$/;

describe("produits Selar", () => {
  it("3 produits (Starter, Business, Pro), chacun avec les 5 options de période", () => {
    expect(products.map((p) => p.plan)).toEqual(["starter", "business", "pro"]);
    for (const p of products) expect(p.options.map((o) => o.period)).toEqual(PERIODS);
    expect(new Set(products.map((p) => p.name)).size).toBe(3);
  });
  it("options libellées comme Selar les affiche, avec les prix et durées du catalogue", () => {
    for (const p of products) {
      const plan = DEFAULT_PLANS.find((x) => x.id === p.plan)!;
      for (const o of p.options) { expect(o.priceFcfa).toBe(plan.prices[o.period]); expect(o.durationDays).toBe(PERIOD_DAYS[o.period]); expect(o.selarLabel).toBe(`Chaque ${o.period}`); }
    }
    // Identique à la capture d'écran du produit Pro : Chaque day 2 500, week 12 500, month 40 000, quarter 105 000, year 380 000
    expect(products[2]!.options.map((o) => [o.selarLabel, o.priceFcfa])).toEqual([["Chaque day", 2500], ["Chaque week", 12500], ["Chaque month", 40000], ["Chaque quarter", 105000], ["Chaque year", 380000]]);
  });
  it("limites exactes par formule", () => {
    expect(products[0]!.limits).toEqual(["1 boutique", "2 utilisateurs (vous compris)", "200 produits"]);
    expect(products[2]!.limits).toEqual(["20 boutiques", "100 utilisateurs (vous compris)", "produits illimités"]);
  });
  it("la description courte reste courte (≤ 200 caractères)", () => { for (const p of products) { expect(p.shortDescription.length).toBeLessThanOrEqual(200); expect(p.name.length).toBeLessThanOrEqual(80); } });
  it("l'économie annoncée est exacte, absente pour le tarif de base", () => {
    expect(products[0]!.options[0]!.savingsPct).toBeNull();
    const y = products[0]!.options[4]!; expect(y.savingsPct).toBe(Math.round((1 - 70_000 / (7_500 * 12)) * 100));
    expect(products[0]!.longDescription).toContain(`Chaque year (Annuel) : 70 000 FCFA pour 365 jours d'accès - ${y.savingsPct} % moins cher que 12 mois payés au mois`);
    expect(products[0]!.longDescription).toContain("Chaque day (Jour) : 500 FCFA pour 1 jour d'accès\n");
  });
  it("décrit durée, grâce et renouvellement conformément aux règles de l'application, et laisse la question du renouvellement automatique à compléter", () => {
    for (const p of products) {
      expect(p.longDescription).toMatch(/- Jour : aucun délai de grâce/); expect(p.longDescription).toMatch(/- Semaine : 1 jour de délai de grâce/); expect(p.longDescription).toMatch(/- Mensuel : 3 jours de délai de grâce/);
      expect(p.longDescription).toMatch(/Si vous gardez la même formule, la nouvelle période s'ajoute/); expect(p.longDescription).toMatch(/Vos données sont conservées/); expect(p.longDescription).toMatch(/Essai gratuit de 14 jours/);
      expect(p.longDescription).toMatch(/Renouvellement : \[à compléter/);
      expect(p.longDescription).not.toMatch(/Un achat = une période/); // faux si Selar renouvelle automatiquement
    }
  });
  it("ne promet aucune fonction absente et ne parle pas de « lecture seule » (l'accès est suspendu)", () => {
    const FORBIDDEN = [/bluetooth/i, /export[^.\n]*ohada/i, /(?<!sysc)ohada/i, /google play/i, /relances? automatiques?/i, /lecture seule/i, /grand livre/i, /devis/i, /avoir/i];
    for (const p of products) for (const re of FORBIDDEN) expect(`${p.shortDescription}\n${p.longDescription}`, `${p.plan} ${re}`).not.toMatch(re);
    expect(NOT_AVAILABLE.length).toBeGreaterThan(3);
    for (const f of COMMON_FEATURES) { expect(f).not.toMatch(/bluetooth/i); expect(f).not.toMatch(/export[^.\n]*ohada/i); }
    expect(products[0]!.longDescription).toMatch(/SYSCOHADA/);
  });
  it("le message après achat : trois étapes, la période à choisir identique, deux champs à compléter marqués", () => {
    const m = postPurchaseMessage("Business");
    expect(m).toMatch(/Réglages > Abonnement/); expect(m).toMatch(/même période que celle que vous venez de payer/); expect(m).toMatch(/Inutile de repayer/); expect(m).toMatch(/référence de commande/); expect(m).toMatch(/\[délai à préciser/); expect(m).toMatch(/\[contact à compléter/);
    for (const p of products) expect(p.postPurchase).toContain(p.planName);
  });
  it("tous les textes sont affichables dans un PDF", () => {
    for (const p of products) for (const s of [p.name, p.shortDescription, p.longDescription, p.postPurchase, ...p.options.map((o) => o.selarLabel)]) expect(PRINTABLE.test(s), `${p.plan}: ${s.match(/[^ -ÿ\n]/)?.[0]}`).toBe(true);
    for (const s of [...COMMON_FEATURES, ...NOT_AVAILABLE]) expect(PRINTABLE.test(s)).toBe(true);
  });
  it("une URL de redirection par produit (formule seule : la période se choisit sur Selar), avec le domaine fourni ou le marqueur explicite", () => {
    expect(products.map((p) => p.redirectUrl)).toEqual(["starter", "business", "pro"].map((f) => `https://VOTRE-DOMAINE/reglages?onglet=abonnement&formule=${f}`));
    const real = buildProducts(undefined, "https://rdogui4-dot.github.io/Dogui-Mart-Pro-SaaS-");
    expect(real[2]!.redirectUrl).toBe("https://rdogui4-dot.github.io/Dogui-Mart-Pro-SaaS-/reglages?onglet=abonnement&formule=pro");
    expect(() => buildProducts(undefined, "http://app.exemple.com")).toThrow();
  });
  it("la version Markdown contient les 3 produits et leurs 15 options", () => {
    const md = productsMarkdown(products, new Date("2026-11-08T10:00:00Z"));
    expect(md.match(/^## \d+\. /gm)).toHaveLength(3); expect(md.match(/\| Chaque (day|week|month|quarter|year) \|/g)).toHaveLength(15);
    expect(md.match(/URL de redirection après paiement/g)).toHaveLength(3); expect(md).toContain("08/11/2026");
  });
});
