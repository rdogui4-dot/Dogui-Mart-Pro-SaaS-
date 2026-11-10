/** Stock intelligent (Business) : règles pures partagées. Quatre quantités restent DISTINCTES : en stock (physique théorique, issue des mouvements), réservée (engagée dans un transfert préparé non expédié), disponible (stock − réservé) et en commande (reste à recevoir des commandes validées). La marchandise en transit n'est ni dans le stock de départ (déjà sortie) ni dans celui de destination (pas encore reçue). */

export type StockStatus = "ok" | "watch" | "low" | "out" | "negative";
export const STATUS_LABEL: Record<StockStatus, string> = { ok: "Disponible", watch: "À surveiller", low: "Stock faible", out: "Rupture", negative: "Stock négatif" };
/** Négatif < 0 ; rupture = 0 ; faible = ≤ minimum ; à surveiller = ≤ seuil d'alerte (préventif, au-dessus du minimum) ; sinon disponible. */
export function stockStatus(qty: number, min: number, alert = 0): StockStatus {
  if (qty < 0) return "negative"; if (qty === 0) return "out"; if (min > 0 && qty <= min) return "low"; if (alert > 0 && qty <= alert) return "watch"; return "ok";
}
export const needsAction = (s: StockStatus): boolean => s === "low" || s === "out" || s === "negative";

/** Valeur estimée du stock = Σ quantité positive × coût unitaire ; les articles sans coût sont comptés à part (jamais valorisés à un prix inventé). Distincte du chiffre d'affaires. */
export function valuation(items: { qty: number; cost: number }[]): { value: number; missingCost: number; negativeQty: number } {
  let value = 0, missing = 0, neg = 0; for (const i of items) { if (i.qty < 0) { neg++; continue; } if (i.qty > 0 && !(i.cost > 0)) { missing++; continue; } value += i.qty * i.cost; } return { value: Math.round(value), missingCost: missing, negativeQty: neg };
}
export const DEFAULT_IDLE_DAYS = 60; export const DEFAULT_TRANSFER_DAYS = 3;
/** Sans mouvement depuis `days` jours (article en stock uniquement : un article à 0 sans mouvement n'est pas « dormant »). */
export const isIdle = (qty: number, lastMoveAt: number | null, now: number, days: number): { idle: boolean; days: number | null } => { if (qty <= 0) return { idle: false, days: null }; if (lastMoveAt === null) return { idle: true, days: null }; const d = Math.floor((now - lastMoveAt) / 864e5); return { idle: d >= days, days: d }; };

// ------------------------------------------------------------------ transferts entre magasins (expédition puis réception)
export type XferStatus = "draft" | "shipped" | "partial" | "received" | "closed" | "cancelled";
export const XFER_LABEL: Record<XferStatus, string> = { draft: "Préparé", shipped: "Expédié", partial: "Partiellement reçu", received: "Reçu", closed: "Clôturé avec écart", cancelled: "Annulé" };
const XNEXT: Record<XferStatus, XferStatus[]> = { draft: ["shipped", "cancelled"], shipped: ["partial", "received", "closed"], partial: ["partial", "received", "closed"], received: [], closed: [], cancelled: [] };
export const xferCanMove = (from: XferStatus, to: XferStatus): boolean => XNEXT[from].includes(to);
export const xferIsOpen = (s: XferStatus): boolean => s === "shipped" || s === "partial";
export type XLine = { qty: number; received: number };
export function xferTotals(lines: XLine[]): { sent: number; received: number; missing: number; inTransit: number } {
  const sent = lines.reduce((a, l) => a + l.qty, 0), received = lines.reduce((a, l) => a + Math.min(l.received, l.qty), 0); const left = Math.round((sent - received) * 1e6) / 1e6; return { sent, received, missing: left, inTransit: left };
}
export const xferStatusAfterReceipt = (lines: XLine[]): "partial" | "received" => (lines.every((l) => l.received >= l.qty) ? "received" : "partial");
export const isXferLate = (shippedAt: number, now: number, days: number, status: XferStatus): boolean => xferIsOpen(status) && now - shippedAt > days * 864e5;
/** Une réception ne peut dépasser ce qui a été expédié moins ce qui a déjà été reçu. */
export const receivable = (l: XLine): number => Math.max(0, Math.round((l.qty - l.received) * 1e6) / 1e6);
