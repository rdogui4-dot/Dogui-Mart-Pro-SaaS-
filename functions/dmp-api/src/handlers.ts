import { buildPaymentUrl, isExpired, linkRef, type QrProvider } from "../../../src/domain/payment-links";
import { toFcfa } from "../../../src/domain/money";
import { ACCOUNTS } from "../../../src/domain/accounting";
import { checkout, stockFor, type CheckoutInput } from "./checkout";
import { HttpError, need, type Ctx, type Store } from "./store";
import { createFreeInvoice, invoiceFromSale, payCustomerInvoice, saveShop } from "./invoicing";
import { createShop, createStaff, initTenant, resetStaffPassword, transferStock, updateStaff } from "./team";
import { cancelPo, createPo, invoicePo, payInvoice, receivePo } from "./purchasing";

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 30);
const must = <T,>(v: T | null | undefined, msg: string, status = 404): T => { if (v == null) throw new HttpError(status, msg); return v; };
const mine = (ctx: Ctx, r: Record<string, unknown> | null) => !!r && r.tenantId === ctx.tenantId && r.shopId === ctx.shopId;

// Champs modifiables par le client. creditBalance / points / annualSpend sont gérés par le serveur uniquement.
const ENTITIES = {
  products: { min: "manager", fields: ["sku", "barcode", "name", "category", "price", "cost", "minStock", "archived"] },
  customers: { min: "cashier", fields: ["name", "phone", "creditLimit"] },
  suppliers: { min: "manager", fields: ["name", "phone", "email"] },
} as const;

export async function saveEntity(store: Store, ctx: Ctx, b: { table: keyof typeof ENTITIES; id?: string; data: Record<string, unknown> }) {
  const spec = ENTITIES[b.table]; if (!spec) throw new HttpError(400, "Table non autorisée");
  need(ctx, spec.min);
  if (b.table === "customers" && b.data.creditLimit !== undefined) need(ctx, "manager"); // plafond de crédit = manager
  const data: Record<string, unknown> = {};
  for (const f of spec.fields) if (f in b.data) data[f] = b.data[f];
  if (b.id) {
    const row = must(await store.get(b.table, b.id), "Introuvable");
    if (!mine(ctx, row)) throw new HttpError(403, "Accès refusé");
    await store.update(b.table, b.id, data);
    return { id: b.id };
  }
  if (b.table === "products" && (typeof data.name !== "string" || !(Number(data.price) >= 0))) throw new HttpError(400, "Nom et prix requis");
  const id = newId();
  const init = b.table === "customers" ? { creditBalance: 0, points: 0, annualSpend: 0 } : b.table === "suppliers" ? { balance: 0 } : {};
  await store.create(b.table, id, ctx.tenantId, { ...init, ...data, tenantId: ctx.tenantId, shopId: ctx.shopId });
  return { id };
}

/** Inventaire : écrit un mouvement d'ajustement égal à l'écart, jamais un écrasement du stock. */
export async function adjustStock(store: Store, ctx: Ctx, b: { productId: string; counted: number }) {
  need(ctx, "manager");
  const p = must(await store.get("products", b.productId), "Produit introuvable");
  if (!mine(ctx, p)) throw new HttpError(403, "Accès refusé");
  const counted = Math.floor(Number(b.counted)); if (!(counted >= 0)) throw new HttpError(400, "Quantité invalide");
  const diff = counted - (await stockFor(store, p.$id));
  if (diff !== 0) await store.create("stock_moves", newId(), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: p.$id, qty: diff, kind: "adjust", refId: "inventaire", userId: ctx.userId });
  return { diff };
}

export async function repayCredit(store: Store, ctx: Ctx, b: { customerId: string; amount: number; method: "cash" | "wave" | "orange" }) {
  need(ctx, "cashier");
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
  for (const t of [b.waveTemplate, b.orangeTemplate]) if (t) buildPaymentUrl(t, { amount: 1, ref: "TEST" }); // valide https + {amount}
  const id = ctx.shopId.slice(0, 36);
  const prev = await store.get("payment_settings", id);
  // Un champ absent conserve la valeur existante ; une chaîne vide désactive l'opérateur.
  const data = {
    tenantId: ctx.tenantId, shopId: ctx.shopId,
    waveTemplate: b.waveTemplate ?? prev?.waveTemplate ?? "", orangeTemplate: b.orangeTemplate ?? prev?.orangeTemplate ?? "",
    expiryMinutes: Math.min(Math.max(Number(b.expiryMinutes) || Number(prev?.expiryMinutes) || 15, 1), 1440),
  };
  if (!(await store.create("payment_settings", id, ctx.tenantId, data))) await store.update("payment_settings", id, data);
  return { ok: true };
}
export async function getPaymentSettings(store: Store, ctx: Ctx) {
  need(ctx, "cashier");
  const s = await store.get("payment_settings", ctx.shopId.slice(0, 36));
  return { wave: !!s?.waveTemplate, orange: !!s?.orangeTemplate, expiryMinutes: Number(s?.expiryMinutes ?? 15) };
}

