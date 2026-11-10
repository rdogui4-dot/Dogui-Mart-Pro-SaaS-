/** Réclamations fournisseur et avoirs : unités endommagées/refusées/retournées rendues VISIBLES, décision tracée (retour, rebut, remise en stock), avoir fournisseur déduit d'une facture OU remboursé en argent (caisse ou compte).
 *  Les écritures comptables suivent le plan existant : déduction = débit 401 / crédit 601 ; remboursement = débit compte d'argent / crédit 401 (le flux apparaît ainsi dans la trésorerie). */
import { createHash } from "node:crypto";
import { ACCOUNTS } from "../../../src/domain/accounting";
import { MAX_AMOUNT } from "../../../src/domain/articles";
import { scaleOf, scaledInt } from "../../../src/domain/quantity";
import { invoiceStatus, paidOf as paidOfPayments } from "../../../src/domain/purchasing";
import { lineKey } from "../../../src/domain/variants";
import { openSessionOf } from "./cashier";
import { names } from "./inventory";
import { gate } from "./purchasing-plus";
import { enforce } from "./fin-rules";
import { HttpError, need, needModule, type BatchOp, type Ctx, type Row, type Store } from "./store";

const sha = (s: string) => createHash("sha1").update(s).digest("hex");
const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 30);
const parse = <T,>(s: unknown, fb: T): T => { try { const v = JSON.parse(String(s)); return v ?? fb; } catch { return fb; } };
const text = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const mine = (ctx: Ctx, r: Row | null): r is Row => !!r && r.tenantId === ctx.tenantId && r.shopId === ctx.shopId;
const MIN = (ctx: Ctx) => ({ tenantId: ctx.tenantId, shopId: ctx.shopId });
const aud = (ctx: Ctx, action: string, detail: string): BatchOp => ({ kind: "create", table: "audit_log", id: newId(), tenantId: ctx.tenantId, data: { ...MIN(ctx), userId: ctx.userId, action, detail: detail.slice(0, 1000) } });
const key = (v: unknown): string => { const k = String(v ?? "").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 36); if (k.length < 8) throw new HttpError(400, "Identifiant de demande invalide (8 caractères au moins)"); return k; };
const amountOf = (v: unknown, label: string): number => { const n = Number(String(v ?? "").replace(/\s/g, "")); if (!Number.isInteger(n) || n < 1 || n > MAX_AMOUNT) throw new HttpError(400, `${label} invalide (entier en FCFA, au moins 1)`); return n; };
async function moneyGate(store: Store, ctx: Ctx) { await gate(store, ctx); needModule(ctx, "accounting"); need(ctx, "manager"); }
const METHOD_ACCOUNT: Record<string, string> = { cash: ACCOUNTS.cash, wave: ACCOUNTS.wave, orange: ACCOUNTS.orange, card: ACCOUNTS.bank };

export const KIND_LABEL: Record<string, string> = { damaged: "Endommagé à la réception", refused: "Refusé à la réception", return: "Retourné au fournisseur" };
export const DECISION_LABEL: Record<string, string> = { return: "À renvoyer / renvoyé au fournisseur", writeoff: "Mis au rebut (perte)", restock: "Remis en stock après contrôle" };
const claimId = (receiptId: string, line: string, kind: string) => `pc${sha(`${receiptId}|${line}|${kind}`).slice(0, 30)}`;
const value = (r: Row) => Math.round(Number(r.qty) * Number(r.unitCost ?? 0));

/** Coût d'achat unitaire retenu pour valoriser une unité : ligne de la commande, sinon coût de l'article. */
export async function unitCostFor(store: Store, poId: string, l: { productId: string; variantId?: string }, cache = new Map<string, Row | null>()): Promise<number> {
  let po = cache.get(poId); if (po === undefined) { po = poId ? await store.get("purchase_orders", poId) : null; cache.set(poId, po); }
  const ol = parse<{ productId: string; variantId?: string; unitCost: number }[]>(po?.lines, []).find((x) => lineKey(x as never) === lineKey(l as never)); if (ol && Number(ol.unitCost) > 0) return Math.round(Number(ol.unitCost));
  const p = await store.get("products", l.productId); return Math.round(Number(p?.cost ?? 0));
}
/** Écriture d'une réclamation « retour fournisseur » (utilisée par le retour de marchandise). */
export async function returnClaimOp(store: Store, ctx: Ctx, r: Row, l: { productId: string; variantId?: string; name: string }, qty: number, tag: string, reason: string): Promise<BatchOp> {
  return { kind: "create", table: "purchase_claims", id: claimId(r.$id, `${lineKey(l as never)}|${tag}`, "return"), tenantId: ctx.tenantId, data: { ...MIN(ctx), receiptId: r.$id, poId: String(r.poId ?? ""), supplierId: String(r.supplierId ?? ""), kind: "return", productId: l.productId, variantId: l.variantId ?? "", name: String(l.name).slice(0, 160), qty, unitCost: await unitCostFor(store, String(r.poId ?? ""), l), status: "decided", decision: "return", reason, decidedBy: ctx.userId, decidedAt: new Date().toISOString(), creditId: "" } };
}

