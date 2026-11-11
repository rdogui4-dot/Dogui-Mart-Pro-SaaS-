/** IProj-Invest Pro : règles pures (VAN, TRI, récupération actualisée, financement par prêt, classement multicritère, sélection sous enveloppe, diversification, volatilité sur valorisations saisies).
 *  Aucun taux, pondération ou seuil n'est présumé : ils sont saisis par l'utilisateur. Simulation et analyse uniquement ; aucune opération n'est exécutée. */
import { cumulative } from "./invest";

// ------------------------------------------------------------------ documentation des indicateurs
export type Doc = { label: string; formula: string; period: string; source: string; assumptions: string; limits: string };
export const INDICATORS: Record<string, Doc> = {
  npv: { label: "VAN (valeur actuelle nette)", formula: "Σ flux(t) ÷ (1 + taux mensuel)^t, t = 0…N ; taux mensuel = (1 + coût du capital annuel)^(1/12) − 1", period: "Durée d'analyse du scénario (mois 0 à N)", source: "Hypothèses du scénario saisies par l'utilisateur ; coût du capital fixé par le propriétaire", assumptions: "Flux mensuels du scénario, réalisés en fin de mois, coût du capital constant", limits: "Aucun taux n'est proposé ; la VAN change fortement avec le taux choisi. Une VAN positive n'est pas une garantie de rentabilité." },
  irr: { label: "TRI (taux de rentabilité interne)", formula: "Taux annuel qui annule la VAN (recherche numérique sur les flux mensuels)", period: "Durée d'analyse du scénario", source: "Hypothèses du scénario", assumptions: "Flux mensuels du scénario", limits: "Non défini sans changement de signe des flux ; plusieurs solutions possibles si le signe change plusieurs fois (alors signalé, valeur non fiable)." },
  roi: { label: "ROI", formula: "Résultat net cumulé ÷ budget initial", period: "Durée d'analyse du scénario", source: "Hypothèses du scénario", assumptions: "Non actualisé", limits: "Ignore la valeur du temps ; à lire avec la VAN." },
  payback: { label: "Délai de récupération", formula: "Premier mois où le flux cumulé devient ≥ 0 (interpolé dans le mois)", period: "Durée d'analyse du scénario", source: "Hypothèses du scénario", assumptions: "Non actualisé", limits: "« jamais » si non atteint sur la durée analysée ; ignore les flux postérieurs." },
  dpayback: { label: "Délai de récupération actualisé", formula: "Premier mois où le flux cumulé actualisé devient ≥ 0", period: "Durée d'analyse du scénario", source: "Hypothèses du scénario, coût du capital du propriétaire", assumptions: "Mêmes que la VAN", limits: "Plus long que le délai simple ; dépend du taux choisi." },
  loan: { label: "Échéancier de prêt", formula: "Annuité constante = P × i ÷ (1 − (1 + i)^−n) ; i = taux annuel saisi ÷ 12 (taux nul : amortissement linéaire)", period: "Durée du prêt saisie", source: "Conditions saisies par l'utilisateur (aucune offre de prêt n'est consultée)", assumptions: "Taux fixe, remboursements mensuels, pas de différé ni de frais de dossier", limits: "Ne remplace pas le tableau d'amortissement de la banque ; arrondis à l'entier, solde absorbé par la dernière échéance." },
  score: { label: "Score multicritère (0 à 100)", formula: "Σ pondération × note normalisée (ROI et récupération du scénario central normalisés entre les projets comparés ; adéquation stratégique et risque notés 1 à 5 par l'utilisateur)", period: "Projets comparés à la date du calcul", source: "Pondérations du propriétaire, notes de l'utilisateur, scénario central", assumptions: "Pondérations totalisant 100 ; mêmes données pour tous les projets", limits: "Un score est un outil de comparaison, pas une décision : il reflète vos pondérations et vos notes." },
  selection: { label: "Sélection sous enveloppe budgétaire", formula: "Combinaison de projets de score total maximal dont le budget cumulé ≤ enveloppe (recherche exhaustive jusqu'à 20 projets, sinon glouton par score)", period: "Projets comparés à la date du calcul", source: "Enveloppe fixée par le propriétaire", assumptions: "Projets indépendants, budgets pris dans leur intégralité", limits: "Simulation : ignore les dépendances entre projets et les contraintes de calendrier." },
  concentration: { label: "Diversification et concentration", formula: "Part de chaque catégorie dans le capital placé actif ; indice de concentration HHI = Σ part² (0 à 10 000)", period: "Placements actifs à la date du calcul", source: "Placements déclarés (catégorie saisie)", assumptions: "Montant investi (hors valorisation)", limits: "Dépend des catégories que vous attribuez ; une bonne diversification n'élimine pas le risque." },
  volatility: { label: "Volatilité observée", formula: "Écart-type des variations entre valorisations successives saisies (en %), baisse maximale cumulée", period: "Entre la première et la dernière valorisation saisies", source: "Valorisations saisies par l'utilisateur (au moins 6)", assumptions: "Intervalles réguliers ; aucune donnée de marché n'est importée", limits: "Non disponible sous 6 valorisations ; intervalles irréguliers = résultat peu comparable ; le passé ne prédit pas l'avenir." },
  variance: { label: "Écart réel / prévu", formula: "Réel cumulé − prévu cumulé du scénario central, et encaissements / décaissements comparés séparément", period: "Du début du projet au mois courant", source: "Scénario central ; réel saisi, ou écritures ICompta validées portant le code projet", assumptions: "Un seul suivi du réel par projet (jamais additionnés)", limits: "Le réel n'a pas de volumes : l'écart n'est pas décomposé en prix/quantité." },
};

