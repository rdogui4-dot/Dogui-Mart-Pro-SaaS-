/** MASTER DOGUI : confirmation de paiement par notification (webhook). Le format de la notification dépend du prestataire et n'est PAS présumé :
 *  l'administrateur déclare où se trouvent la référence, le montant, l'e-mail et le statut ; tant que ce paramétrage est incomplet, aucune activation automatique n'a lieu (file d'examen). */
export type HookMapping = { ref: string; amount: string; email: string; status: string; currency: string; successValues: string[]; expectedCurrency: string };
export const EMPTY_MAPPING: HookMapping = { ref: "", amount: "", email: "", status: "", currency: "", successValues: [], expectedCurrency: "" };
export const mappingComplete = (m: HookMapping): boolean => !!(m.ref && m.amount && m.email && m.status && m.successValues.length);
/** Lit une valeur par chemin pointé (« data.customer.email », « items.0.price »). Aucune évaluation de code. */
export function pathGet(obj: unknown, path: string): unknown { let cur: any = obj; for (const k of path.split(".").filter(Boolean)) { if (cur === null || typeof cur !== "object" || !Object.hasOwn(cur, k)) return undefined; cur = cur[k]; } return cur; }
export type Parsed = { ref: string; amount: number | null; email: string; status: string; currency: string; missing: string[] };
export function parseEvent(payload: unknown, m: HookMapping): Parsed {
  const s = (p: string) => { const v = p ? pathGet(payload, p) : undefined; return v === undefined || v === null || typeof v === "object" ? "" : String(v).trim(); };
  const amountRaw = s(m.amount).replace(/[\s ,]/g, ""); const n = amountRaw && /^\d+(\.\d+)?$/.test(amountRaw) ? Number(amountRaw) : NaN; const missing: string[] = [];
  const out = { ref: s(m.ref).slice(0, 64), amount: Number.isFinite(n) && Number.isInteger(n) ? n : null, email: s(m.email).toLowerCase().slice(0, 120), status: s(m.status).toLowerCase().slice(0, 40), currency: s(m.currency).toUpperCase().slice(0, 8) };
  if (!out.ref) missing.push("référence"); if (out.amount === null) missing.push("montant entier"); if (!out.email) missing.push("e-mail"); if (!out.status) missing.push("statut"); return { ...out, missing };
}
export type Decision = { auto: boolean; why: string };
/** Décision d'activation automatique : paramétrage complet, statut de succès, devise attendue (si fixée), champs présents. Le rapprochement avec la demande se fait ensuite côté serveur (montant et e-mail identiques, demande unique). */
export function canAutoActivate(p: Parsed, m: HookMapping): Decision {
  if (!mappingComplete(m)) return { auto: false, why: "paramétrage de la notification incomplet : examen manuel" }; if (p.missing.length) return { auto: false, why: `champs absents de la notification : ${p.missing.join(", ")}` };
  if (!m.successValues.map((x) => x.toLowerCase()).includes(p.status)) return { auto: false, why: `statut « ${p.status} » non reconnu comme paiement abouti` };
  if (m.expectedCurrency && p.currency !== m.expectedCurrency.toUpperCase()) return { auto: false, why: `devise « ${p.currency || "absente"} » différente de la devise attendue` }; return { auto: true, why: "" };
}
export const refOf = (seed: string): string => `MD-${seed.toUpperCase().slice(0, 8)}`;
export const expectedAmount = (kind: "first" | "month", count: number, first: number, renew: number): number => (kind === "first" ? first : renew * count);
