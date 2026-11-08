import { ACCOUNTS, saleJournal } from "../../../src/domain/accounting";
import { toFcfa } from "../../../src/domain/money";
import { invoiceStatus, invoiceTtc, paidOf, type Payment } from "../../../src/domain/purchasing";
import { HttpError, need, type Ctx, type Store, needModule } from "./store";

const safeId = (s: unknown) => String(s ?? "").replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 36);
const must = <T,>(v: T | null | undefined, msg: string, status = 404): T => { if (v == null) throw new HttpError(status, msg); return v; };
const mine = (ctx: Ctx, r: Record<string, unknown> | null) => !!r && r.tenantId === ctx.tenantId && r.shopId === ctx.shopId;
const parse = <T,>(s: unknown, fallback: T): T => { try { return JSON.parse(String(s)) as T; } catch { return fallback; } };
const ymd = (iso: string) => iso.slice(0, 10).replace(/-/g, "");
const TREASURY = { cash: ACCOUNTS.cash, wave: ACCOUNTS.wave, orange: ACCOUNTS.orange, card: ACCOUNTS.bank } as const;

export async function saveShop(store: Store, ctx: Ctx, b: { name?: string; address?: string; city?: string; phone?: string; legal?: string; vatRatePct?: number }) {
  need(ctx, "owner");
  const vat = b.vatRatePct === undefined ? undefined : Number(b.vatRatePct);
  if (vat !== undefined && !(vat >= 0 && vat <= 30)) throw new HttpError(400, "TVA invalide (0 à 30 %)");
  const clean = (v: unknown, n: number) => (v === undefined ? undefined : String(v).slice(0, n));
  const data: Record<string, unknown> = { name: clean(b.name, 120), address: clean(b.address, 160), city: clean(b.city, 80), phone: clean(b.phone, 32), legal: clean(b.legal, 120), vatRatePct: vat };
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
  if (data.name === "") throw new HttpError(400, "Nom requis");
  const id = ctx.shopId.slice(0, 36);
  if (!(await store.create("shops", id, ctx.tenantId, { tenantId: ctx.tenantId, name: "Mon commerce", vatRatePct: 18, ...data }))) await store.update("shops", id, data);
  return { ok: true };
}

/** Facture à partir d'une vente existante : simple document, aucune écriture comptable (la vente les a déjà passées).
 *  Le crédit accordé à la vente reste dû ; il se règle avec `invoice.customer.pay`. Une seule facture par vente. */
export async function invoiceFromSale(store: Store, ctx: Ctx, b: { saleId: string }) {
  needModule(ctx, "invoices");
  const sale = must(await store.get("sales", String(b.saleId)), "Vente introuvable");
  if (!mine(ctx, sale)) throw new HttpError(403, "Accès refusé");
  if (sale.status !== "paid") throw new HttpError(409, "Vente non finalisée");
  const id = safeId(`iv${sale.$id}`);
  const existing = await store.get("invoices", id);
  if (existing) return { id, number: existing.number, duplicate: true };
  const soldAt = String(sale.soldAt ?? new Date().toISOString());
  const sp = parse<{ method: string; amount: number }[]>(sale.payments, []);
  const total = Number(sale.total);
  // La monnaie rendue n'est pas un règlement : on plafonne les paiements au total de la vente.
  let left = total; const payments: Payment[] = [];
  for (const [i, p] of sp.filter((x) => x.method !== "credit").entries()) {
    const amount = Math.min(toFcfa(p.amount), left); if (amount <= 0) continue; left -= amount;
    payments.push({ id: `${id.slice(0, 30)}_p${i}`, amount, method: p.method as Payment["method"], date: soldAt });
  }
  const paid = paidOf(payments);
  const lines = parse<{ name: string; qty: number; unitPrice: number; discountPct?: number; amount?: number }[]>(sale.lines, []).map((l) => ({ description: l.name, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct, ...(l.amount !== undefined ? { amount: l.amount } : {}) }));
  const number = `FC-${ymd(soldAt)}-${String(sale.$id).slice(0, 6).toUpperCase()}`;
  await store.create("invoices", id, ctx.tenantId, {
    tenantId: ctx.tenantId, shopId: ctx.shopId, number, kind: "customer", partyId: String(sale.customerId ?? ""), total, paid, vat: Number(sale.vat ?? 0), status: invoiceStatus(total, paid),
    dueAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), saleId: String(sale.$id), ref: String(sale.number), lines: JSON.stringify(lines), payments: JSON.stringify(payments),
  });
  return { id, number, duplicate: false };
}

