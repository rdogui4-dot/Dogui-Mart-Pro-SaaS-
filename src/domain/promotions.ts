import { MAX_AMOUNT } from "./articles";

/** MOTEUR UNIQUE de promotions (Business et Pro) : règles pures partagées par le serveur (qui fait foi) et l'interface (formulaires, descriptions).
 *  Business = remises simples ; Pro = familles avancées, cumul, coupons, ciblage, budgets, multi-magasins. Les droits d'abonnement ne changent jamais le calcul d'une
 *  promotion simple : ils activent ou gèlent des fonctions (une campagne avancée « gelée » n'est plus appliquée mais reste conservée). Montants en FCFA entiers. */
export const PROMO_KINDS = [{ id: "percent", label: "Remise en pourcentage" }, { id: "amount", label: "Remise en montant fixe" }, { id: "price", label: "Prix promotionnel" }] as const;
export const PROMO_SCOPES = [{ id: "items", label: "Articles choisis" }, { id: "category", label: "Catégorie d'articles" }] as const;
export const FAMILIES = [
  { id: "simple", label: "Remise simple", pro: false, help: "Un type de remise sur les articles ou la catégorie choisis." },
  { id: "tiers", label: "Prix dégressifs (paliers de quantité)", pro: true, help: "Plus le client achète, plus la remise augmente." },
  { id: "bogo", label: "Achetez X, obtenez Y (gratuit ou réduit)", pro: true, help: "Les Y articles les moins chers du lot sont remisés." },
  { id: "combo", label: "Pack / prix spécial pour un ensemble", pro: true, help: "Un prix fixe quand tous les articles du pack sont dans le panier." },
  { id: "requires", label: "Remise conditionnée à l'achat d'articles", pro: true, help: "La remise s'applique si les articles requis sont dans le panier." },
  { id: "cart", label: "Remise sur le panier (montant minimum)", pro: true, help: "Remise sur tout le panier à partir d'un montant minimal." },
] as const;
export type Family = (typeof FAMILIES)[number]["id"];
export type PromoKind = (typeof PROMO_KINDS)[number]["id"]; export type PromoScope = "items" | "category";
export type StoredStatus = "draft" | "enabled" | "suspended" | "ended";
export type PromoStatus = "draft" | "scheduled" | "active" | "suspended" | "ended";
export type StoreScope = "this" | "all" | "some";
export const STATUS_LABEL: Record<PromoStatus, string> = { draft: "Brouillon", scheduled: "Programmée", active: "Active", suspended: "Suspendue", ended: "Terminée" };
export const MAX_PROMO_ITEMS = 200, MAX_TIERS = 10, MAX_COMBO = 10;
export const DEFAULT_TYPE_RANK: Family[] = ["combo", "bogo", "tiers", "requires", "cart", "simple"];
export const LOYALTY_TIERS = ["bronze", "silver", "gold"] as const;

export type Tier = { minQty: number; kind: PromoKind; value: number };
export type CustomerRules = { categories: string[]; customerIds: string[]; loyalty: string[]; newDays?: number };
export type StoreOverride = { enabled: boolean; value?: number; budget?: number };
export type Promo = {
  id: string; name: string; description?: string; objective?: string; code?: string; family?: Family; kind: PromoKind; scope: PromoScope; value: number; category?: string;
  itemIds: string[]; excludeIds?: string[]; requireItems?: { key: string; qty: number }[]; comboItems?: { key: string; qty: number }[]; tiers?: Tier[]; tierBasis?: "line" | "cumulative"; bogo?: { buy: number; get: number; pct: number };
  startAt: string; endAt: string; status: StoredStatus; minQty?: number; minCart?: number; usageLimit?: number; usageCount: number; perCustomerLimit?: number;
  priority: number; allowBelowMargin: boolean; createdAt: string;
  stackable?: boolean; maxLinePct?: number; maxCartDiscount?: number; budget?: number; minMarginPct?: number; requiresCoupon?: boolean;
  storeScope?: StoreScope; homeShopId?: string; shopIds?: string[]; storeOverrides?: Record<string, StoreOverride>; customerRules?: CustomerRules;
};
export const familyOf = (p: Pick<Promo, "family">): Family => p.family ?? "simple";
/** Fonctions réservées à Pro : une campagne qui en utilise une est « avancée ». */
export function isAdvanced(p: Partial<Promo>): boolean {
  const cr = p.customerRules;
  return familyOf(p as Promo) !== "simple" || !!p.stackable || (!!p.storeScope && p.storeScope !== "this") || !!(cr && (cr.categories.length || cr.customerIds.length || cr.loyalty.length || cr.newDays)) || !!p.requiresCoupon || p.budget !== undefined
    || p.maxLinePct !== undefined || p.maxCartDiscount !== undefined || p.minMarginPct !== undefined || !!(p.excludeIds && p.excludeIds.length);
}

/** Statut effectif : la date est contrôlée à chaque évaluation, jamais seulement mémorisée. */
export function promoStatus(p: Pick<Promo, "status" | "startAt" | "endAt">, now: Date = new Date()): PromoStatus {
  if (p.status === "draft") return "draft"; if (p.status === "suspended") return "suspended"; if (p.status === "ended") return "ended";
  const t = now.getTime(); if (t < Date.parse(p.startAt)) return "scheduled"; if (t >= Date.parse(p.endAt)) return "ended"; return "active";
}
export const normalizeCode = (raw: unknown): string => String(raw ?? "").trim().toUpperCase();

