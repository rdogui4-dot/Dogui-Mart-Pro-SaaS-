import { describe, expect, it } from "vitest";
import { invoiceModel, purchaseOrderModel, receiptModel } from "@/domain/documents";
import { buildPdf, pdfMoney } from "./pdf";

const shop = { name: "Chez Awa", address: "Marché Sandaga", city: "Dakar", phone: "770000000", legal: "NINEA 123456789", vatRatePct: 18 };
describe("rendu PDF", () => {
  it("formate les montants avec des espaces ASCII (sinon caractères illisibles dans le PDF)", () => {
    expect(pdfMoney(1234567)).toBe("1 234 567 FCFA");
    expect(/[  ]/.test(pdfMoney(1234567))).toBe(false);
  });
  it("aucun texte du document ne contient d'espace insécable (pied de facture compris)", () => {
    const m = invoiceModel({ number: "F", total: 1_534_000, vat: 0, createdAt: "2026-01-02T10:00:00Z", lines: [], payments: [] }, null, null);
    const all = [...m.footer, ...m.totals.map((t) => String(t.value))].join(" ");
    expect(/[\u202f\u00a0]/.test(all)).toBe(false);
    expect(m.footer[0]).toBe("Reste dû : 1 534 000 FCFA");
  });
  it("produit des PDF valides : facture multi-pages, bon de commande, ticket", async () => {
    const lines = Array.from({ length: 60 }, (_, i) => ({ description: `Article ${i + 1} avec une désignation assez longue pour passer sur plusieurs lignes dans le tableau`, qty: i + 1, unitPrice: 1500 }));
    const inv = await buildPdf(invoiceModel({ number: "FC-20260102-ABC123", total: 118_000, vat: 18_000, createdAt: "2026-01-02T10:00:00Z", dueAt: "2026-02-01T00:00:00Z", lines, payments: [] }, shop, { name: "Moussa Diop", phone: "781112233" }));
    expect(inv.getNumberOfPages()).toBeGreaterThan(1);
    const po = await buildPdf(purchaseOrderModel({ number: "BC-1", createdAt: "2026-01-02T10:00:00Z", lines: [{ productId: "p", name: "Riz parfumé 50kg", qty: 10, unitCost: 22_000, received: 0, invoiced: 0 }] }, shop, { name: "Grossiste" }));
    const rc = await buildPdf(receiptModel({ number: "V-1", soldAt: "2026-01-02T10:00:00Z", total: 2000, change: 500, lines: [{ name: "Riz", qty: 2, unitPrice: 1000 }], payments: [{ method: "cash", amount: 2500 }] }, shop));
    for (const d of [inv, po, rc]) {
      const bytes = new Uint8Array(d.output("arraybuffer"));
      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
      expect(bytes.length).toBeGreaterThan(1500);
    }
    expect(rc.internal.pageSize.getWidth()).toBe(80);
  });
});
