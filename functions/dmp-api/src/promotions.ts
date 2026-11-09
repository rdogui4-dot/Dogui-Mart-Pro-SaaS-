import { createHash } from "node:crypto";
import { describeDiscount, evaluatePromotions, parsePromotion, promoStatus, STATUS_LABEL, MAX_PROMO_ITEMS, MAX_COMBO, normalizeCode, isAdvanced, familyOf, DEFAULT_TYPE_RANK, FAMILIES, type EvalLine, type EvalResult, type Family, type Promo, type PromoInput, type StoreOverride } from "../../../src/domain/promotions";
import { tierFor } from "../../../src/domain/loyalty";
import { planAllows } from "../../../src/domain/features";
import { entitlementOf } from "./subscriptions";
import { needFeature } from "./articles";
import { HttpError, need, needModule, type Ctx, type Row, type Store } from "./store";

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 30);
const sha = (s: string) => createHash("sha1").update(s).digest("hex");
const mine = (ctx: Ctx, r: Row | null): r is Row => !!r && r.tenantId === ctx.tenantId && r.shopId === ctx.shopId;
const audit = (store: Store, ctx: Ctx, action: string, detail: string) => store.create("audit_log", newId(), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action, detail: detail.slice(0, 1000) });
const J = <T,>(s: unknown, fb: T): T => { try { const v = JSON.parse(String(s)); return v ?? fb; } catch { return fb; } };
const iso = (v: unknown): string => new Date(String(v)).toISOString();
const num = (v: unknown): number | undefined => (v == null || v === "" ? undefined : Number(v));

/** Formule Pro (promotions avancées) ? Déterminée côté serveur à chaque évaluation. */
export async function promoPro(store: Store, ctx: Ctx): Promise<boolean> { return planAllows((await entitlementOf(store, ctx.tenantId)).plan.id, "promotionsPro"); }

export const itemRowId = (promotionId: string, productId: string, role = "target"): string => `i${sha(`${promotionId}|${productId}${role === "target" ? "" : `|${role}`}`).slice(0, 30)}`;
const condRowId = (promotionId: string, kind: string, k: string): string => `c${sha(`${promotionId}|${kind}|${k}`).slice(0, 30)}`;
const groupRowId = (promotionId: string, kind: string, v: string): string => `g${sha(`${promotionId}|${kind}|${v}`).slice(0, 30)}`;
const ruleRowId = (promotionId: string, shopId: string): string => `r${sha(`${promotionId}|${shopId}`).slice(0, 30)}`;
const usageId = (promotionId: string, key: string): string => `u${sha(`${promotionId}|${key}`).slice(0, 30)}`;
const couponUseId = (couponId: string, key: string): string => `k${sha(`${couponId}|${key}`).slice(0, 30)}`;
const skuKey = (sku: unknown): string => `sku:${String(sku)}`;

type Kids = { items: Row[]; conds: Row[]; groups: Row[]; rules: Row[] };
async function loadKids(store: Store, ctx: Ctx, ids: string[]): Promise<Kids> {
  if (!ids.length) return { items: [], conds: [], groups: [], rules: [] };
  const set = new Set(ids); const w = { tenantId: ctx.tenantId };
  const get = async (t: string) => (await store.scan(t, w, { maxRows: 100_000 })).rows.filter((x) => set.has(String(x.promotionId)));
  const [items, conds, groups, rules] = await Promise.all([get("promotion_items"), get("promotion_conditions"), get("promotion_customer_groups"), get("promotion_store_rules")]);
  return { items, conds, groups, rules };
}
const keyOfItem = (r: Row): string => (r.sku ? skuKey(r.sku) : String(r.productId));

/** Reconstruit une campagne (moteur partagé) depuis ses lignes. */
export function rowToPromo(r: Row, k: Kids): Promo {
  const mineOf = <T extends Row>(rows: T[]) => rows.filter((x) => x.promotionId === r.$id);
  const itemIds: string[] = [], excludeIds: string[] = [], requireItems: { key: string; qty: number }[] = [], comboItems: { key: string; qty: number }[] = [];
  for (const it of mineOf(k.items)) {
    const role = String(it.role || "target");
    if (role === "target") { itemIds.push(String(it.productId)); if (it.sku) itemIds.push(skuKey(it.sku)); }
    else if (role === "exclude") excludeIds.push(String(it.productId), ...(it.sku ? [skuKey(it.sku)] : []));
    else if (role === "require") requireItems.push({ key: keyOfItem(it), qty: Number(it.qty ?? 1) });
    else if (role === "combo") comboItems.push({ key: keyOfItem(it), qty: Number(it.qty ?? 1) });
  }
  const tiers = mineOf(k.conds).filter((c) => c.kind === "tier").map((c) => ({ minQty: Number(c.minQty), kind: String(c.valueKind) as Promo["kind"], value: Number(c.value) })).sort((a, b) => a.minQty - b.minQty);
  const bogoRow = mineOf(k.conds).find((c) => c.kind === "bogo"); const bogo = bogoRow ? J<{ buy: number; get: number; pct: number } | undefined>(bogoRow.params, undefined) : undefined;
  const groups = mineOf(k.groups); const cr = { categories: groups.filter((g) => g.kind === "category").map((g) => String(g.value)), customerIds: groups.filter((g) => g.kind === "customer").map((g) => String(g.value)), loyalty: groups.filter((g) => g.kind === "loyalty").map((g) => String(g.value)), ...(groups.find((g) => g.kind === "new")?.days ? { newDays: Number(groups.find((g) => g.kind === "new")!.days) } : {}) };
  const storeOverrides: Record<string, StoreOverride> = {}; for (const x of mineOf(k.rules)) storeOverrides[String(x.targetShopId)] = { enabled: x.enabled !== false, ...(num(x.value) !== undefined ? { value: num(x.value) } : {}), ...(num(x.budget) !== undefined ? { budget: num(x.budget) } : {}) };
  const family = (r.family ? String(r.family) : "simple") as Family;
  return { id: r.$id, name: String(r.name), description: r.description ? String(r.description) : undefined, objective: r.objective ? String(r.objective) : undefined, code: r.code ? String(r.code) : undefined, family, kind: r.kind, scope: r.scope, value: Number(r.discountValue), category: r.category ? String(r.category) : undefined,
    itemIds, excludeIds, requireItems, comboItems, tiers, tierBasis: r.tierBasis === "cumulative" ? "cumulative" : "line", ...(bogo ? { bogo } : {}),
    startAt: iso(r.startAt), endAt: iso(r.endAt), status: r.status, minQty: num(r.minQty), minCart: num(r.minCart), usageLimit: num(r.usageLimit), usageCount: Number(r.usageCount ?? 0), perCustomerLimit: num(r.perCustomerLimit),
    priority: Number(r.priority ?? 0), allowBelowMargin: r.allowBelowMargin === true, createdAt: String(r.createdOn ?? r.$createdAt ?? ""),
    stackable: r.stackable === true, maxLinePct: num(r.maxLinePct), maxCartDiscount: num(r.maxCartDiscount), budget: num(r.budget), minMarginPct: num(r.minMarginPct), requiresCoupon: r.requiresCoupon === true,
    storeScope: (r.storeScope ? String(r.storeScope) : "this") as Promo["storeScope"], homeShopId: String(r.shopId), shopIds: J<string[]>(r.shopIds, []), storeOverrides, customerRules: cr };
}

