import { createHash } from "node:crypto";
import { refundJournal } from "../../../src/domain/accounting";
import { earnedPoints, tierFor } from "../../../src/domain/loyalty";
import { lineTotal, toFcfa } from "../../../src/domain/money";
import { scaleOf, scaledInt } from "../../../src/domain/quantity";
import { boundsOf, addDays, todayIn } from "../../../src/domain/overview";
import { DEFAULT_TIMEZONE, isTimezone } from "../../../src/domain/promotions";
import { needFeature } from "./articles";
import { openSessionOf } from "./cashier";
import { approvalNeeded, claimApproval, hasRight, ledgerOp, newVoucherOps, receiptCode, voucherCodeFor } from "./pos-pro";
import { entitlementOf } from "./subscriptions";
import { planAllows } from "../../../src/domain/features";
import { HttpError, need, needModule, roleOf, type Ctx, type Row, type Store } from "./store";

const sha = (s: string) => createHash("sha1").update(s).digest("hex");
const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 30);
const parse = <T,>(s: unknown, fb: T): T => { try { const v = JSON.parse(String(s)); return v ?? fb; } catch { return fb; } };
const iso = (v: unknown): string => { const t = Date.parse(String(v)); return Number.isNaN(t) ? "" : new Date(t).toISOString(); };
const isManager = (ctx: Ctx) => { const r = roleOf(ctx.roles); return r === "owner" || r === "manager"; };
const METHODS = ["cash", "wave", "orange", "card", "credit", "voucher"] as const;
type SaleLine = { productId: string; variantId?: string; name: string; qty: number; unitPrice: number; discountPct?: number; amount?: number; unitCost?: number; unit?: string; unitQty?: number; components?: unknown[]; serials?: string[]; lots?: unknown[] };
type RetLine = { index: number; qty: number; amount: number };
const audit = (store: Store, ctx: Ctx, action: string, detail: string) => store.create("audit_log", newId(), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action, detail: detail.slice(0, 1000) });

/** Ce qui reste remboursable sur chaque ligne d'une vente (quantités et montants, après les retours déjà enregistrés). Les montants viennent de la VENTE (prix et remises figés) : jamais du client. */
export function refundable(sale: Row, returns: Row[]): { lines: { index: number; name: string; qty: number; remainingQty: number; net: number; remainingNet: number; blocked: string }[]; remainingTotal: number } {
  const lines = parse<SaleLine[]>(sale.lines, []); const nets = lines.map((l) => lineTotal({ productId: l.productId, name: l.name, unitPrice: l.unitPrice, qty: l.qty, discountPct: l.discountPct, amount: l.amount }));
  const sum = nets.reduce((a, b) => a + b, 0); const ratio = sum > 0 ? Math.min(1, Number(sale.total) / sum) : 1; // points de fidélité utilisés : la vente est moins chère que la somme des lignes
  const got = new Map<number, { qty: number; net: number }>(); for (const r of returns) if (r.status !== "failed") for (const x of parse<RetLine[]>(r.lines, [])) { const a = got.get(x.index) ?? { qty: 0, net: 0 }; a.qty += x.qty; a.net += x.amount; got.set(x.index, a); }
  const out = lines.map((l, i) => { const net = Math.round(nets[i]! * ratio); const g = got.get(i) ?? { qty: 0, net: 0 };
    const blocked = l.components?.length ? "bundle : retour non géré" : l.serials?.length ? "article à numéro de série : retour non géré" : l.lots?.length ? "article suivi par lot : retour non géré" : "";
    return { index: i, name: l.name, qty: l.qty, remainingQty: Math.round((l.qty - g.qty) * 1e6) / 1e6, net, remainingNet: net - g.net, blocked }; });
  return { lines: out, remainingTotal: out.reduce((a, l) => a + l.remainingNet, 0) };
}

type Input = { preview?: boolean; returnId?: string; saleId?: string; kind?: string; lines?: { index: number; qty: unknown }[]; reason?: string; refunds?: { method: string; amount: unknown; reference?: string }[]; approvalId?: string };
/** Annulation (vente entière) ou remboursement (lignes et quantités) : opération TRACÉE (ligne `sale_returns`, mouvements de stock « retour », écriture comptable inverse, trace d'audit) — la vente d'origine n'est jamais supprimée ni modifiée dans ses montants.
 *  Gérant ou propriétaire. Idempotent (returnId) et rejouable : une coupure reprend sans doubler stock, comptabilité ni fidélité. Retour non géré pour bundles, séries et lots (refus explicite). */
