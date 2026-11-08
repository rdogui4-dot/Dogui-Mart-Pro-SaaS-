export type CreditAccount = { balance: number; limit: number };
/** Autorise une vente à crédit sans dépasser le plafond du client. */
export function canExtendCredit(acc: CreditAccount, amount: number) {
  if (amount <= 0) return { ok: false as const, error: "Montant invalide" };
  if (acc.balance + amount > acc.limit) return { ok: false as const, error: "Plafond de crédit dépassé" };
  return { ok: true as const };
}
export const applyRepayment = (acc: CreditAccount, amount: number): CreditAccount => ({
  ...acc, balance: Math.max(0, acc.balance - Math.max(0, amount)),
});