// ------------------------------------------------------------------ fuseau horaire de l'entreprise
export const DEFAULT_TIMEZONE = "Africa/Dakar";
export const TIMEZONES = ["Africa/Dakar", "Africa/Abidjan", "Africa/Bamako", "Africa/Conakry", "Africa/Ouagadougou", "Africa/Lome", "Africa/Douala", "Africa/Lagos", "Africa/Casablanca", "Europe/Paris", "UTC"] as const;
export const isTimezone = (tz: unknown): tz is string => { if (typeof tz !== "string" || !tz) return false; try { new Intl.DateTimeFormat("fr-FR", { timeZone: tz }); return true; } catch { return false; } };
const partsIn = (ms: number, tz: string) => { const o: Record<string, number> = {}; for (const p of new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = Number(p.value); return o as { year: number; month: number; day: number; hour: number; minute: number; second: number }; };
/** « 2026-11-10T08:00 » saisi à l'heure de l'entreprise → instant UTC (ISO). */
export function zonedToUtc(local: string, tz: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local); if (!m) throw new Error("Date et heure invalides");
  const as = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!); let ms = as;
  for (let i = 0; i < 2; i++) { const p = partsIn(ms, tz); ms += as - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second); }
  return new Date(ms).toISOString();
}
/** Instant UTC → « AAAA-MM-JJTHH:MM » à l'heure de l'entreprise (champs de formulaire). */
export function utcToZoned(iso: string, tz: string): string { const p = partsIn(Date.parse(iso), tz); const z = (n: number) => String(n).padStart(2, "0"); return `${p.year}-${z(p.month)}-${z(p.day)}T${z(p.hour)}:${z(p.minute)}`; }
/** Jour calendaire (AAAA-MM-JJ) d'un instant, à l'heure de l'entreprise. */
export const dayInZone = (iso: string, tz: string): string => utcToZoned(iso, tz).slice(0, 10);