/** Campagnes activées (statut mémorisé « enabled ») qui peuvent s'appliquer DANS CETTE BOUTIQUE : les siennes + celles des autres boutiques du commerce qui la visent. */
export async function loadEnabledPromotions(store: Store, ctx: Ctx): Promise<Promo[]> {
  const all = (await store.scan("promotions", { tenantId: ctx.tenantId, status: "enabled" }, { maxRows: 5000 })).rows;
  const rows = all.filter((r) => r.shopId === ctx.shopId || r.storeScope === "all" || (r.storeScope === "some" && J<string[]>(r.shopIds, []).includes(ctx.shopId)));
  if (!rows.length) return [];
  const k = await loadKids(store, ctx, rows.map((r) => r.$id)); return rows.map((r) => rowToPromo(r, k));
}
export async function loadPromo(store: Store, ctx: Ctx, row: Row): Promise<Promo> { return rowToPromo(row, await loadKids(store, ctx, [row.$id])); }

// ------------------------------------------------------------------ coupons (Pro)
export type CouponCheck = { ok: boolean; code: string; reason?: string; message: string; couponId?: string; promotionId?: string };
const COUPON_MSG: Record<string, string> = { unknown: "code inconnu", inactive: "coupon désactivé", not_started: "coupon pas encore valable", expired: "coupon expiré", customer: "coupon réservé à un autre client", customer_required: "coupon réservé à un client : identifiez-le", used_up: "coupon déjà utilisé (limite atteinte)", promo_unavailable: "la campagne liée n'est pas applicable ici (inactive, terminée ou hors magasin)" };
export async function checkCoupon(store: Store, ctx: Ctx, rawCode: string, o: { customerId?: string; now: Date; promos: Promo[] }): Promise<CouponCheck & { coupon?: Row }> {
  const code = normalizeCode(rawCode); const bad = (reason: string, c?: Row) => ({ ok: false, code, reason, message: `Coupon ${code} : ${COUPON_MSG[reason]}`, ...(c ? { couponId: c.$id, promotionId: String(c.promotionId) } : {}) });
  const c = (await store.list("promotion_coupons", { tenantId: ctx.tenantId, code }, 5))[0]; if (!c) return bad("unknown");
  if (c.active === false) return bad("inactive", c);
  const t = o.now.getTime(); if (c.validFrom && t < Date.parse(String(c.validFrom))) return bad("not_started", c); if (c.validTo && t >= Date.parse(String(c.validTo))) return bad("expired", c);
  if (c.customerId) { if (!o.customerId) return bad("customer_required", c); if (c.customerId !== o.customerId) return bad("customer", c); }
  const cap = c.singleUse ? 1 : num(c.maxUses); if (cap !== undefined && Number(c.usedCount ?? 0) >= cap) return bad("used_up", c);
  if (!o.promos.some((p) => p.id === c.promotionId)) return bad("promo_unavailable", c);
  return { ok: true, code, message: `Coupon ${code} accepté`, couponId: c.$id, promotionId: String(c.promotionId), coupon: c };
}
/** Tentative invalide : tracée (jamais bloquante pour la vente elle-même). */
export async function logInvalidCoupon(store: Store, ctx: Ctx, chk: CouponCheck, customerId?: string): Promise<void> {
  await store.create("promotion_coupon_usage", newId(), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, couponId: chk.couponId ?? "", promotionId: chk.promotionId ?? "", code: chk.code.slice(0, 24), outcome: "invalid", reason: chk.reason ?? "unknown", customerId: customerId ?? "", userId: ctx.userId, usedAt: new Date().toISOString() });
}
/** Réserve une utilisation du coupon pour une vente (limite atomique par « slot » à identifiant unique). Rejouable : une reprise de la même vente ne consomme rien. Renvoie l'id créé (à annuler si la vente échoue), "" si déjà enregistrée. */
export async function useCoupon(store: Store, ctx: Ctx, c: Row, u: { saleId: string; customerId?: string; usedAt: string }): Promise<string> {
  const prior = (await store.list("promotion_coupon_usage", { couponId: c.$id, saleId: u.saleId }, 1))[0]; if (prior) return "";
  const cap = c.singleUse ? 1 : num(c.maxUses); const data = (slot: number) => ({ tenantId: ctx.tenantId, shopId: ctx.shopId, couponId: c.$id, promotionId: String(c.promotionId), code: String(c.code), outcome: "used", saleId: u.saleId, customerId: u.customerId ?? "", slot, userId: ctx.userId, usedAt: u.usedAt });
  let id = "", slot = 0;
  if (cap !== undefined) { for (let n = Math.max(1, Number(c.usedCount ?? 0) + 1); n <= cap && !id; n++) { const rid = couponUseId(c.$id, `slot${n}`); if (await store.create("promotion_coupon_usage", rid, ctx.tenantId, data(n))) { id = rid; slot = n; } else if ((await store.list("promotion_coupon_usage", { couponId: c.$id, saleId: u.saleId }, 1))[0]) return ""; } if (!id) throw new HttpError(409, `Coupon ${c.code} déjà utilisé : sa limite vient d'être atteinte. Relancez la vente.`); }
  else { id = couponUseId(c.$id, `sale${u.saleId}`); if (!(await store.create("promotion_coupon_usage", id, ctx.tenantId, data(0)))) return ""; }
  const cur = await store.get("promotion_coupons", c.$id); if (cur) await store.update("promotion_coupons", c.$id, { usedCount: Math.max(Number(cur.usedCount ?? 0) + (slot ? 0 : 1), slot) });
  return id;
}

