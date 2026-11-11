/** MASTER DOGUI : licence indépendante de l'abonnement DOGUI MART PRO (règles pures).
 *  Essai de 14 jours sans paiement, une seule fois ; première période de 12 mois à 15 000 FCFA (règlement unique, après l'essai) ; ensuite 2 500 FCFA par mois ; à l'expiration : mode consultation.
 *  Les tarifs sont ceux du cahier des charges v1.1 ; modalités de règlement et délai de grâce : à confirmer par la direction (voir GRACE_DAYS). */
export const MASTER = { trialDays: 14, firstPrice: 15_000, firstMonths: 12, renewPrice: 2_500, graceDays: 0, maxMonths: 12 } as const;
export type Lic = { trialStartedAt?: string; trialEndsAt?: string; firstPaidAt?: string; paidUntil?: string };
export type MState = "none" | "trial" | "active" | "grace" | "expired";
export type Phase = "none" | "trial" | "first" | "renewal";
const DAY = 864e5;
/** Ajoute des mois civils à un instant (UTC), en ramenant le jour au dernier du mois si nécessaire. */
export function addMonths(iso: string, n: number): string { const d = new Date(iso); const y = d.getUTCFullYear(), m = d.getUTCMonth() + n, day = d.getUTCDate(); const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); return new Date(Date.UTC(y, m, Math.min(day, last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds())).toISOString(); }
const t = (s?: string) => (s ? Date.parse(s) : NaN);
export type View = { state: MState; phase: Phase; endsAt: string | null; daysLeft: number | null; canAnalyze: boolean; consultOnly: boolean; trialUsed: boolean; billingStartsAt: string | null; nextDue: { at: string; amount: number; label: string } | null; prices: { first: number; firstMonths: number; renew: number }; consequence: string };
export function viewOf(lic: Lic, now: Date): View {
  const n = now.getTime(); const paid = t(lic.paidUntil), trialEnd = t(lic.trialEndsAt); const trialUsed = !!lic.trialStartedAt || !!lic.firstPaidAt;
  const firstEnd = lic.firstPaidAt ? addMonths(lic.firstPaidAt, MASTER.firstMonths) : null; let state: MState = "none"; let endsAt: string | null = null; let phase: Phase = "none";
  if (paid > n) { state = "active"; endsAt = lic.paidUntil!; phase = firstEnd && n < t(firstEnd) ? "first" : "renewal"; }
  else if (trialEnd > n) { state = "trial"; endsAt = lic.trialEndsAt!; phase = "trial"; }
  else if (Number.isFinite(paid) || Number.isFinite(trialEnd)) { const end = Math.max(Number.isFinite(paid) ? paid : 0, Number.isFinite(trialEnd) ? trialEnd : 0); endsAt = new Date(end).toISOString(); state = MASTER.graceDays > 0 && n < end + MASTER.graceDays * DAY ? "grace" : "expired"; }
  const canAnalyze = state === "trial" || state === "active" || state === "grace";
  const billingStartsAt = lic.firstPaidAt ? lic.firstPaidAt : state === "trial" ? lic.trialEndsAt ?? null : null;
  const nextDue = state === "trial" ? { at: lic.trialEndsAt!, amount: MASTER.firstPrice, label: `Première période de ${MASTER.firstMonths} mois (règlement unique)` } : state === "active" ? { at: lic.paidUntil!, amount: MASTER.renewPrice, label: "Renouvellement mensuel" } : state === "expired" || state === "grace" ? { at: endsAt!, amount: lic.firstPaidAt ? MASTER.renewPrice : MASTER.firstPrice, label: lic.firstPaidAt ? "Renouvellement mensuel" : `Première période de ${MASTER.firstMonths} mois (règlement unique)` } : null;
  const consequence = state === "none" ? "Aucun essai démarré : vous pouvez démarrer l'essai gratuit de 14 jours (sans paiement)." : state === "trial" ? "Fin de l'essai : les nouvelles analyses sont suspendues (mode consultation) tant qu'aucune période n'est activée. Aucun débit automatique." : state === "active" ? "À l'échéance sans renouvellement : mode consultation (historique et anciens rapports accessibles, nouvelles analyses suspendues). Aucun débit automatique." : state === "grace" ? "Délai de grâce en cours : renouvelez avant la fin pour éviter la suspension des nouvelles analyses." : "Mode consultation : historique, anciens rapports et conversations accessibles ; nouvelles analyses, rapports, recommandations et automatisations suspendus. Vos données et les autres modules DOGUI MART PRO ne sont pas affectés.";
  return { state, phase, endsAt, daysLeft: endsAt ? Math.max(0, Math.ceil((t(endsAt) - n) / DAY)) : null, canAnalyze, consultOnly: state === "expired", trialUsed, billingStartsAt, nextDue, prices: { first: MASTER.firstPrice, firstMonths: MASTER.firstMonths, renew: MASTER.renewPrice }, consequence };
}
export type Purchase = { kind: "first" | "month"; count: number };
export type Applied = { lic: Lic; amount: number; from: string; to: string };
/** Activation par la plateforme : « first » = 12 mois à 15 000 FCFA (une seule fois, à partir de la fin de l'essai éventuel) ; « month » = 1 à 12 mois à 2 500 FCFA (après la première période). */
export function applyPurchase(lic: Lic, p: Purchase, now: Date): Applied {
  const nowIso = now.toISOString();
  if (p.kind === "first") { if (lic.firstPaidAt) throw new Error("La première période a déjà été activée : activez des mois de renouvellement"); const from = lic.trialEndsAt && t(lic.trialEndsAt) > now.getTime() ? lic.trialEndsAt : nowIso; const to = addMonths(from, MASTER.firstMonths); return { lic: { ...lic, firstPaidAt: from, paidUntil: to }, amount: MASTER.firstPrice, from, to }; }
  if (!lic.firstPaidAt) throw new Error("Activez d'abord la première période de 12 mois");
  if (!Number.isInteger(p.count) || p.count < 1 || p.count > MASTER.maxMonths) throw new Error(`Nombre de mois : 1 à ${MASTER.maxMonths}`);
  const cur = lic.paidUntil && t(lic.paidUntil) > now.getTime() ? lic.paidUntil : nowIso; const to = addMonths(cur, p.count); return { lic: { ...lic, paidUntil: to }, amount: MASTER.renewPrice * p.count, from: cur, to };
}
export const startTrial = (now: Date): Lic => ({ trialStartedAt: now.toISOString(), trialEndsAt: new Date(now.getTime() + MASTER.trialDays * DAY).toISOString() });
