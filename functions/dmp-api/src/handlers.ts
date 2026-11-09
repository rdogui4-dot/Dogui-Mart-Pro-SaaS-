import { buildPaymentUrl, isExpired, linkRef, normalizeTemplate, type QrProvider } from "../../../src/domain/payment-links";
import { toFcfa } from "../../../src/domain/money";
import { fromScaled, qtyFor, scaleOf, scaledInt } from "../../../src/domain/quantity";
import { trackingOf } from "../../../src/domain/tracking";
import { lotsWithStock } from "./tracking";
import { ACCOUNTS } from "../../../src/domain/accounting";
import { checkout, stockScaled, stockScaledVariant, type CheckoutInput } from "./checkout";
import { HttpError, need, type Ctx, type Row, type Store, needModule } from "./store";
import { createFreeInvoice, invoiceFromSale, payCustomerInvoice, saveShop } from "./invoicing";
import { consolidatedReport } from "./reports";
import { assertQuota, platformGrant, platformLifetime, platformMarkReminded, platformMe, platformPayments, platformRenewals, platformReview, platformSettingsGet, platformSettingsSave, subscriptionCheckout, subscriptionGet, subscriptionSubmitProof } from "./subscriptions";
import { createShop, createStaff, initTenant, resetStaffPassword, transferStock, updateStaff } from "./team";
import { saveUnits } from "./units";
import { deletePriceRule, savePriceRule } from "./pricing";
import { addSerials, receiveLot, setSerialStatus, updateLot, writeOffLot } from "./tracking";
import { articleProfitability, deleteSupplierLink, saveSupplierLink } from "./costing";
import { archiveVariant, deleteVariant, saveVariant } from "./variants";
import { refuseBundle, saveComponents } from "./bundles";
import { isCategory } from "../../../src/domain/pricing";
import { archiveArticle, needFeature, deleteArticle, saveArticle, saveProduct, setArticleImage } from "./articles";
import { cancelPo, createPo, invoicePo, payInvoice, receivePo } from "./purchasing";

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 30);
const must = <T,>(v: T | null | undefined, msg: string, status = 404): T => { if (v == null) throw new HttpError(status, msg); return v; };
const mine = (ctx: Ctx, r: Record<string, unknown> | null) => !!r && r.tenantId === ctx.tenantId && r.shopId === ctx.shopId;

// Champs modifiables par le client. creditBalance / points / annualSpend sont gérés par le serveur uniquement.
/** Actions de lecture / d'abonnement toujours permises, même quand l'abonnement est expiré. */
export const LOCK_EXEMPT = new Set(["report.consolidated", "subscription.get", "subscription.checkout", "subscription.submitProof", "tenant.init", "payments.settings.get", "payment_link.status"]);

const ENTITIES = {
  products: { module: "stock", fields: [] }, // géré par articles.ts
  customers: { module: "customers", fields: ["name", "phone", "creditLimit", "category"] },
  suppliers: { module: "purchases", fields: ["name", "phone", "email"] },
} as const;

export async function saveEntity(store: Store, ctx: Ctx, b: { table: keyof typeof ENTITIES; id?: string; data: Record<string, unknown> }) {
  const spec = ENTITIES[b.table]; if (!spec) throw new HttpError(400, "Table non autorisée");
  needModule(ctx, spec.module);
  if (b.table === "customers" && b.data.creditLimit !== undefined) need(ctx, "manager"); // plafond de crédit = manager
  if (b.table === "customers" && b.data.category !== undefined) { // catégorie tarifaire (gros, revendeur) : décision de gérant, fonction Pro pour en attribuer une
    need(ctx, "manager");
    if (!isCategory(b.data.category)) throw new HttpError(400, "Catégorie de clients inconnue");
    if (b.data.category) await needFeature(store, ctx, "tieredPricing");
  }
  if (b.table === "products") return saveProduct(store, ctx, { id: b.id, data: b.data }); // un seul chemin d'écriture pour les articles
  const data: Record<string, unknown> = {};
  for (const f of spec.fields) if (f in b.data) data[f] = b.data[f];
  if (b.id) {
    const row = must(await store.get(b.table, b.id), "Introuvable");
    if (!mine(ctx, row)) throw new HttpError(403, "Accès refusé");
    await store.update(b.table, b.id, data);
    return { id: b.id };
  }
  const id = newId();
  const init = b.table === "customers" ? { creditBalance: 0, points: 0, annualSpend: 0 } : { balance: 0 };
  await store.create(b.table, id, ctx.tenantId, { ...init, ...data, tenantId: ctx.tenantId, shopId: ctx.shopId });
  return { id };
}