// ------------------------------------------------------------------ VAN, TRI
export const monthlyRate = (annualPct: number): number => (1 + annualPct / 100) ** (1 / 12) - 1;
export const npv = (flows: number[], annualPct: number): number => { const r = monthlyRate(annualPct); return Math.round(flows.reduce((s, f, t) => s + f / (1 + r) ** t, 0)) + 0; };
export const discountedPayback = (flows: number[], annualPct: number): number | null => { const r = monthlyRate(annualPct); let cum = 0, prev = 0; for (let t = 0; t < flows.length; t++) { prev = cum; cum += flows[t]! / (1 + r) ** t; if (t > 0 && cum >= 0 && prev < 0) { const step = cum - prev; return Math.round((t - 1 + (step === 0 ? 1 : -prev / step)) * 10) / 10; } } return null; };
export const signChanges = (flows: number[]): number => { let n = 0, last = 0; for (const f of flows) { const s = Math.sign(f); if (s !== 0) { if (last !== 0 && s !== last) n++; last = s; } } return n; };
export type Irr = { annualPct: number | null; status: "ok" | "none" | "multiple" };
/** TRI annuel par dichotomie sur le taux mensuel. Aucun changement de signe : non défini. Plusieurs : valeur non fiable, signalée. */
export function irr(flows: number[]): Irr {
  const ch = signChanges(flows); if (ch === 0) return { annualPct: null, status: "none" }; const f = (r: number) => flows.reduce((s, x, t) => s + x / (1 + r) ** t, 0); let lo = -0.99, hi = 10; let flo = f(lo), fhi = f(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) { const steps = 400; let found = false; let a = -0.99, fa = f(a); for (let i = 1; i <= steps; i++) { const b = -0.99 + (11 * i) / steps; const fb = f(b); if (Number.isFinite(fa) && Number.isFinite(fb) && fa * fb <= 0) { lo = a; hi = b; flo = fa; fhi = fb; found = true; break; } a = b; fa = fb; } if (!found) return { annualPct: null, status: "none" }; }
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; const fm = f(mid); if (flo * fm <= 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; } }
  const m = (lo + hi) / 2; const annual = ((1 + m) ** 12 - 1) * 100; if (!Number.isFinite(annual)) return { annualPct: null, status: "none" }; return { annualPct: Math.round(annual * 10) / 10, status: ch > 1 ? "multiple" : "ok" };
}

// ------------------------------------------------------------------ prêt et financement
export type Loan = { amount: number; ratePct: number; months: number };
export function checkLoan(b: Record<string, unknown>, budget: number): Loan {
  const amount = Number(b.loanAmount ?? b.amount), rate = Number(b.ratePct), months = Number(b.months); if (!Number.isInteger(amount) || amount <= 0 || amount > budget) throw new Error("Montant du prêt : entier positif, au plus égal au budget");
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error("Taux annuel du prêt : 0 à 100 % (saisi par vous)"); if (!Number.isInteger(months) || months < 1 || months > 240) throw new Error("Durée du prêt : 1 à 240 mois"); return { amount, ratePct: rate, months };
}
export type LoanRow = { month: number; payment: number; interest: number; principal: number; balance: number };
export function loanSchedule(l: Loan): LoanRow[] {
  const i = l.ratePct / 1200; const pay = i === 0 ? l.amount / l.months : (l.amount * i) / (1 - (1 + i) ** -l.months); let bal = l.amount; const out: LoanRow[] = [];
  for (let m = 1; m <= l.months; m++) { const interest = Math.round(bal * i); let principal = m === l.months ? bal : Math.round(pay) - interest; if (principal > bal) principal = bal; if (i === 0) principal = m === l.months ? bal : Math.round(l.amount / l.months); bal -= principal; out.push({ month: m, payment: principal + interest, interest, principal, balance: bal }); }
  return out;
}
/** Flux pour les fonds propres : le prêt est encaissé au mois 0 et remboursé chaque mois ; flux du projet inchangés par ailleurs. */
export function equityFlows(flows: number[], l: Loan | null): { flows: number[]; interest: number } {
  if (!l) return { flows, interest: 0 }; const sch = loanSchedule(l); const out = flows.slice(); while (out.length <= l.months) out.push(0); out[0]! += l.amount; for (const r of sch) out[r.month]! -= r.payment; return { flows: out, interest: sch.reduce((s, r) => s + r.interest, 0) };
}
export const peakNeed = (flows: number[]): number => -Math.min(0, ...cumulative(flows));