/** Rattrape les réclamations des réceptions validées (endommagé / refusé) : idempotent, sans doublon, y compris pour les réceptions passées. */
export async function syncClaims(store: Store, ctx: Ctx): Promise<void> {
  const recs = (await store.scan("purchase_receipts", MIN(ctx), { maxRows: 10_000 })).rows.filter((r) => r.status === "validated"); if (!recs.length) return;
  const have = new Set((await store.scan("purchase_claims", MIN(ctx), { maxRows: 50_000 })).rows.map((r) => r.$id)); const cache = new Map<string, Row | null>();
  for (const r of recs) for (const l of parse<{ productId: string; variantId?: string; name: string; damaged?: number; refused?: number }[]>(r.lines, [])) for (const kind of ["damaged", "refused"] as const) {
    const q = Number(l[kind] ?? 0); if (!(q > 0)) continue; const id = claimId(r.$id, lineKey(l as never), kind); if (have.has(id)) continue;
    await store.create("purchase_claims", id, ctx.tenantId, { ...MIN(ctx), receiptId: r.$id, poId: String(r.poId ?? ""), supplierId: String(r.supplierId ?? ""), kind, productId: l.productId, variantId: l.variantId ?? "", name: String(l.name).slice(0, 160), qty: q, unitCost: await unitCostFor(store, String(r.poId ?? ""), l, cache), status: "open", decision: "", reason: "", creditId: "" }); have.add(id);
  }
}

const view = (r: Row, rec: Map<string, Row>, sup: Map<string, string>, who: Map<string, string>) => ({ id: r.$id, receiptId: String(r.receiptId), receipt: String(rec.get(String(r.receiptId))?.number ?? ""), supplierId: String(r.supplierId ?? ""), supplier: sup.get(String(r.supplierId)) ?? "", kind: String(r.kind), kindLabel: KIND_LABEL[String(r.kind)] ?? String(r.kind), productId: String(r.productId), variantId: String(r.variantId ?? ""), name: String(r.name ?? ""), qty: Number(r.qty), unitCost: Number(r.unitCost ?? 0), value: value(r), status: String(r.status ?? "open"), decision: String(r.decision ?? ""), decisionLabel: DECISION_LABEL[String(r.decision)] ?? "", reason: String(r.reason ?? ""), decidedBy: who.get(String(r.decidedBy)) ?? "", creditId: String(r.creditId ?? ""), at: String(r.$createdAt ?? "") });

export async function claimList(store: Store, ctx: Ctx, b: { productId?: string; status?: string; supplierId?: string } = {}) {
  await gate(store, ctx); await syncClaims(store, ctx); const rows = (await store.scan("purchase_claims", MIN(ctx), { maxRows: 50_000 })).rows.filter((r) => (!b.productId || r.productId === b.productId) && (!b.status || r.status === b.status) && (!b.supplierId || r.supplierId === b.supplierId));
  const rec = new Map((await store.scan("purchase_receipts", MIN(ctx), { maxRows: 10_000 })).rows.map((r) => [r.$id, r])); const sup = new Map((await store.scan("suppliers", MIN(ctx), { maxRows: 3000 })).rows.map((s) => [s.$id, String(s.name)])); const who = await names(store, ctx);
  const out = rows.map((r) => view(r, rec, sup, who)).sort((a, c) => c.at.localeCompare(a.at)); const open = out.filter((x) => x.status === "open");
  return { claims: out.slice(0, 500), openCount: open.length, openQty: open.reduce((s, x) => s + x.qty, 0), openValue: open.reduce((s, x) => s + x.value, 0), lostValue: out.filter((x) => x.decision === "writeoff").reduce((s, x) => s + x.value, 0), note: "Les unités endommagées ou refusées ne sont jamais entrées dans le stock vendable : elles restent ici jusqu'à une décision tracée (renvoi au fournisseur, rebut ou remise en stock après contrôle)." };
}