// ------------------------------------------------------------------ évaluation à la vente
export type SaleEval = EvalResult & { promos: Promo[]; coupon?: CouponCheck & { coupon?: Row }; pro: boolean };
const EMPTY_LINES = (lines: EvalLine[]) => lines.map((l) => ({ index: l.index, discount: 0, parts: [] as { promoId: string; discount: number }[] }));
/** Évaluation côté serveur : campagnes actives du magasin, client (catégorie, fidélité, ancienneté), coupon, budgets consommés, plafonds de la boutique. L'interface ne calcule jamais seule. */
export async function evaluateForSale(store: Store, ctx: Ctx, lines: EvalLine[], o: { customerId?: string; now: Date; couponCode?: string; pro?: boolean }): Promise<SaleEval> {
  const pro = o.pro ?? await promoPro(store, ctx); const promos = await loadEnabledPromotions(store, ctx);
  let coupon: SaleEval["coupon"]; if (o.couponCode) { if (!pro) throw new HttpError(402, "Les coupons sont réservés à la formule Pro."); coupon = await checkCoupon(store, ctx, o.couponCode, { customerId: o.customerId, now: o.now, promos }); }
  if (!promos.length) return { lines: EMPTY_LINES(lines), applied: [], skipped: [], decisions: [], notes: [], promos, coupon, pro };
  const shop = await store.get("shops", ctx.shopId.slice(0, 36)); const uses = new Map<string, number>(); const used = new Map<string, number>();
  const crow = o.customerId ? await store.get("customers", o.customerId) : null;
  const customer = crow ? { id: crow.$id, category: crow.category ? String(crow.category) : undefined, loyalty: tierFor(Number(crow.annualSpend ?? 0)), createdAt: crow.$createdAt ? String(crow.$createdAt) : undefined } : undefined;
  for (const p of promos) {
    if (o.customerId && p.perCustomerLimit !== undefined) uses.set(p.id, (await store.list("promotion_usage", { promotionId: p.id, customerId: o.customerId }, 1000)).length);
    if (p.budget !== undefined || Object.values(p.storeOverrides ?? {}).some((x) => x.budget !== undefined)) { for (const u of (await store.scan("promotion_usage", { promotionId: p.id }, { maxRows: 100_000 })).rows) { used.set(p.id, (used.get(p.id) ?? 0) + Number(u.discount ?? 0)); const k = `${p.id}|${u.shopId}`; used.set(k, (used.get(k) ?? 0) + Number(u.discount ?? 0)); } }
  }
  const rank = String(shop?.promoTypeRank ?? "").split(",").filter((x) => FAMILIES.some((f) => f.id === x)) as Family[];
  const res = evaluatePromotions(promos, lines, { now: o.now, customerId: o.customerId, customer, shopId: ctx.shopId, pro, minMarginPct: Number(shop?.minMarginPct ?? 0), customerUses: (id) => uses.get(id) ?? 0,
    couponPromoId: coupon?.ok ? coupon.promotionId : undefined, budgetUsed: (id, sh) => { const ov = sh ? promos.find((p) => p.id === id)?.storeOverrides?.[sh]?.budget : undefined; return (ov !== undefined && sh ? used.get(`${id}|${sh}`) : used.get(id)) ?? 0; },
    ...(pro && shop?.promoMaxLinePct != null ? { maxLinePct: Number(shop.promoMaxLinePct) } : {}), ...(pro && shop?.promoMaxCartPct != null ? { maxCartPct: Number(shop.promoMaxCartPct) } : {}),
    ...(pro && shop?.promoStrategy === "priority" ? { strategy: "priority" as const } : {}), ...(pro && rank.length ? { typeRank: [...rank, ...DEFAULT_TYPE_RANK.filter((f) => !rank.includes(f))] } : {}) });
  return { ...res, promos, coupon, pro };
}

/** Réserve l'utilisation d'une campagne pour une vente et l'enregistre (traçable, liée à la vente, avec instantané des règles). Limite globale : réservation par « slot » à identifiant unique.
 *  Budget : vérifié après écriture (en cas de dépassement simultané, l'utilisation est annulée : jamais de dépassement silencieux). Rejouable : une reprise retrouve sa ligne. Renvoie l'id créé (à annuler en cas d'échec) ou "". */
export async function recordUsage(store: Store, ctx: Ctx, p: { id: string; usageLimit?: number; usageCount: number; code?: string; budget?: number; storeBudget?: number }, u: { saleId: string; saleNumber: string; customerId?: string; discount: number; baseAmount: number; lines: object[]; usedAt: string; couponId?: string; family?: string; rules?: object; decisions?: object[] }): Promise<string> {
  const prior = (await store.list("promotion_usage", { promotionId: p.id, saleId: u.saleId }, 1))[0]; if (prior) return "";
  const data = (slot: number) => ({ tenantId: ctx.tenantId, shopId: ctx.shopId, promotionId: p.id, saleId: u.saleId, saleNumber: u.saleNumber, customerId: u.customerId ?? "", code: p.code ?? "", discount: u.discount, baseAmount: u.baseAmount, finalAmount: u.baseAmount - u.discount, lines: JSON.stringify(u.lines), slot, userId: ctx.userId, usedAt: u.usedAt,
    couponId: u.couponId ?? "", family: u.family ?? "simple", rules: JSON.stringify(u.rules ?? {}).slice(0, 60_000), decisions: JSON.stringify(u.decisions ?? []).slice(0, 60_000) });
  let id = "", slot = 0;
  if (p.usageLimit !== undefined) {
    for (let n = Math.max(1, p.usageCount + 1); n <= p.usageLimit && !id; n++) { const rid = usageId(p.id, `slot${n}`); if (await store.create("promotion_usage", rid, ctx.tenantId, data(n))) { id = rid; slot = n; } else if ((await store.list("promotion_usage", { promotionId: p.id, saleId: u.saleId }, 1))[0]) return ""; }
    if (!id) throw new HttpError(409, "Promotion épuisée : sa limite d'utilisation vient d'être atteinte. Relancez la vente.");
  } else { id = usageId(p.id, `sale${u.saleId}`); if (!(await store.create("promotion_usage", id, ctx.tenantId, data(0)))) return ""; }
  if (p.budget !== undefined || p.storeBudget !== undefined) {
    const rows = (await store.scan("promotion_usage", { promotionId: p.id }, { maxRows: 100_000 })).rows;
    const tot = rows.reduce((a, r) => a + Number(r.discount ?? 0), 0), here = rows.filter((r) => r.shopId === ctx.shopId).reduce((a, r) => a + Number(r.discount ?? 0), 0);
    if ((p.storeBudget !== undefined && here > p.storeBudget) || (p.storeBudget === undefined && p.budget !== undefined && tot > p.budget)) { await store.remove("promotion_usage", id); throw new HttpError(409, "Budget de la campagne épuisé : la remise ne peut plus être accordée. Relancez la vente."); }
  }
  const cur = await store.get("promotions", p.id); if (cur) await store.update("promotions", p.id, { usageCount: Math.max(Number(cur.usageCount ?? 0) + (slot ? 0 : 1), slot) });
  return id;
}

