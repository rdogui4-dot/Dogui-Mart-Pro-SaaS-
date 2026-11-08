import { BUSINESS_FIELDS, normalizeArticle, normalizePatch, type Article } from "../../../src/domain/articles";
import { FEATURES, planAllows, type FeatureKey } from "../../../src/domain/features";
import { fromScaled, qtyFor, scaleOf, scaledInt } from "../../../src/domain/quantity";
import { readRoles } from "./permissions";
import { assertQuota, entitlementOf } from "./subscriptions";
import { HttpError, need, needModule, type Ctx, type Row, type Store } from "./store";

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 30);
const mine = (ctx: Ctx, r: Row | null): r is Row => !!r && r.tenantId === ctx.tenantId && r.shopId === ctx.shopId;
const must = (r: Row | null, msg = "Article introuvable"): Row => { if (!r) throw new HttpError(404, msg); return r; };
const INITIAL = "stock-initial";
/** Champs que le client peut envoyer. imageFileId n'en fait pas partie : la photo passe uniquement par article.image. */
const FIELDS = ["name", "sku", "barcode", "category", "price", "cost", "minStock", "archived", "description", "unit", "supplierId", "qtyScale"] as const;
const MAX_IMAGE_BYTES = 450_000;

/** Droit lié à la FORMULE (distinct du rôle de l'employé). 402 = « passez à l'offre supérieure ». */
export async function needFeature(store: Store, ctx: Ctx, key: FeatureKey): Promise<void> {
  const e = await entitlementOf(store, ctx.tenantId);
  if (!planAllows(e.plan.id, key)) throw new HttpError(402, `« ${FEATURES[key].label} » est réservé à la formule ${FEATURES[key].min === "pro" ? "Pro" : "Business"} ou supérieure.`);
}

const audit = (store: Store, ctx: Ctx, action: string, detail: string) =>
  store.create("audit_log", newId(), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action, detail: detail.slice(0, 1000) });

/** Référence et code-barres uniques dans la boutique, TOUS articles et variantes confondus (la caisse retrouve un article par scan). */
export async function assertUnique(store: Store, ctx: Ctx, field: "sku" | "barcode", value: string, self?: { productId?: string; variantId?: string }) {
  if (!value) return;
  const where = { tenantId: ctx.tenantId, shopId: ctx.shopId, [field]: value };
  const dup = (await store.list("products", where, 5)).find((r) => r.$id !== self?.productId);
  const vdup = (await store.list("article_variants", where, 5)).find((r) => r.$id !== self?.variantId);
  const hit = dup ?? vdup;
  if (hit) throw new HttpError(409, `${field === "sku" ? "Référence déjà utilisée" : "Code-barres déjà utilisé"} par « ${dup ? dup.name : `${(await store.get("products", String(vdup!.productId)))?.name ?? "article"} — ${vdup!.label}`} »`);
}

/** Écritures qui suivent la création de la fiche (stock initial, premier prix, journal) : à identifiants fixes, donc rejouables sans doublon. */
async function creationRows(store: Store, ctx: Ctx, id: string, a: Article, qty: number, business: boolean) {
  if (qty > 0) await store.create("stock_moves", `${id}_init`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: id, qty, kind: "adjust", refId: INITIAL, userId: ctx.userId });
  if (!business) return;
  await store.create("price_history", `${id}_p0`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: id, oldPrice: 0, newPrice: Number(a.price), oldCost: 0, newCost: Number(a.cost ?? 0), userId: ctx.userId });
  await store.create("audit_log", `${id}_ac`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action: "article.create", detail: `${a.name} (${id}) vente ${a.price} achat ${a.cost ?? 0} stock initial ${fromScaled(qty, scaleOf(a))}`.slice(0, 1000) });
}

/** Création / modification d'un article (table `products`). Également appelée par entity.save pour les produits : un seul chemin d'écriture. */
/** Action article.save : réservée à la formule Business (ou Pro). */
export async function saveArticle(store: Store, ctx: Ctx, b: { id?: string; requestId?: string; data: Record<string, unknown>; initialQty?: number }) {
  needModule(ctx, "stock"); await needFeature(store, ctx, "articles");
  return saveProduct(store, ctx, b);
}