export async function claimDecide(store: Store, ctx: Ctx, b: { id?: string; decision?: string; reason?: string }) {
  await gate(store, ctx); need(ctx, "manager"); const c = await store.get("purchase_claims", String(b.id ?? "")); if (!mine(ctx, c)) throw new HttpError(404, "Réclamation introuvable");
  if (c.status !== "open") { if (c.decision === b.decision) return { id: c.$id, status: String(c.status), duplicate: true }; throw new HttpError(409, "Une décision a déjà été prise sur cette réclamation"); }
  const decision = String(b.decision ?? ""); if (!["return", "writeoff", "restock"].includes(decision)) throw new HttpError(400, "Décision inconnue"); if (c.kind === "refused" && decision !== "return") throw new HttpError(409, "Une marchandise refusée à la réception n'a jamais été prise en charge : elle ne peut que retourner au fournisseur");
  const reason = text(b.reason, 200); if (reason.length < 3) throw new HttpError(400, "Motif obligatoire (3 caractères au moins)"); const ops: BatchOp[] = []; const rec = await store.get("purchase_receipts", String(c.receiptId));
  if (decision === "restock") { const p = await store.get("products", String(c.productId)); if (!mine(ctx, p)) throw new HttpError(404, "Article introuvable"); const scale = scaleOf(p); ops.push({ kind: "create", table: "stock_moves", id: `rc${sha(`restock|${c.$id}`).slice(0, 30)}`, tenantId: ctx.tenantId, data: { ...MIN(ctx), productId: c.productId, ...(c.variantId ? { variantId: c.variantId } : {}), qty: scaledInt(Number(c.qty), scale), kind: "adjust", refId: `reprise-endommage:${String(rec?.number ?? "")}`.slice(0, 64), userId: ctx.userId } }); }
  ops.push({ kind: "update", table: "purchase_claims", id: c.$id, data: { status: "decided", decision, reason, decidedBy: ctx.userId, decidedAt: new Date().toISOString() } }, aud(ctx, "claim.decide", `${c.name} ×${c.qty} (${c.kind}) → ${decision} : ${reason}`));
  try { await store.batch(ops); } catch (e) { const again = await store.get("purchase_claims", c.$id); if (again?.status === "decided") return { id: c.$id, status: "decided", duplicate: true }; throw e; }
  return { id: c.$id, status: "decided", decision, stockAdded: decision === "restock" ? Number(c.qty) : 0, duplicate: false };
}

// ------------------------------------------------------------------ avoirs fournisseur
const remaining = (c: Row) => Number(c.amount) - Number(c.applied ?? 0) - Number(c.refunded ?? 0);
const statusOf = (c: { amount: number; applied: number; refunded: number }, cancelled = false) => (cancelled ? "cancelled" : c.applied + c.refunded >= c.amount ? "settled" : c.applied + c.refunded > 0 ? "partial" : "open");
const cview = (c: Row, sup: Map<string, string>, who: Map<string, string>) => ({ id: c.$id, number: String(c.number), supplierId: String(c.supplierId), supplier: sup.get(String(c.supplierId)) ?? "", amount: Number(c.amount), applied: Number(c.applied ?? 0), refunded: Number(c.refunded ?? 0), remaining: c.status === "cancelled" ? 0 : remaining(c), status: String(c.status), reason: String(c.reason ?? ""), invoiceId: String(c.invoiceId ?? ""), claims: parse<string[]>(c.claimIds, []).length, applications: parse<{ id: string; invoiceId: string; invoice?: string; amount: number; at: string }[]>(c.applications, []), refunds: parse<{ id: string; amount: number; method: string; source: string; date: string; reference: string }[]>(c.refunds, []), by: who.get(String(c.createdBy)) ?? "", at: String(c.$createdAt ?? "") });

export async function creditList(store: Store, ctx: Ctx, b: { supplierId?: string; status?: string } = {}) {
  await gate(store, ctx); const sup = new Map((await store.scan("suppliers", MIN(ctx), { maxRows: 3000 })).rows.map((s) => [s.$id, String(s.name)])); const who = await names(store, ctx);
  const rows = (await store.scan("supplier_credits", MIN(ctx), { maxRows: 5000 })).rows.filter((r) => (!b.supplierId || r.supplierId === b.supplierId) && (!b.status || r.status === b.status)).map((r) => cview(r, sup, who)).sort((a, c) => c.at.localeCompare(a.at));
  return { credits: rows, openAmount: rows.filter((r) => r.status === "open" || r.status === "partial").reduce((s, r) => s + r.remaining, 0), note: "Un avoir se règle de deux façons : déduit d'une facture fournisseur impayée, ou remboursé en argent (caisse ou compte). Les deux peuvent se combiner." };
}

