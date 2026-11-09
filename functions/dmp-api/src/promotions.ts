import { createHash } from "node:crypto";
import { describeDiscount, evaluatePromotions, parsePromotion, promoStatus, STATUS_LABEL, MAX_PROMO_ITEMS, normalizeCode, type EvalLine, type EvalResult, type Promo, type PromoInput } from "../../../src/domain/promotions";
import { needFeature } from "./articles";
import { HttpError, need, needModule, type Ctx, type Row, type Store } from "./store";

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 30);
const sha = (s: string) => createHash("sha1").update(s).digest("hex");
const mine = (ctx: Ctx, r: Row | null): r is Row => !!r && r.tenantId === ctx.tenantId && r.shopId === ctx.shopId;
const audit = (store: Store, ctx: Ctx, action: string, detail: string) => store.create("audit_log", newId(), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action, detail: detail.slice(0, 1000) });
const rowToPromo = (r: Row, itemIds: string[]): Promo => ({ id: r.$id, name: String(r.name), description: r.description ? String(r.description) : undefined, code: r.code ? String(r.code) : undefined, kind: r.kind, scope: r.scope, value: Number(r.discountValue), category: r.category ? String(r.category) : undefined, itemIds,
  startAt: new Date(String(r.startAt)).toISOString(), endAt: new Date(String(r.endAt)).toISOString(), status: r.status, minQty: r.minQty == null ? undefined : Number(r.minQty), minCart: r.minCart == null ? undefined : Number(r.minCart), usageLimit: r.usageLimit == null ? undefined : Number(r.usageLimit), usageCount: Number(r.usageCount ?? 0),
  perCustomerLimit: r.perCustomerLimit == null ? undefined : Number(r.perCustomerLimit), priority: Number(r.priority ?? 0), allowBelowMargin: r.allowBelowMargin === true, createdAt: String(r.createdOn ?? r.$createdAt ?? "") });
export const itemRowId = (promotionId: string, productId: string): string => `i${sha(`${promotionId}|${productId}`).slice(0, 30)}`;
const usageId = (promotionId: string, key: string): string => `u${sha(`${promotionId}|${key}`).slice(0, 30)}`;

/** Promotions de la boutique avec leurs articles (statut mémorisé « enabled » seulement : seules celles-ci peuvent s'appliquer). */
export async function loadEnabledPromotions(store: Store, ctx: Ctx): Promise<Promo[]> {
  const rows = (await store.scan("promotions", { tenantId: ctx.tenantId, shopId: ctx.shopId, status: "enabled" }, { maxRows: 2000 })).rows; if (!rows.length) return [];
  const items = (await store.scan("promotion_items", { tenantId: ctx.tenantId, shopId: ctx.shopId }, { maxRows: 100_000 })).rows; const by = new Map<string, string[]>();
  for (const it of items) by.set(String(it.promotionId), [...(by.get(String(it.promotionId)) ?? []), String(it.productId)]);
  return rows.map((r) => rowToPromo(r, by.get(r.$id) ?? []));
}
/** Évaluation côté serveur : charge les promotions actives, les utilisations du client, la marge minimale de la boutique. L'interface ne calcule jamais seule. */
export async function evaluateForSale(store: Store, ctx: Ctx, lines: EvalLine[], o: { customerId?: string; code?: string; now: Date }): Promise<EvalResult & { promos: Promo[] }> {
  const promos = await loadEnabledPromotions(store, ctx); if (!promos.length) return { lines: lines.map((l) => ({ index: l.index, discount: 0 })), applied: [], skipped: [], promos };
  const shop = await store.get("shops", ctx.shopId.slice(0, 36)); const uses = new Map<string, number>();
  if (o.customerId) for (const p of promos.filter((x) => x.perCustomerLimit !== undefined)) uses.set(p.id, (await store.list("promotion_usage", { promotionId: p.id, customerId: o.customerId }, 1000)).length);
  return { ...evaluatePromotions(promos, lines, { now: o.now, code: o.code, customerId: o.customerId, minMarginPct: Number(shop?.minMarginPct ?? 0), customerUses: (id) => uses.get(id) ?? 0 }), promos };
}

/** Réserve l'utilisation d'une promotion pour une vente et l'enregistre (traçable, liée à la vente). Limite globale : réservation par « slot » à identifiant unique (deux ventes simultanées ne peuvent pas dépasser la limite).
 *  Rejouable : une reprise de la même vente retrouve sa ligne d'utilisation. Renvoie l'identifiant de la ligne créée (à annuler en cas d'échec ultérieur) ou "" si déjà enregistrée. */