/** Annule une utilisation créée pour une vente qui échoue, et recalcule le compteur à partir des lignes réelles (jamais de « slot » perdu). */
export async function releaseUsage(store: Store, promotionId: string, usageRowId: string): Promise<void> {
  await store.remove("promotion_usage", usageRowId); const cur = await store.get("promotions", promotionId);
  if (cur) await store.update("promotions", promotionId, { usageCount: (await store.list("promotion_usage", { promotionId }, 100_000)).length });
}
export async function releaseCoupon(store: Store, couponId: string, usageRowId: string): Promise<void> {
  await store.remove("promotion_coupon_usage", usageRowId); const cur = await store.get("promotion_coupons", couponId);
  if (cur) await store.update("promotion_coupons", couponId, { usedCount: (await store.list("promotion_coupon_usage", { couponId, outcome: "used" }, 100_000)).length });
}

// ------------------------------------------------------------------ gestion
type QtyRef = { productId: string; qty?: number };
type SaveInput = { id?: string; requestId?: string; data: Record<string, unknown>; productIds?: unknown; excludeIds?: unknown; requireItems?: unknown; comboItems?: unknown; shopIds?: unknown };
const worst = (price: number, kind: string, value: number): number => (kind === "percent" ? price * (1 - value / 100) : kind === "amount" ? price - value : value);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? [...new Set((v as unknown[]).map(String))] : []);
const qtyRefs = (v: unknown, label: string): QtyRef[] => { if (v == null) return []; if (!Array.isArray(v)) throw new HttpError(400, `${label} : liste invalide`); const seen = new Set<string>(); return (v as QtyRef[]).map((x) => { const q = Number(x?.qty ?? 1); if (!x?.productId || !Number.isInteger(q) || q < 1 || q > 1000) throw new HttpError(400, `${label} : article et quantité entière (1 à 1000) obligatoires`); if (seen.has(x.productId)) throw new HttpError(400, `${label} : article en double`); seen.add(x.productId); return { productId: String(x.productId), qty: q }; }); };
type KidRow = { table: string; id: string; data: Record<string, unknown> };
const sigOf = (rows: { t: string; v: unknown[] }[]) => rows.map((r) => `${r.t}|${r.v.join("|")}`).sort().join("\n");

/** Création / modification d'une campagne (gérant ou propriétaire). Business : remise simple ; Pro : familles avancées et options (contrôle serveur). Brouillon à la création.
 *  Une campagne déjà utilisée garde sa DÉFINITION de remise (type, valeur, portée, articles, paliers, lots, code) : on en crée une nouvelle. */