/** Facture libre (prestation, vente à un professionnel…) : prix HT, TVA de la boutique, créance client (411) / ventes (701) / TVA (4431). */
export async function createFreeInvoice(store: Store, ctx: Ctx, b: { invoiceId: string; customerId: string; dueAt?: string; note?: string; lines: { description: string; qty: number; unitPrice: number }[] }) {
  needModule(ctx, "invoices");
  const id = safeId(b.invoiceId); if (id.length < 8) throw new HttpError(400, "invoiceId invalide");
  const customer = must(await store.get("customers", b.customerId), "Client introuvable");
  if (!mine(ctx, customer)) throw new HttpError(403, "Accès refusé");
  if (!b.lines?.length) throw new HttpError(400, "Facture vide");
  const lines = b.lines.map((l) => {
    const qty = Number(l.qty), unitPrice = Number(l.unitPrice), description = String(l.description ?? "").trim().slice(0, 120);
    if (!description) throw new HttpError(400, "Désignation requise");
    if (!Number.isInteger(qty) || qty <= 0) throw new HttpError(400, "Quantité invalide");
    if (!Number.isInteger(unitPrice) || unitPrice < 0) throw new HttpError(400, "Prix invalide");
    return { description, qty, unitPrice };
  });
  const shop = await store.get("shops", ctx.shopId);
  const vatRatePct = Number(shop?.vatRatePct ?? 18);
  const ht = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const total = invoiceTtc(ht, vatRatePct);
  const now = new Date().toISOString();
  const existing = await store.get("invoices", id);
  const number = existing ? String(existing.number) : `FC-${ymd(now)}-${id.slice(0, 6).toUpperCase()}`;
  if (!existing) {
    const due = b.dueAt && !Number.isNaN(Date.parse(b.dueAt)) ? new Date(b.dueAt).toISOString() : new Date(Date.now() + 30 * 86_400_000).toISOString();
    await store.create("invoices", id, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, number, kind: "customer", partyId: customer.$id, total, paid: 0, vat: total - ht, status: "unpaid", dueAt: due, saleId: "", ref: String(b.note ?? "").slice(0, 64), lines: JSON.stringify(lines), payments: "[]" });
  }
  const j = saleJournal({ ref: number, date: now, totalTtc: Number(existing?.total ?? total), vatRatePct, payments: [{ method: "credit", amount: Number(existing?.total ?? total) }] });
  const base = id.slice(0, 28);
  for (const [i, e] of j.entries.entries())
    await store.create("journal_entries", `${base}_j${i}`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, ref: number, account: e.account, debit: e.debit, credit: e.credit, label: e.label, date: now });
  return { id, number, total: Number(existing?.total ?? total), duplicate: !!existing };
}

/** Encaissement d'une facture client (idempotent par paymentId). Pour une facture issue d'une vente à crédit, le crédit du client baisse d'autant. */
export async function payCustomerInvoice(store: Store, ctx: Ctx, b: { invoiceId: string; paymentId: string; amount: number; method: Payment["method"] }) {
  needModule(ctx, "invoices");
  const pid = safeId(b.paymentId); if (pid.length < 8) throw new HttpError(400, "paymentId invalide");
  const inv = must(await store.get("invoices", b.invoiceId), "Facture introuvable");
  if (!mine(ctx, inv) || inv.kind !== "customer") throw new HttpError(403, "Accès refusé");
  const acct = TREASURY[b.method]; if (!acct) throw new HttpError(400, "Mode de règlement invalide");
  const payments = parse<Payment[]>(inv.payments, []);
  const total = Number(inv.total);
  const done = payments.find((p) => p.id === pid);
  let amount = done ? done.amount : Math.min(toFcfa(b.amount), Math.max(0, total - paidOf(payments)));
  const customer = inv.saleId && inv.partyId ? await store.get("customers", String(inv.partyId)) : null;
  if (!done) {
    if (inv.saleId) { // vente à crédit : on ne peut encaisser plus que le crédit encore ouvert du client
      if (!customer) throw new HttpError(409, "Une facture de vente à crédit doit être liée à un client");
      amount = Math.min(amount, Number(customer.creditBalance ?? 0));
    }
    if (!(amount > 0)) throw new HttpError(409, total - paidOf(payments) <= 0 ? "Facture déjà soldée" : inv.saleId ? "Crédit du client déjà soldé" : "Montant invalide");
    payments.push({ id: pid, amount, method: b.method, date: new Date().toISOString() });
    const paid = paidOf(payments);
    await store.update("invoices", inv.$id, { payments: JSON.stringify(payments), paid, status: invoiceStatus(total, paid) });
    if (customer) await store.update("customers", customer.$id, { creditBalance: Math.max(0, Number(customer.creditBalance ?? 0) - amount) });
  }
  const ref = `EN-${String(inv.number)}`; const date = (done ?? payments[payments.length - 1]!).date; const base = pid.slice(0, 28);
  const row = { tenantId: ctx.tenantId, shopId: ctx.shopId, ref, date, label: `Encaissement ${inv.number}` };
  await store.create("journal_entries", `${base}_j0`, ctx.tenantId, { ...row, account: acct, debit: amount, credit: 0 });
  await store.create("journal_entries", `${base}_j1`, ctx.tenantId, { ...row, account: ACCOUNTS.customers, debit: 0, credit: amount });
  await store.create("audit_log", `${base}_a`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action: "invoice.customer.pay", detail: `${inv.number} ${amount} ${b.method}` });
  const paid = paidOf(payments);
  return { paid, due: Math.max(0, total - paid), status: invoiceStatus(total, paid), duplicate: !!done };
}
