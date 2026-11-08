/** Montants en FCFA : entiers, sans décimales. Toute la logique monétaire passe par ici. */
export const toFcfa = (n: number): number => Math.round(Number.isFinite(n) ? n : 0);

export const formatFcfa = (n: number): string =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(toFcfa(n)) + " FCFA";

export type CartLine = { productId: string; name: string; unitPrice: number; qty: number; discountPct?: number };

export const lineTotal = (l: CartLine): number =>
  toFcfa(l.unitPrice * l.qty * (1 - Math.min(Math.max(l.discountPct ?? 0, 0), 100) / 100));

export const cartTotal = (lines: CartLine[]): number => lines.reduce((s, l) => s + lineTotal(l), 0);

export type PaymentMethod = "cash" | "momo" | "card" | "credit";
export type Payment = { method: PaymentMethod; amount: number };

/** Valide un encaissement : la somme doit couvrir le total ; la monnaie n'est rendue qu'en espèces. */
export function settle(total: number, payments: Payment[]) {
  const paid = payments.reduce((s, p) => s + toFcfa(p.amount), 0);
  const cash = payments.filter((p) => p.method === "cash").reduce((s, p) => s + toFcfa(p.amount), 0);
  const credit = payments.filter((p) => p.method === "credit").reduce((s, p) => s + toFcfa(p.amount), 0);
  const change = Math.max(0, paid - total);
  if (paid < total) return { ok: false as const, error: "Montant insuffisant", missing: total - paid };
  if (change > cash) return { ok: false as const, error: "La monnaie ne se rend qu'en espèces", missing: 0 };
  return { ok: true as const, change, creditAmount: credit };
}
