/** Achats & fournisseurs (Business) : règles pures partagées par le serveur et l'interface. Commande, réception, facture et paiement sont quatre étapes DISTINCTES : aucune fonction ici ne les additionne. */
export type PoState = "draft" | "pending" | "validated" | "partial" | "received" | "cancelled";
export const PO_LABEL: Record<PoState, string> = { draft: "Brouillon", pending: "En attente de validation", validated: "Validée", partial: "Partiellement reçue", received: "Reçue", cancelled: "Annulée" };
/** Les anciennes commandes (statut « ordered ») sont des commandes validées. */
export const poState = (status: unknown): PoState => (status === "ordered" ? "validated" : (["draft", "pending", "validated", "partial", "received", "cancelled"].includes(String(status)) ? (status as PoState) : "validated"));
export const OPEN_STATES: PoState[] = ["pending", "validated", "partial"];
const NEXT: Record<PoState, PoState[]> = { draft: ["pending", "validated", "cancelled"], pending: ["draft", "validated", "cancelled"], validated: ["partial", "received", "cancelled"], partial: ["received", "validated"], received: [], cancelled: [] };
export const canMove = (from: PoState, to: PoState): boolean => NEXT[from].includes(to);
/** Une commande n'est modifiable librement qu'avant validation ; ensuite, toute modification est contrôlée (motif, historisée). */
export const isFreelyEditable = (s: PoState): boolean => s === "draft";
export const canReceive = (s: PoState): boolean => s === "validated" || s === "partial";

const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;
export type OrderLine = { productId: string; variantId?: string; name: string; qty: number; unit?: string; unitQty?: number; unitPrice?: number; discountPct?: number; unitCost: number; lineHt?: number; received: number; invoiced: number };
/** Montant net d'une ligne : quantité × prix − remise, arrondi au FCFA. */
export function lineNet(qty: number, unitPrice: number, discountPct = 0): number { if (!(discountPct >= 0 && discountPct <= 100)) throw new Error("Remise invalide (0 à 100 %)"); return Math.round(qty * unitPrice * (1 - discountPct / 100)); }
/** Prix de revient unitaire (en unité de base) après remise : net ÷ quantité de base. */
export const baseUnitCost = (net: number, baseQty: number): number => (baseQty > 0 ? Math.round(net / baseQty) : 0);
export type Totals = { goodsHt: number; transport: number; otherFees: number; fees: number; totalHt: number; taxRatePct: number; tax: number; totalTtc: number; taxed: boolean };
/** Totaux : taxes seulement si un taux est configuré (> 0) ; frais explicitement renseignés uniquement. */
export function poTotals(lines: { lineHt?: number; qty: number; unitCost: number }[], transport: number, otherFees: number, taxRatePct: number): Totals {
  const goodsHt = lines.reduce((a, l) => a + (l.lineHt ?? Math.round(l.qty * l.unitCost)), 0); const fees = transport + otherFees; const totalHt = goodsHt + fees; const rate = taxRatePct > 0 ? taxRatePct : 0; const tax = rate > 0 ? Math.round((totalHt * rate) / 100) : 0;
  return { goodsHt, transport, otherFees, fees, totalHt, taxRatePct: rate, tax, totalTtc: totalHt + tax, taxed: rate > 0 };
}
export const toDeliver = (l: { qty: number; received: number }): number => Math.max(0, r6(l.qty - l.received));
export type RecvInput = { productId: string; variantId?: string; accepted: number; damaged: number; refused: number };
/** Écarts d'une réception : commandé, déjà reçu (accepté), accepté ce jour, endommagé, refusé, manquant restant. Les quantités endommagées/refusées ne sont JAMAIS du stock disponible. */
export function receiptDiff(line: { qty: number; received: number }, r: { accepted: number; damaged: number; refused: number }) {
  const remainingBefore = toDeliver(line); const missingAfter = Math.max(0, r6(remainingBefore - r.accepted)); return { ordered: line.qty, receivedBefore: line.received, accepted: r.accepted, damaged: r.damaged, refused: r.refused, delivered: r6(r.accepted + r.damaged + r.refused), missingAfter, over: r.accepted > remainingBefore };
}
export type InvoiceState = "to_pay" | "partial" | "paid" | "dispute";
export const INVOICE_LABEL: Record<InvoiceState, string> = { to_pay: "À payer", partial: "Partiellement payée", paid: "Payée", dispute: "En litige" };
const DAY = 864e5; const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
export function invoiceView(i: { total: number; paid: number; dueOn?: string; disputed?: boolean }, today: string): { state: InvoiceState; remaining: number; overdue: boolean; lateDays: number } {
  const remaining = Math.max(0, i.total - i.paid); const state: InvoiceState = i.disputed && remaining > 0 ? "dispute" : remaining === 0 ? "paid" : i.paid > 0 ? "partial" : "to_pay"; const late = !!i.dueOn && remaining > 0 && i.dueOn < today;
  return { state, remaining, overdue: late, lateDays: late ? dayDiff(i.dueOn!, today) : 0 };
}
/** Solde fournisseur = factures enregistrées − paiements enregistrés (jamais les commandes ni les réceptions). */
export const supplierBalance = (invoices: { total: number; paid: number }[]): number => invoices.reduce((a, i) => a + (i.total - i.paid), 0);
export const normRef = (s: unknown): string => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const normName = (s: unknown): string => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
/** Doublon de facture : même fournisseur et même référence (certain), ou même montant émis à moins de 3 jours d'écart (probable, à confirmer). */
export function duplicateInvoice(existing: { id: string; ref: string; total: number; issuedOn: string; number?: string }[], c: { ref: string; total: number; issuedOn: string }): { kind: "same_ref" | "same_amount"; of: { id: string; number?: string } } | null {
  const rn = normRef(c.ref); if (rn) { const hit = existing.find((e) => normRef(e.ref) === rn); if (hit) return { kind: "same_ref", of: hit }; }
  const near = existing.find((e) => e.total === c.total && Math.abs(dayDiff(e.issuedOn, c.issuedOn)) <= 3); return near ? { kind: "same_amount", of: near } : null;
}
export const isLateDelivery = (deliveryOn: string | undefined, today: string, remaining: number): boolean => !!deliveryOn && remaining > 0 && deliveryOn < today;
export const priceTrend = (prev: number, now: number): number | null => (prev > 0 ? Math.round(((now - prev) / prev) * 1000) / 10 : null);