// ------------------------------------------------------------------ validation de la saisie
export type PromoInput = {
  name: string; description: string; objective: string; code: string; family: Family; kind: PromoKind; scope: PromoScope; value: number; category: string; startAt: string; endAt: string;
  minQty?: number; minCart?: number; usageLimit?: number; perCustomerLimit?: number; priority: number; allowBelowMargin: boolean;
  stackable: boolean; maxLinePct?: number; maxCartDiscount?: number; budget?: number; minMarginPct?: number; requiresCoupon: boolean; storeScope: StoreScope; tierBasis: "line" | "cumulative";
  tiers: Tier[]; bogo?: { buy: number; get: number; pct: number }; comboPrice?: number; customerRules: CustomerRules;
};
const intIn = (raw: unknown, label: string, min: number, max: number): number => { const n = Number(String(raw).replace(/\s/g, "").replace(",", ".")); if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} invalide (entier de ${min} à ${max})`); return n; };
const opt = (raw: unknown): boolean => raw !== undefined && raw !== null && String(raw).trim() !== "";
const iso = (raw: unknown, label: string): string => { const ms = Date.parse(String(raw ?? "")); if (!opt(raw) || Number.isNaN(ms)) throw new Error(`${label} : date et heure obligatoires`); return new Date(ms).toISOString(); };
const valueFor = (kind: PromoKind, raw: unknown, label = ""): number => kind === "percent" ? intIn(raw, `${label}Pourcentage`, 1, 100) : kind === "amount" ? intIn(raw, `${label}Montant de la remise`, 1, MAX_AMOUNT) : intIn(raw, `${label}Prix promotionnel`, 0, MAX_AMOUNT);
const kindOk = (k: unknown): k is PromoKind => PROMO_KINDS.some((x) => x.id === k);

/** Valide et nettoie la saisie d'une campagne (même contrôle côté serveur). Lève une erreur lisible. Les champs Pro sont acceptés ici ; le serveur refuse leur usage hors formule Pro. */
export function parsePromotion(raw: Record<string, unknown>): PromoInput {
  const name = String(raw.name ?? "").trim(); if (name.length < 2 || name.length > 120) throw new Error("Nom de la promotion : 2 à 120 caractères");
  const description = String(raw.description ?? "").trim(); if (description.length > 500) throw new Error("Description : 500 caractères au plus");
  const objective = String(raw.objective ?? "").trim(); if (objective.length > 200) throw new Error("Objectif commercial : 200 caractères au plus");
  const code = normalizeCode(raw.code); if (code && !/^[A-Z0-9_-]{3,20}$/.test(code)) throw new Error("Code promo : 3 à 20 caractères (lettres, chiffres, - ou _)");
  const family = (raw.family ?? "simple") as Family; if (!FAMILIES.some((f) => f.id === family)) throw new Error("Type de promotion inconnu");
  const scope = (raw.scope ?? "items") as PromoScope; if (!PROMO_SCOPES.some((s) => s.id === scope)) throw new Error("Portée inconnue");
  const category = String(raw.category ?? "").trim(); if (scope === "category" && !category) throw new Error("Choisissez la catégorie concernée"); if (scope !== "category" && category) throw new Error("La catégorie ne concerne que les promotions sur catégorie");
  const startAt = iso(raw.startAt, "Début"), endAt = iso(raw.endAt, "Fin"); if (Date.parse(endAt) <= Date.parse(startAt)) throw new Error("La fin doit être postérieure au début");
  if (Date.parse(endAt) - Date.parse(startAt) > 366 * 86_400_000) throw new Error("Durée maximale d'une promotion : 366 jours");
  let kind = (raw.kind ?? "percent") as PromoKind; if (!kindOk(kind)) throw new Error("Type de remise inconnu");
  let value = 0; const tiers: Tier[] = []; let bogo: PromoInput["bogo"]; let comboPrice: number | undefined;
  if (family === "tiers") {
    if (!Array.isArray(raw.tiers) || !raw.tiers.length) throw new Error("Ajoutez au moins un palier de quantité"); if (raw.tiers.length > MAX_TIERS) throw new Error(`${MAX_TIERS} paliers au maximum`);
    const seen = new Set<number>(); for (const t of raw.tiers as { minQty?: unknown; kind?: unknown; value?: unknown }[]) { const q = Number(String(t.minQty).replace(",", ".")); if (!(q > 0) || q > 99_999 || !/^\d+(\.\d{1,3})?$/.test(String(t.minQty).trim().replace(",", "."))) throw new Error("Quantité de palier invalide"); if (seen.has(q)) throw new Error("Deux paliers ont la même quantité"); seen.add(q); if (!kindOk(t.kind)) throw new Error("Type de remise de palier inconnu"); tiers.push({ minQty: q, kind: t.kind, value: valueFor(t.kind, t.value, "Palier : ") }); }
    tiers.sort((a, b) => a.minQty - b.minQty); kind = tiers[0]!.kind; value = tiers[0]!.value;
  } else if (family === "bogo") {
    const buy = intIn(raw.bogoBuy, "Quantité achetée (X)", 1, 1000), get = intIn(raw.bogoGet, "Quantité offerte (Y)", 1, 1000), pct = intIn(raw.bogoPct ?? 100, "Remise sur les articles offerts", 1, 100); bogo = { buy, get, pct }; kind = "percent"; value = pct;
  } else if (family === "combo") { comboPrice = intIn(raw.comboPrice, "Prix de l'ensemble", 0, MAX_AMOUNT); kind = "price"; value = comboPrice; }
  else { if (family === "cart" && kind === "price") throw new Error("Une remise sur le panier se fait en pourcentage ou en montant"); value = valueFor(kind, raw.value); }
  if (family === "cart" && !opt(raw.minCart)) throw new Error("Une remise sur le panier exige un montant minimal de panier");
  const cr = (raw.customerRules ?? {}) as Partial<CustomerRules>;
  const customerRules: CustomerRules = { categories: [...new Set((cr.categories ?? []).map(String))], customerIds: [...new Set((cr.customerIds ?? []).map(String))], loyalty: [...new Set((cr.loyalty ?? []).map(String))], ...(opt(cr.newDays) ? { newDays: intIn(cr.newDays, "Ancienneté d'un nouveau client (jours)", 1, 365) } : {}) };
  for (const l of customerRules.loyalty) if (!LOYALTY_TIERS.includes(l as never)) throw new Error("Niveau de fidélité inconnu");
  const storeScope = (raw.storeScope ?? "this") as StoreScope; if (!["this", "all", "some"].includes(storeScope)) throw new Error("Portée magasins inconnue");
  const stackable = raw.stackable === true; if (stackable && (family === "bogo" || family === "combo")) throw new Error("Un lot (achetez X obtenez Y, pack) ne se cumule pas avec d'autres promotions");
  const out: PromoInput = { name, description, objective, code, family, kind, scope, value, category, startAt, endAt, priority: opt(raw.priority) ? intIn(raw.priority, "Priorité", 0, 100) : 0, allowBelowMargin: raw.allowBelowMargin === true,
    stackable, requiresCoupon: raw.requiresCoupon === true, storeScope, tierBasis: raw.tierBasis === "cumulative" ? "cumulative" : "line", tiers, customerRules, ...(bogo ? { bogo } : {}), ...(comboPrice !== undefined ? { comboPrice } : {}) };
  if (opt(raw.minQty)) { const q = Number(String(raw.minQty).replace(",", ".")); if (!(q > 0) || q > 9999 || !/^\d+(\.\d{1,3})?$/.test(String(raw.minQty).trim().replace(",", "."))) throw new Error("Quantité minimale invalide"); out.minQty = q; }
  if (opt(raw.minCart)) out.minCart = intIn(raw.minCart, "Montant minimal du panier", 1, MAX_AMOUNT);
  if (opt(raw.usageLimit)) out.usageLimit = intIn(raw.usageLimit, "Limite d'utilisation", 1, 10_000_000);
  if (opt(raw.perCustomerLimit)) out.perCustomerLimit = intIn(raw.perCustomerLimit, "Limite par client", 1, 10_000);
  if (opt(raw.maxLinePct)) out.maxLinePct = intIn(raw.maxLinePct, "Plafond de remise par article (%)", 1, 100);
  if (opt(raw.maxCartDiscount)) out.maxCartDiscount = intIn(raw.maxCartDiscount, "Plafond de remise par panier (FCFA)", 1, MAX_AMOUNT);
  if (opt(raw.budget)) out.budget = intIn(raw.budget, "Budget de la campagne (FCFA)", 1, MAX_AMOUNT * 100);
  if (opt(raw.minMarginPct)) out.minMarginPct = intIn(raw.minMarginPct, "Marge minimale de la campagne (%)", 0, 90);
  return out;
}

/** Résumé lisible de la remise (listes, aperçu). */
export function describeDiscount(p: { kind: PromoKind; value: number; family?: Family; tiers?: Tier[]; bogo?: { buy: number; get: number; pct: number } }): string {
  const one = (k: PromoKind, v: number) => (k === "percent" ? `−${v} %` : k === "amount" ? `−${v.toLocaleString("fr-FR")} FCFA` : `prix ${v.toLocaleString("fr-FR")} FCFA`);
  if (p.family === "tiers" && p.tiers?.length) return p.tiers.map((t) => `dès ${t.minQty} : ${one(t.kind, t.value)}`).join(" · ");
  if (p.family === "bogo" && p.bogo) return `${p.bogo.buy} achetés = ${p.bogo.get} ${p.bogo.pct === 100 ? "offert" : `à −${p.bogo.pct} %`}${p.bogo.get > 1 ? "s" : ""}`;
  if (p.family === "combo") return `pack à ${p.value.toLocaleString("fr-FR")} FCFA`;
  return one(p.kind, p.value);
}

// ------------------------------------------------------------------ évaluation
export type EvalLine = { index: number; productId: string; keys?: string[]; category?: string; qty: number; baseAmount: number; unitCost?: number; eligible: boolean };
export type EvalCustomer = { id: string; category?: string; loyalty?: string; createdAt?: string };
export type EvalCtx = {
  now: Date; customerId?: string; customer?: EvalCustomer; minMarginPct: number; customerUses?: (promoId: string) => number; shopId?: string; pro?: boolean;
  couponPromoId?: string; budgetUsed?: (promoId: string, shopId?: string) => number; maxLinePct?: number; maxCartPct?: number; strategy?: "best" | "priority"; typeRank?: Family[];
};
export type Part = { promoId: string; discount: number };
export type Decision = { promoId: string; name: string; code?: string; outcome: "applied" | "refused"; reason: string; message: string; discount?: number };
export type EvalResult = {
  lines: { index: number; promoId?: string; discount: number; parts: Part[] }[];
  applied: { promoId: string; name: string; code?: string; family: Family; discount: number; lineIndexes: number[] }[];
  skipped: { promoId: string; reason: string }[]; decisions: Decision[]; notes: string[];
};

const round = Math.round;
const matches = (l: EvalLine, key: string) => l.productId === key || (l.keys ?? []).includes(key);
const sameCat = (a?: string, b?: string) => (a ?? "").toLowerCase() === (b ?? "").toLowerCase();
const fmt = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} FCFA`;

