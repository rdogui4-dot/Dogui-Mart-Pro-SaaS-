/** ICompta Business : règles pures (écritures, équilibre, périodes, droits de validation). Aucun taux, compte ou règle fiscale n'est inventé : tout paramétrage est à confirmer par un professionnel. */
/** `act` (activité) et `proj` (projet) : axes analytiques optionnels (ICompta Pro). */
export type Line = { account: string; debit: number; credit: number; label?: string; act?: string; proj?: string };
export const isTag = (t: unknown): t is string => typeof t === "string" && /^[A-Za-z0-9_-]{1,24}$/.test(t);
export const MAX_LINES = 50;
/** Codes de journaux conventionnels (à confirmer). */
export const JOURNALS: Record<string, string> = { VE: "Ventes", AC: "Achats", CA: "Caisse", BQ: "Banque", OD: "Opérations diverses" };
export const isJournal = (j: unknown): j is string => typeof j === "string" && Object.hasOwn(JOURNALS, j);
export type Status = "draft" | "pending" | "validated" | "rejected";
export const STATUS_LABEL: Record<Status, string> = { draft: "Brouillon", pending: "À valider", validated: "Validée", rejected: "Rejetée" };
export const KIND_LABEL: Record<string, string> = { manual: "Saisie manuelle", proposal: "Proposition issue d'un événement", reversal: "Contrepassation", correction: "Écriture corrective", depreciation: "Dotation d'amortissement", disposal: "Cession d'immobilisation", stock_loss: "Perte de stock" };

export const isCode = (c: unknown): c is string => typeof c === "string" && /^[1-9]\d{1,7}$/.test(c);
export const validDay = (s: unknown): string | null => { if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null; const d = new Date(`${s}T00:00:00Z`); return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s; };
export const periodOf = (day: string): string => day.slice(0, 7);
export const periodsOfYear = (year: number): string[] => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
export const validPeriod = (p: unknown): p is string => typeof p === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);

/** Contrôle d'une écriture : ≥ 2 lignes, montants entiers positifs, débit XOR crédit par ligne, comptes connus et actifs, total débit = total crédit. */
export function checkLines(lines: unknown, active: Set<string>): { ok: boolean; errors: string[]; lines: Line[]; total: number } {
  const errors: string[] = []; if (!Array.isArray(lines) || lines.length < 2) return { ok: false, errors: ["Une écriture comporte au moins deux lignes"], lines: [], total: 0 }; if (lines.length > MAX_LINES) return { ok: false, errors: [`${MAX_LINES} lignes au plus`], lines: [], total: 0 };
  const out: Line[] = []; let d = 0, c = 0;
  lines.forEach((l: { account?: unknown; debit?: unknown; credit?: unknown; label?: unknown; act?: unknown; proj?: unknown }, i) => { const n = i + 1; const acc = String(l?.account ?? ""); const de = Number(l?.debit ?? 0), cr = Number(l?.credit ?? 0);
    if (!isCode(acc)) errors.push(`Ligne ${n} : numéro de compte invalide`); else if (!active.has(acc)) errors.push(`Ligne ${n} : le compte ${acc} n'existe pas dans le plan de comptes ou est désactivé`);
    if (!Number.isInteger(de) || !Number.isInteger(cr) || de < 0 || cr < 0 || de > 1e12 || cr > 1e12) errors.push(`Ligne ${n} : montants entiers positifs attendus`); else if ((de > 0) === (cr > 0)) errors.push(`Ligne ${n} : renseignez soit un débit, soit un crédit (non nul)`);
    for (const k of ["act", "proj"] as const) if (l?.[k] !== undefined && l?.[k] !== null && l?.[k] !== "" && !isTag(l[k])) errors.push(`Ligne ${n} : code analytique invalide (lettres, chiffres, - et _ ; 24 caractères au plus)`);
    d += de; c += cr; out.push({ account: acc, debit: de, credit: cr, ...(l?.label ? { label: String(l.label).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 120) } : {}), ...(isTag(l?.act) ? { act: l.act } : {}), ...(isTag(l?.proj) ? { proj: l.proj } : {}) }); });
  if (!errors.length && d !== c) errors.push(`Écriture déséquilibrée : débit ${d} ≠ crédit ${c}`); if (!errors.length && d === 0) errors.push("Écriture à zéro");
  return { ok: !errors.length, errors, lines: out, total: d };
}
export const swap = (lines: Line[]): Line[] => lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
/** Forme canonique des lignes (ordre des clés fixe) : sert au hachage. */
/** Les axes analytiques n'entrent dans la forme canonique QUE s'ils sont présents : les empreintes des écritures existantes restent valides. */
export const canonLines = (lines: Line[]): string => JSON.stringify(lines.map((l) => (l.act || l.proj ? [l.account, l.debit, l.credit, l.label ?? "", l.act ?? "", l.proj ?? ""] : [l.account, l.debit, l.credit, l.label ?? ""])));

export type Role = "owner" | "manager" | "other";
/** Validation : propriétaire ou gérant ; le créateur ne valide pas sa propre écriture, sauf le propriétaire (signalé « auto-validée »). */
export function canValidate(role: Role, creator: string, user: string): { ok: boolean; self: boolean; reason?: string } {
  if (role !== "owner" && role !== "manager") return { ok: false, self: false, reason: "Seuls le propriétaire et les gérants valident une écriture" };
  const self = creator === user; if (self && role !== "owner") return { ok: false, self, reason: "Vous ne pouvez pas valider votre propre écriture (séparation des rôles)" }; return { ok: true, self };
}
export const pad = (n: number, w = 6): string => String(n).padStart(w, "0");
export const entryNumber = (seq: number): string => `ICE-${pad(seq)}`;

export type Row = { account: string; debit: number; credit: number };
export function balanceOf(rows: Row[]): { account: string; debit: number; credit: number; solde: number }[] {
  const m = new Map<string, { debit: number; credit: number }>(); for (const r of rows) { const e = m.get(r.account) ?? { debit: 0, credit: 0 }; e.debit += r.debit; e.credit += r.credit; m.set(r.account, e); }
  return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([account, v]) => ({ account, ...v, solde: v.debit - v.credit }));
}
