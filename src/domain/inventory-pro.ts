/** Silent Smart Count (Pro) : règles pures partagées. Rien ici n'invente de donnée : chaque fonction renvoie aussi la base de son calcul, et « indéterminé » quand l'historique est insuffisant.
 *  Aucune règle ne qualifie un écart de fraude : ce sont des indicateurs à vérifier. */

export type Abc = "A" | "B" | "C";
export const ABC_CUT = { a: 80, b: 95 } as const;
export const DEFAULT_FREQ: Record<Abc, number> = { A: 30, B: 90, C: 180 };
export const ABC_LABEL: Record<Abc, string> = { A: "Classe A (forte valeur)", B: "Classe B", C: "Classe C (faible valeur)" };

/** Classification ABC (Pareto) : A = articles qui font les 80 premiers % de la valeur, B jusqu'à 95 %, C le reste. Valeur nulle ou négative = C. */
export function classifyAbc(items: { id: string; value: number }[]): Map<string, Abc> {
  const out = new Map<string, Abc>(); const pos = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value || a.id.localeCompare(b.id)); const total = pos.reduce((s, i) => s + i.value, 0); let cum = 0;
  for (const i of pos) { const before = total ? (cum / total) * 100 : 100; cum += i.value; out.set(i.id, before < ABC_CUT.a ? "A" : before < ABC_CUT.b ? "B" : "C"); }
  for (const i of items) if (!out.has(i.id)) out.set(i.id, "C"); return out;
}
export const checkFreq = (f: unknown): Record<Abc, number> => {
  const o = (f ?? {}) as Partial<Record<Abc, unknown>>; const r = { ...DEFAULT_FREQ }; for (const k of ["A", "B", "C"] as Abc[]) { if (o[k] === undefined || o[k] === "") continue; const n = Number(o[k]); if (!Number.isInteger(n) || n < 1 || n > 730) throw new Error(`Fréquence de la classe ${k} invalide (1 à 730 jours)`); r[k] = n; }
  if (!(r.A <= r.B && r.B <= r.C)) throw new Error("Les articles de forte valeur se comptent plus souvent : A ≤ B ≤ C"); return r;
};
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
/** Un article est à compter si son dernier comptage validé remonte à plus que la fréquence de sa classe (jamais compté = à compter, ancienneté inconnue). */
export function isDue(lastDay: string | null, today: string, freq: number): { due: boolean; overdueDays: number | null; neverCounted: boolean } {
  if (!lastDay) return { due: true, overdueDays: null, neverCounted: true }; const age = dayDiff(lastDay, today); return { due: age >= freq, overdueDays: Math.max(0, age - freq), neverCounted: false };
}

/** Comparaison de deux comptages indépendants (quantités lisibles) : accord, écart, et besoin d'un troisième contrôle selon les seuils. */
export function compareCounts(a: number, b: number, unitCost: number, th: { pct: number; value: number }): { agree: boolean; diff: number; pct: number; value: number; needThird: boolean } {
  const diff = Math.round((b - a) * 1e6) / 1e6; const base = Math.max(Math.abs(a), Math.abs(b)); const pct = base ? (Math.abs(diff) / base) * 100 : 0; const value = Math.round(Math.abs(diff) * unitCost);
  const agree = diff === 0; return { agree, diff, pct, value, needThird: !agree && (value >= th.value || pct >= th.pct) };
}
/** Troisième contrôle : deux comptages identiques font foi ; sinon aucun consensus (arbitrage humain). */
export function consensus(counts: number[]): number | null { for (let i = 0; i < counts.length; i++) for (let j = i + 1; j < counts.length; j++) if (counts[i] === counts[j]) return counts[i]!; return null; }

export type Stats = { n: number; mean: number; sd: number };
export const statsOf = (xs: number[]): Stats => { const n = xs.length; if (!n) return { n: 0, mean: 0, sd: 0 }; const mean = xs.reduce((s, x) => s + x, 0) / n; const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / n); return { n, mean, sd }; };
export const MIN_HISTORY = 3;
/** Écart inhabituel : écart relatif (en %) comparé à l'historique du même article (≥ 3 inventaires), sinon à rien (indéterminé, jamais inventé). */
export function unusualVariance(pctAbs: number, history: number[]): { flag: boolean | null; z: number | null; basis: string } {
  if (history.length < MIN_HISTORY) return { flag: null, z: null, basis: `Historique insuffisant (${history.length} inventaire(s), ${MIN_HISTORY} requis)` };
  const s = statsOf(history); const spread = Math.max(s.sd, 1); const z = (pctAbs - s.mean) / spread; return { flag: z >= 2 && pctAbs >= 2, z: Math.round(z * 10) / 10, basis: `Moyenne historique ${Math.round(s.mean * 10) / 10} % (écart-type ${Math.round(s.sd * 10) / 10}) sur ${s.n} inventaire(s)` };
}
/** Pertes récurrentes : au moins `min` écarts négatifs approuvés sur les `window` derniers inventaires où l'article a été compté. */
export function recurringLoss(diffs: number[], window = 5, min = 3): { flag: boolean; losses: number; of: number } { const last = diffs.slice(-window); const losses = last.filter((d) => d < 0).length; return { flag: last.length >= min && losses >= min, losses, of: last.length }; }
/** Erreur d'unité possible : le rapport compté/théorique est proche d'un facteur de conditionnement (ou de son inverse), ou d'une puissance de 10. */
export function unitErrorSuspect(counted: number, theoretical: number, factors: number[]): { factor: number; direction: "plus" | "moins" } | null {
  if (!(counted > 0) || !(theoretical > 0) || counted === theoretical) return null; const r = counted / theoretical; const cands = [...new Set([...factors.filter((f) => f > 1), 10, 100, 1000])];
  for (const f of cands) { if (Math.abs(r - f) / f <= 0.03) return { factor: f, direction: "plus" }; if (Math.abs(r - 1 / f) * f <= 0.03) return { factor: f, direction: "moins" }; } return null;
}
/** Quantité très éloignée des niveaux de stock habituels (médiane d'au moins 5 relevés) : > 3× ou < ¼. */
export function farFromTrend(counted: number, levels: number[]): { flag: boolean | null; median: number | null } {
  const xs = levels.filter((x) => x >= 0).sort((a, b) => a - b); if (xs.length < 5) return { flag: null, median: null }; const m = xs.length % 2 ? xs[(xs.length - 1) / 2]! : (xs[xs.length / 2 - 1]! + xs[xs.length / 2]!) / 2; if (m < 4) return { flag: null, median: m };
  return { flag: counted > m * 3 || counted < m / 4, median: m };
}