export async function savePromotion(store: Store, ctx: Ctx, b: SaveInput) {
  needModule(ctx, "stock"); need(ctx, "manager"); await needFeature(store, ctx, "promotions");
  let input: PromoInput; try { input = parsePromotion(b.data ?? {}); } catch (e) { throw new HttpError(400, (e as Error).message); }
  const fam = input.family; const ids = strArr(b.productIds); const excl = strArr(b.excludeIds); const req = qtyRefs(b.requireItems, "Articles requis"); const combo = qtyRefs(b.comboItems, "Articles du pack"); const shopIds = strArr(b.shopIds);
  const targeted = fam === "simple" || fam === "tiers" || fam === "bogo";
  if (targeted && input.scope === "items" && !ids.length) throw new HttpError(400, "Sélectionnez au moins un article concerné");
  if ((input.scope !== "items" || !(targeted || fam === "requires")) && ids.length) throw new HttpError(400, "Les articles ne se choisissent que pour une promotion « articles choisis »");
  if (ids.length > MAX_PROMO_ITEMS || excl.length > MAX_PROMO_ITEMS) throw new HttpError(400, `${MAX_PROMO_ITEMS} articles au maximum`);
  if (fam === "combo") { if (!combo.length || combo.reduce((a, c) => a + (c.qty ?? 1), 0) < 2) throw new HttpError(400, "Un pack contient au moins 2 articles (ou 2 unités)"); if (combo.length > MAX_COMBO) throw new HttpError(400, `${MAX_COMBO} articles au maximum par pack`); } else if (combo.length) throw new HttpError(400, "Les articles de pack ne concernent que les packs");
  if (fam === "requires") { if (!req.length) throw new HttpError(400, "Indiquez au moins un article requis"); } else if (req.length) throw new HttpError(400, "Les articles requis ne concernent que les remises conditionnées");
  if (excl.some((x) => ids.includes(x))) throw new HttpError(400, "Un article ne peut pas être à la fois concerné et exclu");
  if (input.storeScope === "some" && !shopIds.length) throw new HttpError(400, "Choisissez au moins un magasin");
  if (input.storeScope !== "some" && shopIds.length) throw new HttpError(400, "Les magasins ne se choisissent que pour une campagne « magasins choisis »");
  for (const sid of shopIds) { const sh = await store.get("shops", sid.slice(0, 36)); if (!sh || sh.tenantId !== ctx.tenantId) throw new HttpError(404, "Magasin introuvable"); }
  const cr = input.customerRules; for (const cid of cr.customerIds) { const c = await store.get("customers", cid); if (!c || c.tenantId !== ctx.tenantId) throw new HttpError(404, "Client ciblé introuvable"); }
  // droits d'abonnement : toute fonction avancée exige Pro (contrôle serveur)
  if (isAdvanced({ family: fam, stackable: input.stackable, storeScope: input.storeScope, customerRules: cr, requiresCoupon: input.requiresCoupon, budget: input.budget, maxLinePct: input.maxLinePct, maxCartDiscount: input.maxCartDiscount, minMarginPct: input.minMarginPct, excludeIds: excl })) await needFeature(store, ctx, "promotionsPro");
  const refIds = [...new Set([...ids, ...excl, ...req.map((r) => r.productId), ...combo.map((c) => c.productId)])]; const prods = new Map<string, Row>();
  for (const pid of refIds) { const p = await store.get("products", pid); if (!mine(ctx, p)) throw new HttpError(404, "Article introuvable dans cette boutique"); if (p.archived) throw new HttpError(409, `${p.name} est archivé`); prods.set(pid, p); }
  // Le code promo est l'identifiant de la campagne (appliquée automatiquement) : généré s'il n'est pas saisi, unique parmi les campagnes non terminées du commerce
  if (!input.code && b.id) { const c0 = await store.get("promotions", b.id); if (mine(ctx, c0) && c0.code) input.code = String(c0.code); }
  if (!input.code) { const base = input.name.normalize("NFD").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6) || "PROMO"; for (let i = 0; i < 20 && !input.code; i++) { const c = `${base}${String(Math.floor(Math.random() * 900) + 100)}`; if (!(await store.list("promotions", { tenantId: ctx.tenantId, code: c }, 1)).length) input.code = c; } if (!input.code) throw new HttpError(409, "Impossible de générer un code : saisissez-en un"); }
  { const same = (await store.list("promotions", { tenantId: ctx.tenantId, code: input.code }, 20)).filter((r) => r.$id !== b.id && r.status !== "ended"); if (same.length) throw new HttpError(409, `Le code ${input.code} est déjà utilisé par « ${same[0]!.name} »`); }
  // contrôle de marge à l'enregistrement (remises simples et paliers) ; les lots/packs/panier sont protégés à la vente par le plancher de marge sur le coût réel
  if (!input.allowBelowMargin && (fam === "simple" || fam === "tiers" || fam === "requires")) {
    const shop = await store.get("shops", ctx.shopId.slice(0, 36)); const m = 1 + (input.minMarginPct ?? Number(shop?.minMarginPct ?? 0)) / 100;
    const targets = fam === "requires" ? [...prods.values()].filter((p) => (ids.length ? ids.includes(p.$id) : req.some((r) => r.productId === p.$id))) : input.scope === "items" ? ids.map((x) => prods.get(x)!) : (await store.scan("products", { tenantId: ctx.tenantId, shopId: ctx.shopId }, { maxRows: 10_000 })).rows.filter((p) => !p.archived && String(p.category ?? "").toLowerCase() === input.category.toLowerCase());
    const offers = fam === "tiers" ? input.tiers.map((t) => ({ kind: t.kind, value: t.value })) : [{ kind: input.kind, value: input.value }];
    for (const p of targets) {
      const subs = p.hasVariants ? (await store.list("article_variants", { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: p.$id }, 200)).filter((v) => !v.archived) : [p];
      for (const v of subs) for (const o of offers) { const cost = Number(v.cost ?? 0); const final = worst(Number(v.price), o.kind, o.value); if (final < 0 || (cost > 0 && final < cost * m)) throw new HttpError(409, `${p.name}${v === p ? "" : ` — ${v.label}`} serait vendu sous la marge minimale (prix final ${Math.max(0, Math.round(final))} pour un coût de ${cost}). Réduisez la remise ou autorisez explicitement la vente sous la marge.`); }
    }
  }
  const row = { name: input.name, description: input.description, objective: input.objective, code: input.code, family: fam, kind: input.kind, scope: fam === "cart" || fam === "combo" ? "items" : input.scope, discountValue: input.value, category: input.category, startAt: input.startAt, endAt: input.endAt, minQty: input.minQty ?? null, minCart: input.minCart ?? null, usageLimit: input.usageLimit ?? null, perCustomerLimit: input.perCustomerLimit ?? null, priority: input.priority, allowBelowMargin: input.allowBelowMargin,
    stackable: input.stackable, maxLinePct: input.maxLinePct ?? null, maxCartDiscount: input.maxCartDiscount ?? null, budget: input.budget ?? null, minMarginPct: input.minMarginPct ?? null, requiresCoupon: input.requiresCoupon, storeScope: input.storeScope, shopIds: JSON.stringify(shopIds), tierBasis: input.tierBasis };
  const mk = (promoId: string) => {
    const kids: KidRow[] = []; const sku = (pid: string) => (prods.get(pid)?.sku ? String(prods.get(pid)!.sku) : "");
    const item = (role: string, r: QtyRef) => kids.push({ table: "promotion_items", id: itemRowId(promoId, r.productId, role), data: { tenantId: ctx.tenantId, shopId: ctx.shopId, promotionId: promoId, productId: r.productId, role, qty: r.qty ?? 1, sku: sku(r.productId) } });
    for (const x of ids) item("target", { productId: x }); for (const x of excl) item("exclude", { productId: x }); for (const r of req) item("require", r); for (const c of combo) item("combo", c);
    for (const t of input.tiers) kids.push({ table: "promotion_conditions", id: condRowId(promoId, "tier", String(t.minQty)), data: { tenantId: ctx.tenantId, shopId: ctx.shopId, promotionId: promoId, kind: "tier", minQty: t.minQty, valueKind: t.kind, value: t.value } });
    if (input.bogo) kids.push({ table: "promotion_conditions", id: condRowId(promoId, "bogo", "1"), data: { tenantId: ctx.tenantId, shopId: ctx.shopId, promotionId: promoId, kind: "bogo", params: JSON.stringify(input.bogo) } });
    const g = (kind: string, value: string, days?: number) => kids.push({ table: "promotion_customer_groups", id: groupRowId(promoId, kind, value), data: { tenantId: ctx.tenantId, shopId: ctx.shopId, promotionId: promoId, kind, value, ...(days ? { days } : {}) } });
    for (const x of cr.categories) g("category", x); for (const x of cr.customerIds) g("customer", x); for (const x of cr.loyalty) g("loyalty", x); if (cr.newDays) g("new", "new", cr.newDays);
    return kids;
  };
  const defSig = (kids: KidRow[]) => sigOf(kids.filter((k) => k.table !== "promotion_customer_groups").map((k) => ({ t: k.table, v: [k.data.role ?? k.data.kind, k.data.productId ?? "", k.data.qty ?? k.data.minQty ?? "", k.data.valueKind ?? "", k.data.value ?? "", k.data.params ?? ""] })));
  const writeKids = async (promoId: string, kids: KidRow[], tables: string[]) => {
    const keep = new Set(kids.map((k) => k.id));
    for (const t of tables) for (const r of await store.list(t, { promotionId: promoId }, 500)) if (!keep.has(r.$id)) await store.remove(t, r.$id);
    for (const k of kids) if (tables.includes(k.table)) await store.create(k.table, k.id, ctx.tenantId, k.data);
  };
  const GROUPS = ["promotion_customer_groups"], DEF = ["promotion_items", "promotion_conditions"];
  if (b.id) {
    const cur = await store.get("promotions", b.id); if (!mine(ctx, cur)) throw new HttpError(404, "Promotion introuvable");
    if (cur.status === "ended") throw new HttpError(409, "Promotion terminée : elle ne se modifie plus (son historique est conservé). Créez-en une nouvelle.");
    const used = Number(cur.usageCount ?? 0) > 0 || (await store.list("promotion_usage", { promotionId: cur.$id }, 1)).length > 0; const kids = mk(cur.$id);
    if (used) {
      const old = await loadKids(store, ctx, [cur.$id]); const oldSig = sigOf([...old.items.map((r) => ({ t: "promotion_items", v: [r.role || "target", r.productId, r.qty ?? 1, "", "", ""] })), ...old.conds.map((r) => ({ t: "promotion_conditions", v: [r.kind, "", r.minQty ?? "", r.valueKind ?? "", r.value ?? "", r.params ?? ""] }))]);
      const normOld = oldSig.split("\n").map((l) => l.replace(/\|(\d+)\.0(\||$)/g, "|$1$2")).sort().join("\n");
      if ((cur.family || "simple") !== fam || cur.kind !== input.kind || Number(cur.discountValue) !== input.value || cur.scope !== row.scope || String(cur.category ?? "") !== input.category || String(cur.code ?? "") !== input.code || (cur.tierBasis || "line") !== input.tierBasis || normOld !== defSig(kids).split("\n").sort().join("\n"))
        throw new HttpError(409, "Cette promotion a déjà été utilisée : son type, sa valeur, sa portée, son code, ses articles, ses paliers et ses lots ne changent plus (l'historique doit rester vrai). Créez-en une nouvelle.");
      if (input.usageLimit !== undefined && input.usageLimit < Number(cur.usageCount ?? 0)) throw new HttpError(409, "La limite ne peut pas être inférieure au nombre d'utilisations déjà enregistrées");
    }
    await store.update("promotions", cur.$id, row);
    await writeKids(cur.$id, kids, used ? GROUPS : [...DEF, ...GROUPS]);
    await audit(store, ctx, "promotion.update", `${input.name} (${cur.$id}) ${fam}`); return { id: cur.$id };
  }
  const id = b.requestId ? `p${String(b.requestId).replace(/[^A-Za-z0-9]/g, "").slice(0, 28)}` : newId(); const prior = await store.get("promotions", id);
  if (prior) { if (!mine(ctx, prior)) throw new HttpError(409, "Demande déjà utilisée"); await writeKids(id, mk(id), [...DEF, ...GROUPS]); return { id, duplicate: true }; }
  await store.create("promotions", id, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, ...row, status: "draft", usageCount: 0, createdBy: ctx.userId, createdOn: new Date().toISOString() });
  await writeKids(id, mk(id), [...DEF, ...GROUPS]);
  await audit(store, ctx, "promotion.create", `${input.name} (${id}) ${fam}`); return { id };
}

