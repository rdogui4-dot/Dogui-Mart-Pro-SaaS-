import { cleanText, parseAmount } from "../../../src/domain/articles";
import { fromScaled, qtyFor, scaleOf, scaledInt } from "../../../src/domain/quantity";
import { MAX_VARIANTS, normalizeAttributes } from "../../../src/domain/variants";
import { assertUnique, freeSku, needFeature } from "./articles";
import { stockScaled } from "./checkout";
import { HttpError, need, needModule, type Ctx, type Row, type Store } from "./store";

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 30);
const mine = (ctx: Ctx, r: Row | null): r is Row => !!r && r.tenantId === ctx.tenantId && r.shopId === ctx.shopId;
const INITIAL = "stock-initial";
const audit = (store: Store, ctx: Ctx, id: string, action: string, detail: string) =>
  store.create("audit_log", id, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action, detail: detail.slice(0, 1000) });

export type VariantInput = { productId: string; id?: string; requestId?: string; attributes?: unknown; sku?: unknown; barcode?: unknown; price?: unknown; cost?: unknown; minStock?: unknown; initialQty?: unknown };

/** Écritures qui suivent la création de la ligne (stock initial, premier prix, drapeau de l'article, journal) : identifiants fixes, donc rejouables sans doublon. */
async function creationRows(store: Store, ctx: Ctx, p: Row, v: Row, qty: number) {
  if (qty > 0) await store.create("stock_moves", `${v.$id}_init`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: p.$id, variantId: v.$id, qty, kind: "adjust", refId: INITIAL, userId: ctx.userId });
  await store.create("price_history", `${v.$id}_p0`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: p.$id, variantId: v.$id, oldPrice: 0, newPrice: Number(v.price), oldCost: 0, newCost: Number(v.cost ?? 0), userId: ctx.userId });
  if (!p.hasVariants) await store.update("products", p.$id, { hasVariants: true });
  await audit(store, ctx, `${v.$id}_ac`, "variant.create", `${p.name} — ${v.label} (${v.$id}) vente ${v.price} achat ${v.cost ?? 0} stock initial ${fromScaled(qty, scaleOf(p))}`);
}

/** Création / modification d'une variante. Fonction Pro. */
export async function saveVariant(store: Store, ctx: Ctx, b: VariantInput) {
  needModule(ctx, "stock"); await needFeature(store, ctx, "variants");
  const p = await store.get("products", b.productId);
  if (!mine(ctx, p)) throw new HttpError(404, "Article introuvable");
  if (p.archived) throw new HttpError(409, "Article archivé : restaurez-le avant de modifier ses variantes");
  const siblings = (await store.list("article_variants", { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: p.$id }, MAX_VARIANTS + 1));
  let attrs: ReturnType<typeof normalizeAttributes> | null = null;
  try { if (!b.id || b.attributes !== undefined) attrs = normalizeAttributes(b.attributes); } catch (e) { throw new HttpError(400, (e as Error).message); }
  const field = (v: unknown, max: number, label: string) => { try { return cleanText(v ?? "", max, label); } catch (e) { throw new HttpError(400, (e as Error).message); } };
  const money = (v: unknown, label: string) => { try { return parseAmount(v, label); } catch (e) { throw new HttpError(400, (e as Error).message); } };
  const barcodeOk = (c: string) => { if (c && !/^[A-Za-z0-9._\-/]+$/.test(c)) throw new HttpError(400, "Code-barres : lettres, chiffres et . _ - / uniquement"); return c; };

  if (b.id) {
    const v = await store.get("article_variants", b.id);
    if (!mine(ctx, v) || v.productId !== p.$id) throw new HttpError(403, "Accès refusé");
    const patch: Record<string, unknown> = {};
    if (attrs) {
      if (siblings.some((x) => x.$id !== v.$id && x.attrKey === attrs!.key)) throw new HttpError(409, "Une variante avec ces attributs existe déjà");
      Object.assign(patch, { attributes: JSON.stringify(attrs.attrs), attrKey: attrs.key, label: attrs.label });
    }
    if (b.sku !== undefined) { patch.sku = field(b.sku, 64, "Référence"); await assertUnique(store, ctx, "sku", String(patch.sku), { variantId: v.$id }); }
    if (b.barcode !== undefined) { patch.barcode = barcodeOk(field(b.barcode, 64, "Code-barres")); await assertUnique(store, ctx, "barcode", String(patch.barcode), { variantId: v.$id }); }
    if (b.price !== undefined) patch.price = money(b.price, "Prix de vente");
    if (b.cost !== undefined) patch.cost = money(b.cost, "Prix d'achat");
    if (b.minStock !== undefined) { const m = Number(b.minStock); if (!Number.isInteger(m) || m < 0) throw new HttpError(400, "Seuil d'alerte invalide"); patch.minStock = m; }
    if (!Object.keys(patch).length) return { id: v.$id };
    await store.update("article_variants", v.$id, patch);
    const pc = patch.price !== undefined && patch.price !== Number(v.price), cc = patch.cost !== undefined && patch.cost !== Number(v.cost ?? 0);
    if (pc || cc) {
      await store.create("price_history", newId(), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: p.$id, variantId: v.$id, oldPrice: Number(v.price), newPrice: Number(patch.price ?? v.price), oldCost: Number(v.cost ?? 0), newCost: Number(patch.cost ?? v.cost ?? 0), userId: ctx.userId });
      await audit(store, ctx, newId(), "variant.price", `${p.name} — ${v.label} : vente ${v.price}→${patch.price ?? v.price}, achat ${v.cost ?? 0}→${patch.cost ?? v.cost ?? 0}`);
    }
    return { id: v.$id };
  }

  // Création
  if (siblings.length >= MAX_VARIANTS) throw new HttpError(409, `${MAX_VARIANTS} variantes au maximum par article`);
  const a = attrs!;
  const id = b.requestId ? `a${String(b.requestId).replace(/[^A-Za-z0-9]/g, "").slice(0, 28)}` : newId();
  const scale = scaleOf(p);
  let qty = 0;
  if (b.initialQty !== undefined && String(b.initialQty).trim() !== "" && Number(b.initialQty) !== 0) {
    try { qty = scaledInt(qtyFor(b.initialQty, scale), scale); } catch (e) { throw new HttpError(400, `Quantité en stock : ${(e as Error).message}`); }
  }
  const prior = await store.get("article_variants", id);
  if (prior) { // reprise après coupure : complète les écritures manquantes sans rien doubler
    if (!mine(ctx, prior) || prior.productId !== p.$id) throw new HttpError(409, "Demande déjà utilisée");
    await creationRows(store, ctx, p, prior, qty); return { id, duplicate: true };
  }
  if (siblings.some((x) => x.attrKey === a.key)) throw new HttpError(409, "Une variante avec ces attributs existe déjà");
  if (!p.hasVariants && (await stockScaled(store, p.$id)) !== 0) throw new HttpError(409, "Cet article a du stock : comptez-le à 0 (inventaire) avant de créer des variantes, puis saisissez le stock de chaque variante.");
  let sku = field(b.sku, 64, "Référence"); const barcode = barcodeOk(field(b.barcode, 64, "Code-barres"));
  if (!sku) { const base = String(p.sku ?? ""); if (base) for (let n = siblings.length + 1; n < siblings.length + 30 && !sku; n++) { const c = `${base}-${String(n).padStart(2, "0")}`.slice(0, 64); try { await assertUnique(store, ctx, "sku", c); sku = c; } catch { /* essai suivant */ } } if (!sku) sku = await freeSku(store, ctx); }
  await assertUnique(store, ctx, "sku", sku); await assertUnique(store, ctx, "barcode", barcode);
  const price = b.price === undefined || b.price === "" ? Number(p.price) : money(b.price, "Prix de vente");
  const cost = b.cost === undefined || b.cost === "" ? Number(p.cost ?? 0) : money(b.cost, "Prix d'achat");
  const minStock = b.minStock === undefined || b.minStock === "" ? Number(p.minStock ?? 0) : Number(b.minStock);
  if (!Number.isInteger(minStock) || minStock < 0) throw new HttpError(400, "Seuil d'alerte invalide");
  const row = { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: p.$id, attributes: JSON.stringify(a.attrs), attrKey: a.key, label: a.label, sku, barcode, price, cost, minStock, imageFileId: "", archived: false };
  if (!(await store.create("article_variants", id, ctx.tenantId, row))) throw new HttpError(409, "Demande déjà utilisée");
  await creationRows(store, ctx, p, { ...row, $id: id }, qty);
  return { id };
}

