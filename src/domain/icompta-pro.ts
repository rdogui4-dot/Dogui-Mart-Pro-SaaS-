/** ICompta Pro : règles pures (double approbation, amortissement linéaire, lettrage, soldes par classe, correspondance des états, analytique).
 *  Aucun taux, durée, compte ni règle fiscale n'est inventé : les durées, comptes et correspondances viennent de l'utilisateur (à faire valider par un professionnel). */
import { isCode, periodOf, validDay, type Line } from "./icompta";

// ------------------------------------------------------------------ double approbation
export type Approval = { by: string; at: string; role: "owner" | "manager" };
export type ApprovalRule = { twoFrom: number; requireOwner: boolean };
export const NO_RULE: ApprovalRule = { twoFrom: 0, requireOwner: false };
/** Nombre d'approbations requises : 2 dès que le total atteint le seuil fixé par le propriétaire (0 = pas de seuil). */
export const requiredApprovals = (total: number, rule?: ApprovalRule | null): 1 | 2 => (rule && rule.twoFrom > 0 && total >= rule.twoFrom ? 2 : 1);
export type Step = { ok: boolean; reason?: string; duplicate?: boolean; final: boolean; self: boolean; next: Approval[]; required: 1 | 2 };
/** Un approbateur = propriétaire ou gérant, une seule fois. L'auteur ne compte que s'il est propriétaire (signalé « auto-approuvé »). L'écriture est validée quand le nombre d'approbateurs DISTINCTS est atteint (et, si demandé, qu'un propriétaire figure parmi eux). */
export function approvalStep(a: { role: "owner" | "manager" | "other"; creator: string; user: string; approvals: Approval[]; total: number; rule?: ApprovalRule | null; at: string }): Step {
  const required = requiredApprovals(a.total, a.rule); const base = { final: false, self: false, next: a.approvals, required };
  if (a.role !== "owner" && a.role !== "manager") return { ...base, ok: false, reason: "Seuls le propriétaire et les gérants approuvent une écriture" };
  const self = a.creator === a.user; if (self && a.role !== "owner") return { ...base, ok: false, self, reason: "Vous ne pouvez pas approuver votre propre écriture (séparation des rôles)" };
  if (a.approvals.some((x) => x.by === a.user)) return { ...base, ok: true, duplicate: true, self };
  const next = [...a.approvals, { by: a.user, at: a.at, role: a.role }]; const distinct = new Set(next.map((x) => x.by)).size; const ownerOk = !a.rule?.requireOwner || required === 1 || next.some((x) => x.role === "owner");
  return { ok: true, final: distinct >= required && ownerOk, self: next.some((x) => x.by === a.creator), next, required };
}

// ------------------------------------------------------------------ immobilisations : amortissement linéaire
export type AssetInput = { cost: number; residual: number; months: number; startOn: string; convention: "same" | "next" };
export const CONVENTION_LABEL: Record<string, string> = { same: "dès le mois de mise en service", next: "à partir du mois suivant" };
export function checkAsset(a: Partial<AssetInput>): string[] {
  const e: string[] = []; if (!Number.isInteger(a.cost) || (a.cost ?? 0) <= 0 || (a.cost ?? 0) > 1e12) e.push("Coût d'acquisition : entier positif");
  if (!Number.isInteger(a.residual ?? 0) || (a.residual ?? 0) < 0 || (a.residual ?? 0) >= (a.cost ?? 0)) e.push("Valeur résiduelle : entier ≥ 0 et inférieur au coût");
  if (!Number.isInteger(a.months) || (a.months ?? 0) < 1 || (a.months ?? 0) > 600) e.push("Durée : nombre entier de mois (1 à 600), à fixer avec votre expert-comptable");
  if (!validDay(a.startOn)) e.push("Date de mise en service invalide"); if (a.convention !== "same" && a.convention !== "next") e.push("Choisissez la convention du premier mois (aucune n'est présumée)"); return e;
}
export const addMonths = (period: string, n: number): string => { const [y, m] = period.split("-").map(Number) as [number, number]; const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
/** Plan linéaire : base = coût − résiduel ; mensualité entière = plancher(base / mois) ; le reliquat est porté par la dernière mensualité (somme exacte). */
export function schedule(a: AssetInput): { period: string; amount: number }[] {
  const base = a.cost - a.residual; const m = Math.floor(base / a.months); const first = a.convention === "same" ? periodOf(a.startOn) : addMonths(periodOf(a.startOn), 1);
  return Array.from({ length: a.months }, (_, i) => ({ period: addMonths(first, i), amount: i === a.months - 1 ? base - m * (a.months - 1) : m }));
}
/** Mensualités échues (≤ période donnée) et non encore comptabilisées. */
export const dueAmortizations = (plan: { period: string; amount: number }[], posted: Set<string>, upTo: string) => plan.filter((p) => p.period <= upTo && !posted.has(p.period) && p.amount > 0);
export type DisposalIn = { cost: number; cumulated: number; proceeds: number; accounts: { asset: string; depr: string; proceeds: string; result: string } };
/** Cession : débit amortissements cumulés, débit encaissement, résultat (perte au débit / gain au crédit), crédit coût d'acquisition. Comptes fournis par l'utilisateur. */
export function disposalLines(d: DisposalIn): { lines: Line[]; result: number; errors: string[] } {
  const errors: string[] = []; for (const [k, c] of Object.entries(d.accounts)) if (!isCode(c)) errors.push(`Compte « ${k} » manquant ou invalide`); if (d.cumulated < 0 || d.cumulated > d.cost) errors.push("Amortissements cumulés incohérents avec le coût"); if (!Number.isInteger(d.proceeds) || d.proceeds < 0) errors.push("Prix de cession : entier ≥ 0");
  if (errors.length) return { lines: [], result: 0, errors }; const result = d.proceeds - (d.cost - d.cumulated); const lines: Line[] = [];
  if (d.cumulated > 0) lines.push({ account: d.accounts.depr, debit: d.cumulated, credit: 0 }); if (d.proceeds > 0) lines.push({ account: d.accounts.proceeds, debit: d.proceeds, credit: 0 });
  if (result < 0) lines.push({ account: d.accounts.result, debit: -result, credit: 0 }); if (result > 0) lines.push({ account: d.accounts.result, debit: 0, credit: result }); lines.push({ account: d.accounts.asset, debit: 0, credit: d.cost });
  return { lines, result, errors };
}

// ------------------------------------------------------------------ lettrage
/** Lettre suivante : A…Z, AA…ZZ, AAA… (numération de colonnes). */
export function nextLetter(existing: string[]): string {
  const idx = (s: string) => s.split("").reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0); const max = existing.filter((s) => /^[A-Z]+$/.test(s)).reduce((m, s) => Math.max(m, idx(s)), 0);
  let n = max + 1; let out = ""; while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); } return out;
}
export type Letterable = { id: string; total: number; paid: number; status: string };
/** Une facture se lettre seulement si elle est intégralement réglée (aucun lettrage partiel inventé). */
export function letterError(i: Letterable | undefined, already: boolean): string {
  if (!i) return "Facture introuvable pour ce tiers"; if (["cancelled", "void", "draft"].includes(i.status)) return "Facture annulée ou brouillon"; if (already) return "Facture déjà lettrée"; if (i.paid < i.total) return `Facture non soldée (reste ${i.total - i.paid})`; if (i.paid > i.total) return "Règlement supérieur au total : à régulariser avant lettrage"; return "";
}

