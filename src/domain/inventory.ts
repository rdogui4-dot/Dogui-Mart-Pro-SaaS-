/** Silent Count (Inventaire Business) : règles pures partagées par le serveur et l'interface.
 *  Principe : le stock théorique se CALCULE à partir des mouvements enregistrés jusqu'à un instant donné ; l'inventaire ne remplace jamais une quantité, il ajoute des mouvements correctifs. */
import { delta, type StockMove } from "./stock";

export type InvStatus = "draft" | "in_progress" | "counted" | "review" | "validated" | "closed" | "cancelled";
export const INV_LABEL: Record<InvStatus, string> = { draft: "Brouillon", in_progress: "En cours", counted: "Comptage terminé", review: "À vérifier", validated: "Validé", closed: "Clôturé", cancelled: "Annulé" };
const NEXT: Record<InvStatus, InvStatus[]> = { draft: ["in_progress", "cancelled"], in_progress: ["counted", "cancelled"], counted: ["in_progress", "review", "cancelled"], review: ["in_progress", "validated", "cancelled"], validated: ["closed"], closed: [], cancelled: [] };
export const canMove = (from: InvStatus, to: InvStatus): boolean => NEXT[from].includes(to);
/** Le comptage (saisie) n'est possible que pendant « en cours » ; l'écart n'est révélé qu'après la fin du comptage. */
export const canCount = (s: InvStatus): boolean => s === "in_progress";
export const revealsTheoretical = (s: InvStatus): boolean => s === "counted" || s === "review" || s === "validated" || s === "closed";
export const isFinal = (s: InvStatus): boolean => s === "closed" || s === "cancelled";
export const isEditable = (s: InvStatus): boolean => s === "draft";

export type LineStatus = "pending" | "counted" | "recount" | "approved" | "rejected" | "second" | "third" | "arbitrate";
export const LINE_LABEL: Record<LineStatus, string> = { pending: "À compter", counted: "Compté", recount: "À recompter", approved: "Écart approuvé", rejected: "Écart refusé", second: "Second comptage indépendant", third: "Troisième contrôle", arbitrate: "Arbitrage du responsable" };

/** Réglage par défaut des écarts importants : 10 % de l'écart relatif OU 50 000 FCFA de valeur absolue. */
export type Threshold = { pct: number; value: number };
export const DEFAULT_THRESHOLD: Threshold = { pct: 10, value: 50_000 };
/** Fenêtre au-delà de laquelle un mouvement n'est plus considéré « récent » par rapport au comptage (15 minutes). */
export const RECENT_WINDOW_MS = 15 * 60 * 1000;
/** Écart physique de moins de 2 secondes entre deux saisies identiques = double appui accidentel. */
export const DOUBLE_TAP_MS = 5000;

type Mv = { kind: StockMove["kind"]; qty: number; at: number };
/** Stock théorique (entiers de sous-unités) à l'instant `at` inclus : somme des mouvements enregistrés jusque-là. */
export const theoreticalAt = (moves: Mv[], at: number): number => moves.reduce((s, m) => (m.at <= at ? s + delta({ productId: "", qty: m.qty, kind: m.kind }) : s), 0);
/** Mouvements intervenus dans l'intervalle ]from, to], regroupés par nature (ventes, réceptions, retours, transferts, autres). */
export type MoveGroup = "sales" | "receipts" | "returns" | "transfers" | "other";
export const GROUP_LABEL: Record<MoveGroup, string> = { sales: "Ventes", receipts: "Réceptions", returns: "Retours", transfers: "Transferts", other: "Autres mouvements" };
const groupOf = (k: string): MoveGroup => (k === "sale" ? "sales" : k === "purchase" ? "receipts" : k === "return" ? "returns" : k === "transfer_in" || k === "transfer_out" ? "transfers" : "other");
export function movesBetween(moves: Mv[], from: number, to: number): { net: Record<MoveGroup, number>; count: number; recent: number } {
  const net: Record<MoveGroup, number> = { sales: 0, receipts: 0, returns: 0, transfers: 0, other: 0 }; let count = 0, recent = 0;
  for (const m of moves) { if (m.at <= from || m.at > to) continue; net[groupOf(m.kind)] += delta({ productId: "", qty: m.qty, kind: m.kind }); count++; if (to - m.at <= RECENT_WINDOW_MS) recent++; }
  return { net, count, recent };
}