// ------------------------------------------------------------------ classement multicritère
export const CRITERIA = ["roi", "payback", "strategy", "risk"] as const;
export type Criterion = (typeof CRITERIA)[number];
export const CRITERION_LABEL: Record<Criterion, string> = { roi: "ROI (central)", payback: "Délai de récupération (central)", strategy: "Adéquation stratégique (note 1-5)", risk: "Risque (note 1-5, 5 = plus risqué)" };
export type Weights = Record<Criterion, number>;
export function checkWeights(w: unknown): Weights { const o = (w ?? {}) as Record<string, unknown>; const out = {} as Weights; let sum = 0; for (const c of CRITERIA) { const n = Number(o[c]); if (!Number.isInteger(n) || n < 0 || n > 100) throw new Error(`Pondération « ${CRITERION_LABEL[c]} » : entier de 0 à 100`); out[c] = n; sum += n; } if (sum !== 100) throw new Error(`Les pondérations doivent totaliser 100 (actuellement ${sum})`); return out; }
export type Cand = { id: string; name: string; budget: number; roiPct: number | null; paybackMonths: number | null; strategy: number | null; riskScore: number | null };
const norm = (v: number, lo: number, hi: number, invert: boolean): number => (hi === lo ? 0.5 : invert ? (hi - v) / (hi - lo) : (v - lo) / (hi - lo));
export function rank(cands: Cand[], w: Weights): { ranked: { id: string; name: string; budget: number; score: number; parts: Record<Criterion, number> }[]; incomplete: { id: string; name: string; missing: string[] }[] } {
  const ok: Cand[] = [], incomplete: { id: string; name: string; missing: string[] }[] = [];
  for (const c of cands) { const miss = [c.roiPct === null ? "ROI du scénario central" : "", c.strategy === null ? "note stratégique" : "", c.riskScore === null ? "note de risque" : ""].filter(Boolean); if (miss.length) incomplete.push({ id: c.id, name: c.name, missing: miss }); else ok.push(c); }
  const rois = ok.map((c) => c.roiPct!); const pays = ok.map((c) => c.paybackMonths ?? Number.POSITIVE_INFINITY).filter(Number.isFinite) as number[]; const rLo = Math.min(...rois), rHi = Math.max(...rois), pLo = Math.min(...pays), pHi = Math.max(...pays);
  const ranked = ok.map((c) => { const parts: Record<Criterion, number> = { roi: norm(c.roiPct!, rLo, rHi, false), payback: c.paybackMonths === null ? 0 : pays.length ? norm(c.paybackMonths, pLo, pHi, true) : 0, strategy: (c.strategy! - 1) / 4, risk: (5 - c.riskScore!) / 4 }; const score = Math.round(CRITERIA.reduce((s, k) => s + w[k] * parts[k], 0) * 10) / 10; return { id: c.id, name: c.name, budget: c.budget, score, parts }; }).sort((a, b) => b.score - a.score || a.budget - b.budget || a.id.localeCompare(b.id));
  return { ranked, incomplete };
}
export function select(items: { id: string; budget: number; score: number }[], envelope: number): { ids: string[]; budget: number; score: number; method: "exhaustive" | "greedy" } {
  if (items.length <= 20) { let best = { mask: 0, score: -1, budget: 0 }; for (let m = 0; m < 1 << items.length; m++) { let b = 0, s = 0; for (let i = 0; i < items.length; i++) if (m & (1 << i)) { b += items[i]!.budget; s += items[i]!.score; } if (b <= envelope && (s > best.score || (s === best.score && b < best.budget))) best = { mask: m, score: s, budget: b }; } return { ids: items.filter((_, i) => best.mask & (1 << i)).map((x) => x.id), budget: best.budget, score: Math.round(Math.max(0, best.score) * 10) / 10, method: "exhaustive" }; }
  let b = 0, s = 0; const ids: string[] = []; for (const it of [...items].sort((a, c) => c.score - a.score)) if (b + it.budget <= envelope) { b += it.budget; s += it.score; ids.push(it.id); } return { ids, budget: b, score: Math.round(s * 10) / 10, method: "greedy" };
}

