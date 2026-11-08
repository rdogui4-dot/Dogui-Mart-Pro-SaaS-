import { describe, expect, it } from "vitest";
import { cartTotal, settle, lineTotal } from "./money";
import { tierFor, earnedPoints, redeemablePoints } from "./loyalty";
import { canExtendCredit, applyRepayment } from "./credit";
import { saleJournal, purchaseJournal, isBalanced } from "./accounting";
import { stockOf, reorderQty } from "./stock";
import { gatewayFor, isValidPhone } from "./mobile-money";

describe("money", () => {
  it("totalise avec remise", () => {
    expect(lineTotal({ productId: "a", name: "A", unitPrice: 1000, qty: 3, discountPct: 10 })).toBe(2700);
    expect(cartTotal([{ productId: "a", name: "A", unitPrice: 500, qty: 2 }])).toBe(1000);
  });
  it("refuse un paiement insuffisant et rend la monnaie en espèces seulement", () => {
    expect(settle(1000, [{ method: "cash", amount: 500 }]).ok).toBe(false);
    expect(settle(1000, [{ method: "cash", amount: 2000 }])).toMatchObject({ ok: true, change: 1000 });
    expect(settle(1000, [{ method: "wave", amount: 1500 }]).ok).toBe(false);
  });
});
describe("loyalty", () => {
  it("paliers et points bonus", () => {
    expect(tierFor(50_000)).toBe("bronze");
    expect(tierFor(600_000)).toBe("gold");
    expect(earnedPoints(10_000, "gold")).toBe(120);
  });
  it("plafonne l'utilisation des points", () => {
    expect(redeemablePoints(10_000, 10_000)).toBe(500);
    expect(redeemablePoints(100, 10_000)).toBe(100);
  });
});
describe("credit", () => {
  it("respecte le plafond", () => {
    expect(canExtendCredit({ balance: 8000, limit: 10_000 }, 3000).ok).toBe(false);
    expect(applyRepayment({ balance: 5000, limit: 10_000 }, 9000).balance).toBe(0);
  });
});
describe("accounting", () => {
  it("écritures de vente et d'achat équilibrées", () => {
    const s = saleJournal({ ref: "V1", date: "2026-01-01", totalTtc: 11_800, vatRatePct: 18, payments: [{ method: "cash", amount: 5000 }, { method: "credit", amount: 6800 }] });
    expect(isBalanced(s)).toBe(true);
    expect(isBalanced(purchaseJournal({ ref: "A1", date: "2026-01-01", totalTtc: 11_800, vatRatePct: 18 }))).toBe(true);
  });
});
describe("stock", () => {
  it("se déduit des mouvements", () => {
    expect(stockOf([{ productId: "a", qty: 10, kind: "purchase" }, { productId: "a", qty: 3, kind: "sale" }, { productId: "a", qty: -1, kind: "adjust" }])).toBe(6);
    expect(reorderQty(2, 60)).toBe(26);
  });
});
describe("mobile money", () => {
  it("échoue sans configuration (fail closed)", async () => {
    await expect(gatewayFor(undefined).requestToPay({ provider: "mtn", phone: "770000000", amount: 1, saleId: "s", idempotencyKey: "k" })).rejects.toThrow();
    expect(isValidPhone("+221 77 123 45 67")).toBe(true);
  });
});

import { buildPaymentUrl, isExpired, linkRef } from "./payment-links";
describe("payment links", () => {
  it("construit le lien à partir du modèle du commerçant", () => {
    expect(buildPaymentUrl("https://pay.example.com/m/X?amount={amount}&ref={ref}", { amount: 1500.4, ref: "DMP 1" })).toBe("https://pay.example.com/m/X?amount=1500&ref=DMP%201");
  });
  it("refuse http et les modèles sans montant", () => {
    expect(() => buildPaymentUrl("http://x.com/?a={amount}", { amount: 1, ref: "r" })).toThrow();
    expect(() => buildPaymentUrl("https://x.com/", { amount: 1, ref: "r" })).toThrow();
  });
  it("expiration et référence", () => {
    expect(isExpired("2020-01-01T00:00:00Z")).toBe(true);
    expect(linkRef("abc-12345678xyz")).toMatch(/^DMP-[A-Z0-9]{8}$/);
  });
});