/** Inventaire : écrit un mouvement d'ajustement égal à l'écart, jamais un écrasement du stock. */
export async function adjustStock(store: Store, ctx: Ctx, b: { productId: string; variantId?: string; lotId?: string; counted: number | string }) {
  needModule(ctx, "stock");
  const p = must(await store.get("products", b.productId), "Produit introuvable");
  if (!mine(ctx, p)) throw new HttpError(403, "Accès refusé");
  refuseBundle(p, "son stock se déduit de ses composants, il ne se compte pas.");
  const scale = scaleOf(p);
  let counted: number;
  try { counted = String(b.counted).trim() === "0" ? 0 : qtyFor(b.counted, scale); } catch (e) { throw new HttpError(400, (e as Error).message); }
  let variant: Row | null = null;
  if (p.hasVariants) { // inventaire d'un article décliné : variante par variante
    variant = b.variantId ? await store.get("article_variants", b.variantId) : null;
    if (!variant || !mine(ctx, variant) || variant.productId !== p.$id) throw new HttpError(400, "Choisissez la variante à compter");
  } else if (b.variantId) throw new HttpError(400, "Cet article n'a pas de variantes");
  const mode = trackingOf(p); let lot: Row | null = null;
  if (mode === "serial") throw new HttpError(409, "Article suivi par numéro de série : le stock se corrige par le statut de chaque numéro (Séries)");
  if (mode === "lot") { // l'inventaire d'un article suivi par lot se fait lot par lot
    lot = b.lotId ? await store.get("article_lots", b.lotId) : null;
    if (!lot || !mine(ctx, lot) || lot.productId !== p.$id || String(lot.variantId ?? "") !== (variant?.$id ?? "")) throw new HttpError(400, "Choisissez le lot à compter");
  }
  const current = lot ? ((await lotsWithStock(store, ctx, p.$id, String(lot.variantId ?? ""))).find((x) => x.id === lot!.$id)?.qty ?? 0) : variant ? await stockScaledVariant(store, variant.$id) : await stockScaled(store, p.$id);
  const diff = scaledInt(counted, scale) - current; // écart en sous-unités : jamais un écrasement du stock
  if (diff !== 0) await store.create("stock_moves", newId(), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: p.$id, ...(variant ? { variantId: variant.$id } : {}), ...(lot ? { lotId: lot.$id } : {}), qty: diff, kind: "adjust", refId: "inventaire", userId: ctx.userId });
  return { diff: fromScaled(diff, scale) };
}

export async function repayCredit(store: Store, ctx: Ctx, b: { customerId: string; amount: number; method: "cash" | "wave" | "orange" }) {
  needModule(ctx, "pos");
  const c = must(await store.get("customers", b.customerId), "Client introuvable");
  if (!mine(ctx, c)) throw new HttpError(403, "Accès refusé");
  const amount = Math.min(toFcfa(b.amount), Number(c.creditBalance ?? 0));
  if (!(amount > 0)) throw new HttpError(400, "Rien à encaisser");
  const acct = { cash: ACCOUNTS.cash, wave: ACCOUNTS.wave, orange: ACCOUNTS.orange }[b.method]; if (!acct) throw new HttpError(400, "Mode invalide");
  const id = newId(), ref = `R-${id.slice(0, 6).toUpperCase()}`, date = new Date().toISOString();
  const balance = Number(c.creditBalance) - amount;
  await store.update("customers", c.$id, { creditBalance: balance });
  const base = { tenantId: ctx.tenantId, shopId: ctx.shopId, ref, date };
  await store.create("journal_entries", `${id}_j0`, ctx.tenantId, { ...base, account: acct, debit: amount, credit: 0, label: `Remboursement crédit ${c.name}` });
  await store.create("journal_entries", `${id}_j1`, ctx.tenantId, { ...base, account: ACCOUNTS.customers, debit: 0, credit: amount, label: `Remboursement crédit ${c.name}` });
  return { repaid: amount, balance };
}

