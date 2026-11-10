/** FinI Pro : règles pures (prévision avec fourchette, scénarios, seuils d'approbation, périodes de budget, rapprochement groupé). Une prévision n'est JAMAIS un solde disponible. */
import type { Flow } from "./fin";

export const HORIZONS = [30, 60, 90, 180, 365] as const;
export const Z90 = 1.645; // fourchette « 90 % » d'une loi normale : hypothèse simplificatrice, annoncée à l'écran
export const MIN_HISTORY_DAYS = 14;

// ---- seuils d'approbation (configurables, jamais imposés par défaut)
export type Rule = { managerFrom: number | null; ownerFrom: number | null };
export type Rules = { minCash: number; transfer: Rule; refund: Rule; plan: Rule };
export const NO_RULE: Rule = { managerFrom: null, ownerFrom: null };
export const DEFAULT_RULES: Rules = { minCash: 0, transfer: NO_RULE, refund: NO_RULE, plan: NO_RULE };
const amt = (v: unknown, label: string): number | null => { if (v === null || v === undefined || v === "") return null; const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 1e12) throw new Error(`${label} : montant entier positif attendu`); return n; };
export function normRule(v: unknown, label: string): Rule { const o = (v ?? {}) as Record<string, unknown>; const m = amt(o.managerFrom, `${label} (gérant)`), ow = amt(o.ownerFrom, `${label} (propriétaire)`); if (m !== null && ow !== null && ow < m) throw new Error(`${label} : le seuil propriétaire doit être supérieur ou égal au seuil gérant`); return { managerFrom: m, ownerFrom: ow }; }
export function normRules(v: unknown): Rules { const o = (v ?? {}) as Record<string, unknown>; const mc = Number(o.minCash ?? 0); if (!Number.isInteger(mc) || mc < 0 || mc > 1e12) throw new Error("Trésorerie minimale : entier positif attendu"); return { minCash: mc, transfer: normRule(o.transfer, "Virements"), refund: normRule(o.refund, "Remboursements fournisseur"), plan: normRule(o.plan, "Paiements planifiés") }; }
export type Level = "any" | "manager" | "owner";
export const requiredLevel = (amount: number, r: Rule): Level => (r.ownerFrom !== null && amount >= r.ownerFrom ? "owner" : r.managerFrom !== null && amount >= r.managerFrom ? "manager" : "any");
export const LEVEL_LABEL: Record<Level, string> = { any: "Tout utilisateur de la comptabilité", manager: "Gérant ou propriétaire", owner: "Propriétaire" };
export const canAt = (level: Level, role: "owner" | "manager" | "other"): boolean => level === "any" || (level === "manager" && (role === "owner" || role === "manager")) || (level === "owner" && role === "owner");

// ---- statistiques et prévision
export const mean = (a: number[]): number => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
export const sd = (a: number[]): number => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
export const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

/** Sources historiques RÉCURRENTES (hors échéances connues, qui sont projetées à leur date, pour ne rien compter deux fois). */
export const RUN_IN = new Set(["sale", "credit_repay"]);
export const RUN_OUT = new Set(["expense", "refund"]);
export type Run = { days: number; inMean: number; outMean: number; netSd: number; ok: boolean };
/** Cadence habituelle sur `window` jours se terminant à `today` ; la fenêtre commence au premier flux observé (jamais de zéros inventés avant l'activité). */
export function runRate(flows: Flow[], today: string, window = 90): Run {
  const rec = flows.filter((f) => f.date <= today && f.date > addDays(today, -window) && !f.key.startsWith("ep:") && ((RUN_IN.has(f.source) && f.amount > 0) || RUN_OUT.has(f.source) || (f.source === "cash_move")));
  if (!rec.length) return { days: 0, inMean: 0, outMean: 0, netSd: 0, ok: false };
  const first = rec.reduce((m, f) => (f.date < m ? f.date : m), today); const days = Math.min(window, daysBetween(first, today) + 1); const net = new Array<number>(days).fill(0); let inn = 0, out = 0;
  for (const f of rec) { const i = daysBetween(addDays(today, -(days - 1)), f.date); if (i < 0 || i >= days) continue; net[i]! += f.amount; if (f.amount > 0) inn += f.amount; else out += -f.amount; }
  return { days, inMean: inn / days, outMean: out / days, netSd: sd(net), ok: days >= MIN_HISTORY_DAYS };
}