export type Priority = "high" | "medium" | "low"; export const PRIORITY_LABEL: Record<Priority, string> = { high: "Priorité haute", medium: "Priorité moyenne", low: "Priorité basse" };
export type Anomaly = { key: string; kind: string; priority: Priority; lineId?: string; name?: string; title: string; justification: string; data: Record<string, unknown>; check: string; caveat: string };
export const CAVEAT = "Indicateur statistique à vérifier : il ne prouve ni erreur ni faute, et ne constitue jamais une qualification de fraude.";

/** Taux de précision : part des articles comptés sans écart, et part de la valeur théorique qui n'est pas en écart (en valeur absolue). */
export function accuracy(rows: { diff: number | null; theoreticalValue: number; valueDiff: number }[]): { lines: number | null; value: number | null; counted: number } {
  const c = rows.filter((r) => r.diff !== null); if (!c.length) return { lines: null, value: null, counted: 0 }; const tv = c.reduce((s, r) => s + Math.abs(r.theoreticalValue), 0); const gap = c.reduce((s, r) => s + Math.abs(r.valueDiff), 0);
  return { lines: Math.round((c.filter((r) => r.diff === 0).length / c.length) * 1000) / 10, value: tv > 0 ? Math.max(0, Math.round((1 - gap / tv) * 1000) / 10) : null, counted: c.length };
}
/** Ordre de comptage : par zone, puis classe (A d'abord), puis catégorie (parcours regroupé), puis valeur décroissante, puis nom. */
export function countOrder<T extends { zone: string; abc: Abc | ""; category: string; value: number; name: string }>(xs: T[]): T[] {
  const rank = (a: Abc | "") => (a === "A" ? 0 : a === "B" ? 1 : a === "C" ? 2 : 3); return [...xs].sort((a, b) => a.zone.localeCompare(b.zone) || rank(a.abc) - rank(b.abc) || a.category.localeCompare(b.category) || b.value - a.value || a.name.localeCompare(b.name));
}
/** Identification assistée : classe les articles du catalogue selon le texte saisi (code exact > référence > mots du nom) ; chaque suggestion dit pourquoi. */
export function identify(query: string, catalog: { id: string; name: string; sku?: string; barcode?: string }[], max = 5): { id: string; name: string; score: number; why: string }[] {
  const q = query.trim().toLowerCase(); if (q.length < 2) return []; const words = q.split(/\s+/).filter((w) => w.length >= 2); const out: { id: string; name: string; score: number; why: string }[] = [];
  for (const p of catalog) { const bc = (p.barcode ?? "").toLowerCase(), sku = (p.sku ?? "").toLowerCase(), nm = p.name.toLowerCase(); let score = 0, why = "";
    if (bc && bc === q) { score = 100; why = "code-barres identique"; } else if (sku && sku === q) { score = 95; why = "référence identique"; } else if (bc && bc.includes(q) && q.length >= 4) { score = 70; why = "code-barres partiel"; } else if (sku && sku.includes(q) && q.length >= 3) { score = 65; why = "référence partielle"; }
    else { const hit = words.filter((w) => nm.includes(w)).length; if (hit) { score = Math.round((hit / words.length) * 60) + (nm.startsWith(q) ? 10 : 0); why = `${hit}/${words.length} mot(s) du nom`; } }
    if (score > 0) out.push({ id: p.id, name: p.name, score, why }); }
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, max);
}
/** Références incohérentes dans le catalogue : même code-barres ou même référence portés par plusieurs articles. */
export function duplicateRefs(catalog: { id: string; name: string; sku?: string; barcode?: string }[]): { ref: string; field: "barcode" | "sku"; names: string[] }[] {
  const out: { ref: string; field: "barcode" | "sku"; names: string[] }[] = []; for (const field of ["barcode", "sku"] as const) { const m = new Map<string, string[]>(); for (const p of catalog) { const v = (p[field] ?? "").trim().toLowerCase(); if (v) (m.get(v) ?? m.set(v, []).get(v)!).push(p.name); } for (const [ref, names] of m) if (names.length > 1) out.push({ ref, field, names }); } return out;
}
/** Transfert pendant une campagne : si l'envoi est compté avant la sortie ET la réception comptée après l'entrée, la marchandise est comptée deux fois dans le total consolidé ; l'inverse = comptée nulle part (en transit). L'écart de chaque magasin reste juste (théorique à l'instant de son comptage). */
export function transferRisk(t: { outAt: number; inAt: number }, countedFromAt: number | null, countedToAt: number | null): "double" | "missing" | "ok" | "unknown" {
  if (countedFromAt === null || countedToAt === null) return "unknown"; if (countedFromAt < t.outAt && countedToAt >= t.inAt) return "double"; if (countedFromAt >= t.outAt && countedToAt < t.inAt) return "missing"; return "ok";
}
