import { formatFcfa, lineTotal, toFcfa } from "./money";
import { paidOf, poTotalHt, type Payment, type PoLine } from "./purchasing";
import type { ConsolidatedReport } from "./reports";

/** Modèle neutre d'un document imprimable (facture, bon de commande, ticket). Le rendu PDF est séparé (src/lib/pdf.ts). */
export type Party = { name: string; lines?: string[] };
export type DocRow = { label: string; qty: number; unit: number; total: number };
export type DocModel = {
  kind: "invoice" | "purchase_order" | "receipt" | "report";
  /** En-têtes du tableau (par défaut : Désignation / Qté / P.U. / Total). */
  columns?: [string, string, string, string];
  title: string; number: string; date: string; dueDate?: string;
  issuer: Party; party: Party; partyLabel: string;
  rows: DocRow[];
  totals: { label: string; value: number; strong?: boolean }[];
  footer: string[];
};
export type Shop = { name?: string; address?: string; city?: string; phone?: string; legal?: string; vatRatePct?: number };

export const issuerOf = (s: Shop | null | undefined): Party => ({
  name: s?.name || "Mon commerce",
  lines: [s?.address, s?.city, s?.phone && `Tél. ${s.phone}`, s?.legal].filter((x): x is string => !!x),
});
/** Montant avec espaces ASCII : les polices PDF standard ne savent pas afficher l'espace fine insécable d'Intl. */
export const plainMoney = (n: number): string => formatFcfa(n).replace(/[\u202f\u00a0]/g, " ");
const dateFr = (iso: string) => new Date(iso).toLocaleDateString("fr-FR");

export type InvoiceDoc = {
  number: string; total: number; vat?: number; paid?: number; dueAt?: string; createdAt: string;
  saleId?: string; lines: { description: string; qty: number; unitPrice: number; discountPct?: number }[];
  payments: Payment[];
};

/** Facture client. Vente (saleId) : prix TTC. Facture libre : prix HT. Le HT est toujours total − TVA. */
export function invoiceModel(inv: InvoiceDoc, shop: Shop | null, customer: { name: string; phone?: string } | null): DocModel {
  const rows: DocRow[] = inv.lines.map((l) => ({
    label: l.description, qty: l.qty, unit: l.unitPrice,
    total: lineTotal({ productId: "", name: l.description, unitPrice: l.unitPrice, qty: l.qty, discountPct: l.discountPct }),
  }));
  const vat = toFcfa(inv.vat ?? 0);
  const paid = paidOf(inv.payments);
  const due = Math.max(0, inv.total - paid);
  return {
    kind: "invoice", title: "FACTURE", number: inv.number, date: dateFr(inv.createdAt), dueDate: inv.dueAt ? dateFr(inv.dueAt) : undefined,
    issuer: issuerOf(shop), partyLabel: "Facturé à",
    party: { name: customer?.name || "Client comptoir", lines: customer?.phone ? [`Tél. ${customer.phone}`] : [] },
    rows,
    totals: [
      { label: "Total HT", value: inv.total - vat }, { label: `TVA${shop?.vatRatePct != null ? ` ${shop.vatRatePct}%` : ""}`, value: vat },
      { label: "Total TTC", value: inv.total, strong: true }, { label: "Déjà réglé", value: paid }, { label: "Reste à payer", value: due, strong: true },
    ],
    footer: due === 0 ? ["Facture acquittée. Merci de votre confiance."] : [`Reste dû : ${plainMoney(due)}`],
  };
}

export function purchaseOrderModel(po: { number: string; createdAt: string; lines: PoLine[] }, shop: Shop | null, supplier: { name: string; phone?: string } | null): DocModel {
  const ht = poTotalHt(po.lines);
  return {
    kind: "purchase_order", title: "BON DE COMMANDE", number: po.number, date: dateFr(po.createdAt),
    issuer: issuerOf(shop), partyLabel: "Fournisseur",
    party: { name: supplier?.name || "—", lines: supplier?.phone ? [`Tél. ${supplier.phone}`] : [] },
    rows: po.lines.map((l) => ({ label: l.name, qty: l.qty, unit: l.unitCost, total: toFcfa(l.qty * l.unitCost) })),
    totals: [{ label: "Total HT", value: ht, strong: true }],
    footer: ["Prix hors taxes. Merci de confirmer la disponibilité et le délai de livraison."],
  };
}