/** Remise d'une promotion sur UNE ligne (jamais plus que la ligne, jamais négative). */
export function lineDiscount(p: Pick<Promo, "kind" | "value">, l: Pick<EvalLine, "qty" | "baseAmount">): number {
  const base = l.baseAmount; if (!(base > 0)) return 0;
  const d = p.kind === "percent" ? round(base * p.value / 100) : p.kind === "amount" ? round(p.value * l.qty) : base - round(p.value * l.qty);
  return Math.max(0, Math.min(base, d));
}
/** Répartit `total` au prorata de `weights` (somme exacte, plus fort reste). */
function spread(total: number, weights: { index: number; w: number }[]): Map<number, number> {
  const out = new Map<number, number>(); const sum = weights.reduce((a, x) => a + x.w, 0); if (!(sum > 0) || total <= 0) return out;
  let left = total; const rows = weights.map((x) => { const exact = total * x.w / sum; return { index: x.index, base: Math.floor(exact), rem: exact - Math.floor(exact) }; });
  for (const r of rows) { out.set(r.index, r.base); left -= r.base; }
  for (const r of [...rows].sort((a, b) => b.rem - a.rem || a.index - b.index)) { if (left <= 0) break; out.set(r.index, out.get(r.index)! + 1); left--; }
  return out;
}

type Cand = { p: Promo; map: Map<number, number>; total: number; group: boolean };
const GROUP = new Set<Family>(["bogo", "combo", "cart", "requires"]);

