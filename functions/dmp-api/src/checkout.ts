import { cartTotal, isQrMethod, settle, toFcfa, type CartLine, type Payment, type PaymentMethod } from "../../../src/domain/money";
import { canExtendCredit } from "../../../src/domain/credit";
import { DEFAULT_RULES, earnedPoints, redeemablePoints, tierFor } from "../../../src/domain/loyalty";
import { saleJournal } from "../../../src/domain/accounting";
import { stockOf, type StockMove } from "../../../src/domain/stock";
import { HttpError, need, type Ctx, type Store } from "./store";

export type CheckoutInput = {
  clientId: string; soldAt?: string; customerId?: string; redeemPoints?: number;
  lines: { productId: string; qty: number; discountPct?: number }[];
  payments: (Payment & { linkId?: string })[];
};
const safeId = (s: string) => s.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 36);

export async function stockFor(store: Store, productId: string): Promise<number> {
  const moves = await store.list("stock_moves", { productId }, 5000);
  return stockOf(moves.map((m) => ({ productId, qty: Number(m.qty), kind: m.kind as StockMove["kind"] })));
}

/** Vente atomique côté serveur : prix et stock lus en base, jamais fournis par le client. */
export async function checkout(store: Store, ctx: Ctx, input: CheckoutInput) {
  need(ctx, "cashier");
  if (!input.clientId || !input.lines?.length) throw new HttpError(400, "Panier vide");
  const saleId = safeId(input.clientId);
  if (saleId.length < 8) throw new HttpError(400, "clientId invalide");

  const existing = await store.get("sales", saleId);
  if (existing && existing.status === "paid") return { saleId, number: existing.number, duplicate: true };
  if (existing && (existing.tenantId !== ctx.tenantId || existing.shopId !== ctx.shopId)) throw new HttpError(409, "Identifiant déjà utilisé");

  // 1) Prix et stock vérifiés en base
  const lines: CartLine[] = [];
  for (const l of input.lines) {
    const qty = Math.floor(Number(l.qty));
    if (!(qty > 0)) throw new HttpError(400, "Quantité invalide");
    const p = await store.get("products", l.productId);
    if (!p || p.tenantId !== ctx.tenantId || p.shopId !== ctx.shopId || p.archived) throw new HttpError(404, "Produit introuvable");
    if (!existing) { // le stock a déjà été décrémenté lors d'une reprise
      const have = await stockFor(store, p.$id);
      if (have < qty) throw new HttpError(409, `Stock insuffisant : ${p.name} (${have})`);
    }
    // Remise > 0 réservée aux managers
    const discountPct = Number(l.discountPct ?? 0);
    if (discountPct > 0) need(ctx, "manager");
    lines.push({ productId: p.$id, name: p.name, unitPrice: Number(p.price), qty, discountPct });
  }
  let total = cartTotal(lines);

  // 2) Client, points
  const customer = input.customerId ? await store.get("customers", input.customerId) : null;
  if (input.customerId && (!customer || customer.tenantId !== ctx.tenantId || customer.shopId !== ctx.shopId)) throw new HttpError(404, "Client introuvable");
  let redeem = 0;
  if (input.redeemPoints && customer) {
    redeem = Math.min(Math.floor(input.redeemPoints), redeemablePoints(Number(customer.points ?? 0), total));
    total -= redeem * DEFAULT_RULES.redeemCfaPerPoint;
  }

  // 3) Paiements : QR = lien confirmé, montant exact, non déjà utilisé
  const links: Record<string, unknown>[] = [];
  for (const p of input.payments) {
    if (isQrMethod(p.method)) {
      const link = p.linkId ? await store.get("payment_links", p.linkId) : null;
      if (!link || link.tenantId !== ctx.tenantId || link.shopId !== ctx.shopId) throw new HttpError(400, "Lien de paiement introuvable");
      if (link.status !== "paid") throw new HttpError(402, "Paiement QR non confirmé");
      if (link.provider !== p.method || Number(link.amount) !== toFcfa(p.amount)) throw new HttpError(400, "Lien de paiement incompatible");
      if (link.saleId && link.saleId !== saleId) throw new HttpError(409, "Lien déjà utilisé");
      links.push(link);
    }
  }
  const credit = input.payments.filter((p) => p.method === "credit").reduce((s, p) => s + toFcfa(p.amount), 0);
  if (credit > 0) {
    if (!customer) throw new HttpError(400, "Client requis pour un crédit");
    const ok = canExtendCredit({ balance: Number(customer.creditBalance ?? 0), limit: Number(customer.creditLimit ?? 0) }, credit);
    if (!ok.ok && !existing) throw new HttpError(409, ok.error);
  }
  const payments: Payment[] = input.payments.map((p) => ({ method: p.method as PaymentMethod, amount: toFcfa(p.amount) }));
  const s = settle(total, payments);
  if (!s.ok) throw new HttpError(402, s.error);

  // 4) Écritures idempotentes : la vente passe "pending" -> "posted" -> "paid"
  const shop = await store.get("shops", ctx.shopId);
  const vatRatePct = Number(shop?.vatRatePct ?? 18);
  const soldAt = input.soldAt && !Number.isNaN(Date.parse(input.soldAt)) ? input.soldAt : new Date().toISOString();
  const number = existing?.number ?? `V-${soldAt.slice(0, 10).replace(/-/g, "")}-${saleId.slice(0, 6).toUpperCase()}`;
  const vat = total - Math.round(total / (1 + vatRatePct / 100));
  await store.create("sales", saleId, ctx.tenantId, {
    tenantId: ctx.tenantId, shopId: ctx.shopId, number, total, vat, customerId: customer?.$id ?? "", cashierId: ctx.userId,
    payments: JSON.stringify(payments), lines: JSON.stringify(lines), status: "pending", clientId: saleId, soldAt,
  });
  const base = saleId.slice(0, 28);
  for (const [i, l] of lines.entries())
    await store.create("stock_moves", `${base}_m${i}`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: l.productId, qty: l.qty, kind: "sale", refId: number, userId: ctx.userId });
  const j = saleJournal({ ref: number, date: soldAt, totalTtc: total, vatRatePct, payments });
  for (const [i, e] of j.entries.entries())
    await store.create("journal_entries", `${base}_j${i}`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, ref: number, account: e.account, debit: e.debit, credit: e.credit, label: e.label, date: soldAt });
  await store.update("sales", saleId, { status: "posted" });

  // 5) Client : crédit, points, cumul annuel (appliqué une seule fois, puis la vente passe "paid")
  const current = await store.get("sales", saleId);
  if (current?.status === "posted") {
    if (customer) {
      const spend = Number(customer.annualSpend ?? 0) + total;
      const pts = Number(customer.points ?? 0) - redeem + earnedPoints(total, tierFor(spend));
      await store.update("customers", customer.$id, { creditBalance: Number(customer.creditBalance ?? 0) + credit, points: pts, annualSpend: spend });
    }
    for (const l of links) await store.update("payment_links", l.$id as string, { saleId });
    await store.update("sales", saleId, { status: "paid" });
  }
  await store.create("audit_log", `${base}_a`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action: "sale.checkout", detail: `${number} ${total}` });
  return { saleId, number, total, change: s.change, duplicate: false };
}