export async function recordUsage(store: Store, ctx: Ctx, p: { id: string; usageLimit?: number; usageCount: number; code?: string }, u: { saleId: string; saleNumber: string; customerId?: string; discount: number; baseAmount: number; lines: object[]; usedAt: string }): Promise<string> {
  const prior = (await store.list("promotion_usage", { promotionId: p.id, saleId: u.saleId }, 1))[0]; if (prior) return "";
  const data = (slot: number) => ({ tenantId: ctx.tenantId, shopId: ctx.shopId, promotionId: p.id, saleId: u.saleId, saleNumber: u.saleNumber, customerId: u.customerId ?? "", code: p.code ?? "", discount: u.discount, baseAmount: u.baseAmount, finalAmount: u.baseAmount - u.discount, lines: JSON.stringify(u.lines), slot, userId: ctx.userId, usedAt: u.usedAt });
  let id = "", slot = 0;
  if (p.usageLimit !== undefined) {
    for (let n = Math.max(1, p.usageCount + 1); n <= p.usageLimit && !id; n++) { const rid = usageId(p.id, `slot${n}`); if (await store.create("promotion_usage", rid, ctx.tenantId, data(n))) { id = rid; slot = n; } }
    if (!id) throw new HttpError(409, "Promotion épuisée : sa limite d'utilisation vient d'être atteinte. Relancez la vente.");
  } else { id = usageId(p.id, `sale${u.saleId}`); if (!(await store.create("promotion_usage", id, ctx.tenantId, data(0)))) return ""; }
  const cur = await store.get("promotions", p.id); if (cur) await store.update("promotions", p.id, { usageCount: Math.max(Number(cur.usageCount ?? 0) + (slot ? 0 : 1), slot) });
  return id;
}

// ------------------------------------------------------------------ gestion
type SaveInput = { id?: string; requestId?: string; data: Record<string, unknown>; productIds?: unknown };
const worst = (price: number, cost: number, kind: string, value: number): number => (kind === "percent" ? price * (1 - value / 100) : kind === "amount" ? price - value : value);

