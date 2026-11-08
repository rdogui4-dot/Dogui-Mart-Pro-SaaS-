/** Écritures SYSCOHADA simplifiées, générées automatiquement à partir des opérations commerciales. */
export const ACCOUNTS = {
  cash: "571", momo: "5721", bank: "521", customers: "411", suppliers: "401",
  salesGoods: "701", purchasesGoods: "601", stockGoods: "31", vatCollected: "4431", vatDeductible: "4452",
} as const;

export type Entry = { account: string; debit: number; credit: number; label: string };
export type Journal = { date: string; ref: string; entries: Entry[] };

export const isBalanced = (j: Journal): boolean =>
  j.entries.reduce((s, e) => s + e.debit, 0) === j.entries.reduce((s, e) => s + e.credit, 0);

const treasury = (m: "cash" | "momo" | "card" | "credit") =>
  m === "cash" ? ACCOUNTS.cash : m === "momo" ? ACCOUNTS.momo : m === "card" ? ACCOUNTS.bank : ACCOUNTS.customers;

/** Vente : débit trésorerie/clients (TTC), crédit 701 (HT) et 4431 (TVA). */
export function saleJournal(a: {
  ref: string; date: string; totalTtc: number; vatRatePct: number;
  payments: { method: "cash" | "momo" | "card" | "credit"; amount: number }[];
}): Journal {
  const ht = Math.round(a.totalTtc / (1 + a.vatRatePct / 100));
  const vat = a.totalTtc - ht;
  const entries: Entry[] = [];
  let remaining = a.totalTtc;
  for (const p of a.payments) {
    const amt = Math.min(p.amount, remaining);
    if (amt <= 0) continue;
    remaining -= amt;
    entries.push({ account: treasury(p.method), debit: amt, credit: 0, label: `Vente ${a.ref}` });
  }
  entries.push({ account: ACCOUNTS.salesGoods, debit: 0, credit: ht, label: `Vente ${a.ref}` });
  if (vat > 0) entries.push({ account: ACCOUNTS.vatCollected, debit: 0, credit: vat, label: `TVA ${a.ref}` });
  return { date: a.date, ref: a.ref, entries };
}

/** Réception d'achat à crédit fournisseur. */
export function purchaseJournal(a: { ref: string; date: string; totalTtc: number; vatRatePct: number }): Journal {
  const ht = Math.round(a.totalTtc / (1 + a.vatRatePct / 100));
  const vat = a.totalTtc - ht;
  const entries: Entry[] = [{ account: ACCOUNTS.purchasesGoods, debit: ht, credit: 0, label: `Achat ${a.ref}` }];
  if (vat > 0) entries.push({ account: ACCOUNTS.vatDeductible, debit: vat, credit: 0, label: `TVA ${a.ref}` });
  entries.push({ account: ACCOUNTS.suppliers, debit: 0, credit: a.totalTtc, label: `Achat ${a.ref}` });
  return { date: a.date, ref: a.ref, entries };
}