const TRANSITIONS: Record<string, string[]> = { draft: ["enabled"], enabled: ["suspended", "ended"], suspended: ["enabled", "ended"], ended: [] };
/** Activation (programmée si le début est futur), suspension, reprise, fin anticipée. Une promotion terminée ne rouvre pas. Activer ou reprendre une campagne AVANCÉE exige la formule Pro
 *  (en rétrogradation : les campagnes avancées restent conservées, gelées et non appliquées ; on peut toujours les suspendre ou les terminer). */
export async function setPromotionStatus(store: Store, ctx: Ctx, b: { id: string; to: string }) {
  needModule(ctx, "stock"); need(ctx, "manager"); await needFeature(store, ctx, "promotions");
  const cur = await store.get("promotions", String(b.id)); if (!mine(ctx, cur)) throw new HttpError(404, "Promotion introuvable");
  const to = String(b.to); if (!["draft", "enabled", "suspended", "ended"].includes(to)) throw new HttpError(400, "Statut inconnu");
  if (cur.status === to) return { id: cur.$id, status: to };
  if (!(TRANSITIONS[String(cur.status)] ?? []).includes(to)) throw new HttpError(409, `Passage impossible : ${cur.status} → ${to}`);
  if (to === "enabled") {
    const p = await loadPromo(store, ctx, cur); const f = familyOf(p);
    if (isAdvanced(p)) await needFeature(store, ctx, "promotionsPro");
    if (Date.parse(String(cur.endAt)) <= Date.now()) throw new HttpError(409, "La date de fin est déjà passée : modifiez la période avant d'activer");
    if ((f === "simple" || f === "tiers" || f === "bogo") && p.scope === "items" && !p.itemIds.length) throw new HttpError(409, "Aucun article concerné : sélectionnez-en avant d'activer");
    if (f === "combo" && !(p.comboItems ?? []).length) throw new HttpError(409, "Le pack ne contient aucun article");
    if (f === "requires" && !(p.requireItems ?? []).length) throw new HttpError(409, "Aucun article requis");
  }
  const patch: Record<string, unknown> = { status: to }; if (to === "ended" && Date.parse(String(cur.endAt)) > Date.now()) patch.endAt = new Date().toISOString(); // fin anticipée : la période s'arrête maintenant
  await store.update("promotions", cur.$id, patch); await audit(store, ctx, `promotion.${to}`, `${cur.name} (${cur.$id})`);
  return { id: cur.$id, status: to };
}
/** Suppression : seulement une promotion jamais utilisée ; sinon on la termine (l'historique reste). */
export async function deletePromotion(store: Store, ctx: Ctx, b: { id: string }) {
  needModule(ctx, "stock"); need(ctx, "manager"); await needFeature(store, ctx, "promotions");
  const cur = await store.get("promotions", String(b.id)); if (!mine(ctx, cur)) throw new HttpError(404, "Promotion introuvable");
  if (Number(cur.usageCount ?? 0) > 0 || (await store.list("promotion_usage", { promotionId: cur.$id }, 1)).length) throw new HttpError(409, "Cette promotion a déjà été utilisée : terminez-la plutôt que de la supprimer (son historique est conservé).");
  for (const t of ["promotion_items", "promotion_conditions", "promotion_customer_groups", "promotion_store_rules", "promotion_coupons"]) for (const r of await store.list(t, { promotionId: cur.$id }, 500)) await store.remove(t, r.$id);
  await store.remove("promotions", cur.$id); await audit(store, ctx, "promotion.delete", `${cur.name} (${cur.$id})`); return { id: cur.$id };
}