/** Chemin d'écriture commun. Via entity.save (écran Stock, toutes formules) : fiche simple uniquement, sans historique de prix ni journal d'article. */
export async function saveProduct(store: Store, ctx: Ctx, b: { id?: string; requestId?: string; data: Record<string, unknown>; initialQty?: number }) {
  needModule(ctx, "stock");
  const business = planAllows((await entitlementOf(store, ctx.tenantId)).plan.id, "articles");
  const input: Record<string, unknown> = {};
  for (const f of FIELDS) if (b.data && f in b.data) input[f] = b.data[f];
  let patch: Partial<Article>, full: Article | null = null;
  try {
    if (b.id) patch = normalizePatch(input);
    else { full = normalizeArticle(input); patch = full; }
  } catch (e) { throw new HttpError(400, (e as Error).message); }
  // Fiche enrichie (description, unité, fournisseur) : formule Business. La fiche simple reste ouverte à toutes les formules.
  const rich = (["description", "unit", "supplierId"] as const).some((k) => k in patch && (b.id ? true : patch[k] !== (k === "unit" ? "piece" : "")));
  if (rich && !business) throw new HttpError(402, `« ${FEATURES.articles.label} » est réservé à la formule Business ou supérieure.`);
  if (patch.supplierId) {
    const sup = await store.get("suppliers", patch.supplierId);
    if (!mine(ctx, sup)) throw new HttpError(400, "Fournisseur introuvable dans cette boutique");
  }
  if (b.id) {
    const row = must(await store.get("products", b.id)); if (!mine(ctx, row)) throw new HttpError(403, "Accès refusé");
    if (patch.qtyScale !== undefined && patch.qtyScale !== scaleOf(row)) {
      await needFeature(store, ctx, "packaging"); // quantités décimales : Pro
      // Les mouvements existants sont des entiers à l'ancienne échelle : on ne change la précision que sur un article sans aucun mouvement.
      if ((await store.scan("stock_moves", { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: row.$id }, { maxRows: 1 })).rows.length) throw new HttpError(409, "La précision des quantités ne peut plus changer : cet article a déjà des mouvements de stock.");
      if ((await store.list("article_units", { productId: row.$id, active: true }, 1)).length) throw new HttpError(409, "Retirez d'abord les conditionnements de cet article.");
    }
    if (patch.sku !== undefined) await assertUnique(store, ctx, "sku", patch.sku, { productId: row.$id });
    if (patch.barcode !== undefined) await assertUnique(store, ctx, "barcode", patch.barcode, { productId: row.$id });
    if (!Object.keys(patch).length) return { id: row.$id };
    await store.update("products", row.$id, patch);
    const priceChanged = patch.price !== undefined && patch.price !== Number(row.price), costChanged = patch.cost !== undefined && patch.cost !== Number(row.cost ?? 0);
    if (business && (priceChanged || costChanged)) {
      await store.create("price_history", newId(), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: row.$id, oldPrice: Number(row.price), newPrice: patch.price ?? Number(row.price), oldCost: Number(row.cost ?? 0), newCost: patch.cost ?? Number(row.cost ?? 0), userId: ctx.userId });
      await audit(store, ctx, "article.price", `${row.name} : vente ${row.price}→${patch.price ?? row.price}, achat ${row.cost ?? 0}→${patch.cost ?? row.cost ?? 0}`);
    }
    return { id: row.$id };
  }
  const a = full!;
  // Identifiant dérivé de la demande du client : un nouvel envoi après coupure réseau ne crée jamais de doublon.
  const id = b.requestId ? `a${String(b.requestId).replace(/[^A-Za-z0-9]/g, "").slice(0, 28)}` : newId();
  if (a.qtyScale !== 0) await needFeature(store, ctx, "packaging");
  let qty = 0; // stock initial en entiers de sous-unités
  if (b.initialQty !== undefined && String(b.initialQty).trim() !== "" && Number(b.initialQty) !== 0) {
    try { qty = scaledInt(qtyFor(b.initialQty, a.qtyScale), a.qtyScale); } catch (e) { throw new HttpError(400, `Quantité en stock : ${(e as Error).message}`); }
  }
  const prior = await store.get("products", id);
  if (prior) {
    if (!mine(ctx, prior)) throw new HttpError(409, "Demande déjà utilisée");
    await creationRows(store, ctx, id, prior as unknown as Article, qty, business); // reprise après coupure : complète ce qui manquerait, sans rien doubler
    return { id, duplicate: true };
  }
  await assertUnique(store, ctx, "sku", a.sku); await assertUnique(store, ctx, "barcode", a.barcode);
  await assertQuota(store, ctx.tenantId, "products");
  const created = await store.create("products", id, ctx.tenantId, { ...a, tenantId: ctx.tenantId, shopId: ctx.shopId });
  if (!created) { const ex = await store.get("products", id); if (mine(ctx, ex)) return { id, duplicate: true }; throw new HttpError(409, "Demande déjà utilisée"); }
  await creationRows(store, ctx, id, a, qty, business);
  return { id };
}

