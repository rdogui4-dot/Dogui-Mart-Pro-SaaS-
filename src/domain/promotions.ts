import { MAX_AMOUNT } from "./articles";

/** Promotions (Business) : règles pures partagées par le serveur (qui fait foi) et l'interface (aperçu, formulaires). Montants en FCFA entiers. */
export const PROMO_KINDS = [{ id: "percent", label: "Remise en pourcentage" }, { id: "amount", label: "Remise en montant fixe" }, { id: "price", label: "Prix promotionnel" }] as const;
/** Un code promo regroupe 1 à N articles (ou toute une catégorie) avec UN type de remise ; il s'applique automatiquement à la caisse, sans saisie du client. */
export const PROMO_SCOPES = [{ id: "items", label: "Articles choisis" }, { id: "category", label: "Catégorie d'articles" }] as const;
export type PromoKind = (typeof PROMO_KINDS)[number]["id"]; export type PromoScope = "items" | "category";
export type StoredStatus = "draft" | "enabled" | "suspended" | "ended";
export type PromoStatus = "draft" | "scheduled" | "active" | "suspended" | "ended";
export const STATUS_LABEL: Record<PromoStatus, string> = { draft: "Brouillon", scheduled: "Programmée", active: "Active", suspended: "Suspendue", ended: "Terminée" };
export const MAX_PROMO_ITEMS = 200;

export type Promo = {
  id: string; name: string; description?: string; code?: string; kind: PromoKind; scope: PromoScope; value: number; category?: string; itemIds: string[];
  startAt: string; endAt: string; status: StoredStatus; minQty?: number; minCart?: number; usageLimit?: number; usageCount: number; perCustomerLimit?: number;
  priority: number; allowBelowMargin: boolean; createdAt: string;
};

/** Statut effectif : la date est contrôlée à chaque évaluation, jamais seulement mémorisée. */
export function promoStatus(p: Pick<Promo, "status" | "startAt" | "endAt">, now: Date = new Date()): PromoStatus {
  if (p.status === "draft") return "draft"; if (p.status === "suspended") return "suspended"; if (p.status === "ended") return "ended";
  const t = now.getTime(); if (t < Date.parse(p.startAt)) return "scheduled"; if (t >= Date.parse(p.endAt)) return "ended"; return "active";
}
export const normalizeCode = (raw: unknown): string => String(raw ?? "").trim().toUpperCase();