// ---------- Paiements par lien / QR code (Wave Business, Orange Business) ----------
export async function savePaymentSettings(store: Store, ctx: Ctx, b: { waveTemplate?: string; orangeTemplate?: string; expiryMinutes?: number }) {
  need(ctx, "owner");
  // Faute de saisie = réponse 400 claire (jamais « Erreur interne »). Un modèle accepté est testé avec un montant et une référence d'essai.
  const norm: { waveTemplate?: string; orangeTemplate?: string } = {}; const converted: string[] = [];
  for (const [key, provider, label] of [["waveTemplate", "wave", "Wave Business"], ["orangeTemplate", "orange", "Orange Business"]] as const) {
    const raw = b[key]; if (!raw) continue;
    try { const n = normalizeTemplate(raw, provider); buildPaymentUrl(n.template, { amount: 1, ref: "TEST" }); norm[key] = n.template; if (n.converted) converted.push(provider); }
    catch (e) { throw new HttpError(400, `Lien ${label} : ${(e as Error).message}`); }
  }
  const id = ctx.shopId.slice(0, 36);
  const prev = await store.get("payment_settings", id);
  // Un champ absent conserve la valeur existante ; une chaîne vide désactive l'opérateur.
  const data = {
    tenantId: ctx.tenantId, shopId: ctx.shopId,
    waveTemplate: norm.waveTemplate ?? (b.waveTemplate === "" ? "" : prev?.waveTemplate ?? ""), orangeTemplate: norm.orangeTemplate ?? (b.orangeTemplate === "" ? "" : prev?.orangeTemplate ?? ""),
    expiryMinutes: Math.min(Math.max(Number(b.expiryMinutes) || Number(prev?.expiryMinutes) || 15, 1), 1440),
  };
  if (!(await store.create("payment_settings", id, ctx.tenantId, data))) await store.update("payment_settings", id, data);
  return { ok: true, converted };
}
export async function getPaymentSettings(store: Store, ctx: Ctx) {
  needModule(ctx, "pos");
  const s = await store.get("payment_settings", ctx.shopId.slice(0, 36));
  return { wave: !!s?.waveTemplate, orange: !!s?.orangeTemplate, expiryMinutes: Number(s?.expiryMinutes ?? 15) };
}

export async function createPaymentLink(store: Store, ctx: Ctx, b: { provider: QrProvider; amount: number }) {
  needModule(ctx, "pos");
  const amount = toFcfa(b.amount); if (!(amount > 0)) throw new HttpError(400, "Montant invalide");
  if (b.provider !== "wave" && b.provider !== "orange") throw new HttpError(400, "Opérateur invalide");
  const s = must(await store.get("payment_settings", ctx.shopId.slice(0, 36)), "Paiement QR non configuré", 409);
  const template = b.provider === "wave" ? s.waveTemplate : s.orangeTemplate;
  if (!template) throw new HttpError(409, `Lien ${b.provider} non configuré dans les réglages`);
  const id = newId(), reference = linkRef(id);
  let url: string; try { url = buildPaymentUrl(template, { amount, ref: reference }); } catch { throw new HttpError(409, "Le lien enregistré pour cet opérateur est invalide : corrigez-le dans Réglages → Paiements QR."); }
  const expiresAt = new Date(Date.now() + Number(s.expiryMinutes ?? 15) * 60_000).toISOString();
  await store.create("payment_links", id, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, provider: b.provider, amount, reference, url, status: "pending", saleId: "", txRef: "", expiresAt, createdBy: ctx.userId, confirmedBy: "" });
  return { id, url, reference, amount, expiresAt }; // le QR est dessiné côté client à partir de l'URL
}

/** Confirmation manuelle : l'opérateur saisit l'ID de transaction reçu par SMS/app Business.
 *  Unicité de l'ID par commerçant (anti-réutilisation) + journal d'audit. Sera remplacée par un webhook opérateur. */