export async function createPaymentLink(store: Store, ctx: Ctx, b: { provider: QrProvider; amount: number }) {
  need(ctx, "cashier");
  const amount = toFcfa(b.amount); if (!(amount > 0)) throw new HttpError(400, "Montant invalide");
  if (b.provider !== "wave" && b.provider !== "orange") throw new HttpError(400, "Opérateur invalide");
  const s = must(await store.get("payment_settings", ctx.shopId.slice(0, 36)), "Paiement QR non configuré", 409);
  const template = b.provider === "wave" ? s.waveTemplate : s.orangeTemplate;
  if (!template) throw new HttpError(409, `Lien ${b.provider} non configuré dans les réglages`);
  const id = newId(), reference = linkRef(id);
  const url = buildPaymentUrl(template, { amount, ref: reference });
  const expiresAt = new Date(Date.now() + Number(s.expiryMinutes ?? 15) * 60_000).toISOString();
  await store.create("payment_links", id, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, provider: b.provider, amount, reference, url, status: "pending", saleId: "", txRef: "", expiresAt, createdBy: ctx.userId, confirmedBy: "" });
  return { id, url, reference, amount, expiresAt }; // le QR est dessiné côté client à partir de l'URL
}

/** Confirmation manuelle : l'opérateur saisit l'ID de transaction reçu par SMS/app Business.
 *  Unicité de l'ID par commerçant (anti-réutilisation) + journal d'audit. Sera remplacée par un webhook opérateur. */
export async function confirmPaymentLink(store: Store, ctx: Ctx, b: { linkId: string; txRef: string }) {
  need(ctx, "cashier");
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
  need(ctx, "cashier");
  const link = must(await store.get("payment_links", b.linkId), "Lien introuvable");
  if (!mine(ctx, link)) throw new HttpError(403, "Accès refusé");
  if (link.status !== "pending") throw new HttpError(409, `Lien ${link.status}`);
  await store.update("payment_links", link.$id, { status: "cancelled" });
  return { status: "cancelled" };
}
export async function paymentLinkStatus(store: Store, ctx: Ctx, b: { linkId: string }) {
  need(ctx, "cashier");
  const link = must(await store.get("payment_links", b.linkId), "Lien introuvable");
  if (!mine(ctx, link)) throw new HttpError(403, "Accès refusé");
  const status = link.status === "pending" && isExpired(String(link.expiresAt)) ? "expired" : link.status;
  return { status };
}

/** Actions qui ne dépendent d'aucune boutique particulière (le shopId du contexte est alors vide). */
export const TENANT_LEVEL = new Set(["tenant.init", "shop.create", "staff.create", "staff.update", "staff.resetPassword"]);

export const ACTIONS = {
  checkout: (s: Store, c: Ctx, b: CheckoutInput) => checkout(s, c, b),
  "entity.save": saveEntity, "stock.adjust": adjustStock, "credit.repay": repayCredit,
  "payments.settings.save": savePaymentSettings, "payments.settings.get": (s: Store, c: Ctx) => getPaymentSettings(s, c),
  "payment_link.create": createPaymentLink, "payment_link.confirm": confirmPaymentLink,
  "po.create": createPo, "po.cancel": cancelPo, "po.receive": receivePo, "invoice.supplier.create": invoicePo, "invoice.supplier.pay": payInvoice,
  "shop.save": saveShop, "invoice.customer.fromSale": invoiceFromSale, "invoice.customer.create": createFreeInvoice, "invoice.customer.pay": payCustomerInvoice,
  "tenant.init": initTenant, "shop.create": createShop, "staff.create": createStaff, "staff.update": updateStaff, "staff.resetPassword": resetStaffPassword, "stock.transfer": transferStock,
  "payment_link.cancel": cancelPaymentLink, "payment_link.status": paymentLinkStatus,
} as const;
