/** IProj-Invest Business : règles pures (projets d'entreprise, placements, scénarios, indicateurs).
 *  Outil d'analyse et de simulation : ni conseil financier, ni promesse de rendement, ni exécution d'opération.
 *  Toute hypothèse est saisie par l'utilisateur et identifiée comme telle ; aucun cours ni rendement de marché n'est fabriqué. */
import { addDays, daysBetween } from "./fin-pro";
import { validDay } from "./icompta";

export const KINDS = { project: "Projet d'entreprise", placement: "Placement financier" } as const;
export type Kind = keyof typeof KINDS;
export const PROJECT_STATUS: Record<string, string> = { study: "En étude", approved: "Approuvé", in_progress: "En cours", done: "Terminé", abandoned: "Abandonné" };
export const PLACEMENT_STATUS: Record<string, string> = { active: "En cours", closed: "Clôturé" };
export const SCENARIOS = ["prudent", "central", "optimistic"] as const;
export type ScenarioName = (typeof SCENARIOS)[number];
export const SCENARIO_LABEL: Record<ScenarioName, string> = { prudent: "Prudent", central: "Central", optimistic: "Optimiste" };
export const PROJECT_TYPES = ["Nouveau magasin", "Équipement", "Véhicule", "Recrutement", "Extension", "Autre"] as const;
export const RISKS = ["low", "medium", "high"] as const;
export type Risk = (typeof RISKS)[number];
export const RISK_LABEL: Record<Risk, string> = { low: "Faible", medium: "Moyen", high: "Élevé" };
export const PROFILES = ["prudent", "balanced", "dynamic"] as const;
export type Profile = (typeof PROFILES)[number];
export const PROFILE_LABEL: Record<Profile, string> = { prudent: "Prudent", balanced: "Équilibré", dynamic: "Dynamique" };
/** Risque maximal compatible avec chaque profil (déclaré par le propriétaire, sans questionnaire inventé). */
export const PROFILE_MAX: Record<Profile, Risk> = { prudent: "low", balanced: "medium", dynamic: "high" };
export const riskRank = (r: Risk): number => RISKS.indexOf(r);
export const riskMismatch = (risk: Risk, profile: Profile | null): boolean => !!profile && riskRank(risk) > riskRank(PROFILE_MAX[profile]);

const money = (v: unknown, label: string, min = 0): number => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > 1e12) throw new Error(`${label} : entier ≥ ${min} attendu (FCFA)`); return n; };
const txt = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

// ------------------------------------------------------------------ fiches
export type Financing = { source: string; amount: number; note?: string };
export type ProjectData = { type: string; objective: string; endOn: string; financing: Financing[]; note: string };
export type Maturity = { id: string; date: string; amount: number; label: string; done: boolean };
export type PlacementData = { asset: string; amount: number; boughtOn: string; horizonMonths: number; fees: number; expectedRatePct: number; risk: Risk; riskNotes: string; maturities: Maturity[]; note: string; closedOn?: string; realizedAmount?: number };