/** Création / modification d'une promotion (gérant ou propriétaire, formule Business). Brouillon à la création. Une promotion déjà utilisée garde sa définition (kind, valeur, portée, articles, code) : on en crée une nouvelle. */
export async function savePromotion(store: Store, ctx: Ctx, b: SaveInput) {
  needModule(ctx, "stock"); need(ctx, "manager"); await needFeature(store, ctx, "promotions");
  let input: PromoInput; try { input = parsePromotion(b.data ?? {}); } catch (e) { throw new HttpError(400, (e as Error).message); }
  const ids = Array.isArray(b.productIds) ? [...new Set((b.productIds as unknown[]).map(String))] : [];
  if (input.scope === "items" && !ids.length) throw new HttpError(400, "Sélectionnez au moins un article concerné");
  if (input.scope !== "items" && ids.length) throw new HttpError(400, "Les articles ne se choisissent que pour une promotion « articles choisis »");
  if (ids.length > MAX_PROMO_ITEMS) throw new HttpError(400, `${MAX_PROMO_ITEMS} articles au maximum`);
  const prods: Row[] = [];
  for (const pid of ids) { const p = await store.get("products", pid); if (!mine(ctx, p)) throw new HttpError(404, "Article introuvable dans cette boutique"); if (p.archived) throw new HttpError(409, `${p.name} est archivé`); prods.push(p); }
  // code unique parmi les promotions non terminées de la boutique
  if (input.code) { const same = (await store.list("promotions", { tenantId: ctx.tenantId, shopId: ctx.shopId, code: input.code }, 20)).filter((r) => r.$id !== b.id && r.status !== "ended"); if (same.length) throw new HttpError(409, `Le code ${input.code} est déjà utilisé par « ${same[0]!.name} »`); }
  // contrôle de marge à l'enregistrement : le prix final ne doit pas passer sous coût × (1 + marge minimale), sauf autorisation explicite
  if (!input.allowBelowMargin && input.scope !== "cart") {
    const shop = await store.get("shops", ctx.shopId.slice(0, 36)); const m = 1 + Number(shop?.minMarginPct ?? 0) / 100;
    const targets = input.scope === "items" ? prods : (await store.scan("products", { tenantId: ctx.tenantId, shopId: ctx.shopId }, { maxRows: 10_000 })).rows.filter((p) => !p.archived && String(p.category ?? "").toLowerCase() === input.category.toLowerCase());
    for (const p of targets) {
      const subs = p.hasVariants ? (await store.list("article_variants", { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: p.$id }, 200)).filter((v) => !v.archived) : [p];
      for (const v of subs) { const cost = Number(v.cost ?? 0); const final = worst(Number(v.price), cost, input.kind, input.value); if (final < 0 || (cost > 0 && final < cost * m)) throw new HttpError(409, `${p.name}${v === p ? "" : ` — ${v.label}`} serait vendu sous la marge minimale (prix final ${Math.max(0, Math.round(final))} pour un coût de ${cost}). Réduisez la remise ou autorisez explicitement la vente sous la marge.`); }
    }
  }
  const row = { name: input.name, description: input.description, code: input.code, kind: input.kind, scope: input.scope, discountValue: input.value, category: input.category, startAt: input.startAt, endAt: input.endAt, minQty: input.minQty ?? null, minCart: input.minCart ?? null, usageLimit: input.usageLimit ?? null, perCustomerLimit: input.perCustomerLimit ?? null, priority: input.priority, allowBelowMargin: input.allowBelowMargin };
  if (b.id) {
    const cur = await store.get("promotions", b.id); if (!mine(ctx, cur)) throw new HttpError(404, "Promotion introuvable");
    if (cur.status === "ended") throw new HttpError(409, "Promotion terminée : elle ne se modifie plus (son historique est conservé). Créez-en une nouvelle.");
    const used = Number(cur.usageCount ?? 0) > 0 || (await store.list("promotion_usage", { promotionId: cur.$id }, 1)).length > 0;
    if (used) {
      const curItems = (await store.list("promotion_items", { promotionId: cur.$id }, 300)).map((r) => String(r.productId)).sort().join(",");
      if (cur.kind !== input.kind || Number(cur.discountValue) !== input.value || cur.scope !== input.scope || String(cur.category ?? "") !== input.category || String(cur.code ?? "") !== input.code || curItems !== [...ids].sort().join(",")) throw new HttpError(409, "Cette promotion a déjà été utilisée : son type, sa valeur, sa portée, son code et ses articles ne changent plus (l'historique doit rester fidèle). Créez une nouvelle promotion.");
      if (input.usageLimit !== undefined && input.usageLimit < Number(cur.usageCount ?? 0)) throw new HttpError(409, "La limite ne peut pas être inférieure au nombre d'utilisations déjà enregistrées");
    }
    await store.update("promotions", cur.$id, row);
    if (!used) { const keep = new Set(ids.map((x) => itemRowId(cur.$id, x))); for (const r of await store.list("promotion_items", { promotionId: cur.$id }, 300)) if (!keep.has(r.$id)) await store.remove("promotion_items", r.$id); for (const pid of ids) await store.create("promotion_items", itemRowId(cur.$id, pid), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, promotionId: cur.$id, productId: pid }); }
    await audit(store, ctx, "promotion.update", `${input.name} (${cur.$id})`); return { id: cur.$id };
  }
  const id = b.requestId ? `p${String(b.requestId).replace(/[^A-Za-z0-9]/g, "").slice(0, 28)}` : newId(); const prior = await store.get("promotions", id);
  if (prior) { if (!mine(ctx, prior)) throw new HttpError(409, "Demande déjà utilisée"); for (const pid of ids) await store.create("promotion_items", itemRowId(id, pid), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, promotionId: id, productId: pid }); return { id, duplicate: true }; }
  await store.create("promotions", id, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, ...row, status: "draft", usageCount: 0, createdBy: ctx.userId, createdOn: new Date().toISOString() });
  for (const pid of ids) await store.create("promotion_items", itemRowId(id, pid), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, promotionId: id, productId: pid });
  await audit(store, ctx, "promotion.create", `${input.name} (${id})`); return { id };
}

const TRANSITIONS: Record<string, string[]> = { draft: ["enabled"], enabled: ["suspended", "ended"], suspended: ["enabled", "ended"], ended: [] };
/** Activation (programmée si le début est futur), suspension, reprise, fin anticipée. Une promotion terminée ne rouvre pas. */
export async function setPromotionStatus(store: Store, ctx: Ctx, b: { id: string; to: string }) {
  needModule(ctx, "stock"); need(ctx, "manager"); await needFeature(store, ctx, "promotions");
  const cur = await store.get("promotions", String(b.id)); if (!mine(ctx, cur)) throw new HttpError(404, "Promotion introuvable");
  const to = String(b.to); if (!["draft", "enabled", "suspended", "ended"].includes(to)) throw new HttpError(400, "Statut inconnu");
  if (cur.status === to) return { id: cur.$id, status: to };
  if (!(TRANSITIONS[String(cur.status)] ?? []).includes(to)) throw new HttpError(409, `Passage impossible : ${cur.status} → ${to}`);
  if (to === "enabled") {
    if (Date.parse(String(cur.endAt)) <= Date.now()) throw new HttpError(409, "La date de fin est déjà passée : modifiez la période avant d'activer");
    if (cur.scope === "items" && !(await store.list("promotion_items", { promotionId: cur.$id }, 1)).length) throw new HttpError(409, "Aucun article concerné : sélectionnez-en avant d'activer");
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
  for (const r of await store.list("promotion_items", { promotionId: cur.$id }, 300)) await store.remove("promotion_items", r.$id);
  await store.remove("promotions", cur.$id); await audit(store, ctx, "promotion.delete", `${cur.name} (${cur.$id})`); return { id: cur.$id };
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