export async function refundSale(store: Store, ctx: Ctx, b: Input) {
  needModule(ctx, "pos"); await needFeature(store, ctx, "smartPos");
  const proPos = planAllows((await entitlementOf(store, ctx.tenantId)).plan.id, "smartPosPro"); const kindWanted = b.kind === "cancel" ? "cancel" : "refund";
  let needApproval = false; // Pro : droit distinct « annuler » / « rembourser », ou approbation d'un responsable ; Business : gérant
  if (proPos) { if (!(await hasRight(store, ctx, kindWanted))) needApproval = true; } else need(ctx, "manager");
  const rawId = String(b.returnId ?? (b.preview ? "preview-00000000" : "")); if (rawId.length < 8) throw new HttpError(400, "returnId invalide (8 caractères au moins)"); const rid = `rt${sha(`${ctx.tenantId}|${rawId}`).slice(0, 30)}`;
  const kind = b.kind === "cancel" ? "cancel" : "refund"; const reason = String(b.reason ?? (b.preview ? "aperçu" : "")).trim(); if (reason.length < 3 || reason.length > 200) throw new HttpError(400, "Motif obligatoire (3 à 200 caractères)");
  const sale = await store.get("sales", String(b.saleId ?? "")); if (!sale || sale.tenantId !== ctx.tenantId || sale.shopId !== ctx.shopId) throw new HttpError(404, "Vente introuvable");
  const prior = await store.get("sale_returns", rid); const existing = (await store.list("sale_returns", { saleId: sale.$id }, 200)); let row = prior;
  if (prior && prior.saleId !== sale.$id) throw new HttpError(409, "Identifiant d'opération déjà utilisé");
  const lines = parse<SaleLine[]>(sale.lines, []); const customer = sale.customerId ? await store.get("customers", String(sale.customerId)) : null; const shop = await store.get("shops", ctx.shopId.slice(0, 36)); const vatRatePct = Number(shop?.vatRatePct ?? 18);
  let chosen: RetLine[] = []; let refunds: { method: string; amount: number; reference?: string }[] = []; let amount = 0;
  if (!row) {
    if (sale.status !== "paid") throw new HttpError(409, sale.status === "cancelled" ? "Vente déjà annulée" : sale.status === "refunded" ? "Vente déjà entièrement remboursée" : "Seule une vente terminée peut être remboursée");
    const rf = refundable(sale, existing); const asked = kind === "cancel" ? rf.lines.filter((l) => l.remainingQty > 0).map((l) => ({ index: l.index, qty: l.remainingQty })) : (b.lines ?? []).map((l) => ({ index: Number(l.index), qty: Number(String(l.qty).replace(",", ".")) }));
    if (kind === "cancel" && existing.some((r) => r.status !== "failed")) throw new HttpError(409, "Cette vente a déjà été remboursée en partie : remboursez le reste ligne par ligne");
    if (!asked.length) throw new HttpError(400, "Choisissez au moins une ligne à rembourser"); const seen = new Set<number>();
    for (const a of asked) {
      const l = rf.lines[a.index]; if (!l || seen.has(a.index)) throw new HttpError(400, "Ligne de vente invalide"); seen.add(a.index); if (l.blocked) throw new HttpError(409, `${l.name} : ${l.blocked}`);
      const p = await store.get("products", lines[a.index]!.productId); const sc = scaleOf(p); if (!(a.qty > 0) || scaledInt(a.qty, sc) > scaledInt(l.remainingQty, sc)) throw new HttpError(400, `${l.name} : quantité à rembourser invalide (reste ${l.remainingQty})`);
      const full = scaledInt(a.qty, sc) === scaledInt(l.remainingQty, sc); const amt = full ? l.remainingNet : Math.round(l.net * a.qty / l.qty); chosen.push({ index: a.index, qty: a.qty, amount: Math.min(amt, l.remainingNet) });
    }
    amount = chosen.reduce((a, l) => a + l.amount, 0); if (!(amount > 0)) throw new HttpError(400, "Montant à rembourser nul");
    if (b.preview) return { preview: true as const, amount, kind, lines: chosen }; // calcul serveur du montant (aucune écriture)
    refunds = (b.refunds ?? []).map((r) => ({ method: String(r.method), amount: toFcfa(Number(r.amount)), ...(r.reference ? { reference: String(r.reference).trim().slice(0, 64) } : {}) }));
    if (refunds.some((r) => r.method === "voucher")) { if (!proPos) throw new HttpError(402, "Les avoirs (bons d'achat) sont réservés à la formule Pro."); refunds = refunds.map((r) => (r.method === "voucher" ? { ...r, reference: voucherCodeFor(`${ctx.tenantId}|${rawId}`) } : r)); if (refunds.filter((r) => r.method === "voucher").length > 1) throw new HttpError(400, "Un seul avoir par remboursement"); }
    if (!refunds.length) throw new HttpError(400, "Indiquez comment le client est remboursé");
    for (const r of refunds) { if (!(METHODS as readonly string[]).includes(r.method)) throw new HttpError(400, "Moyen de remboursement inconnu"); if (!(r.amount > 0)) throw new HttpError(400, "Montant de remboursement invalide"); if (["wave", "orange", "card"].includes(r.method) && (r.reference ?? "").length < 4) throw new HttpError(400, "Référence obligatoire pour un remboursement numérique (elle n'est pas vérifiée par l'application)"); if (r.method === "credit" && !customer) throw new HttpError(400, "Remboursement sur compte : la vente n'a pas de client"); }
    const sumR = refunds.reduce((a, r) => a + r.amount, 0); if (sumR !== amount) throw new HttpError(400, `La répartition du remboursement (${sumR.toLocaleString("fr-FR")}) ne correspond pas au montant à rembourser (${amount.toLocaleString("fr-FR")})`);
    const creditPart = refunds.filter((r) => r.method === "credit").reduce((a, r) => a + r.amount, 0); if (creditPart > Number(customer?.creditBalance ?? 0)) throw new HttpError(409, `Remboursement sur compte supérieur à la dette du client (${Number(customer?.creditBalance ?? 0).toLocaleString("fr-FR")} FCFA)`);
    const cashPart = refunds.filter((r) => r.method === "cash").reduce((a, r) => a + r.amount, 0); const sess = await openSessionOf(store, ctx);
    if (cashPart > 0 && !sess && shop?.cashRequired === true) throw new HttpError(409, "Ouvrez la caisse avant de rembourser en espèces");
    if (needApproval) { const aid = String(b.approvalId ?? ""); if (!aid) throw approvalNeeded(kind, `${kind === "cancel" ? "annulation" : "remboursement"} : droit requis ou approbation d'un responsable`, sale.$id); for (const o of await claimApproval(store, ctx, aid, kind, rid, sale.$id)) { if (o.kind === "create") { if (!(await store.create(o.table, o.id, ctx.tenantId, o.data))) throw new HttpError(409, "Approbation déjà utilisée"); } else if (o.kind === "update") await store.update(o.table, o.id, o.data); } }
    const data = { tenantId: ctx.tenantId, shopId: ctx.shopId, saleId: sale.$id, saleNumber: String(sale.number), kind, amount, refunds: JSON.stringify(refunds), lines: JSON.stringify(chosen), reason, userId: ctx.userId, sessionId: cashPart > 0 && sess ? sess.$id : "", at: new Date().toISOString(), points: 0, status: "pending" };
    if (!(await store.create("sale_returns", rid, ctx.tenantId, data))) throw new HttpError(409, "Opération déjà en cours : réessayez");
    row = await store.get("sale_returns", rid);
  } else { chosen = parse(row.lines, []); refunds = parse(row.refunds, []); amount = Number(row.amount); if (row.status === "done") return { id: rid, amount, kind: String(row.kind), duplicate: true }; }
  // reprise ou première exécution : toutes les écritures ont des identifiants fixes
  const base = rid.slice(0, 26); const number = String(sale.number); const at = String(row!.at);
  for (const c of chosen) { const l = lines[c.index]!; const p = await store.get("products", l.productId); await store.create("stock_moves", `${base}_s${c.index}`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, productId: l.productId, ...(l.variantId ? { variantId: l.variantId } : {}), qty: scaledInt(c.qty, scaleOf(p)), kind: "return", refId: `retour-${number}`, userId: ctx.userId, ...(l.unit ? { unit: l.unit, unitQty: l.unitQty } : {}) }); }
  const j = refundJournal({ ref: number, date: at, totalTtc: amount, vatRatePct, refunds: refunds as never }); for (const [i, e] of j.entries.entries()) await store.create("journal_entries", `${base}_j${i}`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, ref: `${number}-RETOUR`, account: e.account, debit: e.debit, credit: e.credit, label: e.label, date: at });
  const vr = refunds.find((r) => r.method === "voucher"); if (vr) { const o = newVoucherOps({ ...ctx }, vr.amount, number, sale.customerId ? String(sale.customerId) : undefined, vr.reference); for (const x of o.ops) if (x.kind === "create") await store.create(x.table, x.id, ctx.tenantId, x.data); }
  if (proPos) { const o = ledgerOp(ctx, { kind, ref: number, key: rid, amount: -amount, at, userId: String(row!.userId ?? ctx.userId), sessionId: String(row!.sessionId ?? ""), payload: { refunds, reason } }); await store.create(o.table, o.id, ctx.tenantId, (o as { data: Record<string, unknown> }).data); }
  const fresh = await store.get("sale_returns", rid);
  if (fresh?.status === "pending") {
    let pts = 0;
    if (customer) { const spend = Math.max(0, Number(customer.annualSpend ?? 0) - amount); pts = earnedPoints(amount, tierFor(Number(customer.annualSpend ?? 0))); const creditPart = refunds.filter((r) => r.method === "credit").reduce((a, r) => a + r.amount, 0);
      await store.update("customers", customer.$id, { annualSpend: spend, points: Math.max(0, Number(customer.points ?? 0) - pts), creditBalance: Math.max(0, Number(customer.creditBalance ?? 0) - creditPart) }); }
    const all = refundable(sale, [...existing.filter((r) => r.$id !== rid), { ...(fresh as Row), status: "done" }]); await store.update("sales", sale.$id, { status: all.remainingTotal <= 0 || kind === "cancel" ? (kind === "cancel" ? "cancelled" : "refunded") : "paid" });
    await store.update("sale_returns", rid, { status: "done", points: pts });
  }
  await store.create("audit_log", `${base}_a`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action: `sale.${kind}`, detail: `${number} ${amount} ${reason}`.slice(0, 1000) });
  return { id: rid, amount, kind, duplicate: false };
}

