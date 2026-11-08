import { toFcfa } from "./money";

export type PoLine = { productId: string; name: string; qty: number; unitCost: number; received: number; invoiced: number };
export type PoStatus = "ordered" | "partial" | "received" | "cancelled";
export type InvoiceStatus = "unpaid" | "partial" | "paid";
export type Payment = { id: string; amount: number; method: "cash" | "wave" | "orange" | "card"; date: string };

export const lineHt = (qty: number, unitCost: number): number => toFcfa(qty * unitCost);
export const poTotalHt = (lines: PoLine[]): number => lines.reduce((s, l) => s + lineHt(l.qty, l.unitCost), 0);
export const toReceive = (l: PoLine): number => Math.max(0, l.qty - l.received);
/** Quantités reçues mais pas encore facturées. */
export const toInvoice = (l: PoLine): number => Math.max(0, l.received - l.invoiced);

export function poStatus(lines: PoLine[], cancelled = false): PoStatus {
  if (cancelled) return "cancelled";
  const got = lines.reduce((s, l) => s + l.received, 0);
  if (got === 0) return "ordered";
  return lines.every((l) => l.received >= l.qty) ? "received" : "partial";
}

/** Coût moyen pondéré après réception (stock actuel valorisé au coût actuel + quantité reçue au coût de la commande). */
export function weightedCost(stock: number, cost: number, qty: number, unitCost: number): number {
  const base = Math.max(0, stock);
  const total = base + qty;
  return total > 0 ? toFcfa((base * cost + qty * unitCost) / total) : toFcfa(unitCost);
}

export const invoiceTtc = (ht: number, vatRatePct: number): number => toFcfa(ht * (1 + vatRatePct / 100));
export const paidOf = (payments: Payment[]): number => payments.reduce((s, p) => s + p.amount, 0);
export const invoiceStatus = (total: number, paid: number): InvoiceStatus => (paid >= total ? "paid" : paid > 0 ? "partial" : "unpaid");
export const dueOf = (total: number, payments: Payment[]): number => Math.max(0, total - paidOf(payments));

/** Valide une saisie de réception/facturation : quantités entières > 0, pas au-delà du restant. */
export function validateQuantities(
  lines: PoLine[], wanted: { productId: string; qty: number }[], remaining: (l: PoLine) => number,
): { ok: true } | { ok: false; error: string } {
  if (!wanted.length) return { ok: false, error: "Aucune ligne" };
  const seen = new Set<string>();
  for (const w of wanted) {
    const line = lines.find((l) => l.productId === w.productId);
    if (!line) return { ok: false, error: "Produit hors commande" };
    if (seen.has(w.productId)) return { ok: false, error: "Ligne en double" };
    seen.add(w.productId);
    if (!Number.isInteger(w.qty) || w.qty <= 0) return { ok: false, error: "Quantité invalide" };
    if (w.qty > remaining(line)) return { ok: false, error: `Quantité supérieure au restant : ${line.name}` };
  }
  return { ok: true };
}