// ------------------------------------------------------------------ classes, résultat provisoire, correspondance des états
export type Bal = { account: string; debit: number; credit: number };
export function classTotals(rows: Bal[]) {
  const byClass: Record<string, { debit: number; credit: number; solde: number }> = {}; for (const r of rows) { const c = r.account[0] ?? "?"; const e = (byClass[c] ??= { debit: 0, credit: 0, solde: 0 }); e.debit += r.debit; e.credit += r.credit; e.solde = e.debit - e.credit; }
  const charges = (byClass["6"]?.debit ?? 0) - (byClass["6"]?.credit ?? 0); const produits = (byClass["7"]?.credit ?? 0) - (byClass["7"]?.debit ?? 0);
  return { byClass, charges, produits, result: produits - charges };
}
export type MapRow = { section: string; label: string; prefixes: string[]; sign: "debit" | "credit" };
export const MAP_SECTIONS: Record<string, string> = { assets: "Actif", liabilities: "Passif", income: "Compte de résultat" };
export function checkMap(map: unknown): { ok: boolean; errors: string[]; map: MapRow[] } {
  const errors: string[] = []; if (!Array.isArray(map)) return { ok: false, errors: ["Correspondance invalide"], map: [] }; if (map.length > 200) return { ok: false, errors: ["200 lignes au plus"], map: [] };
  const out = map.map((m: Partial<MapRow>, i) => { const pre = (Array.isArray(m?.prefixes) ? m.prefixes : []).map(String); if (!Object.hasOwn(MAP_SECTIONS, String(m?.section))) errors.push(`Ligne ${i + 1} : section inconnue`); if (String(m?.label ?? "").trim().length < 2) errors.push(`Ligne ${i + 1} : libellé manquant`); if (!pre.length || pre.some((p) => !/^[1-9]\d{0,7}$/.test(p))) errors.push(`Ligne ${i + 1} : préfixes de comptes invalides`); if (m?.sign !== "debit" && m?.sign !== "credit") errors.push(`Ligne ${i + 1} : sens (débit/crédit) à préciser`); return { section: String(m?.section), label: String(m?.label ?? "").trim().slice(0, 100), prefixes: pre, sign: (m?.sign === "credit" ? "credit" : "debit") as "debit" | "credit" }; });
  return { ok: !errors.length, errors, map: out };
}
/** Chaque compte est rattaché à la ligne dont le préfixe est le plus long ; un compte sans ligne est listé « non rattaché » (jamais perdu ni deviné). */
export function applyMap(rows: Bal[], map: MapRow[]) {
  const sum = map.map(() => 0); const unmapped: string[] = [];
  for (const r of rows) { let best = -1, len = -1; map.forEach((m, i) => { for (const p of m.prefixes) if (r.account.startsWith(p) && p.length > len) { best = i; len = p.length; } }); if (best < 0) { unmapped.push(r.account); continue; } sum[best]! += map[best]!.sign === "debit" ? r.debit - r.credit : r.credit - r.debit; }
  return { lines: map.map((m, i) => ({ section: m.section, label: m.label, amount: sum[i]! })), unmapped };
}

// ------------------------------------------------------------------ analytique
/** Soldes des classes 6 (charges) et 7 (produits) par code d'un axe ; « (sans axe) » regroupe les lignes non étiquetées. */
export function axisTotals(lines: Line[], axis: "act" | "proj") {
  const m = new Map<string, { code: string; charges: number; produits: number }>(); for (const l of lines) { const k = l.account[0]; if (k !== "6" && k !== "7") continue; const code = l[axis] || "(sans axe)"; const e = m.get(code) ?? { code, charges: 0, produits: 0 }; if (k === "6") e.charges += l.debit - l.credit; else e.produits += l.credit - l.debit; m.set(code, e); }
  return [...m.values()].map((e) => ({ ...e, result: e.produits - e.charges })).sort((a, b) => (a.code < b.code ? -1 : 1));
}
