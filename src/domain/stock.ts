export type StockMove = { productId: string; qty: number; kind: "sale" | "purchase" | "adjust" | "loss" | "transfer_in" | "transfer_out" | "assembly_in" | "assembly_out" };
const sign: Record<StockMove["kind"], 1 | -1> = { sale: -1, loss: -1, transfer_out: -1, purchase: 1, transfer_in: 1, adjust: 1, assembly_in: 1, assembly_out: -1 };
/** Le stock se déduit toujours des mouvements (journal immuable) : jamais d'écrasement direct. */
export const delta = (m: StockMove): number => (m.kind === "adjust" ? m.qty : sign[m.kind] * Math.abs(m.qty));
export const stockOf = (moves: StockMove[]): number => moves.reduce((s, m) => s + delta(m), 0);
export const isLow = (stock: number, minStock: number): boolean => stock <= minStock;
/** Quantité à commander : couvrir `coverDays` de ventes moyennes, moins le stock actuel. */
export function reorderQty(stock: number, soldLast30: number, coverDays = 14): number {
  const perDay = soldLast30 / 30;
  return Math.max(0, Math.ceil(perDay * coverDays - stock));
}