// ------------------------------------------------------------------ placements : diversification et volatilité
export const ASSET_CLASSES = ["Dépôt / épargne", "Obligations / titres de dette", "Actions", "Immobilier", "Matières premières", "Autre"] as const;
export function diversification(rows: { amount: number; assetClass: string; risk: string; fees: number }[], maxPct: number | null) {
  const total = rows.reduce((s, r) => s + r.amount, 0); const by = (key: "assetClass" | "risk") => { const m = new Map<string, number>(); for (const r of rows) m.set(r[key] || "Non classé", (m.get(r[key] || "Non classé") ?? 0) + r.amount); return [...m.entries()].map(([k, v]) => ({ key: k, amount: v, sharePct: total ? Math.round((v / total) * 1000) / 10 : 0 })).sort((a, b) => b.amount - a.amount); };
  const classes = by("assetClass"); const hhi = total ? Math.round(classes.reduce((s, c) => s + (c.amount / total) ** 2 * 10_000, 0)) : 0; const top = classes[0] ?? null;
  return { total, byClass: classes, byRisk: by("risk"), hhi, top, fees: rows.reduce((s, r) => s + r.fees, 0), breach: maxPct !== null && !!top && top.sharePct > maxPct ? { key: top.key, sharePct: top.sharePct, maxPct } : null };
}
export const MIN_POINTS = 6;
export function volatility(values: { date: string; value: number }[]): { available: boolean; points: number; stdPct: number | null; maxDrawdownPct: number | null; avgGapDays: number | null; regular: boolean; reason?: string } {
  const v = values.slice().sort((a, b) => a.date.localeCompare(b.date)); if (v.length < MIN_POINTS) return { available: false, points: v.length, stdPct: null, maxDrawdownPct: null, avgGapDays: null, regular: false, reason: `Non disponible : ${MIN_POINTS} valorisations saisies au moins sont nécessaires (${v.length} actuellement)` };
  const rets: number[] = []; const gaps: number[] = []; for (let i = 1; i < v.length; i++) { if (v[i - 1]!.value <= 0) continue; rets.push(v[i]!.value / v[i - 1]!.value - 1); gaps.push((Date.parse(`${v[i]!.date}T00:00:00Z`) - Date.parse(`${v[i - 1]!.date}T00:00:00Z`)) / 864e5); }
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length; const std = rets.length > 1 ? Math.sqrt(rets.reduce((s, x) => s + (x - mean) ** 2, 0) / (rets.length - 1)) : 0; let peak = v[0]!.value, dd = 0; for (const p of v) { peak = Math.max(peak, p.value); if (peak > 0) dd = Math.max(dd, (peak - p.value) / peak); }
  const avg = gaps.reduce((s, x) => s + x, 0) / gaps.length; const regular = Math.max(...gaps) - Math.min(...gaps) <= Math.max(5, avg * 0.25);
  return { available: true, points: v.length, stdPct: Math.round(std * 1000) / 10, maxDrawdownPct: Math.round(dd * 1000) / 10, avgGapDays: Math.round(avg * 10) / 10, regular };
}

// ------------------------------------------------------------------ échéancier et écart réel / prévu
export type Tranche = { id: string; dueOn: string; amount: number; status: string };
export const trancheState = (t: Tranche, today: string): "planned" | "late" | "paid" | "cancelled" => (t.status === "paid" ? "paid" : t.status === "cancelled" ? "cancelled" : t.dueOn < today ? "late" : "planned");
export const plannedTotal = (ts: Tranche[]): number => ts.filter((t) => t.status !== "cancelled").reduce((s, t) => s + t.amount, 0);
/** Encaissements et décaissements prévus jusqu'au mois courant (somme des flux positifs / négatifs du scénario central). */
export function plannedToDate(flows: number[], upTo: number) { let inn = 0, out = 0; for (let t = 0; t <= Math.min(upTo, flows.length - 1); t++) { const f = flows[t]!; if (f >= 0) inn += f; else out -= f; } return { in: inn, out }; }
