/** Écritures SYSCOHADA simplifiées, générées automatiquement à partir des opérations commerciales. */
export const ACCOUNTS = {
  cash: "571", wave: "5722", orange: "5723", bank: "521", customers: "411", vouchers: "4191", suppliers: "401",
  salesGoods: "701", purchasesGoods: "601", stockGoods: "31", vatCollected: "4431", vatDeductible: "4452",
} as const;

export type Entry = { account: string; debit: number; credit: number; label: string };
export type Journal = { date: string; ref: string; entries: Entry[] };

export const isBalanced = (j: Journal): boolean =>
  j.entries.reduce((s, e) => s + e.debit, 0) === j.entries.reduce((s, e) => s + e.credit, 0);

type Method = "cash" | "wave" | "orange" | "card" | "credit" | "voucher";
const treasury = (m: Method) =>
  ({ cash: ACCOUNTS.cash, wave: ACCOUNTS.wave, orange: ACCOUNTS.orange, card: ACCOUNTS.bank, credit: ACCOUNTS.customers, voucher: ACCOUNTS.vouchers })[m];

/** Vente : débit trésorerie/clients (TTC), crédit 701 (HT) et 4431 (TVA). */
export function saleJournal(a: {
  ref: string; date: string; totalTtc: number; vatRatePct: number;
  payments: { method: Method; amount: number }[];
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

/** Remboursement ou annulation : écriture inverse de la vente (ventes et TVA collectée au débit, trésorerie ou clients au crédit). */
export function refundJournal(a: { ref: string; date: string; totalTtc: number; vatRatePct: number; refunds: { method: Method; amount: number }[] }): Journal {
  const ht = Math.round(a.totalTtc / (1 + a.vatRatePct / 100)); const vat = a.totalTtc - ht;
  const entries: Entry[] = [{ account: ACCOUNTS.salesGoods, debit: ht, credit: 0, label: `Remboursement ${a.ref}` }];
  if (vat > 0) entries.push({ account: ACCOUNTS.vatCollected, debit: vat, credit: 0, label: `TVA remboursement ${a.ref}` });
  for (const r of a.refunds) if (r.amount > 0) entries.push({ account: treasury(r.method), debit: 0, credit: r.amount, label: `Remboursement ${a.ref} (${r.method})` });
  return { date: a.date, ref: a.ref, entries };
}
