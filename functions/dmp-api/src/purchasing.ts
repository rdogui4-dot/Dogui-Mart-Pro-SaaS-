import { ACCOUNTS, purchaseJournal } from "../../../src/domain/accounting";
import { toFcfa } from "../../../src/domain/money";
import { invoiceStatus, invoiceTtc, lineHt, paidOf, poStatus, toInvoice, toReceive, validateQuantities, weightedCost, type Payment, type PoLine } from "../../../src/domain/purchasing";
import { stockFor, stockScaledVariant } from "./checkout";
import { qtyFor, scaleOf, scaledInt, fromScaled } from "../../../src/domain/quantity";
import { lineKey } from "../../../src/domain/variants";
import { HttpError, need, type Ctx, type Row, type Store, needModule } from "./store";

const safeId = (s: string) => String(s ?? "").replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 36);
const must = <T,>(v: T | null | undefined, msg: string, status = 404): T => { if (v == null) throw new HttpError(status, msg); return v; };
const mine = (ctx: Ctx, r: Record<string, unknown> | null) => !!r && r.tenantId === ctx.tenantId && r.shopId === ctx.shopId;
const parse = <T,>(s: unknown, fallback: T): T => { try { return JSON.parse(String(s)) as T; } catch { return fallback; } };
const day = () => new Date().toISOString();
const ymd = (iso: string) => iso.slice(0, 10).replace(/-/g, "");

async function loadPo(store: Store, ctx: Ctx, poId: string) {
  const po = must(await store.get("purchase_orders", poId), "Commande introuvable");
  if (!mine(ctx, po)) throw new HttpError(403, "Accès refusé");
  return { po, lines: parse<PoLine[]>(po.lines, []), receipts: parse<string[]>(po.receipts, []), invoicedIds: parse<string[]>(po.invoicedIds, []) };
}

export async function createPo(store: Store, ctx: Ctx, b: { clientId: string; supplierId: string; lines: { productId: string; variantId?: string; qty: number; unitCost: number }[] }) {
  needModule(ctx, "purchases");
  const id = safeId(b.clientId); if (id.length < 8) throw new HttpError(400, "clientId invalide");
  const existing = await store.get("purchase_orders", id);
  if (existing) { if (!mine(ctx, existing)) throw new HttpError(409, "Identifiant déjà utilisé"); return { id, number: existing.number, duplicate: true }; }
  const supplier = must(await store.get("suppliers", b.supplierId), "Fournisseur introuvable");
  if (!mine(ctx, supplier)) throw new HttpError(403, "Accès refusé");
  if (!b.lines?.length) throw new HttpError(400, "Commande vide");
  const seen = new Set<string>(); const lines: PoLine[] = [];
  for (const l of b.lines) {
    const unitCost = Number(l.unitCost);
    if (!Number.isInteger(unitCost) || unitCost < 0) throw new HttpError(400, "Prix d'achat invalide");
    if (seen.has(lineKey(l))) throw new HttpError(400, "Produit en double");
    seen.add(lineKey(l));
    const p = must(await store.get("products", l.productId), "Produit introuvable");
    if (!mine(ctx, p)) throw new HttpError(403, "Accès refusé");
    let v: Row | null = null;
    if (p.hasVariants) { v = l.variantId ? await store.get("article_variants", l.variantId) : null; if (!v || !mine(ctx, v) || v.productId !== p.$id) throw new HttpError(400, `Choisissez une variante pour ${p.name}`); }
    else if (l.variantId) throw new HttpError(400, `${p.name} n'a pas de variantes`);
    let qty: number; try { qty = qtyFor(l.qty, scaleOf(p)); } catch (e) { throw new HttpError(400, `${p.name} : ${(e as Error).message}`); }
    lines.push({ productId: p.$id, ...(v ? { variantId: v.$id } : {}), name: v ? `${p.name} — ${v.label}` : String(p.name), qty, unitCost, received: 0, invoiced: 0 });
  }
  const now = day(); const number = `BC-${ymd(now)}-${id.slice(0, 6).toUpperCase()}`;
  const total = lines.reduce((s, l) => s + lineHt(l.qty, l.unitCost), 0);
  await store.create("purchase_orders", id, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, number, supplierId: supplier.$id, lines: JSON.stringify(lines), total, status: "ordered", receipts: "[]", invoicedIds: "[]" });
  await store.create("audit_log", `${id.slice(0, 30)}_a`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action: "po.create", detail: `${number} ${total}` });
  return { id, number, total, duplicate: false };
}