/** Candidats d'UNE campagne sur le panier, sans tenir compte des autres : remises par ligne, ou raison du refus. */
function candidate(p: Promo, lines: EvalLine[], ctx: EvalCtx): { map: Map<number, number> } | { refuse: string; message: string } {
  const fam = familyOf(p); const live = lines.filter((l) => l.eligible && l.baseAmount > 0 && !(p.excludeIds ?? []).some((k) => matches(l, k)));
  const override = ctx.shopId ? p.storeOverrides?.[ctx.shopId]?.value : undefined; const val = override ?? p.value;
  const targets = fam === "cart" ? live : live.filter((l) => (p.scope === "items" ? p.itemIds.some((k) => matches(l, k)) : sameCat(l.category, p.category)));
  const map = new Map<number, number>();
  if (fam === "simple") {
    for (const l of targets) { if (p.minQty !== undefined && l.qty < p.minQty) continue; const d = lineDiscount({ kind: p.kind, value: val }, l); if (d > 0) map.set(l.index, d); }
    if (!map.size) return { refuse: targets.length ? "min_qty" : "none", message: targets.length ? `quantité minimale non atteinte (${p.minQty})` : "aucun article concerné dans le panier" };
  } else if (fam === "tiers") {
    const tiers = [...(p.tiers ?? [])].sort((a, b) => a.minQty - b.minQty); if (!tiers.length) return { refuse: "none", message: "aucun palier" };
    const total = targets.reduce((a, l) => a + l.qty, 0);
    for (const l of targets) { const basis = p.tierBasis === "cumulative" ? total : l.qty; const t = [...tiers].reverse().find((x) => x.minQty <= basis); if (!t) continue; const d = lineDiscount({ kind: t.kind, value: t.value }, l); if (d > 0) map.set(l.index, d); }
    if (!map.size) return { refuse: targets.length ? "min_qty" : "none", message: targets.length ? `premier palier non atteint (dès ${tiers[0]!.minQty})` : "aucun article concerné dans le panier" };
  } else if (fam === "bogo") {
    const b = p.bogo!; const units: { index: number; price: number }[] = [];
    for (const l of targets) if (Number.isInteger(l.qty) && l.qty > 0 && l.qty <= 1000) for (let i = 0; i < l.qty; i++) units.push({ index: l.index, price: l.baseAmount / l.qty });
    if (!units.length) return { refuse: "none", message: "aucun article concerné dans le panier" };
    const groups = Math.floor(units.length / (b.buy + b.get)); if (groups < 1) return { refuse: "min_qty", message: `il faut ${b.buy + b.get} articles du lot (achetez ${b.buy}, obtenez ${b.get})` };
    const raw = new Map<number, number>(); for (const u of [...units].sort((x, y) => x.price - y.price || x.index - y.index).slice(0, groups * b.get)) raw.set(u.index, (raw.get(u.index) ?? 0) + u.price * b.pct / 100);
    for (const [i, d] of raw) { const l = lines.find((x) => x.index === i)!; const r = Math.min(l.baseAmount, round(d)); if (r > 0) map.set(i, r); }
  } else if (fam === "combo") {
    const comps = p.comboItems ?? []; const pool = live; const taken: { index: number; value: number }[] = []; let sets = Infinity;
    const avail = comps.map((c) => pool.filter((l) => matches(l, c.key)).reduce((a, l) => a + Math.floor(l.qty), 0)); comps.forEach((c, i) => { sets = Math.min(sets, Math.floor(avail[i]! / c.qty)); });
    if (!comps.length || !(sets >= 1)) return { refuse: "requires", message: "tous les articles du pack ne sont pas dans le panier" };
    let value = 0; for (const c of comps) { let need = c.qty * sets; for (const l of pool.filter((x) => matches(x, c.key))) { const take = Math.min(need, Math.floor(l.qty)); if (take <= 0) continue; const v = l.baseAmount / l.qty * take; taken.push({ index: l.index, value: v }); value += v; need -= take; } }
    const d = round(value - sets * val); if (d <= 0) return { refuse: "no_gain", message: `le prix de l'ensemble (${fmt(val)}) n'est pas inférieur au prix normal` };
    for (const [i, x] of spread(d, taken.map((t) => ({ index: t.index, w: t.value })))) map.set(i, Math.min(x, lines.find((l) => l.index === i)!.baseAmount));
  } else if (fam === "requires") {
    for (const r of p.requireItems ?? []) { const have = live.filter((l) => matches(l, r.key)).reduce((a, l) => a + l.qty, 0); if (have < r.qty) return { refuse: "requires", message: "un article requis est absent du panier (ou en quantité insuffisante)" }; }
    const tg = p.itemIds.length || p.scope === "category" ? targets : live.filter((l) => (p.requireItems ?? []).some((r) => matches(l, r.key)));
    for (const l of tg) { const d = lineDiscount({ kind: p.kind, value: val }, l); if (d > 0) map.set(l.index, d); }
    if (!map.size) return { refuse: "none", message: "aucun article concerné dans le panier" };
  } else if (fam === "cart") {
    const base = live.reduce((a, l) => a + l.baseAmount, 0); if (!live.length) return { refuse: "none", message: "panier vide pour cette promotion" };
    if (p.kind === "percent") for (const l of live) { const d = round(l.baseAmount * val / 100); if (d > 0) map.set(l.index, d); } else for (const [i, d] of spread(Math.min(val, base), live.map((l) => ({ index: l.index, w: l.baseAmount })))) if (d > 0) map.set(i, d);
  }
  return { map };
}

/** Plafond de remise d'une ligne imposé par la marge (coût réel figé). Coût inconnu + marge exigée : aucune remise possible (jamais de chiffre approximatif). */
function marginFloor(l: EvalLine, p: Promo, ctx: EvalCtx): number {
  if (p.allowBelowMargin) return Infinity; const m = p.minMarginPct ?? ctx.minMarginPct;
  if (!(l.unitCost && l.unitCost > 0)) return m > 0 ? 0 : Infinity;
  return Math.max(0, l.baseAmount - l.unitCost * (1 + m / 100) * l.qty);
}

/** Évalue toutes les campagnes sur le panier. Règles (identiques pour Business et Pro, les fonctions avancées étant gelées hors Pro) :
 *  – par défaut une seule promotion par ligne : la plus avantageuse (stratégie « best », départage par priorité, rang du type, ancienneté) ou, en stratégie « priority », la plus prioritaire ;
 *  – deux promotions ne se cumulent que si TOUTES deux sont cumulables ; une ligne reçoit alors soit la meilleure offre exclusive, soit le cumul, selon le plus avantageux ;
 *  – un lot (achetez X obtenez Y, pack, remise panier, articles requis) est appliqué en entier ou pas du tout ;
 *  – plafonds : par article, par panier, par campagne, budget, limite d'utilisation, marge minimale (coût réel) ;
 *  – chaque campagne concernée par le panier reçoit une décision expliquée (appliquée ou refusée, avec la raison). */