/** Écart en sous-unités : compté − théorique (positif = surplus, négatif = manquant). */
export const varianceOf = (countedScaled: number, theoreticalScaled: number): number => countedScaled - theoreticalScaled;
/** Valeur estimée de l'écart au coût applicable (coût unitaire d'une UNITÉ lisible), arrondie au FCFA. */
export const varianceValue = (diffReadable: number, unitCost: number): number => Math.round(diffReadable * unitCost);
/** Écart important : valeur absolue ≥ seuil en FCFA, ou écart relatif ≥ seuil en % du théorique (théorique nul + écart ≠ 0 = important). */
export function isSignificant(diffReadable: number, theoreticalReadable: number, value: number, t: Threshold = DEFAULT_THRESHOLD): boolean {
  if (diffReadable === 0) return false; if (Math.abs(value) >= t.value) return true;
  if (theoreticalReadable === 0) return true; return (Math.abs(diffReadable) / Math.abs(theoreticalReadable)) * 100 >= t.pct;
}
export const checkThreshold = (t: unknown): Threshold => {
  const o = (t ?? {}) as { pct?: unknown; value?: unknown }; const pct = o.pct === undefined || o.pct === "" ? DEFAULT_THRESHOLD.pct : Number(o.pct), value = o.value === undefined || o.value === "" ? DEFAULT_THRESHOLD.value : Number(o.value);
  if (!Number.isFinite(pct) || pct < 0 || pct > 1000) throw new Error("Seuil en % invalide (0 à 1000)"); if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000) throw new Error("Seuil en valeur invalide");
  return { pct, value: Math.round(value) };
};

/** Doublon accidentel : même agent, même quantité, moins de 5 secondes après la saisie précédente. */
export const isDoubleTap = (prev: { by: string; qty: number; at: number } | null, next: { by: string; qty: number; at: number }): boolean => !!prev && prev.by === next.by && prev.qty === next.qty && next.at - prev.at >= 0 && next.at - prev.at < DOUBLE_TAP_MS;
/** Deux agents différents qui saisissent des quantités différentes sur un même article : conflit à arbitrer (recomptage). */
export const isConflict = (prev: { by: string; qty: number } | null, next: { by: string; qty: number }): boolean => !!prev && prev.by !== next.by && prev.qty !== next.qty;

export type LineLike = { status: LineStatus; counted: number | null };
export function progress(lines: LineLike[]): { total: number; counted: number; pending: number; recount: number; pct: number } {
  const total = lines.length, counted = lines.filter((l) => l.counted !== null && l.status !== "recount").length, recount = lines.filter((l) => l.status === "recount" || l.status === "second" || l.status === "third" || l.status === "arbitrate").length;
  return { total, counted, pending: total - counted - recount + 0, recount, pct: total ? Math.round((counted / total) * 100) : 0 };
}
/** Un inventaire ne peut être validé que si chaque écart est tranché (approuvé ou refusé) ; les lignes non comptées ne reçoivent AUCUN ajustement. */
export function validationBlockers(lines: { status: LineStatus; diff: number | null; significant: boolean; reason?: string }[]): string[] {
  const out: string[] = []; const open = lines.filter((l) => l.diff !== null && l.diff !== 0 && l.status !== "approved" && l.status !== "rejected").length; if (open) out.push(`${open} écart(s) non traité(s) : approuvez-les (avec motif) ou refusez-les`);
  const recount = lines.filter((l) => l.status === "recount").length; if (recount) out.push(`${recount} article(s) à recompter`);
  const ctl = lines.filter((l) => l.status === "second" || l.status === "third" || l.status === "arbitrate").length; if (ctl) out.push(`${ctl} contrôle(s) indépendant(s) en cours ou à arbitrer`);
  const noReason = lines.filter((l) => l.status === "approved" && !(l.reason ?? "").trim()).length; if (noReason) out.push(`${noReason} ajustement(s) sans motif`);
  return out;
}
