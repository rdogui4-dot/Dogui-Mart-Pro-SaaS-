/** FinI Business : règles pures (comptes financiers par boutique, flux, soldes, échéances, rapprochement, budgets). Aucune donnée fictive : un compte non configuré n'a pas de solde. */
export type AccountKind = "cash" | "bank" | "mobile" | "safe";
export const KIND_LABEL: Record<AccountKind, string> = { cash: "Caisse (espèces)", bank: "Banque", mobile: "Mobile money", safe: "Coffre" };
export const isKind = (k: unknown): k is AccountKind => k === "cash" || k === "bank" || k === "mobile" || k === "safe";

/** Moyens de règlement connus de l'application : chacun peut être rattaché à UN compte par boutique. */
export const METHOD_LABEL: Record<string, string> = { cash: "Espèces", wave: "Wave", orange: "Orange Money", card: "Carte / banque", mobile: "Mobile money (autre)", transfer: "Virement", other: "Autre" };
export const METHODS = Object.keys(METHOD_LABEL);
export const isMethod = (m: unknown): m is string => typeof m === "string" && Object.hasOwn(METHOD_LABEL, m);
/** Suggestion (jamais appliquée automatiquement) : moyens habituels d'un type de compte. */
export const SUGGESTED_METHODS: Record<AccountKind, string[]> = { cash: ["cash"], safe: [], bank: ["card", "transfer"], mobile: ["wave", "orange", "mobile"] };

/** Comptes comptables d'argent → moyen de règlement (plan existant : 571, 5722, 5723, 521). */
export const MONEY_ACCOUNTS: Record<string, string> = { "571": "cash", "5722": "wave", "5723": "orange", "521": "card" };

export type FlowSource = "sale" | "refund" | "credit_repay" | "customer_invoice" | "supplier_payment" | "supplier_refund" | "expense" | "cash_move" | "other";
export const SOURCE_LABEL: Record<FlowSource, string> = { sale: "Vente", refund: "Remboursement client", supplier_refund: "Remboursement fournisseur", credit_repay: "Remboursement de crédit client", customer_invoice: "Encaissement facture client", supplier_payment: "Paiement fournisseur", expense: "Dépense", cash_move: "Mouvement de caisse", other: "Autre écriture" };

/** Classe une écriture d'argent d'après sa référence et son libellé (les pièces d'origine restent la référence). */
export function classifyJournal(ref: string, label: string): FlowSource {
  const r = ref.toUpperCase(), l = label.toLowerCase();
  if (r.startsWith("RF-")) return "supplier_payment";
  if (r.startsWith("R-") && l.includes("crédit")) return "credit_repay";
  if (l.includes("remboursement fournisseur")) return "supplier_refund";
  if (l.includes("remboursement") && !l.includes("crédit")) return "refund";
  if (l.includes("règlement") || l.includes("reglement")) return "supplier_payment";
  if (l.includes("facture") || l.includes("encaissement")) return "customer_invoice";
  if (l.includes("vente")) return "sale";
  return "other";
}

export type Flow = { key: string; source: FlowSource; ref: string; date: string; method: string; amount: number; label: string; by: string; status: string };
export type Transfer = { id: string; fromId: string; toId: string; amount: number; date: string; status: string };
export type Account = { id: string; name: string; kind: AccountKind; methods: string[]; openingBalance: number | null; openingDate: string | null; active: boolean };

export const validDay = (s: unknown): string | null => { if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null; const d = new Date(`${s}T00:00:00Z`); return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s; };
export const validMonth = (s: unknown): string | null => (typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s) ? s : null);
export const dayOfIso = (iso: string): string => iso.slice(0, 10);

/** Un compte est « configuré » quand son solde d'ouverture ET sa date sont renseignés : sinon aucun solde n'est affiché. */
export const isConfigured = (a: Pick<Account, "openingBalance" | "openingDate">): boolean => a.openingBalance !== null && a.openingDate !== null;

/** Doublons : une même clé de flux ne compte qu'une fois (rejeu, double source). */
export function dedupe(flows: Flow[]): Flow[] { const seen = new Set<string>(); return flows.filter((f) => (seen.has(f.key) ? false : (seen.add(f.key), true))); }

/** Attribution des flux aux comptes : un moyen ne peut appartenir qu'à un compte actif ; le reste est « non affecté » (jamais perdu, jamais inventé). */
export function routing(accounts: Account[]): Map<string, string> { const m = new Map<string, string>(); for (const a of accounts) if (a.active) for (const x of a.methods) if (!m.has(x)) m.set(x, a.id); return m; }