export type ReceiptSale = {
  number: string; soldAt: string; total: number; change?: number;
  lines: { name: string; qty: number; unitPrice: number; discountPct?: number }[];
  payments: { method: string; amount: number }[];
};
const METHOD: Record<string, string> = { cash: "Espèces", wave: "Wave", orange: "Orange Money", card: "Carte", credit: "Crédit" };

export function receiptModel(sale: ReceiptSale, shop: Shop | null, customer?: string): DocModel {
  const totals = [{ label: "TOTAL", value: sale.total, strong: true }, ...sale.payments.map((p) => ({ label: METHOD[p.method] ?? p.method, value: p.amount }))];
  if (sale.change) totals.push({ label: "Monnaie rendue", value: sale.change });
  return {
    kind: "receipt", title: "TICKET DE CAISSE", number: sale.number, date: new Date(sale.soldAt).toLocaleString("fr-FR"),
    issuer: issuerOf(shop), partyLabel: "Client", party: { name: customer || "Client comptoir" },
    rows: sale.lines.map((l) => ({ label: l.name, qty: l.qty, unit: l.unitPrice, total: lineTotal({ productId: "", name: l.name, unitPrice: l.unitPrice, qty: l.qty, discountPct: l.discountPct }) })),
    totals, footer: ["Merci de votre visite !"],
  };
}

const METHOD_FR: Record<string, string> = { cash: "Espèces", wave: "Wave", orange: "Orange Money", card: "Carte / banque", credit: "Crédit client" };

/** Rapport consolidé imprimable : une ligne par boutique, puis les totaux. Les chiffres inconnus sont omis et expliqués en pied de page, jamais remplacés par 0. */
export function reportModel(r: ConsolidatedReport, company: string, now: Date = new Date()): DocModel {
  const T = r.totals; const totals: DocModel["totals"] = [
    { label: "Chiffre d'affaires TTC", value: T.revenueTtc, strong: true }, { label: "dont TVA", value: T.vat }, { label: "Chiffre d'affaires HT", value: T.revenueHt },
  ];
  if (T.grossMargin !== null) totals.push({ label: `Marge brute HT${T.marginPct !== null ? ` (${T.marginPct} %)` : ""}`, value: T.grossMargin, strong: true });
  for (const [m, v] of Object.entries(T.byMethod).sort((a, b) => b[1] - a[1])) totals.push({ label: `Encaissé : ${METHOD_FR[m] ?? m}`, value: v });
  totals.push({ label: "Crédits clients ouverts", value: T.openCredit }, { label: "Factures clients à encaisser", value: T.receivables }, { label: "Dettes fournisseurs", value: T.payables });
  if (T.stockValue !== null) totals.push({ label: "Stock valorisé (coût moyen)", value: T.stockValue });
  const footer = [`Période : du ${dateFr(r.period.from)} au ${dateFr(r.period.to)} (${r.period.note.toLowerCase()}).`];
  if (T.grossMargin === null) footer.push(`Marge brute non affichée : coûts d'achat manquants (couverture ${T.costCoveragePct} % du chiffre d'affaires).`);
  if (T.stockValue === null) footer.push("Stock valorisé non affiché : historique trop long pour un calcul exact.");
  if (r.partial) footer.push("Rapport partiel : le volume de ventes dépasse la limite de lecture.");
  return {
    kind: "report", title: "RAPPORT DE VENTES", number: `${r.period.from} au ${r.period.to}`, date: now.toLocaleDateString("fr-FR"),
    issuer: { name: company }, partyLabel: "Périmètre", party: { name: r.shops.length === 1 ? r.shops[0]!.name : `${r.shops.length} boutiques`, lines: r.shops.length > 1 ? r.shops.map((s) => s.name) : [] },
    columns: ["Boutique", "Ventes", "Panier moy.", "CA TTC"],
    rows: r.shops.map((s) => ({ label: s.name, qty: s.count, unit: s.avgBasket, total: s.revenueTtc })),
    totals, footer,
  };
}
