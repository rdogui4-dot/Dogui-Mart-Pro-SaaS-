import { statsOf } from "./inventory-pro";

/** Stock super intelligent (Pro) : règles pures et explicables. Aucune prévision n'est certaine : chaque résultat porte sa méthode, ses données, sa confiance et ses limites. */
export const DAY = 864e5;
export const Z95 = 1.65; // niveau de service 95 % (loi normale unilatérale)
export const MIN_ACTIVE_DAYS = 14; // en dessous : pas de prévision
export type Confidence = "élevée" | "moyenne" | "faible";
const r2 = (n: number) => Math.round(n * 100) / 100; const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Ventes journalières nettes (ventes − retours clients) sur `days` jours à partir de `fromMs` (jour 0 = le plus ancien). */
export function dailyDemand(events: { at: number; qty: number }[], fromMs: number, days: number): number[] {
  const out = Array<number>(days).fill(0); for (const e of events) { const i = Math.floor((e.at - fromMs) / DAY); if (i >= 0 && i < days) out[i]! += e.qty; } return out.map((x) => Math.max(0, r3(x)));
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export type Forecast = { ok: true; daily: number; total: number; horizon: number; sd: number; activeDays: number; salesDays: number; method: string; seasonal: boolean; confidence: Confidence; low: number; high: number; limits: string[] } | { ok: false; reason: string; activeDays: number; limits: string[] };
/** Lissage exponentiel (α = 0,1) sur les ventes journalières depuis la première vente ; saisonnalité hebdomadaire seulement avec ≥ 56 jours d'historique ; intervalle ± 1,65 écart-type de la somme sur l'horizon. */
export function forecast(series: number[], startDow: number, horizon: number): Forecast {
  const first = series.findIndex((x) => x > 0); const active = first < 0 ? [] : series.slice(first); const n = active.length; const salesDays = active.filter((x) => x > 0).length;
  const limits = ["Fondée uniquement sur les ventes passées : elle ignore les promotions à venir, changements de prix, nouveaux concurrents et événements exceptionnels.", "Estimation statistique, jamais une certitude : elle ne déclenche aucune commande sans votre validation."];
  if (n < MIN_ACTIVE_DAYS) return { ok: false, reason: first < 0 ? "Aucune vente sur la période d'analyse." : `Historique insuffisant : ${n} jour(s) depuis la première vente (minimum ${MIN_ACTIVE_DAYS}).`, activeDays: n, limits };
  let level = active[0]!; for (const x of active.slice(1)) level = 0.1 * x + 0.9 * level;
  const seasonal = n >= 56; const dow = (i: number) => (((startDow + first + i) % 7) + 7) % 7; const fac = Array<number>(7).fill(1);
  if (seasonal) { const overall = mean(active); if (overall > 0) for (let d = 0; d < 7; d++) { const xs = active.filter((_, i) => dow(i) === d); fac[d] = Math.min(3, Math.max(0.3, mean(xs) / overall)); } const fm = mean(fac); for (let d = 0; d < 7; d++) fac[d] = fac[d]! / fm; }
  let total = 0; for (let k = 0; k < horizon; k++) total += level * fac[dow(n + k)]!;
  const recent = active.slice(-56); const sd = statsOf(recent).sd; const cv = mean(recent) > 0 ? sd / mean(recent) : 99; const band = Z95 * sd * Math.sqrt(horizon);
  const confidence: Confidence = n >= 60 && cv <= 1 ? "élevée" : n >= 28 && cv <= 2 ? "moyenne" : "faible"; const lim = [...limits];
  if (salesDays / n < 0.3) lim.push("Ventes sporadiques (moins d'un jour sur trois) : la demande quotidienne est très irrégulière."); if (n < 28) lim.push("Historique court (< 4 semaines) : niveau de confiance faible."); if (!seasonal) lim.push("Moins de 8 semaines d'historique : saisonnalité hebdomadaire non prise en compte.");
  return { ok: true, daily: r3(total / horizon), total: r2(total), horizon, sd: r3(sd), activeDays: n, salesDays, method: `Lissage exponentiel (α = 0,1) sur les ventes journalières${seasonal ? " avec profil hebdomadaire" : ""}`, seasonal, confidence, low: r2(Math.max(0, total - band)), high: r2(total + band), limits: lim };
}

/** Stock de sécurité = z × σ(demande/jour) × √(délai) (z = 1,65 ≈ 95 % de service). */
export const safetyStock = (sdDaily: number, leadDays: number, z = Z95): number => r2(z * sdDaily * Math.sqrt(Math.max(0, leadDays)));
export type Risk = "out" | "high" | "medium" | "low" | "none";
export const RISK_LABEL: Record<Risk, string> = { out: "En rupture", high: "Risque élevé", medium: "Risque modéré", low: "Faible risque", none: "Pas de demande" };
export type Replen = { reorderPoint: number; safety: number; position: number; daysToOut: number | null; coverDays: number | null; risk: Risk; suggestedQty: number; suggestedMin: number; formula: string };
/** Point de commande = demande/jour × délai + stock de sécurité. Position = en stock + en commande + en transit entrant. Quantité = demande × (délai + couverture cible) + sécurité − position, arrondie à l'unité supérieure. */
export function replenishment(i: { qty: number; onOrder: number; inTransit: number; daily: number; sd: number; lead: number; cover: number; whole?: boolean }): Replen {
  const safety = safetyStock(i.sd, i.lead); const reorderPoint = r2(i.daily * i.lead + safety); const position = r3(i.qty + i.onOrder + i.inTransit); const daysToOut = i.daily > 0 && i.qty > 0 ? r2(i.qty / i.daily) : null; const coverDays = i.daily > 0 ? r2(Math.max(0, position) / i.daily) : null;
  let risk: Risk = "none"; if (i.qty <= 0 && i.daily > 0) risk = "out"; else if (i.daily > 0) risk = position < reorderPoint && (coverDays ?? 0) < i.lead ? "high" : position < reorderPoint || (coverDays ?? 99) < i.lead + 7 ? "medium" : "low";
  const raw = Math.max(0, i.daily * (i.lead + i.cover) + safety - position); const suggestedQty = i.daily > 0 ? (i.whole === false ? r2(raw) : (Math.ceil(raw - 1e-9) || 0)) : 0;
  return { reorderPoint, safety, position, daysToOut, coverDays, risk, suggestedQty, suggestedMin: Math.ceil(reorderPoint - 1e-9), formula: `${r2(i.daily)}/jour × (${i.lead} j de délai + ${i.cover} j de couverture) + sécurité ${safety} − position ${position}` };
}

export type StockClass = "dead" | "overstock" | "slow" | "normal" | "nodata";
export const CLASS_LABEL: Record<StockClass, string> = { dead: "Sans vente", overstock: "Surstock", slow: "Rotation lente", normal: "Normal", nodata: "Pas de stock" };
/** Rotation = quantités vendues ÷ stock moyen (≈ stock actuel quand l'historique de stock manque), couverture = stock ÷ vente moyenne/jour. */
export function classify(i: { qty: number; sold: number; days: number; overCover?: number; slowCover?: number }): { cls: StockClass; rotation: number | null; coverDays: number | null; dailyAvg: number } {
  const daily = i.days > 0 ? i.sold / i.days : 0; if (i.qty <= 0) return { cls: "nodata", rotation: null, coverDays: null, dailyAvg: r3(daily) };
  if (i.sold <= 0) return { cls: "dead", rotation: 0, coverDays: null, dailyAvg: 0 };
  const cover = i.qty / daily; const cls: StockClass = cover > (i.overCover ?? 90) ? "overstock" : cover > (i.slowCover ?? 45) ? "slow" : "normal";
  return { cls, rotation: r2(i.sold / i.qty), coverDays: r2(cover), dailyAvg: r3(daily) };
}
/** Variation de consommation entre deux périodes de même durée : signalée seulement si la base est significative (≥ 5 unités) et l'écart ≥ 50 %. */
export function consumptionChange(recent: number, previous: number): { pct: number | null; flag: "hausse" | "baisse" | null } {
  if (previous < 5) return { pct: null, flag: null }; const pct = r2(((recent - previous) / previous) * 100); return { pct, flag: pct >= 50 ? "hausse" : pct <= -50 ? "baisse" : null };
}
/** Immobilisation financière : valeur du stock au-delà des besoins couvrant `targetDays`. */
export const excessValue = (qty: number, daily: number, cost: number, targetDays: number): number => (qty > 0 && cost > 0 ? Math.round(Math.max(0, qty - daily * targetDays) * cost) : 0);

// ------------------------------------------------------------------ multi-magasins
export type ShopPos = { shopId: string; qty: number; inTransit: number; daily: number; min: number };
export type TransferHint = { fromShopId: string; toShopId: string; qty: number; why: string };
/** Un magasin donne seulement son excédent (au-delà de son minimum et de `keepDays` de ventes) vers un magasin dont la couverture est < `needDays` ; jamais plus que le besoin. Suggestion : rien n'est transféré automatiquement. */
export function suggestTransfers(shops: ShopPos[], o: { needDays: number; keepDays: number; whole?: boolean }): TransferHint[] {
  const need = shops.map((s) => ({ s, need: Math.max(0, s.daily * o.needDays + s.min - (s.qty + s.inTransit)) })).filter((x) => x.need > 0 && x.s.daily > 0).sort((a, b) => b.need - a.need);
  const give = new Map(shops.map((s) => [s.shopId, Math.max(0, s.qty - Math.max(s.min, s.daily * o.keepDays))])); const out: TransferHint[] = [];
  for (const n of need) { let left = n.need; for (const d of [...give.entries()].filter(([id, g]) => id !== n.s.shopId && g > 0).sort((a, b) => b[1] - a[1])) { if (left <= 0) break; let q = Math.min(left, d[1]); q = o.whole === false ? r2(q) : Math.floor(q + 1e-9); if (q <= 0) continue; give.set(d[0], d[1] - q); left -= q; const dn = shops.find((s) => s.shopId === n.s.shopId)!; out.push({ fromShopId: d[0], toShopId: n.s.shopId, qty: q, why: `Le magasin de destination couvre ${dn.daily > 0 ? r2((dn.qty + dn.inTransit) / dn.daily) : 0} jour(s) de ventes ; l'origine garde son minimum et ${o.keepDays} jour(s) de ventes.` }); } }
  return out;
}
/** Déséquilibre : un magasin couvre moins de `low` jours pendant qu'un autre en couvre plus de `high`. */
export function imbalance(shops: ShopPos[], low = 7, high = 60): { imbalanced: boolean; short: string[]; surplus: string[] } {
  const cov = (s: ShopPos) => (s.daily > 0 ? (s.qty + s.inTransit) / s.daily : s.qty > 0 ? Infinity : null); const short = shops.filter((s) => s.daily > 0 && (cov(s) ?? 99) < low).map((s) => s.shopId); const surplus = shops.filter((s) => { const c = cov(s); return c !== null && c > high && s.qty > s.min; }).map((s) => s.shopId);
  return { imbalanced: short.length > 0 && surplus.length > 0, short, surplus };
}

// ------------------------------------------------------------------ simulation
export type SimInput = { qty: number; daily: number; sd: number; horizon: number; price: number; cost: number; orders: { day: number; qty: number }[] };
export type SimResult = { stockoutDay: number | null; lostUnits: number; lostRevenue: number; lostMargin: number; endQty: number; minQty: number; days: number; lostUnitsHigh: number };
/** Projection jour par jour (demande moyenne constante) ; `lostUnitsHigh` rejoue la même projection avec une demande + 1,65 σ (scénario pessimiste). Les ventes manquées estimées ne sont pas du chiffre d'affaires réalisé. */
export function simulate(i: SimInput): SimResult {
  const run = (d: number) => { let q = i.qty; let out: number | null = null; let lost = 0; let min = q; for (let day = 1; day <= i.horizon; day++) { for (const o of i.orders) if (o.day === day) q += o.qty; if (q >= d) q -= d; else { lost += d - Math.max(0, q); q = 0; if (out === null) out = day; } min = Math.min(min, q); } return { out, lost, q, min }; };
  const base = run(i.daily); const high = run(i.daily + Z95 * i.sd);
  return { stockoutDay: base.out, lostUnits: r2(base.lost), lostRevenue: Math.round(base.lost * i.price), lostMargin: Math.round(base.lost * Math.max(0, i.price - i.cost)), endQty: r2(base.q), minQty: r2(base.min), days: i.horizon, lostUnitsHigh: r2(high.lost) };
}

// ------------------------------------------------------------------ anomalies
/** Mouvements répétés : au moins `min` mouvements identiques (article, type, quantité, auteur) dans une fenêtre de `windowMs`. */
export function repeatedMoves<T extends { id: string; at: number; key: string }>(moves: T[], windowMs = 10 * 60_000, min = 3): T[][] {
  const by = new Map<string, T[]>(); for (const m of moves) (by.get(m.key) ?? by.set(m.key, []).get(m.key)!).push(m); const out: T[][] = [];
  for (const g of by.values()) { g.sort((a, b) => a.at - b.at); let s = 0; for (let e = 0; e < g.length; e++) { while (g[e]!.at - g[s]!.at > windowMs) s++; if (e - s + 1 >= min) { const grp = g.slice(s, e + 1); if (!out.some((o) => o[0] === grp[0])) out.push(grp); else out[out.findIndex((o) => o[0] === grp[0])] = grp; } } }
  return out;
}
/** Valeur inhabituelle par rapport à l'historique (≥ 5 observations) : z-score ≥ 3. */
export function outlier(value: number, history: number[]): { flag: boolean; z: number | null } { if (history.length < 5) return { flag: false, z: null }; const s = statsOf(history); if (s.sd === 0) return { flag: value > s.mean && history.length >= 5 && value >= s.mean * 3 && value > 0, z: null }; const z = r2((value - s.mean) / s.sd); return { flag: z >= 3, z }; }
export const ANOMALY_CAVEAT = "Indicateur à vérifier : il ne prouve ni erreur ni faute et n'est jamais une qualification de fraude.";