export type Sched = { on: string; amount: number; label: string; kind: "in" | "out"; layer: "committed" | "planned" | "scenario" };
export type Adj = { salesDeltaPct?: number; costDeltaPct?: number; receivableDelayDays?: number; payableDelayDays?: number; extra?: { on: string; amount: number; label: string }[] };
export const clampAdj = (a: Adj | undefined): Required<Omit<Adj, "extra">> & { extra: NonNullable<Adj["extra"]> } => ({ salesDeltaPct: Math.max(-100, Math.min(300, Number(a?.salesDeltaPct ?? 0) || 0)), costDeltaPct: Math.max(-100, Math.min(300, Number(a?.costDeltaPct ?? 0) || 0)), receivableDelayDays: Math.max(0, Math.min(180, Math.round(Number(a?.receivableDelayDays ?? 0) || 0))), payableDelayDays: Math.max(-60, Math.min(180, Math.round(Number(a?.payableDelayDays ?? 0) || 0))), extra: (a?.extra ?? []).slice(0, 50).filter((x) => Number.isFinite(Number(x.amount)) && /^\d{4}-\d{2}-\d{2}$/.test(String(x.on))).map((x) => ({ on: String(x.on), amount: Math.round(Number(x.amount)), label: String(x.label ?? "Hypothèse").slice(0, 80) })) });

export type Point = { date: string; central: number; low: number; high: number };
export type Forecast = { relative: boolean; series: Point[]; min: { date: string; value: number } | null; end: Point | null; firstBelow: string | null; lowBelow: string | null; layers: { committedIn: number; committedOut: number; plannedIn: number; plannedOut: number; scenarioNet: number; runNet: number } };
/** Projette jour par jour : solde (ou variation cumulée si l'ouverture est inconnue) = ouverture + cadence habituelle × ajustements + échéances. Fourchette = z·σ·√k (hypothèse annoncée). */
export function project(p: { from: string; days: number; opening: number | null; run: Run; sched: Sched[]; minCash: number; adj?: Adj }): Forecast {
  const a = clampAdj(p.adj); const inDay = p.run.ok ? (p.run.inMean * (1 + a.salesDeltaPct / 100)) : 0, outDay = p.run.ok ? (p.run.outMean * (1 + a.costDeltaPct / 100)) : 0; const sdNet = p.run.ok ? p.run.netSd : 0;
  const events = new Map<string, number>(); const lay = { committedIn: 0, committedOut: 0, plannedIn: 0, plannedOut: 0, scenarioNet: 0, runNet: 0 };
  const put = (s: Sched) => { let on = s.on; if (s.kind === "in" && s.layer !== "scenario") on = addDays(on, a.receivableDelayDays); if (s.kind === "out" && s.layer !== "scenario") on = addDays(on, a.payableDelayDays); if (on <= p.from) on = addDays(p.from, 1); const end = addDays(p.from, p.days); if (on > end) return; const v = s.kind === "in" ? s.amount : -s.amount; events.set(on, (events.get(on) ?? 0) + v); if (s.layer === "committed") { if (v > 0) lay.committedIn += v; else lay.committedOut += -v; } else if (s.layer === "planned") { if (v > 0) lay.plannedIn += v; else lay.plannedOut += -v; } else lay.scenarioNet += v; };
  for (const s of p.sched) put(s); for (const x of a.extra) put({ on: x.on, amount: Math.abs(x.amount), label: x.label, kind: x.amount >= 0 ? "in" : "out", layer: "scenario" });
  let bal = p.opening ?? 0; const series: Point[] = []; let min: Forecast["min"] = null, firstBelow: string | null = null, lowBelow: string | null = null;
  for (let k = 1; k <= p.days; k++) { const date = addDays(p.from, k); bal += inDay - outDay + (events.get(date) ?? 0); lay.runNet += inDay - outDay; const band = Z90 * sdNet * Math.sqrt(k); const pt = { date, central: Math.round(bal), low: Math.round(bal - band), high: Math.round(bal + band) }; series.push(pt);
    if (p.opening !== null) { if (!min || pt.central < min.value) min = { date, value: pt.central }; if (!firstBelow && pt.central < p.minCash) firstBelow = date; if (!lowBelow && pt.low < p.minCash) lowBelow = date; } }
  return { relative: p.opening === null, series, min, end: series.at(-1) ?? null, firstBelow, lowBelow, layers: { ...lay, runNet: Math.round(lay.runNet) } };
}