export function evaluatePromotions(promos: Promo[], lines: EvalLine[], ctx: EvalCtx): EvalResult {
  const decisions: Decision[] = []; const notes: string[] = []; const refused = new Set<string>(); const strategy = ctx.strategy ?? "best"; const rank = ctx.typeRank ?? DEFAULT_TYPE_RANK;
  const cartBase = lines.reduce((a, l) => a + l.baseAmount, 0); const eligibleBase = lines.filter((l) => l.eligible).reduce((a, l) => a + l.baseAmount, 0);
  const refuse = (p: Promo, reason: string, message: string) => { if (refused.has(p.id)) return; refused.add(p.id); decisions.push({ promoId: p.id, name: p.name, ...(p.code ? { code: p.code } : {}), outcome: "refused", reason, message }); };
  const touches = (p: Promo): boolean => { const fam = familyOf(p); if (fam === "cart") return lines.some((l) => l.eligible); if (fam === "combo") return (p.comboItems ?? []).some((c) => lines.some((l) => matches(l, c.key))); return lines.some((l) => (p.scope === "items" ? p.itemIds.some((k) => matches(l, k)) : sameCat(l.category, p.category)) || (fam === "requires" && (p.requireItems ?? []).some((r) => matches(l, r.key)))); };
  const cands: Cand[] = [];
  for (const p of promos) {
    const rel = touches(p) || (!!p.requiresCoupon && ctx.couponPromoId === p.id); if (!rel && !(p.requiresCoupon && ctx.couponPromoId === p.id)) continue;
    const st = promoStatus(p, ctx.now);
    if (st !== "active") { refuse(p, "not_active", st === "scheduled" ? "pas encore commencée" : st === "ended" ? "terminée" : st === "suspended" ? "suspendue" : "brouillon (non activée)"); continue; }
    if (isAdvanced(p) && !ctx.pro) { refuse(p, "frozen", "campagne avancée gelée : elle exige la formule Pro (conservée, non appliquée)"); continue; }
    if (ctx.shopId && p.storeScope === "some" && !(p.shopIds ?? []).includes(ctx.shopId)) { refuse(p, "store", "non applicable dans ce magasin"); continue; }
    if (ctx.shopId && p.storeOverrides?.[ctx.shopId]?.enabled === false) { refuse(p, "store_suspended", "suspendue dans ce magasin"); continue; }
    if (p.requiresCoupon && ctx.couponPromoId !== p.id) { refuse(p, "coupon_required", "un coupon valide est nécessaire"); continue; }
    const cr = p.customerRules; if (cr && (cr.categories.length || cr.customerIds.length || cr.loyalty.length || cr.newDays)) {
      const c = ctx.customer; const isNew = !!(cr.newDays && c?.createdAt && ctx.now.getTime() - Date.parse(c.createdAt) <= cr.newDays * 86_400_000);
      const ok = !!c && (cr.customerIds.includes(c.id) || cr.categories.includes(c.category ?? "") || cr.loyalty.includes(c.loyalty ?? "") || isNew);
      if (!ok) { refuse(p, "customer", c ? "réservée à d'autres clients" : "réservée à certains clients : identifiez le client"); continue; }
    }
    if (p.usageLimit !== undefined && p.usageCount >= p.usageLimit) { refuse(p, "limit", "limite d'utilisation atteinte"); continue; }
    if (p.perCustomerLimit !== undefined && (!ctx.customerId || (ctx.customerUses?.(p.id) ?? 0) >= p.perCustomerLimit)) { refuse(p, "per_customer", ctx.customerId ? "limite par client atteinte" : "limite par client : identifiez le client"); continue; }
    const budget = (ctx.shopId ? p.storeOverrides?.[ctx.shopId]?.budget : undefined) ?? p.budget; const used = ctx.budgetUsed?.(p.id, ctx.shopId) ?? 0;
    if (budget !== undefined && used >= budget) { refuse(p, "budget", "budget de la campagne épuisé"); continue; }
    if (p.minCart !== undefined && (familyOf(p) === "cart" ? eligibleBase : cartBase) < p.minCart) { refuse(p, "min_cart", `panier minimal non atteint (${fmt(p.minCart)})`); continue; }
    const c = candidate(p, lines, ctx); if ("refuse" in c) { if (c.refuse !== "none") refuse(p, c.refuse, c.message); continue; }
    let map = c.map; const fam = familyOf(p);
    // marge minimale sur le coût réel : lot refusé en entier, promotion par ligne ignorée ligne par ligne
    const bad = [...map].filter(([i, d]) => d > marginFloor(lines.find((l) => l.index === i)!, p, ctx));
    if (bad.length) { if (GROUP.has(fam)) { refuse(p, "margin", "prix final sous la marge minimale (ou coût de revient indisponible)"); continue; } for (const [i] of bad) map.delete(i); if (!map.size) { refuse(p, "margin", "prix final sous la marge minimale (ou coût de revient indisponible)"); continue; } }
    if (p.maxLinePct !== undefined) for (const [i, d] of map) map.set(i, Math.min(d, Math.floor(lines.find((l) => l.index === i)!.baseAmount * p.maxLinePct / 100)));
    let total = [...map.values()].reduce((a, d) => a + d, 0);
    if (p.maxCartDiscount !== undefined && total > p.maxCartDiscount) { map = spread(p.maxCartDiscount, [...map].map(([index, w]) => ({ index, w }))); total = p.maxCartDiscount; notes.push(`« ${p.name} » plafonnée à ${fmt(p.maxCartDiscount)} par panier`); }
    if (budget !== undefined && used + total > budget) { refuse(p, "budget", `le budget restant (${fmt(budget - used)}) ne couvre pas cette remise (${fmt(total)})`); continue; }
    if (total > 0) cands.push({ p, map, total, group: GROUP.has(fam) });
  }
  const typeIdx = (p: Promo) => { const i = rank.indexOf(familyOf(p)); return i < 0 ? 99 : i; };
  const byTotal = (a: Cand, b: Cand) => strategy === "priority" ? b.p.priority - a.p.priority || b.total - a.total || typeIdx(a.p) - typeIdx(b.p) || a.p.createdAt.localeCompare(b.p.createdAt) || a.p.id.localeCompare(b.p.id)
    : b.total - a.total || b.p.priority - a.p.priority || typeIdx(a.p) - typeIdx(b.p) || a.p.createdAt.localeCompare(b.p.createdAt) || a.p.id.localeCompare(b.p.id);
  const exclusive = cands.filter((c) => !c.p.stackable), stackables = cands.filter((c) => c.p.stackable);
  const claimed = new Map<number, Cand>(); const chosen = new Map<number, { cand: Cand; d: number }>(); const lost = (c: Cand, why: string, msg: string) => refuse(c.p, why, msg);
  // 1) lots : appliqués en entier ou pas du tout, face à la meilleure alternative par ligne
  const lineBest = (i: number) => exclusive.filter((c) => !c.group && c.map.has(i)).sort((a, b) => (strategy === "priority" ? b.p.priority - a.p.priority : 0) || b.map.get(i)! - a.map.get(i)! || b.p.priority - a.p.priority || typeIdx(a.p) - typeIdx(b.p))[0];
  for (const g of exclusive.filter((c) => c.group).sort(byTotal)) {
    const idx = [...g.map.keys()]; if (idx.some((i) => claimed.has(i))) { lost(g, "conflict", `articles déjà couverts par « ${claimed.get(idx.find((i) => claimed.has(i))!)!.p.name} »`); continue; }
    const alts = idx.map((i) => lineBest(i)); const altTotal = alts.reduce((a, c, k) => a + (c ? c.map.get(idx[k]!)! : 0), 0); const altPri = Math.max(-1, ...alts.map((c) => (c ? c.p.priority : -1)));
    const wins = strategy === "priority" ? g.p.priority > altPri || (g.p.priority === altPri && g.total >= altTotal) : g.total >= altTotal;
    if (!wins) { lost(g, "not_best", "une autre promotion est plus avantageuse pour ces articles"); continue; }
    for (const i of idx) { claimed.set(i, g); chosen.set(i, { cand: g, d: g.map.get(i)! }); }
  }
  // 2) promotions par ligne : la meilleure offre exclusive de chaque ligne libre
  for (const l of lines) {
    if (claimed.has(l.index)) continue; const best = exclusive.filter((c) => !c.group && c.map.has(l.index)).sort((a, b) => strategy === "priority" ? b.p.priority - a.p.priority || b.map.get(l.index)! - a.map.get(l.index)! || typeIdx(a.p) - typeIdx(b.p) || a.p.createdAt.localeCompare(b.p.createdAt) || a.p.id.localeCompare(b.p.id) : b.map.get(l.index)! - a.map.get(l.index)! || b.p.priority - a.p.priority || typeIdx(a.p) - typeIdx(b.p) || a.p.createdAt.localeCompare(b.p.createdAt) || a.p.id.localeCompare(b.p.id))[0];
    if (best) chosen.set(l.index, { cand: best, d: best.map.get(l.index)! });
  }
  // 3) cumul : uniquement entre promotions cumulables, par ordre de priorité, sur le montant restant ; comparé à la meilleure offre exclusive de la ligne
  const stacked = new Map<number, { parts: { cand: Cand; d: number }[]; total: number }>();
  for (const l of lines) {
    if (claimed.has(l.index)) continue; let rest = l.baseAmount; const parts: { cand: Cand; d: number }[] = [];
    for (const s of [...stackables].filter((c) => c.map.has(l.index)).sort((a, b) => b.p.priority - a.p.priority || typeIdx(a.p) - typeIdx(b.p) || a.p.createdAt.localeCompare(b.p.createdAt))) {
      const fam = familyOf(s.p); const orig = s.map.get(l.index)!; let d = orig;
      if (parts.length) { const ratio = (fam === "simple" || fam === "tiers" || fam === "requires" || fam === "cart") && s.p.kind === "percent" ? orig / l.baseAmount : orig / l.baseAmount; d = round(rest * ratio); } // cumul sur le montant restant
      d = Math.min(d, rest, Math.max(0, Math.min(marginFloor(l, s.p, ctx) - (l.baseAmount - rest), Infinity))); if (d > 0) { parts.push({ cand: s, d }); rest -= d; }
    }
    const tot = parts.reduce((a, x) => a + x.d, 0); if (tot > 0) stacked.set(l.index, { parts, total: tot });
  }
  const finalParts = new Map<number, { cand: Cand; d: number }[]>();
  for (const l of lines) {
    const ex = chosen.get(l.index), st = stacked.get(l.index);
    if (ex && (!st || ex.d >= st.total)) finalParts.set(l.index, [ex]); else if (st && (!ex || st.total > ex.d)) finalParts.set(l.index, st.parts);
    if (ex && st && st.total > ex.d && ex.cand.group) finalParts.set(l.index, [ex]);
  }
  // 4) plafonds de la boutique : par article, puis par panier
  const disc = new Map<number, number>(); for (const [i, ps] of finalParts) disc.set(i, ps.reduce((a, x) => a + x.d, 0));
  const scale = (i: number, newTotal: number) => { const ps = finalParts.get(i)!; const old = ps.reduce((a, x) => a + x.d, 0); if (old <= 0) return; let left = newTotal; ps.forEach((x, k) => { const nd = k === ps.length - 1 ? left : Math.floor(x.d * newTotal / old); x.d = nd; left -= nd; }); disc.set(i, newTotal); };
  if (ctx.maxLinePct !== undefined) for (const [i, d] of [...disc]) { const cap = Math.floor(lines.find((l) => l.index === i)!.baseAmount * ctx.maxLinePct / 100); if (d > cap) { scale(i, cap); notes.push(`remise de l'article plafonnée à ${ctx.maxLinePct} % (règle de la boutique)`); } }
  if (ctx.maxCartPct !== undefined) { const tot = [...disc.values()].reduce((a, d) => a + d, 0); const cap = Math.floor(cartBase * ctx.maxCartPct / 100); if (tot > cap) { const sp = spread(cap, [...disc].map(([index, w]) => ({ index, w }))); for (const [i, nd] of sp) scale(i, nd); notes.push(`remises du panier plafonnées à ${ctx.maxCartPct} % du panier (règle de la boutique)`); } }
  // 5) résultat, décisions et explications
  const outLines: EvalResult["lines"] = []; const by = new Map<string, { cand: Cand; discount: number; idx: number[] }>();
  for (const l of lines) {
    const ps = (finalParts.get(l.index) ?? []).filter((x) => x.d > 0); const parts = ps.map((x) => ({ promoId: x.cand.p.id, discount: x.d }));
    outLines.push({ index: l.index, ...(parts[0] ? { promoId: parts[0].promoId } : {}), discount: parts.reduce((a, x) => a + x.discount, 0), parts });
    for (const x of ps) { const a = by.get(x.cand.p.id) ?? { cand: x.cand, discount: 0, idx: [] }; a.discount += x.d; a.idx.push(l.index); by.set(x.cand.p.id, a); }
  }
  for (const [id, a] of by) decisions.push({ promoId: id, name: a.cand.p.name, ...(a.cand.p.code ? { code: a.cand.p.code } : {}), outcome: "applied", reason: "applied", message: a.cand.p.stackable && [...by.values()].some((o) => o !== a && o.cand.p.stackable && o.idx.some((i) => a.idx.includes(i))) ? "appliquée et cumulée avec une autre promotion cumulable" : "appliquée", discount: a.discount });
  for (const c of cands) if (!by.has(c.p.id) && !refused.has(c.p.id)) { const w = [...by.values()].find((a) => [...c.map.keys()].some((i) => a.idx.includes(i))); decisions.push({ promoId: c.p.id, name: c.p.name, ...(c.p.code ? { code: c.p.code } : {}), outcome: "refused", reason: "not_best", message: w ? `non retenue : « ${w.cand.p.name} » est plus ${strategy === "priority" ? "prioritaire" : "avantageuse"} pour ces articles (promotions non cumulables)` : "non retenue" }); }
  return {
    lines: outLines, applied: [...by].map(([promoId, a]) => ({ promoId, name: a.cand.p.name, ...(a.cand.p.code ? { code: a.cand.p.code } : {}), family: familyOf(a.cand.p), discount: a.discount, lineIndexes: a.idx })),
    skipped: decisions.filter((d) => d.outcome === "refused").map((d) => ({ promoId: d.promoId, reason: d.reason })), decisions, notes,
  };
}