export async function confirmPaymentLink(store: Store, ctx: Ctx, b: { linkId: string; txRef: string }) {
  needModule(ctx, "pos");
  const link = must(await store.get("payment_links", b.linkId), "Lien introuvable");
  if (!mine(ctx, link)) throw new HttpError(403, "Accès refusé");
  if (link.status === "paid") return { status: "paid" };
  if (link.status !== "pending") throw new HttpError(409, `Lien ${link.status}`);
  if (isExpired(String(link.expiresAt))) { await store.update("payment_links", link.$id, { status: "expired" }); throw new HttpError(410, "Lien expiré"); }
  const txRef = String(b.txRef ?? "").trim().toUpperCase();
  if (txRef.length < 6) throw new HttpError(400, "ID de transaction requis (6 caractères min.)");
  const dup = await store.list("payment_links", { tenantId: ctx.tenantId, txRef }, 1);
  if (dup.length) throw new HttpError(409, "Cet ID de transaction a déjà servi");
  await store.update("payment_links", link.$id, { status: "paid", txRef, confirmedBy: ctx.userId });
  await store.create("audit_log", newId(), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action: "payment_link.confirm", detail: `${link.reference} ${link.provider} ${link.amount} tx=${txRef}` });
  return { status: "paid" };
}
export async function cancelPaymentLink(store: Store, ctx: Ctx, b: { linkId: string }) {
  needModule(ctx, "pos");
  const link = must(await store.get("payment_links", b.linkId), "Lien introuvable");
  if (!mine(ctx, link)) throw new HttpError(403, "Accès refusé");
  if (link.status !== "pending") throw new HttpError(409, `Lien ${link.status}`);
  await store.update("payment_links", link.$id, { status: "cancelled" });
  return { status: "cancelled" };
}
export async function paymentLinkStatus(store: Store, ctx: Ctx, b: { linkId: string }) {
  needModule(ctx, "pos");
  const link = must(await store.get("payment_links", b.linkId), "Lien introuvable");
  if (!mine(ctx, link)) throw new HttpError(403, "Accès refusé");
  const status = link.status === "pending" && isExpired(String(link.expiresAt)) ? "expired" : link.status;
  return { status };
}

/** Actions qui ne dépendent d'aucune boutique particulière (le shopId du contexte est alors vide). */
export const TENANT_LEVEL = new Set(["report.consolidated", "subscription.get", "subscription.checkout", "subscription.submitProof", "tenant.init", "shop.create", "staff.create", "staff.update", "staff.resetPassword"]);

export const ACTIONS = {
  checkout: (s: Store, c: Ctx, b: CheckoutInput) => checkout(s, c, b),
  "entity.save": saveEntity, "article.save": saveArticle, "article.archive": archiveArticle, "article.delete": deleteArticle, "article.image": setArticleImage, "article.units.save": saveUnits, "bundle.components": saveComponents, "lot.receive": receiveLot, "lot.update": updateLot, "lot.writeoff": writeOffLot, "serial.add": addSerials, "serial.status": setSerialStatus, "supplier.link.save": saveSupplierLink, "supplier.link.delete": deleteSupplierLink, "article.profitability": articleProfitability, "price.rule.save": savePriceRule, "price.rule.delete": deletePriceRule, "variant.save": saveVariant, "variant.archive": archiveVariant, "variant.delete": deleteVariant, "stock.adjust": adjustStock, "credit.repay": repayCredit,
  "payments.settings.save": savePaymentSettings, "payments.settings.get": (s: Store, c: Ctx) => getPaymentSettings(s, c),
  "payment_link.create": createPaymentLink, "payment_link.confirm": confirmPaymentLink,
  "po.create": createPo, "po.cancel": cancelPo, "po.receive": receivePo, "invoice.supplier.create": invoicePo, "invoice.supplier.pay": payInvoice,
  "shop.save": saveShop, "invoice.customer.fromSale": invoiceFromSale, "invoice.customer.create": createFreeInvoice, "invoice.customer.pay": payCustomerInvoice,
  "tenant.init": initTenant, "shop.create": createShop, "staff.create": createStaff, "staff.update": updateStaff, "staff.resetPassword": resetStaffPassword, "stock.transfer": transferStock,
  "subscription.get": subscriptionGet, "subscription.checkout": subscriptionCheckout, "subscription.submitProof": subscriptionSubmitProof,
  "platform.me": platformMe, "platform.subscription.lifetime": platformLifetime, "platform.renewals.list": platformRenewals, "platform.renewals.markReminded": platformMarkReminded, "platform.payments.list": platformPayments, "platform.payment.review": platformReview, "platform.subscription.grant": platformGrant, "platform.settings.save": platformSettingsSave, "platform.settings.get": platformSettingsGet,
  "report.consolidated": consolidatedReport,
  "payment_link.cancel": cancelPaymentLink, "payment_link.status": paymentLinkStatus,
} as const;