export async function archiveArticle(store: Store, ctx: Ctx, b: { id: string; archived: boolean }) {
  needModule(ctx, "stock"); await needFeature(store, ctx, "articles");
  const row = must(await store.get("products", b.id)); if (!mine(ctx, row)) throw new HttpError(403, "Accès refusé");
  const archived = b.archived === true;
  if (!!row.archived !== archived) { await store.update("products", row.$id, { archived }); await audit(store, ctx, archived ? "article.archive" : "article.restore", `${row.name} (${row.$id})`); }
  return { id: row.$id, archived };
}

/** Suppression : gérant ou propriétaire, et seulement si l'article n'a AUCUN historique commercial (ventes, réceptions, transferts, commandes). Sinon : archivage. */
export async function deleteArticle(store: Store, ctx: Ctx, b: { id: string }) {
  needModule(ctx, "stock"); await needFeature(store, ctx, "articles"); need(ctx, "manager");
  const row = must(await store.get("products", b.id)); if (!mine(ctx, row)) throw new HttpError(403, "Accès refusé");
  if (row.hasVariants) throw new HttpError(409, "Cet article a des variantes : supprimez ou archivez-les d'abord.");
  const moves = (await store.scan("stock_moves", { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: row.$id })).rows;
  const used = moves.some((m) => !(m.kind === "adjust" && m.refId === INITIAL));
  const inOrders = (await store.scan("purchase_orders", { tenantId: ctx.tenantId, shopId: ctx.shopId })).rows.some((po) => { try { return (JSON.parse(String(po.lines)) as { productId?: string }[]).some((l) => l.productId === row.$id); } catch { return false; } });
  if (used || inOrders) throw new HttpError(409, "Cet article a un historique (ventes, mouvements ou commandes) : archivez-le plutôt que de le supprimer.");
  for (const m of moves) await store.remove("stock_moves", m.$id);
  for (const h of (await store.scan("price_history", { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: row.$id })).rows) await store.remove("price_history", h.$id);
  if (row.imageFileId) await store.deleteFile(String(row.imageFileId));
  await store.remove("products", row.$id);
  await audit(store, ctx, "article.delete", `${row.name} (${row.$id})`);
  return { id: row.$id };
}

const MAGIC: { mime: string; ext: string; ok: (b: Uint8Array) => boolean }[] = [
  { mime: "image/jpeg", ext: "jpg", ok: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", ext: "png", ok: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: "image/webp", ext: "webp", ok: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
];

/** Photo d'un article : `data` = image compressée en base64 (le client la réduit avant l'envoi) ; `data: null` retire la photo.
 *  Le fichier reçoit les mêmes droits de lecture que la ligne de l'article (propriétaire + employés de la boutique). */
export async function setArticleImage(store: Store, ctx: Ctx, b: { id: string; variantId?: string; mime?: string; data: string | null }) {
  needModule(ctx, "stock"); await needFeature(store, ctx, "articles");
  const prod = must(await store.get("products", b.id)); if (!mine(ctx, prod)) throw new HttpError(403, "Accès refusé");
  let row = prod, table = "products";
  if (b.variantId) { // photo d'une variante : fonction Pro
    await needFeature(store, ctx, "variants");
    const v = must(await store.get("article_variants", b.variantId), "Variante introuvable"); if (!mine(ctx, v) || v.productId !== prod.$id) throw new HttpError(403, "Accès refusé");
    row = v; table = "article_variants";
  }
  const old = row.imageFileId ? String(row.imageFileId) : "";
  if (b.data === null) {
    await store.update(table, row.$id, { imageFileId: "" }); if (old) await store.deleteFile(old);
    await audit(store, ctx, "article.image.remove", `${row.name} (${row.$id})`); return { fileId: "" };
  }
  if (typeof b.data !== "string" || !/^[A-Za-z0-9+/]+=*$/.test(b.data)) throw new HttpError(400, "Image invalide");
  const bytes = new Uint8Array(Buffer.from(b.data, "base64"));
  if (bytes.length < 100) throw new HttpError(400, "Image invalide");
  if (bytes.length > MAX_IMAGE_BYTES) throw new HttpError(413, "Image trop lourde (450 Ko maximum après compression)");
  const kind = MAGIC.find((m) => m.ok(bytes)); // le contenu fait foi, pas le type annoncé par le client
  if (!kind) throw new HttpError(400, "Format d'image non pris en charge (JPEG, PNG ou WebP)");
  const fileId = newId();
  await store.putFile(fileId, bytes, `${row.$id}.${kind.ext}`, kind.mime, readRoles("products", ctx.tenantId, prod as Record<string, unknown>, prod.$id));
  await store.update(table, row.$id, { imageFileId: fileId });
  if (old) await store.deleteFile(old);
  await audit(store, ctx, "article.image", `${row.name} (${row.$id})`);
  return { fileId };
}

export { BUSINESS_FIELDS };