export function checkProject(b: Record<string, unknown>): { name: string; budget: number; startOn: string; data: ProjectData } {
  const name = txt(b.name, 160); if (name.length < 3) throw new Error("Nom du projet : 3 caractères au moins");
  const budget = money(b.budget, "Budget initial", 1); const startOn = validDay(b.startOn); if (!startOn) throw new Error("Date de début invalide (AAAA-MM-JJ)");
  const endOn = b.endOn ? validDay(b.endOn) : ""; if (b.endOn && !endOn) throw new Error("Date de fin invalide"); if (endOn && endOn < startOn) throw new Error("La fin ne peut pas précéder le début");
  const type = txt(b.type, 40) || "Autre"; const objective = txt(b.objective, 200); if (objective.length < 5) throw new Error("Objectif : 5 caractères au moins");
  const fin = (Array.isArray(b.financing) ? b.financing : []).slice(0, 10).map((f: { source?: unknown; amount?: unknown; note?: unknown }) => ({ source: txt(f?.source, 60), amount: money(f?.amount, "Montant de financement"), ...(f?.note ? { note: txt(f.note, 80) } : {}) })).filter((f) => f.source);
  const total = fin.reduce((s, f) => s + f.amount, 0); if (total > budget * 10) throw new Error("Financement incohérent avec le budget");
  return { name, budget, startOn, data: { type, objective, endOn: endOn ?? "", financing: fin, note: txt(b.note, 200) } };
}
export function checkPlacement(b: Record<string, unknown>): { name: string; amount: number; startOn: string; data: PlacementData } {
  const asset = txt(b.asset, 120); if (asset.length < 3) throw new Error("Actif : 3 caractères au moins"); const amount = money(b.amount, "Montant investi", 1); const boughtOn = validDay(b.boughtOn); if (!boughtOn) throw new Error("Date d'investissement invalide");
  const horizon = Number(b.horizonMonths); if (!Number.isInteger(horizon) || horizon < 1 || horizon > 600) throw new Error("Horizon : nombre entier de mois (1 à 600)"); const fees = money(b.fees ?? 0, "Frais"); if (fees >= amount) throw new Error("Les frais dépassent le montant investi");
  const rate = Number(b.expectedRatePct); if (!Number.isFinite(rate) || rate < -100 || rate > 1000) throw new Error("Rendement attendu : pourcentage annuel que VOUS déclarez (-100 à 1000)");
  if (!RISKS.includes(b.risk as Risk)) throw new Error("Niveau de risque déclaré obligatoire (faible, moyen ou élevé)"); const riskNotes = txt(b.riskNotes, 200); if (riskNotes.length < 5) throw new Error("Décrivez les risques déclarés (5 caractères au moins)");
  const mats = (Array.isArray(b.maturities) ? b.maturities : []).slice(0, 40).map((m: { id?: unknown; date?: unknown; amount?: unknown; label?: unknown; done?: unknown }, i) => { const date = validDay(m?.date); if (!date) throw new Error(`Échéance ${i + 1} : date invalide`); return { id: txt(m?.id, 24) || `m${i + 1}`, date, amount: money(m?.amount ?? 0, `Échéance ${i + 1}`), label: txt(m?.label, 80) || "Échéance", done: m?.done === true }; });
  if (new Set(mats.map((m) => m.id)).size !== mats.length) throw new Error("Identifiants d'échéance en double");
  return { name: asset, amount, startOn: boughtOn, data: { asset, amount, boughtOn, horizonMonths: horizon, fees, expectedRatePct: rate, risk: b.risk as Risk, riskNotes, maturities: mats.sort((a, c) => a.date.localeCompare(c.date)), note: txt(b.note, 200) } };
}