/** Deux campagnes se chevauchent si leurs périodes se recouvrent ET qu'elles visent des articles/catégories/magasins communs. */
export function findOverlaps(promos: Promo[]): { a: string; b: string; why: string }[] {
  const out: { a: string; b: string; why: string }[] = []; const live = promos.filter((p) => p.status === "enabled" || p.status === "draft");
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i]!, b = live[j]!; if (!(Date.parse(a.startAt) < Date.parse(b.endAt) && Date.parse(b.startAt) < Date.parse(a.endAt))) continue;
    const ik = a.itemIds.filter((x) => b.itemIds.includes(x)).length; const cat = a.scope === "category" && b.scope === "category" && sameCat(a.category, b.category);
    const mixed = (a.scope === "category" && b.scope === "items") || (a.scope === "items" && b.scope === "category") || familyOf(a) === "cart" || familyOf(b) === "cart";
    const shops = (x: Promo) => (x.storeScope === "all" ? null : x.storeScope === "some" ? x.shopIds ?? [] : [x.homeShopId ?? ""]); const sa = shops(a), sb = shops(b); const shopCommon = sa === null || sb === null || sa.some((s) => sb.includes(s));
    if ((ik || cat || mixed) && shopCommon) out.push({ a: a.id, b: b.id, why: ik ? `${ik} article(s) en commun` : cat ? "même catégorie" : "portée large (catégorie ou panier)" });
  }
  return out;
}