/** Règle locale d'un magasin pour une campagne multi-magasins : activer/suspendre localement, prix ou valeur locale, budget local. Autorisé au gérant du magasin concerné (autorisation locale) ou à celui du magasin d'origine. Pro. */
export async function setStoreRule(store: Store, ctx: Ctx, b: { id: string; shopId?: string; enabled?: boolean; value?: unknown; budget?: unknown; clear?: boolean }) {
  needModule(ctx, "stock"); need(ctx, "manager"); await needFeature(store, ctx, "promotionsPro");
  const cur = await store.get("promotions", String(b.id)); if (!cur || cur.tenantId !== ctx.tenantId) throw new HttpError(404, "Promotion introuvable");
  const target = String(b.shopId ?? ctx.shopId); const sh = await store.get("shops", target.slice(0, 36)); if (!sh || sh.tenantId !== ctx.tenantId) throw new HttpError(404, "Magasin introuvable");
  if (!(target === ctx.shopId || cur.shopId === ctx.shopId)) throw new HttpError(403, "Vous ne pouvez régler que votre magasin (ou, depuis le magasin d'origine, ceux de la campagne)");
  const scope = String(cur.storeScope || "this"); const applies = target === cur.shopId || scope === "all" || (scope === "some" && J<string[]>(cur.shopIds, []).includes(target)); if (!applies) throw new HttpError(409, "Cette campagne ne vise pas ce magasin");
  const rid = ruleRowId(cur.$id, target);
  if (b.clear) { await store.remove("promotion_store_rules", rid); await audit(store, ctx, "promotion.storeRule.clear", `${cur.name} → ${target}`); return { id: cur.$id }; }
  const intOpt = (v: unknown, l: string, min: number) => { if (v == null || v === "") return null; const n = Number(v); if (!Number.isInteger(n) || n < min) throw new HttpError(400, `${l} invalide`); return n; };
  const value = intOpt(b.value, "Valeur locale", cur.kind === "percent" ? 1 : 0); if (value !== null && cur.kind === "percent" && value > 100) throw new HttpError(400, "Pourcentage local invalide");
  if (value !== null && ["tiers", "bogo"].includes(String(cur.family))) throw new HttpError(400, "Valeur locale non disponible pour ce type");
  const data = { tenantId: ctx.tenantId, shopId: String(cur.shopId), promotionId: cur.$id, targetShopId: target, enabled: b.enabled !== false, value, budget: intOpt(b.budget, "Budget local", 1) };
  if (!(await store.create("promotion_store_rules", rid, ctx.tenantId, data))) await store.update("promotion_store_rules", rid, data);
  await audit(store, ctx, "promotion.storeRule", `${cur.name} → ${target} ${data.enabled ? "actif" : "suspendu"}`); return { id: cur.$id };
}