export async function cancelPo(store: Store, ctx: Ctx, b: { poId: string }) {
  needModule(ctx, "purchases");
  const { po, lines } = await loadPo(store, ctx, b.poId);
  if (lines.some((l) => l.received > 0)) throw new HttpError(409, "Commande déjà réceptionnée");
  if (po.status === "cancelled") return { status: "cancelled" };
  await store.update("purchase_orders", po.$id, { status: "cancelled" });
  return { status: "cancelled" };
}

/** Réception (totale ou partielle) : mouvements de stock + coût moyen pondéré.
 *  Ordre sûr en cas de reprise : la commande est mise à jour d'abord (receiptId mémorisé), puis les mouvements sont écrits avec des identifiants déterministes. */
export async function receivePo(store: Store, ctx: Ctx, b: { poId: string; receiptId: string; lines: { productId: string; variantId?: string; qty: number }[] }) {
  needModule(ctx, "purchases");
  const rid = safeId(b.receiptId); if (rid.length < 8) throw new HttpError(400, "receiptId invalide");
  const { po, lines, receipts } = await loadPo(store, ctx, b.poId);
  if (po.status === "cancelled") throw new HttpError(409, "Commande annulée");
  const duplicate = receipts.includes(rid);
  const wanted = (b.lines ?? []).map((w) => ({ productId: w.productId, ...(w.variantId ? { variantId: w.variantId } : {}), qty: Number(String(w.qty).replace(",", ".")) }));
  const scales = new Map<string, number>();
  for (const w of wanted) scales.set(w.productId, scaleOf(await store.get("products", w.productId)));
  if (!duplicate) {
    const v = validateQuantities(lines, wanted, toReceive, (id) => scales.get(id) ?? 0); if (!v.ok) throw new HttpError(409, v.error);
    // coûts moyens calculés avant que le stock ne bouge (par variante pour un article décliné)
    const costs = new Map<string, { table: string; id: string; cost: number }>();
    for (const w of wanted) {
      const line = lines.find((l) => lineKey(l) === lineKey(w))!;
      const p = must(await store.get("products", w.productId), "Produit introuvable");
      const v = w.variantId ? must(await store.get("article_variants", w.variantId), "Variante introuvable") : null;
      const stock = v ? fromScaled(await stockScaledVariant(store, v.$id), scales.get(w.productId) ?? 0) : await stockFor(store, w.productId, scales.get(w.productId));
      costs.set(lineKey(w), { table: v ? "article_variants" : "products", id: v ? v.$id : p.$id, cost: weightedCost(stock, Number((v ?? p).cost ?? 0), w.qty, line.unitCost) });
      line.received = Math.round((line.received + w.qty) * 1e6) / 1e6;
    }
    await store.update("purchase_orders", po.$id, { lines: JSON.stringify(lines), receipts: JSON.stringify([...receipts, rid]), status: poStatus(lines) });
    for (const c of costs.values()) await store.update(c.table, c.id, { cost: c.cost });
  }
  const base = rid.slice(0, 28);
  for (const [i, w] of wanted.entries())
    await store.create("stock_moves", `${base}_m${i}`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: w.productId, ...(w.variantId ? { variantId: w.variantId } : {}), qty: scaledInt(w.qty, scales.get(w.productId) ?? 0), kind: "purchase", refId: String(po.number), userId: ctx.userId });
  return { status: poStatus(lines), duplicate };
}