// ---- budgets multi-périodes
export type Period = "month" | "quarter" | "year";
export const PERIODS: Period[] = ["month", "quarter", "year"];
export const PERIOD_LABEL: Record<Period, string> = { month: "Mois", quarter: "Trimestre", year: "Année" };
export function validKey(period: Period, key: unknown): string | null { const k = String(key ?? ""); if (period === "month") return /^\d{4}-(0[1-9]|1[0-2])$/.test(k) ? k : null; if (period === "quarter") return /^\d{4}-Q[1-4]$/.test(k) ? k : null; return /^\d{4}$/.test(k) ? k : null; }
export function rangeOf(period: Period, key: string): { from: string; to: string } {
  if (period === "year") return { from: `${key}-01-01`, to: `${key}-12-31` };
  if (period === "quarter") { const y = key.slice(0, 4), q = Number(key.slice(6)); const m = (q - 1) * 3 + 1; const last = new Date(Date.UTC(Number(y), m + 2, 0)).getUTCDate(); return { from: `${y}-${String(m).padStart(2, "0")}-01`, to: `${y}-${String(m + 2).padStart(2, "0")}-${last}` }; }
  const last = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5)), 0)).getUTCDate(); return { from: `${key}-01`, to: `${key}-${String(last).padStart(2, "0")}` };
}
export const pctDelta = (a: number, b: number): number | null => (a === 0 ? (b === 0 ? 0 : null) : Math.round(((b - a) / Math.abs(a)) * 1000) / 10);

// ---- rapprochement groupé (plusieurs flux = une ligne de relevé)
export type GroupSuggestion = { line: number; flowKeys: string[]; score: number; why: string };
export function suggestGroups(lines: { date: string; amount: number }[], flows: Flow[], skipLines: Set<number>, usedKeys: Set<string>, toleranceDays = 3, maxGroup = 3): GroupSuggestion[] {
  const used = new Set(usedKeys); const out: GroupSuggestion[] = [];
  lines.forEach((l, i) => { if (skipLines.has(i)) return; const cand = flows.filter((f) => !used.has(f.key) && Math.abs(daysBetween(f.date, l.date)) <= toleranceDays && Math.sign(f.amount) === Math.sign(l.amount)).slice(0, 30);
    const found = ((): Flow[] | null => { for (let size = 2; size <= maxGroup; size++) { const pick = (start: number, left: number, acc: Flow[]): Flow[] | null => { if (left === 0) return acc.reduce((s, f) => s + f.amount, 0) === l.amount ? acc : null; for (let j = start; j < cand.length; j++) { const r = pick(j + 1, left - 1, [...acc, cand[j]!]); if (r) return r; } return null; }; const r = pick(0, size, []); if (r) return r; } return null; })();
    if (found) { for (const f of found) used.add(f.key); out.push({ line: i, flowKeys: found.map((f) => f.key), score: 60, why: `${found.length} flux dont la somme égale la ligne du relevé` }); } });
  return out;
}