export async function creditCreate(store: Store, ctx: Ctx, b: { requestKey?: string; claimIds?: unknown; invoiceId?: string; reason?: string; amount?: unknown }) {
  await moneyGate(store, ctx); const k = key(b.requestKey); const id = `cr${sha(`${ctx.tenantId}|${ctx.shopId}|credit|${k}`).slice(0, 30)}`; const prior = await store.get("supplier_credits", id); if (prior) { if (!mine(ctx, prior)) throw new HttpError(409, "Identifiant déjà utilisé"); return { id, number: String(prior.number), duplicate: true }; }
  const ids = Array.isArray(b.claimIds) ? [...new Set(b.claimIds.map(String))] : []; if (!ids.length || ids.length > 100) throw new HttpError(400, "Choisissez au moins une réclamation (100 au plus)"); const reason = text(b.reason, 200); if (reason.length < 3) throw new HttpError(400, "Motif obligatoire (3 caractères au moins)");
  const claims: Row[] = []; for (const cid of ids) { const c = await store.get("purchase_claims", cid); if (!mine(ctx, c)) throw new HttpError(404, "Réclamation introuvable"); if (c.creditId) throw new HttpError(409, `« ${c.name} » est déjà couvert par un avoir`); if (c.decision !== "return") throw new HttpError(409, `« ${c.name} » : décidez d'abord de le renvoyer au fournisseur`); claims.push(c); }
  const supplierId = String(claims[0]!.supplierId); if (!supplierId || claims.some((c) => String(c.supplierId) !== supplierId)) throw new HttpError(400, "Un avoir ne couvre que les réclamations d'un même fournisseur"); const sup = await store.get("suppliers", supplierId); if (!mine(ctx, sup)) throw new HttpError(404, "Fournisseur introuvable");
  const max = claims.reduce((s, c) => s + value(c), 0); const amount = b.amount === undefined || b.amount === "" ? max : amountOf(b.amount, "Montant de l'avoir"); if (max < 1) throw new HttpError(409, "Ces unités n'ont pas de coût d'achat connu : renseignez le coût de l'article avant de créer l'avoir"); if (amount > max) throw new HttpError(409, `L'avoir (${amount}) dépasse la valeur des unités réclamées (${max})`);
  let invoiceId = ""; if (b.invoiceId) { const inv = await store.get("invoices", String(b.invoiceId)); if (!mine(ctx, inv) || inv.kind !== "supplier" || String(inv.partyId) !== supplierId) throw new HttpError(404, "Facture introuvable pour ce fournisseur"); invoiceId = inv.$id; }
  const number = `AV-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${sha(id).slice(0, 4).toUpperCase()}`;
  try { await store.batch([{ kind: "create", table: "supplier_credits", id, tenantId: ctx.tenantId, data: { ...MIN(ctx), supplierId, number, claimIds: JSON.stringify(ids), invoiceId, amount, applied: 0, refunded: 0, status: "open", reason, applications: "[]", refunds: "[]", createdBy: ctx.userId, requestKey: k } }, ...claims.map((c): BatchOp => ({ kind: "update", table: "purchase_claims", id: c.$id, data: { creditId: id } })), aud(ctx, "credit.create", `${number} ${sup.name} ${amount} (${ids.length} réclamation(s)) : ${reason}`)]); } catch (e) { const again = await store.get("supplier_credits", id); if (again && mine(ctx, again)) return { id, number: String(again.number), duplicate: true }; throw e; }
  return { id, number, amount, duplicate: false };
}

