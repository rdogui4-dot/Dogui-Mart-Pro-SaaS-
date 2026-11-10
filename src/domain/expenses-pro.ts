/** Dépenses Pro : règles pures (périodes, budgets, circuits d'approbation, récurrence, anomalies, prévision). Aucune lecture de base : testé seul, partagé par le serveur et l'interface. */
export type PeriodKind = "month" | "quarter" | "year";
export const PERIOD_LABEL: Record<PeriodKind, string> = { month: "Mensuel", quarter: "Trimestriel", year: "Annuel" };
const DAY = 864e5;
const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const addDaysTo = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
/** Clé de période qui contient un jour : « 2026-11 », « 2026-Q4 », « 2026 ». */
export function periodKey(kind: PeriodKind, day: string): string { const y = day.slice(0, 4), m = Number(day.slice(5, 7)); return kind === "month" ? day.slice(0, 7) : kind === "quarter" ? `${y}-Q${Math.ceil(m / 3)}` : y; }
export const isPeriodKey = (kind: PeriodKind, k: string): boolean => (kind === "month" ? /^\d{4}-(0[1-9]|1[0-2])$/ : kind === "quarter" ? /^\d{4}-Q[1-4]$/ : /^\d{4}$/).test(k);
export function periodBounds(kind: PeriodKind, key: string): { from: string; to: string } {
  const y = Number(key.slice(0, 4)); if (kind === "year") return { from: `${y}-01-01`, to: `${y}-12-31` };
  if (kind === "quarter") { const m = (Number(key.slice(6)) - 1) * 3 + 1; const last = m + 2; return { from: `${y}-${String(m).padStart(2, "0")}-01`, to: `${y}-${String(last).padStart(2, "0")}-${String(lastDayOf(y, last)).padStart(2, "0")}` }; }
  const m = Number(key.slice(5, 7)); const from = `${key}-01`; return { from, to: addDaysTo(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`, -1) };
}
export type BudgetMode = "approval" | "block";
export type Budget = { id: string; shopId: string; kind: PeriodKind; key: string; category: string; service: string; amount: number; mode: BudgetMode; active: boolean };
export type ExpenseLike = { shopId: string; category: string; service?: string; amount: number; spentOn: string };
/** Un budget couvre une dépense si boutique (vide = toutes), catégorie (vide = toutes), service (vide = tous) et période correspondent. */
export const budgetCovers = (b: Budget, e: ExpenseLike): boolean => b.active && (!b.shopId || b.shopId === e.shopId) && (!b.category || b.category === e.category) && (!b.service || b.service === (e.service ?? "")) && periodKey(b.kind, e.spentOn) === b.key;
export type BudgetUse = { budget: Budget; realized: number; pending: number; planned: number; paid: number; committed: number; remaining: number; usedPct: number | null; over: boolean };
/** Utilisation d'un budget : réalisé = dépenses validées ; en attente et planifié sont comptés à part (jamais mélangés au réalisé) ; engagé = réalisé + en attente. */
export function budgetUse(b: Budget, rows: (ExpenseLike & { status: string; paid?: number })[]): BudgetUse {
  let realized = 0, pending = 0, planned = 0, paid = 0; for (const r of rows) { if (!budgetCovers(b, r)) continue; if (r.status === "approved") { realized += r.amount; paid += r.paid ?? r.amount; } else if (r.status === "pending") pending += r.amount; else if (r.status === "planned") planned += r.amount; }
  const committed = realized + pending; return { budget: b, realized, pending, planned, paid, committed, remaining: b.amount - committed, usedPct: b.amount > 0 ? Math.round((committed / b.amount) * 1000) / 10 : null, over: committed > b.amount };
}
/** Budgets que ferait dépasser une nouvelle dépense (engagé + nouvelle > plafond). */
export function budgetBreaches(budgets: Budget[], rows: (ExpenseLike & { status: string; paid?: number })[], e: ExpenseLike): { use: BudgetUse; after: number; excess: number }[] {
  const out = []; for (const b of budgets) { if (!budgetCovers(b, e)) continue; const u = budgetUse(b, rows); const after = u.committed + e.amount; if (after > b.amount) out.push({ use: u, after, excess: after - b.amount }); } return out;
}
// ---- circuit d'approbation
export type Tier = "manager" | "owner"; export type Rule = { id: string; name: string; minAmount: number; category: string; shopId: string; levels: Tier[]; active: boolean };
/** Règle applicable : la plus spécifique (catégorie, boutique) puis au plus gros seuil franchi. */
export function matchRule(rules: Rule[], e: { amount: number; category: string; shopId: string }): Rule | null {
  const ok = rules.filter((r) => r.active && e.amount >= r.minAmount && (!r.category || r.category === e.category) && (!r.shopId || r.shopId === e.shopId) && r.levels.length);
  ok.sort((a, b) => (b.category ? 2 : 0) + (b.shopId ? 1 : 0) - ((a.category ? 2 : 0) + (a.shopId ? 1 : 0)) || b.minAmount - a.minAmount); return ok[0] ?? null;
}
/** Un niveau « manager » accepte gérant ou propriétaire ; un niveau « owner » n'accepte que le propriétaire. */
export const levelAccepts = (level: Tier, tier: Tier): boolean => level === "manager" || tier === "owner";
export type Approval = { by: string; tier: Tier; at: string; via: "decision" | "code" };
/** Prochain niveau non satisfait que cet approbateur peut franchir (un même utilisateur ne franchit qu'un niveau, sauf le propriétaire qui peut tous les franchir, tracé). */
export function nextLevel(levels: Tier[], approvals: Approval[], who: { id: string; tier: Tier }): { index: number } | { error: string } {
  const idx = levels.findIndex((l, i) => i >= approvals.length && levelAccepts(l, who.tier)); const i = approvals.length;
  if (i >= levels.length) return { error: "Tous les niveaux sont déjà validés" };
  if (approvals.some((a) => a.by === who.id) && who.tier !== "owner") return { error: "Vous avez déjà validé un niveau de cette dépense : un autre responsable doit valider le niveau suivant" };
  if (!levelAccepts(levels[i]!, who.tier)) return { error: `Le niveau suivant (${i + 1}/${levels.length}) exige la validation du propriétaire` };
  void idx; return { index: i };
}
// ---- récurrence
export type Frequency = "weekly" | "monthly" | "quarterly" | "yearly"; export const FREQ_LABEL: Record<Frequency, string> = { weekly: "Hebdomadaire", monthly: "Mensuelle", quarterly: "Trimestrielle", yearly: "Annuelle" };
/** Échéances d'un modèle récurrent entre deux jours (inclus) ; jour du mois ramené au dernier jour si le mois est plus court (31 → 28/30). */
export function occurrences(r: { startOn: string; endOn?: string; frequency: Frequency; dayOfMonth?: number }, from: string, to: string): string[] {
  const out: string[] = []; const end = r.endOn && r.endOn < to ? r.endOn : to; const start = r.startOn;
  if (r.frequency === "weekly") { for (let d = start; d <= end; d = addDaysTo(d, 7)) if (d >= from) out.push(d); return out; }
  const step = r.frequency === "monthly" ? 1 : r.frequency === "quarterly" ? 3 : 12; const dom = r.dayOfMonth ?? Number(start.slice(8, 10)); let y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7));
  for (let n = 0; n < 600; n++) { const day = `${y}-${String(m).padStart(2, "0")}-${String(Math.min(dom, lastDayOf(y, m))).padStart(2, "0")}`; if (day > end) break; if (day >= from && day >= start) out.push(day); m += step; while (m > 12) { m -= 12; y++; } }
  return out;
}
// ---- statistiques et anomalies
export const median = (a: number[]): number => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) : 0; };
export const mean = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
export const stdev = (a: number[]): number => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
export type Anomaly = { code: string; level: "warn" | "info"; message: string; basis: string; expenseIds?: string[] };
/** Variation inhabituelle : le total du mois courant d'une catégorie dépasse nettement l'historique (≥ 3 mois d'historique, ≥ 2× la moyenne et plus de 1 écart-type). */
export function categoryVariation(current: number, history: number[]): { unusual: boolean; ratio: number | null; avg: number } {
  const avg = mean(history); if (history.length < 3 || avg <= 0) return { unusual: false, ratio: null, avg }; const ratio = current / avg; return { unusual: ratio >= 2 && current > avg + stdev(history), ratio: Math.round(ratio * 100) / 100, avg: Math.round(avg) };
}
type Row = { id: string; label: string; beneficiary: string; category: string; amount: number; spentOn: string; createdBy: string; shopId: string };
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
/** Doublons potentiels : même montant, même libellé et même bénéficiaire à moins de 3 jours d'écart. */
export function findDuplicates(rows: Row[]): Row[][] {
  const groups = new Map<string, Row[]>(); for (const r of rows) { const k = `${r.amount}|${norm(r.label)}|${norm(r.beneficiary)}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
  const out: Row[][] = []; for (const g of groups.values()) { if (g.length < 2) continue; const s = [...g].sort((a, b) => a.spentOn.localeCompare(b.spentOn)); let run = [s[0]!]; for (const r of s.slice(1)) { if (daysBetween(run[run.length - 1]!.spentOn, r.spentOn) <= 3) run.push(r); else { if (run.length > 1) out.push(run); run = [r]; } } if (run.length > 1) out.push(run); } return out;
}
/** Dépenses récurrentes détectées : au moins 3 occurrences du même libellé/bénéficiaire, espacées de 26 à 35 jours (mensuel) avec un montant stable (±10 %). */
export function detectRecurring(rows: Row[]): { label: string; beneficiary: string; category: string; amount: number; occurrences: number; lastOn: string; nextOn: string; ids: string[] }[] {
  const groups = new Map<string, Row[]>(); for (const r of rows) { const k = `${norm(r.label)}|${norm(r.beneficiary)}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
  const out = []; for (const g of groups.values()) { if (g.length < 3) continue; const s = [...g].sort((a, b) => a.spentOn.localeCompare(b.spentOn)); const gaps = s.slice(1).map((r, i) => daysBetween(s[i]!.spentOn, r.spentOn)); const amts = s.map((r) => r.amount); const m = median(amts);
    if (gaps.every((x) => x >= 26 && x <= 35) && amts.every((x) => Math.abs(x - m) <= m * 0.1)) { const last = s[s.length - 1]!; out.push({ label: last.label, beneficiary: last.beneficiary, category: last.category, amount: Math.round(m), occurrences: s.length, lastOn: last.spentOn, nextOn: addDaysTo(last.spentOn, Math.round(mean(gaps))), ids: s.map((r) => r.id) }); } }
  return out;
}
// ---- prévision de trésorerie (indicative)
export type Flow = { on: string; amount: number; label: string; kind: "payable" | "planned" | "pending" | "run-rate" | "extra" };
export type Projection = { days: { day: string; inflow: number; outflow: number; balance: number | null }[]; minBalance: number | null; minOn: string | null; firstNegativeOn: string | null; totalOut: number; totalIn: number };
/** Projection jour par jour. `opening` null = solde disponible inconnu : on ne projette alors que les flux nets (jamais un solde inventé). */
export function project(o: { from: string; days: number; opening: number | null; inflowPerDay: number; flows: Flow[] }): Projection {
  const days = []; let bal = o.opening; let min: number | null = null, minOn: string | null = null, neg: string | null = null, tOut = 0, tIn = 0; let net = 0;
  for (let i = 0; i < o.days; i++) { const day = addDaysTo(o.from, i); const out = o.flows.filter((f) => f.on === day).reduce((a, f) => a + f.amount, 0); const inn = Math.round(o.inflowPerDay); tOut += out; tIn += inn; net += inn - out; bal = bal === null ? null : bal + inn - out; const shown = bal === null ? null : bal;
    if (shown !== null && (min === null || shown < min)) { min = shown; minOn = day; } if (shown !== null && shown < 0 && !neg) neg = day; days.push({ day, inflow: inn, outflow: out, balance: shown }); }
  void net; return { days, minBalance: min, minOn, firstNegativeOn: neg, totalOut: tOut, totalIn: tIn };
}
/** Répartition d'une dépense entre boutiques : montants entiers, le reliquat d'arrondi va à la première boutique ; refuse si la somme ne correspond pas. */
export function allocate(amount: number, parts: { shopId: string; pct?: number; amount?: number }[]): { shopId: string; amount: number }[] | { error: string } {
  if (!parts.length) return { error: "Aucune boutique" }; if (new Set(parts.map((p) => p.shopId)).size !== parts.length) return { error: "Boutique en double dans la répartition" };
  if (parts.every((p) => p.amount !== undefined)) { const s = parts.reduce((a, p) => a + Number(p.amount), 0); if (parts.some((p) => !Number.isInteger(p.amount) || p.amount! < 0)) return { error: "Montants de répartition invalides" }; return s === amount ? parts.map((p) => ({ shopId: p.shopId, amount: p.amount! })) : { error: `La répartition (${s}) ne correspond pas au montant (${amount})` }; }
  if (parts.every((p) => p.pct !== undefined)) { const s = parts.reduce((a, p) => a + Number(p.pct), 0); if (Math.abs(s - 100) > 0.001 || parts.some((p) => p.pct! < 0)) return { error: "Les pourcentages doivent totaliser 100 %" }; const base = parts.map((p) => ({ shopId: p.shopId, amount: Math.floor((amount * p.pct!) / 100) })); base[0]!.amount += amount - base.reduce((a, p) => a + p.amount, 0); return base; }
  return { error: "Indiquez soit des montants, soit des pourcentages pour toutes les boutiques" };
}