export type Balance = { accountId: string; configured: boolean; opening: number | null; inflow: number; outflow: number; transfersIn: number; transfersOut: number; balance: number | null; asOf: string | null };
/** Solde = ouverture + flux affectés (date ≥ date d'ouverture, ≤ date de calcul) + virements confirmés. */
export function balanceOf(a: Account, flows: Flow[], transfers: Transfer[], route: Map<string, string>, asOf?: string): Balance {
  const base: Balance = { accountId: a.id, configured: isConfigured(a), opening: a.openingBalance, inflow: 0, outflow: 0, transfersIn: 0, transfersOut: 0, balance: null, asOf: asOf ?? null };
  if (!base.configured) return base;
  const from = a.openingDate!;
  for (const f of flows) { if (route.get(f.method) !== a.id || f.date < from || (asOf && f.date > asOf)) continue; if (f.amount >= 0) base.inflow += f.amount; else base.outflow += -f.amount; }
  for (const t of transfers) { if (t.status !== "confirmed" || t.date < from || (asOf && t.date > asOf)) continue; if (t.toId === a.id) base.transfersIn += t.amount; if (t.fromId === a.id) base.transfersOut += t.amount; }
  base.balance = base.opening! + base.inflow - base.outflow + base.transfersIn - base.transfersOut; return base;
}

// ---- échéances (créances / dettes)
export const AGING = [{ key: "notDue", label: "Non échu" }, { key: "d30", label: "1 à 30 jours" }, { key: "d60", label: "31 à 60 jours" }, { key: "d90", label: "61 à 90 jours" }, { key: "d90p", label: "Plus de 90 jours" }, { key: "noDue", label: "Sans échéance" }] as const;
export type AgingKey = (typeof AGING)[number]["key"];
export function agingKey(due: string | null, today: string): AgingKey {
  if (!due) return "noDue"; if (due >= today) return "notDue";
  const days = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 864e5);
  return days <= 30 ? "d30" : days <= 60 ? "d60" : days <= 90 ? "d90" : "d90p";
}
export function aging(items: { due: string | null; remaining: number }[], today: string): Record<AgingKey, number> {
  const out = { notDue: 0, d30: 0, d60: 0, d90: 0, d90p: 0, noDue: 0 } as Record<AgingKey, number>;
  for (const it of items) if (it.remaining > 0) out[agingKey(it.due, today)] += it.remaining; return out;
}

// ---- rapprochement assisté
export type StatementLine = { date: string; amount: number; label: string };
export type Suggestion = { line: number; flowKey: string; score: number; why: string };
/** Propose (sans jamais valider) des paires ligne de relevé ↔ flux : même montant, date proche. Chaque flux n'est proposé qu'une fois. */
export function suggestMatches(lines: StatementLine[], flows: Flow[], toleranceDays = 3): Suggestion[] {
  const used = new Set<string>(); const out: Suggestion[] = [];
  lines.forEach((l, i) => {
    let best: { f: Flow; gap: number } | null = null;
    for (const f of flows) { if (used.has(f.key) || f.amount !== l.amount) continue; const gap = Math.abs(Math.round((Date.parse(`${f.date}T00:00:00Z`) - Date.parse(`${l.date}T00:00:00Z`)) / 864e5)); if (gap > toleranceDays) continue; if (!best || gap < best.gap) best = { f, gap }; }
    if (best) { used.add(best.f.key); out.push({ line: i, flowKey: best.f.key, score: best.gap === 0 ? 100 : 100 - best.gap * 10, why: best.gap === 0 ? "Même montant et même date" : `Même montant, ${best.gap} jour(s) d'écart` }); }
  });
  return out;
}

// ---- budgets
export type BudgetState = "ok" | "warn" | "over";
export const budgetState = (spent: number, budget: number): BudgetState => (budget <= 0 ? (spent > 0 ? "over" : "ok") : spent > budget ? "over" : spent >= budget * 0.8 ? "warn" : "ok");

/** Transition de statut d'un virement : en attente → confirmé ; en attente ou confirmé → annulé (motif obligatoire). */
export const TRANSFER_NEXT: Record<string, string[]> = { pending: ["confirmed", "cancelled"], confirmed: ["cancelled"], cancelled: [] };
export const STATUS_LABEL: Record<string, string> = { pending: "En attente", confirmed: "Confirmé", cancelled: "Annulé" };