/** Facture fournisseur sur les quantités reçues et non encore facturées. Écritures SYSCOHADA : 601 + 4452 / 401. */
export async function invoicePo(store: Store, ctx: Ctx, b: { poId: string; invoiceId: string; supplierRef?: string; dueAt?: string; lines?: { productId: string; variantId?: string; qty: number }[] }) {
  needModule(ctx, "accounting");
  const iid = safeId(b.invoiceId); if (iid.length < 8) throw new HttpError(400, "invoiceId invalide");
  const { po, lines, invoicedIds } = await loadPo(store, ctx, b.poId);
  if (po.status === "cancelled") throw new HttpError(409, "Commande annulée");
  const duplicate = invoicedIds.includes(iid);
  const wanted = (b.lines?.length ? b.lines : lines.filter((l) => toInvoice(l) > 0).map((l) => ({ productId: l.productId, variantId: l.variantId, qty: toInvoice(l) }))).map((w) => ({ productId: w.productId, ...(w.variantId ? { variantId: w.variantId } : {}), qty: Number(w.qty) }));
  const shop = await store.get("shops", ctx.shopId);
  const vatRatePct = Number(shop?.vatRatePct ?? 18);
  if (!duplicate) {
    const iscales = new Map<string, number>(); for (const w of wanted) iscales.set(w.productId, scaleOf(await store.get("products", w.productId)));
    const v = validateQuantities(lines, wanted, toInvoice, (id) => iscales.get(id) ?? 0); if (!v.ok) throw new HttpError(409, v.error === "Aucune ligne" ? "Rien à facturer : réceptionnez d'abord" : v.error);
    for (const w of wanted) { const ln = lines.find((l) => lineKey(l) === lineKey(w))!; ln.invoiced = Math.round((ln.invoiced + w.qty) * 1e6) / 1e6; }
    await store.update("purchase_orders", po.$id, { lines: JSON.stringify(lines), invoicedIds: JSON.stringify([...invoicedIds, iid]) });
  }
  // En reprise, la facture existe peut-être déjà : on ne la recrée pas, on complète seulement les écritures manquantes.
  const existing = await store.get("invoices", iid);
  const now = day();
  const ht = wanted.reduce((s, w) => s + lineHt(w.qty, lines.find((l) => lineKey(l) === lineKey(w))!.unitCost), 0);
  const total = existing ? Number(existing.total) : invoiceTtc(ht, vatRatePct);
  const number = existing ? String(existing.number) : `FF-${ymd(now)}-${iid.slice(0, 6).toUpperCase()}`;
  if (!existing) {
    const due = b.dueAt && !Number.isNaN(Date.parse(b.dueAt)) ? new Date(b.dueAt).toISOString() : new Date(Date.now() + 30 * 86_400_000).toISOString();
    await store.create("invoices", iid, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, number, kind: "supplier", partyId: String(po.supplierId), total, paid: 0, status: "unpaid", dueAt: due, poId: po.$id, ref: String(b.supplierRef ?? "").slice(0, 64), vat: total - Math.round(total / (1 + vatRatePct / 100)), payments: "[]" });
  }
  const j = purchaseJournal({ ref: number, date: now, totalTtc: total, vatRatePct });
  const base = iid.slice(0, 28);
  for (const [i, e] of j.entries.entries())
    await store.create("journal_entries", `${base}_j${i}`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, ref: number, account: e.account, debit: e.debit, credit: e.credit, label: e.label, date: now });
  return { id: iid, number, total, duplicate };
}

const TREASURY = { cash: ACCOUNTS.cash, wave: ACCOUNTS.wave, orange: ACCOUNTS.orange, card: ACCOUNTS.bank } as const;

/** Règlement (total ou partiel) d'une facture fournisseur. Idempotent par paymentId. */
export async function payInvoice(store: Store, ctx: Ctx, b: { invoiceId: string; paymentId: string; amount: number; method: Payment["method"] }) {
  needModule(ctx, "accounting");
  const pid = safeId(b.paymentId); if (pid.length < 8) throw new HttpError(400, "paymentId invalide");
  const inv = must(await store.get("invoices", b.invoiceId), "Facture introuvable");
  if (!mine(ctx, inv) || inv.kind !== "supplier") throw new HttpError(403, "Accès refusé");
  const acct = TREASURY[b.method]; if (!acct) throw new HttpError(400, "Mode de règlement invalide");
  const payments = parse<Payment[]>(inv.payments, []);
  const total = Number(inv.total);
  const done = payments.find((p) => p.id === pid);
  const due = Math.max(0, total - paidOf(payments));
  const amount = done ? done.amount : Math.min(toFcfa(b.amount), due);
  if (!done) {
    if (!(amount > 0)) throw new HttpError(409, due === 0 ? "Facture déjà soldée" : "Montant invalide");
    payments.push({ id: pid, amount, method: b.method, date: day() });
    const paid = paidOf(payments);
    await store.update("invoices", inv.$id, { payments: JSON.stringify(payments), paid, status: invoiceStatus(total, paid) });
  }
  const ref = `RF-${String(inv.number)}`; const date = (done ?? payments[payments.length - 1]!).date; const base = pid.slice(0, 28);
  const row = { tenantId: ctx.tenantId, shopId: ctx.shopId, ref, date, label: `Règlement ${inv.number}` };
  await store.create("journal_entries", `${base}_j0`, ctx.tenantId, { ...row, account: ACCOUNTS.suppliers, debit: amount, credit: 0 });
  await store.create("journal_entries", `${base}_j1`, ctx.tenantId, { ...row, account: acct, debit: 0, credit: amount });
  await store.create("audit_log", `${base}_a`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action: "invoice.pay", detail: `${inv.number} ${amount} ${b.method}` });
  const paid = paidOf(payments);
  return { paid, due: Math.max(0, total - paid), status: invoiceStatus(total, paid), duplicate: !!done };
}
export type { Row };