// ------------------------------------------------------------------ scénarios d'un projet
export type Assumptions = { months: number; monthlySales: number; marginPct: number; fixedCosts: number; growthPct: number; delayMonths: number; residualValue: number; extras: { month: number; amount: number; label: string }[] };
export function checkAssumptions(b: Record<string, unknown>): Assumptions {
  const months = Number(b.months); if (!Number.isInteger(months) || months < 1 || months > 240) throw new Error("Durée d'analyse : 1 à 240 mois");
  const marginPct = Number(b.marginPct); if (!Number.isFinite(marginPct) || marginPct < 0 || marginPct > 100) throw new Error("Marge sur ventes : 0 à 100 %"); const growthPct = Number(b.growthPct ?? 0); if (!Number.isFinite(growthPct) || growthPct < -50 || growthPct > 100) throw new Error("Croissance mensuelle des ventes : -50 à 100 %");
  const delay = Number(b.delayMonths ?? 0); if (!Number.isInteger(delay) || delay < 0 || delay >= months) throw new Error("Délai avant les premières ventes : entier ≥ 0 et inférieur à la durée");
  const extras = (Array.isArray(b.extras) ? b.extras : []).slice(0, 40).map((e: { month?: unknown; amount?: unknown; label?: unknown }, i) => { const m = Number(e?.month); const a = Number(e?.amount); if (!Number.isInteger(m) || m < 0 || m > months) throw new Error(`Flux ponctuel ${i + 1} : mois entre 0 et la durée`); if (!Number.isInteger(a) || Math.abs(a) > 1e12 || a === 0) throw new Error(`Flux ponctuel ${i + 1} : montant entier non nul (négatif = sortie)`); return { month: m, amount: a, label: txt(e?.label, 60) || "Flux ponctuel" }; });
  return { months, monthlySales: money(b.monthlySales, "Ventes mensuelles"), marginPct, fixedCosts: money(b.fixedCosts, "Coûts fixes mensuels"), growthPct, delayMonths: delay, residualValue: money(b.residualValue ?? 0, "Valeur résiduelle"), extras };
}
/** Flux de trésorerie mensuels : mois 0 = -budget ; mois m = ventes × marge − coûts fixes (+ flux ponctuels) ; valeur résiduelle au dernier mois. Montants arrondis à l'entier à chaque mois. */
export function projectFlows(budget: number, a: Assumptions): number[] {
  const f = [-budget]; for (let m = 1; m <= a.months; m++) { const sales = m <= a.delayMonths ? 0 : a.monthlySales * (1 + a.growthPct / 100) ** (m - a.delayMonths - 1); f.push(Math.round(sales * (a.marginPct / 100)) - a.fixedCosts); }
  for (const e of a.extras) f[e.month] = (f[e.month] ?? 0) + e.amount; f[a.months] = (f[a.months] ?? 0) + a.residualValue; return f;
}
export const cumulative = (flows: number[]): number[] => { let s = 0; return flows.map((x) => (s += x)); };
export type Metrics = { totalIn: number; totalOut: number; net: number; roiPct: number | null; paybackMonths: number | null; breakEvenSales: number | null; peakNeed: number; flows: number[]; cumulative: number[] };
/** Délai de récupération : premier mois où le cumul devient ≥ 0, interpolé linéairement dans le mois ; null s'il n'est jamais atteint. ROI = résultat net / sorties initiales. Seuil de rentabilité = ventes mensuelles pour lesquelles marge = coûts fixes. */
export function metrics(budget: number, a: Assumptions): Metrics {
  const flows = projectFlows(budget, a); const cum = cumulative(flows); let pay: number | null = null; for (let m = 1; m < cum.length; m++) if (cum[m]! >= 0 && cum[m - 1]! < 0) { const prev = cum[m - 1]!; const step = cum[m]! - prev; pay = Math.round((m - 1 + (step === 0 ? 1 : -prev / step)) * 10) / 10; break; }
  const totalIn = flows.reduce((s, x) => s + Math.max(0, x), 0); const totalOut = flows.reduce((s, x) => s + Math.min(0, x), 0); const net = cum.at(-1) ?? 0;
  return { totalIn, totalOut, net, roiPct: budget > 0 ? Math.round((net / budget) * 1000) / 10 : null, paybackMonths: pay, breakEvenSales: a.marginPct > 0 ? Math.ceil(a.fixedCosts / (a.marginPct / 100)) : null, peakNeed: -Math.min(0, ...cum), flows, cumulative: cum };
}
/** Sensibilité : ventes ±10 % et ±20 %, coûts fixes ±10 % et ±20 %, une variable à la fois. */
export function sensitivity(budget: number, a: Assumptions) {
  const rows: { variable: string; change: number; net: number; roiPct: number | null; paybackMonths: number | null }[] = []; const base = metrics(budget, a);
  for (const [variable, key] of [["Ventes", "monthlySales"], ["Coûts fixes", "fixedCosts"]] as const) for (const ch of [-20, -10, 10, 20]) { const m = metrics(budget, { ...a, [key]: Math.round(a[key] * (1 + ch / 100)) }); rows.push({ variable, change: ch, net: m.net, roiPct: m.roiPct, paybackMonths: m.paybackMonths }); }
  return { base: { net: base.net, roiPct: base.roiPct, paybackMonths: base.paybackMonths }, rows };
}