export async function creditApply(store: Store, ctx: Ctx, b: { id?: string; invoiceId?: string; amount?: unknown; requestKey?: string }) {
  await moneyGate(store, ctx); const k = key(b.requestKey); const c = await store.get("supplier_credits", String(b.id ?? "")); if (!mine(ctx, c)) throw new HttpError(404, "Avoir introuvable"); if (c.status === "cancelled") throw new HttpError(409, "Avoir annulé");
  const apps = parse<{ id: string; invoiceId: string; amount: number; at: string }[]>(c.applications, []); if (apps.some((a) => a.id === k)) return { id: c.$id, duplicate: true, remaining: remaining(c) };
  const inv = await store.get("invoices", String(b.invoiceId ?? "")); if (!mine(ctx, inv) || inv.kind !== "supplier" || String(inv.partyId) !== String(c.supplierId)) throw new HttpError(404, "Facture introuvable pour ce fournisseur"); if (inv.provisional === true) throw new HttpError(409, "Facture provisoire : confirmez d'abord la facture reçue du fournisseur"); if (inv.status === "void") throw new HttpError(409, "Facture annulée");
  const payments = parse<{ id: string; amount: number; method: string; date: string; source: string; reference: string; by: string }[]>(inv.payments, []); const total = Number(inv.total); const due = total - paidOfPayments(payments as never); if (due <= 0) throw new HttpError(409, "Facture déjà soldée : demandez plutôt un remboursement de l'avoir"); const amount = amountOf(b.amount, "Montant");
  if (amount > remaining(c)) throw new HttpError(409, `Le montant (${amount}) dépasse le reste de l'avoir (${remaining(c)})`); if (amount > due) throw new HttpError(409, `Le montant (${amount}) dépasse le reste dû sur la facture (${due})`);
  const now = new Date().toISOString(); const next = [...payments, { id: k, amount, method: "credit_note", date: now, source: "credit", reference: String(c.number), by: ctx.userId }]; const paid = paidOfPayments(next as never); const base = sha(`${c.$id}|apply|${k}`).slice(0, 28); const row = { tenantId: ctx.tenantId, shopId: ctx.shopId, ref: String(c.number), date: now, label: `Avoir fournisseur ${c.number} sur ${inv.number}` };
  const leftBefore = remaining(c); const applied = Number(c.applied ?? 0) + amount; const na = [...apps, { id: k, invoiceId: inv.$id, invoice: String(inv.number), amount, at: now }];
  try { await store.batch([{ kind: "update", table: "invoices", id: inv.$id, data: { payments: JSON.stringify(next), paid, status: invoiceStatus(total, paid) } }, { kind: "update", table: "supplier_credits", id: c.$id, data: { applied, applications: JSON.stringify(na), status: statusOf({ amount: Number(c.amount), applied, refunded: Number(c.refunded ?? 0) }) } },
    { kind: "create", table: "journal_entries", id: `${base}_j0`, tenantId: ctx.tenantId, data: { ...row, account: ACCOUNTS.suppliers, debit: amount, credit: 0 } }, { kind: "create", table: "journal_entries", id: `${base}_j1`, tenantId: ctx.tenantId, data: { ...row, account: ACCOUNTS.purchasesGoods, debit: 0, credit: amount } }, aud(ctx, "credit.apply", `${c.number} → ${inv.number} ${amount}`)]); } catch (e) { const again = await store.get("supplier_credits", c.$id); if (parse<{ id: string }[]>(again?.applications, []).some((a) => a.id === k)) return { id: c.$id, duplicate: true, remaining: remaining(again!) }; throw e; }
  return { id: c.$id, duplicate: false, remaining: leftBefore - amount, invoiceRemaining: due - amount };
}

