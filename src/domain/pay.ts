import { canExtendCredit } from "./credit";
import { isQrMethod, type Payment, type PaymentMethod } from "./money";

/** Ligne de paiement saisie à la caisse (le montant reste un texte tant qu'il n'est pas validé). */
export type PayLine = { id: string; method: PaymentMethod; amount: string; reference: string; linkId?: string };
export const METHOD_LABEL: Record<PaymentMethod, string> = { cash: "Espèces", wave: "Wave", orange: "Orange Money", card: "Carte", credit: "Crédit client", voucher: "Bon d'achat / avoir" };
export type PayState = { ok: boolean; errors: string[]; paid: number; remaining: number; change: number; creditAmount: number; payments: (Payment & { reference?: string; linkId?: string })[] };

/** Contrôle d'un encaissement (paiement mixte compris) : montants entiers, référence pour Mobile Money (jamais « vérifiée » par l'application), crédit réservé aux clients dans leur plafond,
 *  monnaie rendue seulement en espèces et dans la limite des espèces reçues, total couvert. Le serveur refait les mêmes contrôles et fait foi. */
export function evaluatePay(total: number, lines: PayLine[], o: { hasCustomer: boolean; credit?: { balance: number; limit: number } }): PayState {
  const errors: string[] = []; const payments: PayState["payments"] = []; let paid = 0, cash = 0, credit = 0;
  if (!lines.length) errors.push("Ajoutez un moyen de paiement");
  lines.forEach((l, i) => {
    const raw = l.amount.replace(/\s/g, ""); const n = Number(raw); const tag = lines.length > 1 ? ` (ligne ${i + 1})` : "";
    if (raw === "" || !Number.isInteger(n) || n <= 0) { errors.push(`Montant invalide${tag}`); return; }
    paid += n; if (l.method === "cash") cash += n; if (l.method === "credit") credit += n;
    const ref = l.reference.trim();
    if (isQrMethod(l.method) && !l.linkId && ref.length < 4) errors.push(`${METHOD_LABEL[l.method]}${tag} : saisissez la référence de la transaction (4 caractères au moins)`);
    if (l.method === "voucher" && ref.length < 4) errors.push(`Bon d'achat${tag} : saisissez son code`);
    if (ref.length > 64) errors.push(`Référence trop longue${tag}`);
    payments.push({ method: l.method, amount: n, ...(ref ? { reference: ref } : {}), ...(l.linkId ? { linkId: l.linkId } : {}) });
  });
  if (credit > 0) { if (!o.hasCustomer) errors.push("Choisissez un client pour un paiement à crédit"); else if (o.credit) { const c = canExtendCredit(o.credit, credit); if (!c.ok) errors.push(c.error); } }
  const remaining = Math.max(0, total - paid); const change = Math.max(0, paid - total);
  if (remaining > 0) errors.push(`Reste à payer : ${remaining.toLocaleString("fr-FR")} FCFA`);
  const voucherAmt = lines.filter((x) => x.method === "voucher").reduce((a, x) => a + (Number(x.amount.replace(/\s/g, "")) || 0), 0); if (voucherAmt > total) errors.push("Un bon d'achat ne rend pas de monnaie : le montant du bon dépasse le total");
  if (change > cash) errors.push("La monnaie ne se rend qu'en espèces : le surplus dépasse les espèces reçues");
  if (credit > total) errors.push("Le crédit ne peut pas dépasser le total de la vente");
  return { ok: errors.length === 0, errors, paid, remaining, change, creditAmount: credit, payments };
}