/** Réglages des promotions : fuseau horaire de l'entreprise (toutes formules), plafonds, stratégie et priorité par type (Pro). */
export async function savePromoSettings(store: Store, ctx: Ctx, b: { tz?: string; maxLinePct?: unknown; maxCartPct?: unknown; strategy?: string; typeRank?: unknown; minMarginPct?: unknown }) {
  needModule(ctx, "stock"); need(ctx, "manager"); await needFeature(store, ctx, "promotions");
  const sh = await store.get("shops", ctx.shopId.slice(0, 36)); if (!sh || sh.tenantId !== ctx.tenantId) throw new HttpError(404, "Boutique introuvable"); const patch: Record<string, unknown> = {};
  const pct = (v: unknown, l: string, min: number, max: number) => { if (v === null || v === "") return null; const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${l} : entier de ${min} à ${max}`); return n; };
  if (b.tz !== undefined) { const { isTimezone } = await import("../../../src/domain/promotions"); if (!isTimezone(b.tz)) throw new HttpError(400, "Fuseau horaire inconnu"); patch.promoTz = b.tz; }
  if (b.minMarginPct !== undefined) patch.minMarginPct = pct(b.minMarginPct, "Marge minimale", 0, 90) ?? 0;
  if (b.maxLinePct !== undefined || b.maxCartPct !== undefined || b.strategy !== undefined || b.typeRank !== undefined) await needFeature(store, ctx, "promotionsPro");
  if (b.maxLinePct !== undefined) patch.promoMaxLinePct = pct(b.maxLinePct, "Plafond par article", 1, 100);
  if (b.maxCartPct !== undefined) patch.promoMaxCartPct = pct(b.maxCartPct, "Plafond par panier", 1, 100);
  if (b.strategy !== undefined) { if (!["best", "priority"].includes(b.strategy)) throw new HttpError(400, "Stratégie inconnue"); patch.promoStrategy = b.strategy; }
  if (b.typeRank !== undefined) { const r = strArr(b.typeRank); if (r.some((x) => !FAMILIES.some((f) => f.id === x))) throw new HttpError(400, "Type inconnu dans la priorité"); patch.promoTypeRank = r.join(","); }
  if (Object.keys(patch).length) { await store.update("shops", sh.$id, patch); await audit(store, ctx, "promotion.settings", JSON.stringify(patch)); }
  return { ok: true };
}

// ------------------------------------------------------------------ coupons (Pro)
const randCode = () => `CP${Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("")}`;
/** Création de coupons (codes personnalisés, à usage unique, limités, valables sur une période, réservés à un client) ou modification d'un coupon. `count` > 1 génère des codes uniques à usage unique. */
export async function saveCoupon(store: Store, ctx: Ctx, b: { id?: string; promotionId?: string; code?: string; singleUse?: boolean; maxUses?: unknown; customerId?: string; validFrom?: string; validTo?: string; active?: boolean; count?: unknown }) {
  needModule(ctx, "stock"); need(ctx, "manager"); await needFeature(store, ctx, "promotionsPro");
  const dateOpt = (v: unknown, l: string) => { if (v == null || v === "") return null; const ms = Date.parse(String(v)); if (Number.isNaN(ms)) throw new HttpError(400, `${l} invalide`); return new Date(ms).toISOString(); };
  const maxUses = b.maxUses == null || b.maxUses === "" ? null : Number(b.maxUses); if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1_000_000)) throw new HttpError(400, "Nombre d'utilisations invalide");
  const validFrom = dateOpt(b.validFrom, "Début de validité"), validTo = dateOpt(b.validTo, "Fin de validité"); if (validFrom && validTo && Date.parse(validTo) <= Date.parse(validFrom)) throw new HttpError(400, "La fin de validité doit suivre le début");
  if (b.id) {
    const cur = await store.get("promotion_coupons", b.id); if (!mine(ctx, cur)) throw new HttpError(404, "Coupon introuvable");
    if (maxUses !== null && maxUses < Number(cur.usedCount ?? 0)) throw new HttpError(409, "La limite ne peut pas être inférieure aux utilisations déjà enregistrées");
    await store.update("promotion_coupons", cur.$id, { maxUses, validFrom, validTo, ...(b.active !== undefined ? { active: b.active !== false } : {}) });
    await audit(store, ctx, "coupon.update", `${cur.code} (${cur.$id})`); return { id: cur.$id };
  }
  const promo = await store.get("promotions", String(b.promotionId ?? "")); if (!mine(ctx, promo)) throw new HttpError(404, "Campagne introuvable");
  if (promo.status === "ended") throw new HttpError(409, "Campagne terminée : ses coupons ne se créent plus");
  if (b.customerId) { const c = await store.get("customers", b.customerId); if (!c || c.tenantId !== ctx.tenantId || c.shopId !== ctx.shopId) throw new HttpError(404, "Client introuvable"); }
  const count = b.count == null || b.count === "" ? 1 : Number(b.count); if (!Number.isInteger(count) || count < 1 || count > 50) throw new HttpError(400, "Nombre de coupons : 1 à 50");
  if (count > 1 && (b.code || b.customerId)) throw new HttpError(400, "La création en série génère elle-même les codes et n'est pas réservée à un client");
  const out: string[] = [];
  for (let n = 0; n < count; n++) {
    let code = normalizeCode(b.code); if (code && !/^[A-Z0-9_-]{3,20}$/.test(code)) throw new HttpError(400, "Code coupon : 3 à 20 caractères (lettres, chiffres, - ou _)");
    if (!code) for (let i = 0; i < 20 && !code; i++) { const c = randCode(); if (!(await store.list("promotion_coupons", { tenantId: ctx.tenantId, code: c }, 1)).length) code = c; }
    if (!code) throw new HttpError(409, "Impossible de générer un code");
    if ((await store.list("promotion_coupons", { tenantId: ctx.tenantId, code }, 1)).length) throw new HttpError(409, `Le code ${code} existe déjà`);
    const id = newId(); await store.create("promotion_coupons", id, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, promotionId: promo.$id, code, singleUse: count > 1 || b.singleUse === true, maxUses, usedCount: 0, customerId: b.customerId ?? "", validFrom, validTo, active: true, createdBy: ctx.userId });
    out.push(id);
  }
  await audit(store, ctx, "coupon.create", `${count} coupon(s) → ${promo.name} (${promo.$id})`); return { ids: out };
}
/** Coupons de la boutique avec leurs utilisations et tentatives invalides. */
export async function listCoupons(store: Store, ctx: Ctx, b: { promotionId?: string } = {}) {
  needModule(ctx, "stock"); need(ctx, "manager"); await needFeature(store, ctx, "promotionsPro");
  const where: Record<string, string> = { tenantId: ctx.tenantId, shopId: ctx.shopId }; if (b.promotionId) where.promotionId = String(b.promotionId);
  const coupons = (await store.scan("promotion_coupons", where, { maxRows: 5000 })).rows; const usage = (await store.scan("promotion_coupon_usage", { tenantId: ctx.tenantId, shopId: ctx.shopId }, { maxRows: 50_000 })).rows;
  const promos = new Map((await store.scan("promotions", { tenantId: ctx.tenantId, shopId: ctx.shopId }, { maxRows: 5000 })).rows.map((p) => [p.$id, String(p.name)]));
  const by = new Map<string, { used: number; invalid: number }>(); for (const u of usage) { const a = by.get(String(u.couponId)) ?? { used: 0, invalid: 0 }; if (u.outcome === "used") a.used++; else a.invalid++; by.set(String(u.couponId), a); }
  const unknown = usage.filter((u) => u.outcome === "invalid" && !u.couponId).length; const invalidRecent = usage.filter((u) => u.outcome === "invalid").sort((a, b) => String(b.usedAt).localeCompare(String(a.usedAt))).slice(0, 30).map((u) => ({ code: String(u.code), reason: String(u.reason), at: iso(u.usedAt) }));
  return { coupons: coupons.map((c) => ({ id: c.$id, code: String(c.code), promotionId: String(c.promotionId), promotionName: promos.get(String(c.promotionId)) ?? "", singleUse: c.singleUse === true, maxUses: num(c.maxUses), usedCount: Number(c.usedCount ?? 0), customerId: c.customerId ? String(c.customerId) : undefined, validFrom: c.validFrom ? iso(c.validFrom) : undefined, validTo: c.validTo ? iso(c.validTo) : undefined, active: c.active !== false, invalidAttempts: by.get(c.$id)?.invalid ?? 0 })).sort((a, b) => a.code.localeCompare(b.code)),
    invalidTotal: usage.filter((u) => u.outcome === "invalid").length, invalidUnknown: unknown, invalidRecent };
}

/** Suivi : promotions par statut effectif, utilisations, remises accordées, chiffre d'affaires des lignes en promotion (net de remise — ce n'est PAS un bénéfice), par promotion. */
export async function promotionStats(store: Store, ctx: Ctx, b: { from?: string; to?: string } = {}) {
  needModule(ctx, "stock"); need(ctx, "manager"); await needFeature(store, ctx, "promotions");
  const now = new Date(); const to = b.to && /^\d{4}-\d{2}-\d{2}$/.test(b.to) ? b.to : now.toISOString().slice(0, 10); const from = b.from && /^\d{4}-\d{2}-\d{2}$/.test(b.from) ? b.from : new Date(now.getTime() - 29 * 864e5).toISOString().slice(0, 10);
  if (to < from) throw new HttpError(400, "La fin précède le début");
  const where = { tenantId: ctx.tenantId, shopId: ctx.shopId };
  const promos = (await store.scan("promotions", where, { maxRows: 5000 })).rows;
  const usage = (await store.scan("promotion_usage", where, { range: { field: "usedAt", from: `${from}T00:00:00.000Z`, to: new Date(Date.parse(`${to}T00:00:00Z`) + 864e5).toISOString() }, maxRows: 50_000 }));
  const counts: Record<string, number> = { draft: 0, scheduled: 0, active: 0, suspended: 0, ended: 0 }; for (const p of promos) counts[promoStatus({ status: p.status, startAt: String(p.startAt), endAt: String(p.endAt) }, now)]!++;
  const per = new Map<string, { uses: number; discount: number; revenue: number }>();
  for (const u of usage.rows) { const a = per.get(String(u.promotionId)) ?? { uses: 0, discount: 0, revenue: 0 }; a.uses++; a.discount += Number(u.discount ?? 0); a.revenue += Number(u.finalAmount ?? 0); per.set(String(u.promotionId), a); }
  const items = promos.map((p) => { const a = per.get(p.$id) ?? { uses: 0, discount: 0, revenue: 0 }; return { id: p.$id, name: String(p.name), status: promoStatus({ status: p.status, startAt: String(p.startAt), endAt: String(p.endAt) }, now), ...a }; }).filter((x) => x.uses > 0).sort((a, b) => b.discount - a.discount);
  const sum = (k: "uses" | "discount" | "revenue") => items.reduce((a, x) => a + x[k], 0);
  return { period: { from, to }, created: promos.length, byStatus: counts, uses: sum("uses"), discountTotal: sum("discount"), promoRevenue: sum("revenue"), items, truncated: usage.truncated,
    note: "Le chiffre d'affaires promotionnel est le montant encaissé sur les lignes en promotion, net de remise : ce n'est pas un bénéfice." };
}
export { STATUS_LABEL, describeDiscount, normalizeCode };