export type PromoInput = {
  name: string; description: string; code: string; kind: PromoKind; scope: PromoScope; value: number; category: string; startAt: string; endAt: string;
  minQty?: number; minCart?: number; usageLimit?: number; perCustomerLimit?: number; priority: number; allowBelowMargin: boolean;
};
const intIn = (raw: unknown, label: string, min: number, max: number): number => { const n = Number(String(raw).replace(/\s/g, "").replace(",", ".")); if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} invalide (entier de ${min} à ${max})`); return n; };
const opt = (raw: unknown): boolean => raw !== undefined && raw !== null && String(raw).trim() !== "";
const iso = (raw: unknown, label: string): string => { const ms = Date.parse(String(raw ?? "")); if (!opt(raw) || Number.isNaN(ms)) throw new Error(`${label} : date et heure obligatoires`); return new Date(ms).toISOString(); };

/** Valide et nettoie la saisie d'une promotion (même contrôle côté serveur). Lève une erreur lisible. */
export function parsePromotion(raw: Record<string, unknown>): PromoInput {
  const name = String(raw.name ?? "").trim(); if (name.length < 2 || name.length > 120) throw new Error("Nom de la promotion : 2 à 120 caractères");
  const description = String(raw.description ?? "").trim(); if (description.length > 500) throw new Error("Description : 500 caractères au plus");
  const code = normalizeCode(raw.code); if (code && !/^[A-Z0-9_-]{3,20}$/.test(code)) throw new Error("Code promo : 3 à 20 caractères (lettres, chiffres, - ou _)");
  const kind = raw.kind as PromoKind; if (!PROMO_KINDS.some((k) => k.id === kind)) throw new Error("Type de remise inconnu");
  const scope = (raw.scope ?? "items") as PromoScope; if (!PROMO_SCOPES.some((s) => s.id === scope)) throw new Error("Portée inconnue");
  if (kind === "price" && scope === "category") throw new Error("Un prix promotionnel se définit pour des articles précis, pas pour une catégorie");
  const value = kind === "percent" ? intIn(raw.value, "Pourcentage", 1, 100) : kind === "amount" ? intIn(raw.value, "Montant de la remise", 1, MAX_AMOUNT) : intIn(raw.value, "Prix promotionnel", 0, MAX_AMOUNT);
  const category = String(raw.category ?? "").trim(); if (scope === "category" && !category) throw new Error("Choisissez la catégorie concernée"); if (scope !== "category" && category) throw new Error("La catégorie ne concerne que les promotions sur catégorie");
  const startAt = iso(raw.startAt, "Début"), endAt = iso(raw.endAt, "Fin"); if (Date.parse(endAt) <= Date.parse(startAt)) throw new Error("La fin doit être postérieure au début");
  if (Date.parse(endAt) - Date.parse(startAt) > 366 * 86_400_000) throw new Error("Durée maximale d'une promotion : 366 jours");
  const out: PromoInput = { name, description, code, kind, scope, value, category, startAt, endAt, priority: opt(raw.priority) ? intIn(raw.priority, "Priorité", 0, 100) : 0, allowBelowMargin: raw.allowBelowMargin === true };
  if (opt(raw.minQty)) { const q = Number(String(raw.minQty).replace(",", ".")); if (!(q > 0) || q > 9999 || !/^\d+(\.\d{1,3})?$/.test(String(raw.minQty).trim().replace(",", "."))) throw new Error("Quantité minimale invalide"); out.minQty = q; }
  if (opt(raw.minCart)) out.minCart = intIn(raw.minCart, "Montant minimal du panier", 1, MAX_AMOUNT);
  if (opt(raw.usageLimit)) out.usageLimit = intIn(raw.usageLimit, "Limite d'utilisation", 1, 10_000_000);
  if (opt(raw.perCustomerLimit)) out.perCustomerLimit = intIn(raw.perCustomerLimit, "Limite par client", 1, 10_000);
  return out;
}

/** Résumé lisible de la remise (listes, aperçu). */
export const describeDiscount = (p: { kind: PromoKind; value: number }): string => (p.kind === "percent" ? `−${p.value} %` : p.kind === "amount" ? `−${p.value.toLocaleString("fr-FR")} FCFA` : `prix ${p.value.toLocaleString("fr-FR")} FCFA`);

export type EvalLine = { index: number; productId: string; category?: string; qty: number; baseAmount: number; unitCost?: number; eligible: boolean };
export type EvalCtx = { now: Date; customerId?: string; minMarginPct: number; customerUses?: (promoId: string) => number };
export type EvalResult = { lines: { index: number; promoId?: string; discount: number }[]; applied: { promoId: string; name: string; code?: string; discount: number; lineIndexes: number[] }[]; skipped: { promoId: string; reason: string }[] };

const round = Math.round;
/** Remise d'une promotion sur UNE ligne (jamais plus que la ligne, jamais négative). */
export function lineDiscount(p: Pick<Promo, "kind" | "value">, l: Pick<EvalLine, "qty" | "baseAmount">): number {
  const base = l.baseAmount; if (!(base > 0)) return 0;
  let d = 0;
  if (p.kind === "percent") d = round(base * p.value / 100);
  else if (p.kind === "amount") d = round(p.value * l.qty);
  else d = base - round(p.value * l.qty);
  return Math.max(0, Math.min(base, d));
}

/** Choisit, pour chaque ligne, LA meilleure promotion applicable (jamais deux : pas de cumul). Départage : plus forte remise, puis priorité, puis la plus ancienne.
 *  Le code promo n'est PAS saisi par le client : il s'applique automatiquement aux articles qu'il regroupe. Une promotion n'est applicable que si : active à cet instant, limite globale non atteinte, limite par client, panier minimal,
 *  quantité minimale, ligne éligible (prix de base, sans remise manuelle) et prix final au moins égal à la marge minimale (sauf autorisation explicite). */
export function evaluatePromotions(promos: Promo[], lines: EvalLine[], ctx: EvalCtx): EvalResult {
  const cartBase = lines.reduce((a, l) => a + l.baseAmount, 0); const skipped: EvalResult["skipped"] = [];
  const usable = promos.filter((p) => {
    const why = promoStatus(p, ctx.now) !== "active" ? "non active" : p.usageLimit !== undefined && p.usageCount >= p.usageLimit ? "limite d'utilisation atteinte"
      : p.perCustomerLimit !== undefined && (!ctx.customerId || (ctx.customerUses?.(p.id) ?? 0) >= p.perCustomerLimit) ? "limite par client" : p.minCart !== undefined && cartBase < p.minCart ? "panier minimal non atteint" : "";
    if (why) skipped.push({ promoId: p.id, reason: why }); return !why;
  });
  const cand = new Map<number, { p: Promo; discount: number }[]>();
  for (const p of usable) {
    const elig = lines.filter((l) => l.eligible && l.baseAmount > 0 && (p.scope === "items" ? p.itemIds.includes(l.productId) : (l.category ?? "").toLowerCase() === (p.category ?? "").toLowerCase()) && (p.minQty === undefined || l.qty >= p.minQty));
    for (const l of elig) {
      const d = lineDiscount(p, l); if (d <= 0) continue;
      if (!p.allowBelowMargin && l.unitCost && l.unitCost > 0 && (l.baseAmount - d) / l.qty < l.unitCost * (1 + ctx.minMarginPct / 100)) { skipped.push({ promoId: p.id, reason: "marge minimale" }); continue; }
      (cand.get(l.index) ?? cand.set(l.index, []).get(l.index)!).push({ p, discount: d });
    }
  }
  const out: EvalResult["lines"] = []; const by = new Map<string, { name: string; code?: string; discount: number; idx: number[] }>();
  for (const l of lines) {
    const best = (cand.get(l.index) ?? []).sort((a, b) => b.discount - a.discount || b.p.priority - a.p.priority || a.p.createdAt.localeCompare(b.p.createdAt) || a.p.id.localeCompare(b.p.id))[0];
    if (!best) { out.push({ index: l.index, discount: 0 }); continue; }
    out.push({ index: l.index, promoId: best.p.id, discount: best.discount });
    const a = by.get(best.p.id) ?? { name: best.p.name, code: best.p.code, discount: 0, idx: [] }; a.discount += best.discount; a.idx.push(l.index); by.set(best.p.id, a);
  }
  return { lines: out, applied: [...by].map(([promoId, a]) => ({ promoId, name: a.name, ...(a.code ? { code: a.code } : {}), discount: a.discount, lineIndexes: a.idx })), skipped };
}