// ------------------------------------------------------------------ projet : transitions, réel contre prévu
const NEXT: Record<string, string[]> = { study: ["approved", "abandoned"], approved: ["in_progress", "study", "abandoned"], in_progress: ["done", "abandoned"], done: [], abandoned: [] };
export const canMove = (from: string, to: string): boolean => (NEXT[from] ?? []).includes(to);
export type Actual = { id: string; date: string; kind: "out" | "in"; amount: number; label: string; source: string; sourceRef: string; status: string };
export function actualTotals(rows: Actual[]) { const live = rows.filter((r) => r.status !== "void"); const out = live.filter((r) => r.kind === "out").reduce((s, r) => s + r.amount, 0); const inn = live.filter((r) => r.kind === "in").reduce((s, r) => s + r.amount, 0); return { out, in: inn, net: inn - out }; }
export const monthIndex = (startOn: string, date: string): number => { const [y1, m1] = startOn.split("-").map(Number) as [number, number]; const [y2, m2] = date.split("-").map(Number) as [number, number]; return (y2 - y1) * 12 + (m2 - m1); };
/** Réel mois par mois (mois 0 = mois de début) face au scénario central : deux séries distinctes, jamais mélangées. */
export function compareActual(budget: number, central: Assumptions | null, startOn: string, rows: Actual[], today: string) {
  const live = rows.filter((r) => r.status !== "void"); const nowIdx = Math.max(0, monthIndex(startOn, today)); const last = central ? Math.min(nowIdx, central.months) : nowIdx; const plan = central ? cumulative(projectFlows(budget, central)) : [];
  const act = new Array(last + 1).fill(0) as number[]; for (const r of live) { const i = monthIndex(startOn, r.date.slice(0, 7)); const k = Math.min(Math.max(i, 0), last); act[k] = (act[k] ?? 0) + (r.kind === "in" ? r.amount : -r.amount); } const actCum = cumulative(act);
  return Array.from({ length: last + 1 }, (_, i) => ({ month: i, planned: central ? plan[i] ?? null : null, actual: actCum[i] ?? 0, gap: central ? (actCum[i] ?? 0) - (plan[i] ?? 0) : null }));
}
export type Alert = { level: "critical" | "warn" | "info"; text: string };
export function projectAlerts(p: { status: string; budget: number; startOn: string }, spent: number, hasScenarios: Record<string, boolean>, today: string): Alert[] {
  const out: Alert[] = []; if (spent > p.budget) out.push({ level: "critical", text: `Décaissements constatés (${spent}) supérieurs au budget initial (${p.budget})` }); else if (p.budget > 0 && spent >= p.budget * 0.9) out.push({ level: "warn", text: "Plus de 90 % du budget initial est déjà décaissé" });
  if (p.status === "study" && !SCENARIOS.every((s) => hasScenarios[s])) out.push({ level: "info", text: "Renseignez les trois scénarios (prudent, central, optimiste) avant d'approuver" }); if ((p.status === "approved" || p.status === "in_progress") && p.startOn < today && spent === 0 && p.status === "in_progress") out.push({ level: "warn", text: "Projet en cours sans aucun décaissement enregistré : le suivi du réel est-il à jour ?" });
  return out;
}

// ------------------------------------------------------------------ placements
/** Projection mécanique, NON garantie : montant net des frais capitalisé au rendement annuel que vous avez déclaré. */
export function placementProjection(p: { amount: number; fees: number; expectedRatePct: number; horizonMonths: number }) { const base = p.amount - p.fees; const value = Math.round(base * (1 + p.expectedRatePct / 100) ** (p.horizonMonths / 12)); return { invested: p.amount, fees: p.fees, projected: value, gain: value - p.amount, gainPct: Math.round(((value - p.amount) / p.amount) * 1000) / 10 }; }
export const endOf = (boughtOn: string, months: number): string => { const [y, m, d] = boughtOn.split("-").map(Number) as [number, number, number]; const t = y * 12 + (m - 1) + months; const ny = Math.floor(t / 12), nm = (t % 12) + 1; const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate(); return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`; };
export function placementAlerts(p: PlacementData, profile: Profile | null, today: string): Alert[] {
  const out: Alert[] = []; if (!profile) out.push({ level: "info", text: "Profil de risque non défini : aucun rapprochement avec le risque déclaré du placement n'est possible" }); else if (riskMismatch(p.risk, profile)) out.push({ level: "warn", text: `Risque déclaré « ${RISK_LABEL[p.risk]} » supérieur à celui de votre profil « ${PROFILE_LABEL[profile]} »` });
  for (const m of p.maturities) { if (m.done) continue; const d = daysBetween(today, m.date); if (d < 0) out.push({ level: "critical", text: `Échéance dépassée depuis ${-d} jour(s) : ${m.label} du ${m.date}` }); else if (d <= 30) out.push({ level: "warn", text: `Échéance dans ${d} jour(s) : ${m.label} du ${m.date}` }); }
  const end = endOf(p.boughtOn, p.horizonMonths); if (!p.closedOn && end < today) out.push({ level: "warn", text: `Horizon dépassé depuis le ${end} : décidez de la suite (clôture ou prolongation)` }); if (p.expectedRatePct > 25) out.push({ level: "warn", text: "Rendement déclaré très élevé : un rendement élevé s'accompagne d'un risque élevé de perte. Vérifiez vos sources." });
  return out;
}
export const LIMITS = ["Outil d'analyse et de simulation : ce n'est ni un conseil financier ni une promesse de rendement.", "Les résultats ne sont aussi fiables que vos hypothèses, qui sont les vôtres et peuvent se révéler fausses.", "Aucune transaction n'est exécutée par l'application (pas de souscription, d'achat ni de transfert).", "Les décisions importantes doivent être validées par un professionnel compétent (expert-comptable, conseiller financier agréé)."];
void addDays;
