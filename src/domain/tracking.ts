/** Suivi par lot (dates de péremption, sortie FEFO) et par numéro de série (Pro). Règles pures, partagées serveur / interface / tests. */
export const TRACKING_MODES = [{ id: "", label: "Aucun suivi" }, { id: "lot", label: "Par lot (péremption)" }, { id: "serial", label: "Par numéro de série" }] as const;
export type Tracking = "" | "lot" | "serial";
export const isTracking = (t: unknown): t is Tracking => t === "" || t === "lot" || t === "serial";
export const trackingOf = (p: object | null | undefined): Tracking => { const t = (p as { tracking?: unknown } | null)?.tracking; return t === "lot" || t === "serial" ? t : ""; };

// ------------------------------------------------------------------ péremption
export const EXPIRY_WARN_DAYS = 30;
export type ExpiryState = "none" | "ok" | "soon" | "expired";
export const dayOf = (iso: string): string => iso.slice(0, 10);
const DAY_MS = 86_400_000;
export const daysUntil = (expiresAt: string, today: string): number => Math.round((Date.parse(`${dayOf(expiresAt)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
/** Un lot est valable jusqu'à la fin du jour de péremption inclus ; périmé dès le lendemain. */
export function expiryState(expiresAt: string | undefined | null, today: string, warnDays = EXPIRY_WARN_DAYS): ExpiryState {
  if (!expiresAt) return "none";
  const d = daysUntil(expiresAt, today);
  return d < 0 ? "expired" : d <= warnDays ? "soon" : "ok";
}
export const EXPIRED_POLICIES = [{ id: "block", label: "Interdire la vente des lots périmés" }, { id: "allow", label: "Autoriser la vente des lots périmés" }] as const;
export type ExpiredPolicy = (typeof EXPIRED_POLICIES)[number]["id"];
export const isExpiredPolicy = (p: unknown): p is ExpiredPolicy => p === "block" || p === "allow";

export type LotStock = { id: string; qty: number; expiresAt?: string | null; receivedAt?: string; status?: string };
/** FEFO : « premier périmé, premier sorti ». Répartit `need` (entiers de sous-unités) sur les lots : date de péremption la plus proche d'abord, lots sans date en dernier,
 *  puis réception la plus ancienne, puis identifiant. Les lots bloqués ne sortent jamais ; les lots périmés ne sortent pas si la politique l'interdit. */
export function allocateFefo(lots: LotStock[], need: number, today: string, policy: ExpiredPolicy = "block"): { allocations: { lotId: string; qty: number }[]; shortage: number; expiredQty: number; blockedQty: number } {
  let expiredQty = 0, blockedQty = 0; const usable: LotStock[] = [];
  for (const l of lots) {
    if (l.qty <= 0) continue;
    if (l.status === "blocked") { blockedQty += l.qty; continue; }
    if (policy === "block" && expiryState(l.expiresAt, today) === "expired") { expiredQty += l.qty; continue; }
    usable.push(l);
  }
  usable.sort((a, b) => (a.expiresAt ? 0 : 1) - (b.expiresAt ? 0 : 1) || (a.expiresAt && b.expiresAt ? dayOf(a.expiresAt).localeCompare(dayOf(b.expiresAt)) : 0) || (a.receivedAt ?? "").localeCompare(b.receivedAt ?? "") || a.id.localeCompare(b.id));
  const allocations: { lotId: string; qty: number }[] = []; let left = need;
  for (const l of usable) { if (left <= 0) break; const take = Math.min(l.qty, left); allocations.push({ lotId: l.id, qty: take }); left -= take; }
  return { allocations, shortage: Math.max(0, left), expiredQty, blockedQty };
}

export const MAX_LOT_NO = 40;
export function normalizeLotNo(raw: unknown): string {
  const t = String(raw ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  if (!t) throw new Error("Numéro de lot obligatoire");
  if (t.length > MAX_LOT_NO) throw new Error(`Numéro de lot : ${MAX_LOT_NO} caractères maximum`);
  if (!/^[A-Z0-9 ._/\-]+$/.test(t)) throw new Error("Numéro de lot : lettres, chiffres et . _ - / uniquement");
  return t;
}
/** Date AAAA-MM-JJ valide (jour réel) ou erreur lisible. Renvoie l'ISO à minuit UTC. */
export function normalizeDate(raw: unknown, label: string): string {
  const t = String(raw ?? "").trim().slice(0, 10);
  const ms = Date.parse(`${t}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== t) throw new Error(`${label} invalide (AAAA-MM-JJ)`);
  return `${t}T00:00:00.000Z`;
}

// ------------------------------------------------------------------ numéros de série
export const SERIAL_STATUSES = [{ id: "available", label: "Disponible" }, { id: "sold", label: "Vendu" }, { id: "returned", label: "Retourné" }, { id: "warranty", label: "Sous garantie" }, { id: "defective", label: "Défectueux" }] as const;
export type SerialStatus = (typeof SERIAL_STATUSES)[number]["id"];
export const serialStatusLabel = (s?: string): string => SERIAL_STATUSES.find((x) => x.id === s)?.label ?? "Disponible";
/** Transitions autorisées par l'utilisateur. La vente (available → sold) n'est faite que par l'encaissement. */
export const SERIAL_TRANSITIONS: Record<SerialStatus, SerialStatus[]> = {
  available: ["defective"], sold: ["returned", "warranty"], warranty: ["sold", "returned"], returned: ["available", "defective"], defective: [],
};
/** Effet d'une transition sur le stock : +1 quand l'unité redevient vendable, −1 quand elle sort du stock vendable. */
export const stockEffect = (from: SerialStatus, to: SerialStatus): -1 | 0 | 1 => (to === "available" && from !== "available" ? 1 : from === "available" && to !== "available" ? -1 : 0);
export function normalizeSerial(raw: unknown): string {
  const t = String(raw ?? "").trim().replace(/\s+/g, "").toUpperCase();
  if (t.length < 3) throw new Error("Numéro de série trop court (3 caractères minimum)");
  if (t.length > 64) throw new Error("Numéro de série : 64 caractères maximum");
  if (!/^[A-Z0-9._/\-]+$/.test(t)) throw new Error("Numéro de série : lettres, chiffres et . _ - / uniquement");
  return t;
}
/** Liste saisie en vrac (une ligne, une virgule ou un espace par numéro) : normalisée, sans doublon. */
export function parseSerials(input: unknown): string[] {
  const parts = (Array.isArray(input) ? input.map(String) : String(input ?? "").split(/[\n,;\s]+/)).map((x) => x.trim()).filter(Boolean);
  const out: string[] = []; const seen = new Set<string>();
  for (const p of parts) { const s = normalizeSerial(p); if (seen.has(s)) throw new Error(`Numéro de série en double : ${s}`); seen.add(s); out.push(s); }
  return out;
}
export const MAX_SERIALS_PER_OP = 200;
/** Fin de garantie à partir de la date de vente (mois calendaires, borné au dernier jour du mois). */
export function warrantyEnd(soldAtIso: string, months: number): string {
  const d = new Date(soldAtIso); const day = d.getUTCDate();
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, last)); return end.toISOString();
}