// ------------------------------------------------------------------ historique des ventes et réimpression
const shopTz = (s: Row | null) => (s?.promoTz && isTimezone(String(s.promoTz)) ? String(s.promoTz) : DEFAULT_TIMEZONE);
const saleView = (s: Row, ret: Row[], names: Map<string, string>, customers: Map<string, string>) => {
  const done = ret.filter((r) => r.saleId === s.$id && r.status !== "failed"); const refunded = done.reduce((a, r) => a + Number(r.amount), 0);
  return { id: s.$id, number: String(s.number), total: Number(s.total), vat: Number(s.vat ?? 0), status: String(s.status), soldAt: iso(s.soldAt), cashierId: String(s.cashierId ?? ""), seller: names.get(String(s.cashierId)) ?? "", customerId: s.customerId ? String(s.customerId) : "", customer: customers.get(String(s.customerId)) ?? "", payments: parse<{ method: string; amount: number; reference?: string; verified?: boolean }[]>(s.payments, []), refunded, returns: done.length };
};
async function names(store: Store, ctx: Ctx): Promise<Map<string, string>> { const m = new Map<string, string>((await store.scan("staff", { tenantId: ctx.tenantId }, { maxRows: 500 })).rows.map((x) => [String(x.userId), String(x.name)])); try { for (const o of await store.listOwners(ctx.tenantId)) m.set(o.userId, o.name || "Propriétaire"); } catch { /* annuaire indisponible */ } return m; }
/** Historique : le vendeur voit SES ventes, le gérant toutes celles de la boutique. Jour par défaut = aujourd'hui (heure de l'entreprise). */
export async function listSales(store: Store, ctx: Ctx, b: { from?: string; to?: string; q?: string; status?: string } = {}) {
  needModule(ctx, "pos"); await needFeature(store, ctx, "smartPos"); const shop = await store.get("shops", ctx.shopId.slice(0, 36)); const tz = shopTz(shop); const today = todayIn(new Date(), tz); const day = /^\d{4}-\d{2}-\d{2}$/;
  const from = b.from && day.test(b.from) ? b.from : today, to = b.to && day.test(b.to) ? b.to : today; if (to < from) throw new HttpError(400, "La fin précède le début"); if (Date.parse(to) - Date.parse(from) > 92 * 864e5) throw new HttpError(400, "Période de 92 jours au maximum");
  const bnd = boundsOf(from, to, tz); const where: Record<string, string> = { tenantId: ctx.tenantId, shopId: ctx.shopId }; if (!isManager(ctx)) where.cashierId = ctx.userId; if (b.status && ["paid", "cancelled", "refunded", "pending", "posted"].includes(b.status)) where.status = b.status;
  const rows = await store.scan("sales", where, { range: { field: "soldAt", from: bnd.gte, to: bnd.lt }, maxRows: 5_000 }); const q = String(b.q ?? "").trim().toLowerCase();
  const rets = (await store.scan("sale_returns", { tenantId: ctx.tenantId, shopId: ctx.shopId }, { maxRows: 20_000 })).rows; const nm = await names(store, ctx); const cu = new Map((await store.scan("customers", { tenantId: ctx.tenantId, shopId: ctx.shopId }, { maxRows: 10_000 })).rows.map((c) => [String(c.$id), String(c.name)]));
  const out = rows.rows.map((s) => saleView(s, rets, nm, cu)).filter((s) => !q || `${s.number} ${s.customer} ${s.seller}`.toLowerCase().includes(q)).sort((a, c) => c.soldAt.localeCompare(a.soldAt)).slice(0, 300);
  return { period: { from, to, tz }, sales: out, truncated: rows.truncated, totals: { count: out.filter((s) => s.status === "paid" || s.status === "refunded").length, paid: out.filter((s) => s.status === "paid").reduce((a, s) => a + s.total, 0), refunded: out.reduce((a, s) => a + s.refunded, 0) } };
}
/** Détail d'une vente (lignes, paiements avec références, retours) et données du ticket. */
export async function getSale(store: Store, ctx: Ctx, b: { saleId: string; reprint?: boolean }) {
  needModule(ctx, "pos"); await needFeature(store, ctx, "smartPos"); const s = await store.get("sales", String(b.saleId)); if (!s || s.tenantId !== ctx.tenantId || s.shopId !== ctx.shopId) throw new HttpError(404, "Vente introuvable");
  if (!isManager(ctx) && s.cashierId !== ctx.userId) throw new HttpError(403, "Vous ne pouvez consulter que vos propres ventes");
  const rets = (await store.list("sale_returns", { saleId: s.$id }, 200)); const nm = await names(store, ctx); const cu = s.customerId ? await store.get("customers", String(s.customerId)) : null; const lines = parse<SaleLine[]>(s.lines, []);
  if (b.reprint) await audit(store, ctx, "sale.reprint", `${s.number}`); // une réimpression est tracée ; elle ne crée ni vente, ni mouvement de stock
  const proPos = planAllows((await entitlementOf(store, ctx.tenantId)).plan.id, "smartPosPro");
  return { ...saleView(s, rets, nm, new Map(cu ? [[cu.$id, String(cu.name)]] : [])), ...(proPos ? { verifyCode: receiptCode(ctx.tenantId, String(s.number), Number(s.total), String(s.soldAt)) } : {}), lines: lines.map((l) => ({ name: l.name, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct ?? 0, amount: l.amount ?? Math.round(l.unitPrice * l.qty), unit: l.unit ?? "", unitQty: l.unitQty ?? null })), refundable: refundable(s, rets), returnsDetail: rets.map((r) => ({ id: r.$id, kind: String(r.kind), amount: Number(r.amount), reason: String(r.reason ?? ""), at: iso(r.at), status: String(r.status), refunds: parse(r.refunds, []), user: nm.get(String(r.userId)) ?? "" })).sort((a, c) => c.at.localeCompare(a.at)) };
}
void addDays;