import { invoiceStatus, invoiceTtc, paidOf, poStatus, poTotalHt, toInvoice, validateQuantities, weightedCost, type PoLine } from "./purchasing";
describe("purchasing", () => {
  const L = (o: Partial<PoLine> = {}): PoLine => ({ productId: "p", name: "Riz", qty: 10, unitCost: 600, received: 0, invoiced: 0, ...o });
  it("statut de commande selon les réceptions", () => {
    expect(poStatus([L()])).toBe("ordered");
    expect(poStatus([L({ received: 4 })])).toBe("partial");
    expect(poStatus([L({ received: 10 })])).toBe("received");
    expect(poStatus([L()], true)).toBe("cancelled");
    expect(poTotalHt([L(), L({ qty: 2, unitCost: 250 })])).toBe(6500);
  });
  it("coût moyen pondéré", () => {
    expect(weightedCost(10, 500, 10, 700)).toBe(600);
    expect(weightedCost(-5, 500, 10, 700)).toBe(700);
  });
  it("validation des quantités", () => {
    const lines = [L({ received: 6 })];
    expect(validateQuantities(lines, [{ productId: "p", qty: 4 }], (l) => l.qty - l.received).ok).toBe(true);
    expect(validateQuantities(lines, [{ productId: "p", qty: 5 }], (l) => l.qty - l.received).ok).toBe(false);
    expect(validateQuantities(lines, [{ productId: "p", qty: 1.5 }], (l) => l.qty - l.received).ok).toBe(false);
    expect(validateQuantities(lines, [{ productId: "zz", qty: 1 }], (l) => l.qty - l.received).ok).toBe(false);
    expect(toInvoice(L({ received: 6, invoiced: 2 }))).toBe(4);
  });
  it("facture TTC et statut de paiement", () => {
    expect(invoiceTtc(10_000, 18)).toBe(11_800);
    const pays = [{ id: "a", amount: 5000, method: "cash" as const, date: "" }];
    expect(paidOf(pays)).toBe(5000);
    expect(invoiceStatus(11_800, 5000)).toBe("partial");
    expect(invoiceStatus(11_800, 11_800)).toBe("paid");
  });
});

import { invoiceModel, purchaseOrderModel, receiptModel } from "./documents";
describe("documents", () => {
  const shop = { name: "Chez Awa", city: "Dakar", phone: "770000000", vatRatePct: 18 };
  it("facture : HT = TTC − TVA, reste à payer", () => {
    const m = invoiceModel({ number: "FC-1", total: 11_800, vat: 1_800, createdAt: "2026-01-02T10:00:00Z", lines: [{ description: "Conseil", qty: 2, unitPrice: 5000 }], payments: [{ id: "a", amount: 4000, method: "cash", date: "" }] }, shop, { name: "Moussa" });
    expect(m.totals.map((t) => t.value)).toEqual([10_000, 1_800, 11_800, 4_000, 7_800]);
    expect(m.rows[0]!.total).toBe(10_000);
    expect(m.issuer.lines).toContain("Tél. 770000000");
  });
  it("facture soldée et client comptoir", () => {
    const m = invoiceModel({ number: "FC-2", total: 1000, createdAt: "2026-01-02T10:00:00Z", lines: [], payments: [{ id: "a", amount: 1000, method: "cash", date: "" }] }, null, null);
    expect(m.party.name).toBe("Client comptoir"); expect(m.footer[0]).toMatch(/acquittée/); expect(m.issuer.name).toBe("Mon commerce");
  });
  it("bon de commande et ticket", () => {
    const po = purchaseOrderModel({ number: "BC-1", createdAt: "2026-01-02T10:00:00Z", lines: [{ productId: "p", name: "Riz", qty: 10, unitCost: 600, received: 0, invoiced: 0 }] }, shop, { name: "Grossiste" });
    expect(po.totals[0]!.value).toBe(6000);
    const r = receiptModel({ number: "V-1", soldAt: "2026-01-02T10:00:00Z", total: 2000, change: 500, lines: [{ name: "Riz", qty: 2, unitPrice: 1000 }], payments: [{ method: "cash", amount: 2500 }] }, shop);
    expect(r.totals.map((t) => t.label)).toEqual(["TOTAL", "Espèces", "Monnaie rendue"]);
  });
});