export async function creditRefund(store: Store, ctx: Ctx, b: { id?: string; amount?: unknown; method?: string; source?: string; reference?: string; paidOn?: string; requestKey?: string }) {
  await moneyGate(store, ctx); const k = key(b.requestKey); const c = await store.get("supplier_credits", String(b.id ?? "")); if (!mine(ctx, c)) throw new HttpError(404, "Avoir introuvable"); if (c.status === "cancelled") throw new HttpError(409, "Avoir annulé");
  const refunds = parse<{ id: string; amount: number; method: string; source: string; date: string; reference: string; by: string; movementId?: string }[]>(c.refunds, []); if (refunds.some((r) => r.id === k)) return { id: c.$id, duplicate: true, remaining: remaining(c) };
  const amount = amountOf(b.amount, "Montant"); if (amount > remaining(c)) throw new HttpError(409, `Le montant (${amount}) dépasse le reste de l'avoir (${remaining(c)})`); await enforce(store, ctx, "refund", amount);
  const source = b.source === "till" ? "till" : "external"; const method = source === "till" ? "cash" : String(b.method ?? ""); if (!Object.hasOwn(METHOD_ACCOUNT, method)) throw new HttpError(400, "Moyen de remboursement inconnu");
  const paidOn = b.paidOn ? String(b.paidOn) : new Date().toISOString().slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || new Date(`${paidOn}T00:00:00Z`).toISOString().slice(0, 10) !== paidOn) throw new HttpError(400, "Date invalide"); if (paidOn > new Date().toISOString().slice(0, 10)) throw new HttpError(400, "La date ne peut pas être dans le futur");
  const now = new Date().toISOString(); const sup = await store.get("suppliers", String(c.supplierId)); const ops: BatchOp[] = []; let movementId = "";
  if (source === "till") { const sess = await openSessionOf(store, ctx); if (!sess) throw new HttpError(409, "Ouvrez la caisse pour encaisser un remboursement en espèces dans la caisse"); movementId = `cm${sha(`${c.$id}|refund|${k}`).slice(0, 28)}`; ops.push({ kind: "create", table: "cash_movements", id: movementId, tenantId: ctx.tenantId, data: { ...MIN(ctx), sessionId: sess.$id, kind: "in", amount, reason: `Remboursement fournisseur ${c.number}`.slice(0, 200), status: "authorized", userId: ctx.userId, authorizedBy: ctx.userId, at: now, beneficiary: String(sup?.name ?? "").slice(0, 120), supplierPaymentId: c.$id } }); }
  const leftBefore = remaining(c); const refunded = Number(c.refunded ?? 0) + amount; const nr = [...refunds, { id: k, amount, method, source, date: `${paidOn}T12:00:00.000Z`, reference: text(b.reference, 64), by: ctx.userId, ...(movementId ? { movementId } : {}) }]; const base = sha(`${c.$id}|refund|${k}`).slice(0, 28); const row = { tenantId: ctx.tenantId, shopId: ctx.shopId, ref: `RV-${c.number}`, date: `${paidOn}T12:00:00.000Z`, label: `Remboursement fournisseur ${c.number}` };
  ops.unshift({ kind: "update", table: "supplier_credits", id: c.$id, data: { refunded, refunds: JSON.stringify(nr), status: statusOf({ amount: Number(c.amount), applied: Number(c.applied ?? 0), refunded }) } }, { kind: "create", table: "journal_entries", id: `${base}_j0`, tenantId: ctx.tenantId, data: { ...row, account: METHOD_ACCOUNT[method]!, debit: amount, credit: 0 } }, { kind: "create", table: "journal_entries", id: `${base}_j1`, tenantId: ctx.tenantId, data: { ...row, account: ACCOUNTS.suppliers, debit: 0, credit: amount } }, aud(ctx, "credit.refund", `${c.number} ${amount} ${source}/${method}`));
  try { await store.batch(ops); } catch (e) { const again = await store.get("supplier_credits", c.$id); if (parse<{ id: string }[]>(again?.refunds, []).some((r) => r.id === k)) return { id: c.$id, duplicate: true, remaining: remaining(again!) }; throw e; }
  const mapped = (await store.scan("fin_accounts", MIN(ctx), { maxRows: 500 })).rows.some((a) => a.active !== false && a.openingDate && parse<string[]>(a.methods, []).includes(method));
  return { id: c.$id, duplicate: false, remaining: leftBefore - amount, ...(mapped ? {} : { treasuryWarning: `Le remboursement est enregistré, mais aucun compte financier configuré de cette boutique n'est rattaché à « ${method === "card" ? "Banque / virement" : method} » : le solde ne bougera pas dans Finance tant que vous n'avez pas créé ce compte (avec son solde d'ouverture) et rattaché ce moyen.` }) };
}

export async function creditCancel(store: Store, ctx: Ctx, b: { id?: string; reason?: string }) {
  await moneyGate(store, ctx); const c = await store.get("supplier_credits", String(b.id ?? "")); if (!mine(ctx, c)) throw new HttpError(404, "Avoir introuvable"); if (c.status === "cancelled") return { id: c.$id, status: "cancelled", duplicate: true };
  if (Number(c.applied ?? 0) > 0 || Number(c.refunded ?? 0) > 0) throw new HttpError(409, "Cet avoir a déjà été utilisé (déduction ou remboursement) : il ne peut plus être annulé"); const reason = text(b.reason, 200); if (reason.length < 3) throw new HttpError(400, "Motif obligatoire (3 caractères au moins)");
  await store.batch([{ kind: "update", table: "supplier_credits", id: c.$id, data: { status: "cancelled", reason: `${String(c.reason ?? "")} · annulé : ${reason}`.slice(0, 200) } }, ...parse<string[]>(c.claimIds, []).map((id): BatchOp => ({ kind: "update", table: "purchase_claims", id, data: { creditId: "" } })), aud(ctx, "credit.cancel", `${c.number} : ${reason}`)]); return { id: c.$id, status: "cancelled", duplicate: false };
}
