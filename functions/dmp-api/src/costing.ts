import { createHash } from "node:crypto";
import { aggregateProfit } from "../../../src/domain/costing";
import { MAX_AMOUNT } from "../../../src/domain/articles";
import { parsePeriod } from "../../../src/domain/reports";
import { qtyFor, scaleOf } from "../../../src/domain/quantity";
import { needFeature } from "./articles";
import { HttpError, needModule, type Ctx, type Row, type Store } from "./store";

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 30);
const mine = (ctx: Ctx, r: Row | null): r is Row => !!r && r.tenantId === ctx.tenantId && r.shopId === ctx.shopId;
const parse = <T,>(s: unknown, fb: T): T => { try { return JSON.parse(String(s)) as T; } catch { return fb; } };
/** Une seule fiche par (article, variante, fournisseur) : identifiant déterministe, jamais de doublon. */
export const linkId = (productId: string, variantId: string, supplierId: string): string => `l${createHash("sha1").update(`${productId}|${variantId}|${supplierId}`).digest("hex").slice(0, 30)}`;

export type LinkInput = { productId: string; variantId?: string; supplierId: string; supplierRef?: unknown; price: unknown; leadDays?: unknown; minQty?: unknown; feePct?: unknown; status?: unknown };

/** Associe un fournisseur à un article (ou une variante) avec ses conditions d'approvisionnement. Création ou mise à jour (même clé = même fiche). Fonction Pro. */
export async function saveSupplierLink(store: Store, ctx: Ctx, b: LinkInput) {
  needModule(ctx, "stock"); await needFeature(store, ctx, "costing");
  const p = await store.get("products", b.productId);
  if (!mine(ctx, p)) throw new HttpError(404, "Article introuvable");
  const variantId = b.variantId ? String(b.variantId) : "";
  if (p.hasVariants) { const v = variantId ? await store.get("article_variants", variantId) : null; if (!v || !mine(ctx, v) || v.productId !== p.$id) throw new HttpError(400, "Choisissez la variante concernée"); }
  else if (variantId) throw new HttpError(400, "Cet article n'a pas de variantes");
  const sup = await store.get("suppliers", String(b.supplierId));
  if (!mine(ctx, sup)) throw new HttpError(404, "Fournisseur introuvable dans cette boutique");
  const price = typeof b.price === "string" ? Number(b.price.replace(/\s/g, "")) : Number(b.price);
  if (!Number.isInteger(price) || price < 0 || price > MAX_AMOUNT) throw new HttpError(400, "Prix d'achat invalide : montant entier en FCFA");
  const num = (v: unknown) => (v === undefined || v === null || String(v).trim() === "" ? undefined : Number(String(v).replace(",", ".")));
  const leadDays = num(b.leadDays); if (leadDays !== undefined && (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > 365)) throw new HttpError(400, "Délai invalide (0 à 365 jours)");
  const feePct = num(b.feePct); if (feePct !== undefined && (!(feePct >= 0 && feePct <= 100) || Math.round(feePct * 100) / 100 !== feePct)) throw new HttpError(400, "Frais invalides (0 à 100 %, 2 décimales au plus)");
  let minQty = 0; if (num(b.minQty) !== undefined) { try { minQty = qtyFor(num(b.minQty), scaleOf(p)); } catch (e) { throw new HttpError(400, `Quantité minimale : ${(e as Error).message}`); } }
  const status = b.status === undefined ? "active" : String(b.status); if (status !== "active" && status !== "inactive") throw new HttpError(400, "Statut inconnu");
  const supplierRef = String(b.supplierRef ?? "").trim().replace(/\s+/g, " ").slice(0, 64);
  const id = linkId(p.$id, variantId, sup.$id);
  const data = { supplierRef, price, leadDays: leadDays ?? 0, minQty, feePct: feePct ?? 0, status };
  const created = await store.create("article_suppliers", id, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: p.$id, variantId, supplierId: sup.$id, lastPrice: 0, ...data });
  if (!created) await store.update("article_suppliers", id, data);
  await store.create("audit_log", newId(), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action: created ? "supplier.link.create" : "supplier.link.update", detail: `${p.name} ← ${sup.name} : ${price} FCFA, délai ${leadDays ?? 0} j, minimum ${minQty}, frais ${feePct ?? 0} %, ${status}`.slice(0, 1000) });
  return { id, created };
}

export async function deleteSupplierLink(store: Store, ctx: Ctx, b: { id: string }) {
  needModule(ctx, "stock"); await needFeature(store, ctx, "costing");
  const l = await store.get("article_suppliers", b.id);
  if (!mine(ctx, l)) throw new HttpError(404, "Fiche fournisseur introuvable");
  await store.remove("article_suppliers", l.$id);
  await store.create("audit_log", newId(), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action: "supplier.link.delete", detail: `${l.productId} ← ${l.supplierId}`.slice(0, 1000) });
  return { id: l.$id };
}

const MAX_SALES = 20_000;
/** Rentabilité par article (ou variante) et par catégorie sur une période (92 jours au plus), boutique active. Lecture seule. Fonction Pro. */
export async function articleProfitability(store: Store, ctx: Ctx, b: { from: string; to: string }) {
  needModule(ctx, "reports"); await needFeature(store, ctx, "profitability");
  const period = parsePeriod(b.from, b.to); if (!period.ok) throw new HttpError(400, period.error);
  const where = { tenantId: ctx.tenantId, shopId: ctx.shopId };
  const [sales, products] = await Promise.all([store.scan("sales", where, { range: { field: "soldAt", from: period.gte, to: period.lt }, maxRows: MAX_SALES }), store.scan("products", where, { maxRows: 10_000 })]);
  const info = Object.fromEntries(products.rows.map((p) => [p.$id, { category: String(p.category ?? ""), name: String(p.name) }]));
  const rows = sales.rows.map((r) => ({ total: Number(r.total), vat: Number(r.vat ?? 0), status: String(r.status), soldAt: String(r.soldAt), lines: parse(r.lines, []) }));
  const agg = aggregateProfit(rows, { from: period.from, to: period.to }, info);
  return { period: { from: period.from, to: period.to, days: period.days }, items: agg.items.slice(0, 200), categories: agg.categories, truncated: sales.truncated, itemsTotal: agg.items.length };
}