import { reportModel } from "./documents";
import type { ConsolidatedReport } from "./reports";
describe("modèle PDF du rapport", () => {
  const agg = { count: 3, revenueTtc: 6000, vat: 915, revenueHt: 5085, avgBasket: 2000, cogs: 3500, grossMargin: 1585, marginPct: 31.2, indicativeMargin: 1585, costCoveragePct: 100, costedRevenueTtc: 6000, lineRevenueTtc: 6000, byMethod: { cash: 2000, card: 4000 } };
  const rep = (over: Partial<ConsolidatedReport["totals"]> = {}, partial = false): ConsolidatedReport => ({
    period: { from: "2026-06-01", to: "2026-06-07", days: 7, note: "Jours en heure UTC" },
    shops: [{ id: "a", name: "Dakar", ...agg, openCredit: 0, receivables: 0, payables: 0, stockValue: 1000, stockouts: 0, truncated: { sales: false, stock: false } }],
    totals: { ...agg, openCredit: 4000, receivables: 500, payables: 5900, stockValue: 60600, stockouts: 2, ...over }, daily: [], topProducts: [], partial,
  });
  it("une ligne par boutique et les totaux utiles", () => {
    const m = reportModel(rep(), "Chez Awa", new Date("2026-06-08T10:00:00Z"));
    expect(m.kind).toBe("report"); expect(m.columns).toEqual(["Boutique", "Ventes", "Panier moy.", "CA TTC"]);
    expect(m.rows).toEqual([{ label: "Dakar", qty: 3, unit: 2000, total: 6000 }]);
    const labels = m.totals.map((t) => t.label);
    expect(labels).toContain("Marge brute HT (31.2 %)"); expect(labels).toContain("Encaissé : Carte / banque"); expect(labels).toContain("Stock valorisé (coût moyen)");
    expect(m.totals.find((t) => t.label === "Dettes fournisseurs")!.value).toBe(5900);
  });
  it("omet les chiffres inconnus au lieu de les mettre à zéro, et explique pourquoi", () => {
    const m = reportModel(rep({ grossMargin: null, marginPct: null, costCoveragePct: 54, stockValue: null }, true), "Chez Awa");
    expect(m.totals.map((t) => t.label).join("|")).not.toMatch(/Marge brute|Stock valorisé/);
    expect(m.footer.join(" ")).toMatch(/54 %/); expect(m.footer.join(" ")).toMatch(/Stock valorisé non affiché/); expect(m.footer.join(" ")).toMatch(/partiel/);
  });
});

describe("caractères imprimables dans les PDF", () => {
  // Les polices PDF standard (WinAnsi) n'affichent ni flèches ni la plupart des symboles : un caractère hors de cette plage donne du texte illisible.
  const PRINTABLE = /^[\u0020-\u007E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2026\u2022\u20AC\n]*$/;
  const texts = (m: import("./documents").DocModel) => [m.title, m.number, m.date, m.issuer.name, ...(m.issuer.lines ?? []), m.party.name, ...(m.party.lines ?? []), ...(m.columns ?? []), ...m.rows.map((r) => r.label), ...m.totals.map((x) => x.label), ...m.footer];
  it("facture, bon de commande, ticket et rapport n'utilisent que des caractères affichables", () => {
    const shop = { name: "Chez Awa — Dakar", address: "Marché Sandaga", city: "Dakar", phone: "770000000", legal: "NINEA 1", vatRatePct: 18 };
    const models = [
      invoiceModel({ number: "FC-1", total: 1000, vat: 0, createdAt: "2026-01-02T10:00:00Z", dueAt: "2026-02-01T00:00:00Z", lines: [{ description: "Café crème", qty: 1, unitPrice: 1000 }], payments: [] }, shop, { name: "Moussa Diop" }),
      purchaseOrderModel({ number: "BC-1", createdAt: "2026-01-02T10:00:00Z", lines: [{ productId: "p", name: "Riz", qty: 1, unitCost: 1, received: 0, invoiced: 0 }] }, shop, { name: "Grossiste" }),
      receiptModel({ number: "V-1", soldAt: "2026-01-02T10:00:00Z", total: 2000, change: 500, lines: [{ name: "Riz", qty: 2, unitPrice: 1000 }], payments: [{ method: "cash", amount: 2500 }, { method: "credit", amount: 0 }] }, shop),
      reportModel({ period: { from: "2026-06-01", to: "2026-06-07", days: 7, note: "Jours en heure UTC" }, shops: [], totals: { count: 0, revenueTtc: 0, vat: 0, revenueHt: 0, avgBasket: 0, cogs: null, grossMargin: null, marginPct: null, indicativeMargin: 0, costCoveragePct: 100, costedRevenueTtc: 0, lineRevenueTtc: 0, byMethod: { wave: 1 }, openCredit: 0, receivables: 0, payables: 0, stockValue: null, stockouts: null }, daily: [], topProducts: [], partial: true }, "Chez Awa"),
    ];
    for (const m of models) for (const s of texts(m)) expect(PRINTABLE.test(s), `${m.kind}: « ${s} »`).toBe(true);
  });
});