export async function archiveVariant(store: Store, ctx: Ctx, b: { id: string; archived: boolean }) {
  needModule(ctx, "stock"); await needFeature(store, ctx, "variants");
  const v = await store.get("article_variants", b.id);
  if (!mine(ctx, v)) throw new HttpError(404, "Variante introuvable");
  const archived = b.archived === true;
  if (!!v.archived !== archived) { await store.update("article_variants", v.$id, { archived }); await audit(store, ctx, newId(), archived ? "variant.archive" : "variant.restore", `${v.label} (${v.$id})`); }
  return { id: v.$id, archived };
}

/** Suppression : gérant ou propriétaire, seulement sans historique (ventes, réceptions, transferts, commandes). Sinon : archivage. */
export async function deleteVariant(store: Store, ctx: Ctx, b: { id: string }) {
  needModule(ctx, "stock"); await needFeature(store, ctx, "variants"); need(ctx, "manager");
  const v = await store.get("article_variants", b.id);
  if (!mine(ctx, v)) throw new HttpError(404, "Variante introuvable");
  const moves = (await store.scan("stock_moves", { tenantId: ctx.tenantId, shopId: ctx.shopId, variantId: v.$id })).rows;
  const used = moves.some((m) => !(m.kind === "adjust" && m.refId === INITIAL));
  const inOrders = (await store.scan("purchase_orders", { tenantId: ctx.tenantId, shopId: ctx.shopId })).rows.some((po) => { try { return (JSON.parse(String(po.lines)) as { variantId?: string }[]).some((l) => l.variantId === v.$id); } catch { return false; } });
  if (used || inOrders) throw new HttpError(409, "Cette variante a un historique (ventes, mouvements ou commandes) : archivez-la plutôt que de la supprimer.");
  for (const m of moves) await store.remove("stock_moves", m.$id);
  for (const h of (await store.scan("price_history", { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: String(v.productId) })).rows.filter((x) => x.variantId === v.$id)) await store.remove("price_history", h.$id);
  if (v.imageFileId) await store.deleteFile(String(v.imageFileId));
  await store.remove("article_variants", v.$id);
  const left = await store.list("article_variants", { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: String(v.productId) }, 1);
  if (!left.length) await store.update("products", String(v.productId), { hasVariants: false });
  await audit(store, ctx, newId(), "variant.delete", `${v.label} (${v.$id})`);
  return { id: v.$id };
}
