// Précommande automatique : quand un article passe sous son seuil d'alerte, un BROUILLON de commande fournisseur est préparé (ou complété)
// dans les Achats. Jamais soumis, validé ni envoyé automatiquement : le gérant le relit, l'ajuste et le valide.
// Quantité = rotation des ventes (30 derniers jours) × (délai fournisseur + 30 jours de couverture) + seuil − stock − déjà en commande,
// jamais moins que la quantité habituellement commandée (médiane des 3 dernières commandes de l'article), plafonnée par le minimum du fournisseur.
import { createHash } from "node:crypto";
import { planAllows } from "../../../src/domain/features";
import { poState, poTotals, toDeliver, type OrderLine } from "../../../src/domain/purchasing-plus";
import { fromScaled, scaleOf } from "../../../src/domain/quantity";
import { stockOf } from "../../../src/domain/stock";
import { lineKey } from "../../../src/domain/variants";
import { aud, buildLine, ev, poNumber } from "./purchasing-plus";
import { entitlementOf } from "./subscriptions";
import { HttpError, need, needModule, type Ctx, type Row, type Store } from "./store";

export const AUTO_BY = "auto-preorder";
export const ROTATION_DAYS = 30, COVER_DAYS = 30, DEFAULT_LEAD = 7;
const OPEN = new Set(["draft", "pending", "validated", "partial"]);
const sha = (s: string) => createHash("sha1").update(s).digest("hex");
const parse = <T,>(s: unknown, f: T): T => { try { return JSON.parse(String(s)) as T; } catch { return f; } };
const mine = (ctx: Ctx, r: Row | null): r is Row => !!r && r.tenantId === ctx.tenantId && r.shopId === ctx.shopId;
const cfgId = (ctx: Ctx) => `po${sha(`${ctx.tenantId}|${ctx.shopId}|preorder`).slice(0, 30)}`;
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const ceilTo = (v: number, scale: number) => { const f = 10 ** scale; return Math.ceil(v * f - 1e-9) / f; };

/** Calcul pur de la quantité proposée (exposé pour les tests et l'affichage). */
export function preorderQty(x: { stock: number; threshold: number; onOrder: number; soldLast30: number; leadDays: number; history: number[]; minQty?: number; scale?: number }): { qty: number; daily: number; basis: "rotation" | "history" | "threshold" } {
  const sc = x.scale ?? 0; const daily = x.soldLast30 / ROTATION_DAYS; const need = daily * (x.leadDays + COVER_DAYS) + x.threshold - x.stock - x.onOrder; const hist = median(x.history);
  let qty: number; let basis: "rotation" | "history" | "threshold";
  if (daily > 0) { qty = Math.max(need, hist); basis = hist > need ? "history" : "rotation"; } else if (hist > 0) { qty = hist; basis = "history"; } else { qty = 2 * x.threshold - x.stock - x.onOrder; basis = "threshold"; }
  qty = ceilTo(Math.max(qty, x.minQty ?? 0), sc); if (!(qty > 0)) qty = ceilTo(Math.max(x.threshold, 1), sc);
  return { qty, daily: Math.round(daily * 100) / 100, basis };
}

async function settingsRow(store: Store, ctx: Ctx) { const r = await store.get("crm_config", cfgId(ctx)); return mine(ctx, r) && r.kind === "preorder" ? r : null; }
export async function preorderEnabled(store: Store, ctx: Ctx): Promise<boolean> { const r = await settingsRow(store, ctx); return r ? parse<{ enabled?: boolean }>(r.data, {}).enabled !== false : true; } // actif par défaut
const allowed = async (store: Store, ctx: Ctx) => planAllows((await entitlementOf(store, ctx.tenantId)).plan.id, "purchasing");

type Item = { productId: string; name: string; stock: number; threshold: number; onOrder: number; daily: number; leadDays: number; qty: number; basis: string; supplierId: string; supplier: string; unitPrice: number };
type Ctx2 = { products: Map<string, Row>; pos: Row[]; suppliers: Map<string, Row> };

async function evaluate(store: Store, ctx: Ctx, p: Row, c: Ctx2): Promise<{ item?: Item; noSupplier?: { productId: string; name: string; stock: number; threshold: number } } | null> {
  if (p.archived === true || p.kind === "bundle" || p.hasVariants === true) return null;
  const threshold = Number(p.alertStock ?? 0) > 0 ? Number(p.alertStock) : Number(p.minStock ?? 0); if (!(threshold > 0)) return null;
  const sc = scaleOf(p); const { rows } = await store.scan("stock_moves", { productId: p.$id }, { maxRows: 200_000 });
  const stock = fromScaled(stockOf(rows.map((m) => ({ productId: p.$id, qty: Number(m.qty), kind: m.kind as never }))), sc); if (stock > threshold) return null;
  const since = Date.now() - ROTATION_DAYS * 864e5; const sold = fromScaled(rows.filter((m) => m.kind === "sale" && Date.parse(String(m.$createdAt ?? m.at ?? "")) >= since).reduce((a, m) => a + Math.abs(Number(m.qty)), 0), sc);
  let onOrder = 0, autoDraftHas = false; const history: { qty: number; at: string; supplierId: string; unitCost: number }[] = [];
  for (const po of c.pos) { const st = poState(po.status); const lines = parse<OrderLine[]>(po.lines, []); for (const l of lines) { if (l.productId !== p.$id || l.variantId) continue;
    if (OPEN.has(st)) { onOrder += toDeliver(l); if (st === "draft" && po.createdBy === AUTO_BY) autoDraftHas = true; }
    if (st !== "cancelled" && po.createdBy !== AUTO_BY) history.push({ qty: Number(l.qty), at: String(po.$createdAt ?? ""), supplierId: String(po.supplierId), unitCost: Number(l.unitPrice ?? l.unitCost ?? 0) }); } }
  if (autoDraftHas) return null; // déjà dans une précommande en attente
  if (stock + onOrder > threshold) return null; // une commande en cours couvre déjà le besoin
  history.sort((a, b) => b.at.localeCompare(a.at));
  // fournisseur : celui de la fiche, sinon la meilleure offre active, sinon le dernier fournisseur commandé
  const offers = (await store.list("article_suppliers", { productId: p.$id }, 50)).filter((o) => mine(ctx, o) && !o.variantId && o.status !== "inactive");
  const ok = (id: string) => { const s = c.suppliers.get(id); return s && s.archived !== true ? s : null; };
  const offerOf = (id: string) => offers.find((o) => o.supplierId === id);
  let sup = p.supplierId ? ok(String(p.supplierId)) : null;
  if (!sup) { const best = offers.filter((o) => ok(String(o.supplierId))).sort((a, b) => Number(a.price) - Number(b.price))[0]; if (best) sup = ok(String(best.supplierId)); }
  if (!sup && history[0]) sup = ok(history[0].supplierId);
  if (!sup) return { noSupplier: { productId: p.$id, name: String(p.name), stock, threshold } };
  const offer = offerOf(sup.$id); const leadDays = Number(offer?.leadDays ?? 0) > 0 ? Number(offer!.leadDays) : Number(sup.leadDays ?? 0) > 0 ? Number(sup.leadDays) : DEFAULT_LEAD;
  const r = preorderQty({ stock, threshold, onOrder, soldLast30: sold, leadDays, history: history.slice(0, 3).map((h) => h.qty), minQty: Number(offer?.minQty ?? 0), scale: sc });
  const unitPrice = Number(offer?.price ?? 0) > 0 ? Number(offer!.price) : history.find((h) => h.supplierId === sup!.$id && h.unitCost > 0)?.unitCost ?? Math.max(0, Number(p.cost ?? 0));
  return { item: { productId: p.$id, name: String(p.name), stock, threshold, onOrder, daily: r.daily, leadDays, qty: r.qty, basis: r.basis, supplierId: sup.$id, supplier: String(sup.name), unitPrice } };
}

const reason = (i: Item) => `${i.name} : stock ${i.stock} ≤ seuil ${i.threshold}${i.onOrder ? `, ${i.onOrder} déjà en commande` : ""} ; ventes ${i.daily}/j ; délai ${i.leadDays} j ; quantité ${i.qty} (${i.basis === "rotation" ? "rotation des ventes" : i.basis === "history" ? "quantité habituellement commandée" : "remise à 2 × le seuil, sans historique"})`;

/** Ajoute les articles à la précommande (un brouillon par fournisseur). Aucune exception ne remonte à l'opération qui l'a déclenchée. */
async function apply(store: Store, ctx: Ctx, items: Item[]) {
  const actor = { ...ctx, userId: AUTO_BY }; const created: string[] = [];
  const bySup = new Map<string, Item[]>(); for (const i of items) bySup.set(i.supplierId, [...(bySup.get(i.supplierId) ?? []), i]);
  for (const [supplierId, list] of bySup) {
    const draft = (await store.list("purchase_orders", { tenantId: ctx.tenantId, shopId: ctx.shopId, supplierId }, 200)).find((po) => poState(po.status) === "draft" && po.createdBy === AUTO_BY);
    const prev = draft ? parse<OrderLine[]>(draft.lines, []) : []; const lines = [...prev];
    for (const i of list) { if (lines.some((l) => lineKey(l) === lineKey({ productId: i.productId }))) continue; lines.push(await buildLine(store, ctx, { productId: i.productId, qty: i.qty, unitPrice: i.unitPrice })); }
    if (lines.length === prev.length) continue;
    const notes = [String(draft?.notes ?? "Précommande automatique (articles passés sous leur seuil) : à relire, ajuster puis soumettre."), ...list.map(reason)].join("\n").slice(0, 2000);
    const sh = await store.get("shops", ctx.shopId.slice(0, 36)); const taxRatePct = sh?.vatRatePct == null ? 0 : Math.max(0, Number(sh.vatRatePct)); const tot = poTotals(lines, Number(draft?.transportFee ?? 0), Number(draft?.otherFees ?? 0), taxRatePct);
    if (draft) { await store.batch([{ kind: "update", table: "purchase_orders", id: draft.$id, data: { lines: JSON.stringify(lines), total: tot.totalHt, notes } }, ev(actor, "po", draft.$id, "update", { auto: true, added: list.map((i) => i.name) }), aud(actor, "po.preorder", `${draft.number} +${list.length}`)]); created.push(String(draft.number)); continue; }
    const id = `pa${sha(`${ctx.tenantId}|${ctx.shopId}|${supplierId}|${Date.now()}`).slice(0, 28)}`; const now = new Date().toISOString(); const number = await poNumber(store, ctx, id, now);
    await store.batch([{ kind: "create", table: "purchase_orders", id, tenantId: ctx.tenantId, data: { tenantId: ctx.tenantId, shopId: ctx.shopId, number, supplierId, status: "draft", receipts: "[]", invoicedIds: "[]", docs: "[]", createdBy: AUTO_BY, feesAllocated: 0, lines: JSON.stringify(lines), total: tot.totalHt, deliveryOn: null, transportFee: 0, otherFees: 0, taxRatePct, notes } }, ev(actor, "po", id, "create", { auto: true, number, lines: lines.length }), aud(actor, "po.preorder", `${number} ${list.length} article(s)`)]);
    created.push(number);
  }
  return created;
}

async function context(store: Store, ctx: Ctx): Promise<Ctx2> {
  const pos = (await store.scan("purchase_orders", { tenantId: ctx.tenantId, shopId: ctx.shopId }, { maxRows: 5_000 })).rows;
  const suppliers = new Map((await store.scan("suppliers", { tenantId: ctx.tenantId, shopId: ctx.shopId }, { maxRows: 2_000 })).rows.map((s) => [s.$id, s]));
  return { products: new Map(), pos, suppliers };
}

/** Déclenché après une sortie de stock (vente, correction, transfert, inventaire) : n'échoue jamais l'opération d'origine. */
export async function autoPreorder(store: Store, ctx: Ctx, productIds: string[] | "all"): Promise<{ drafts: string[] }> {
  if (!ctx.tenantId || !ctx.shopId || !(await allowed(store, ctx)) || !(await preorderEnabled(store, ctx))) return { drafts: [] };
  const prods = productIds === "all" ? (await store.scan("products", { tenantId: ctx.tenantId, shopId: ctx.shopId }, { maxRows: 5_000 })).rows : (await Promise.all([...new Set(productIds)].slice(0, 100).map((id) => store.get("products", id)))).filter((p): p is Row => mine(ctx, p));
  const cand = prods.filter((p) => (Number(p.alertStock ?? 0) > 0 || Number(p.minStock ?? 0) > 0) && p.archived !== true); if (!cand.length) return { drafts: [] };
  const c = await context(store, ctx); const items: Item[] = [];
  for (const p of cand) { const r = await evaluate(store, ctx, p, c); if (r?.item) items.push(r.item); }
  return { drafts: items.length ? await apply(store, ctx, items) : [] };
}

/** Productions concernées par une action qui sort du stock (pour le déclenchement). */
export async function preorderTargets(store: Store, ctx: Ctx, action: string, payload: Record<string, unknown>, data: unknown): Promise<string[] | "all" | null> {
  if (action === "checkout") { const sid = (data as { saleId?: string } | null)?.saleId; const sale = sid ? await store.get("sales", sid) : null; const lines = parse<{ productId: string; components?: { productId: string }[] }[]>(sale?.lines, (payload.lines as never) ?? []);
    return lines.flatMap((l) => [l.productId, ...(l.components ?? []).map((x) => x.productId)]).filter(Boolean); }
  if (action === "stk.correct" || action === "stock.adjust") { const ids = [payload.productId, ...((payload.lines as { productId?: string }[] | undefined) ?? []).map((l) => l.productId)].filter(Boolean).map(String); return ids.length ? ids : "all"; }
  if (["xfer.ship", "stock.transfer", "count.validate"].includes(action)) return "all";
  return null;
}

// ------------------------------------------------------------------ réglage et état (Achats)
export async function preorderStatus(store: Store, ctx: Ctx) {
  needModule(ctx, "purchases"); if (!(await allowed(store, ctx))) throw new HttpError(402, "Précommande automatique : formule Business ou supérieure.");
  const enabled = await preorderEnabled(store, ctx); const c = await context(store, ctx);
  const drafts = c.pos.filter((po) => poState(po.status) === "draft" && po.createdBy === AUTO_BY).map((po) => ({ id: po.$id, number: String(po.number), supplier: String(c.suppliers.get(String(po.supplierId))?.name ?? ""), lines: parse<OrderLine[]>(po.lines, []).map((l) => ({ name: l.name, qty: l.qty, unitPrice: Number(l.unitPrice ?? 0) })), total: Number(po.total ?? 0), notes: String(po.notes ?? "") }));
  const prods = (await store.scan("products", { tenantId: ctx.tenantId, shopId: ctx.shopId }, { maxRows: 5_000 })).rows.filter((p) => (Number(p.alertStock ?? 0) > 0 || Number(p.minStock ?? 0) > 0) && p.archived !== true);
  const noSupplier: { productId: string; name: string; stock: number; threshold: number }[] = []; for (const p of prods.slice(0, 500)) { const r = await evaluate(store, ctx, p, c); if (r?.noSupplier) noSupplier.push(r.noSupplier); }
  return { enabled, drafts, noSupplier, rule: `Quantité = ventes des ${ROTATION_DAYS} derniers jours ÷ ${ROTATION_DAYS} × (délai fournisseur + ${COVER_DAYS} j) + seuil − stock − déjà en commande ; au moins la quantité habituellement commandée (médiane des 3 dernières commandes) et le minimum du fournisseur. Délai : offre fournisseur, sinon fiche fournisseur, sinon ${DEFAULT_LEAD} j.` };
}
export async function preorderSet(store: Store, ctx: Ctx, b: { enabled?: boolean }) {
  needModule(ctx, "purchases"); need(ctx, "manager"); if (!(await allowed(store, ctx))) throw new HttpError(402, "Précommande automatique : formule Business ou supérieure.");
  const enabled = b.enabled !== false; const r = await settingsRow(store, ctx); const data = JSON.stringify({ enabled });
  if (r) await store.update("crm_config", r.$id, { data, updatedBy: ctx.userId }); else await store.create("crm_config", cfgId(ctx), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, kind: "preorder", data, updatedBy: ctx.userId });
  await store.create("audit_log", `pa${sha(`${ctx.tenantId}|${Date.now()}|${Math.random()}`).slice(0, 28)}`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action: "preorder.settings", detail: enabled ? "activée" : "désactivée" });
  return { enabled };
}
/** « Analyser maintenant » : passe en revue tous les articles à seuil de la boutique. */
export async function preorderRun(store: Store, ctx: Ctx) { needModule(ctx, "purchases"); need(ctx, "manager"); if (!(await allowed(store, ctx))) throw new HttpError(402, "Précommande automatique : formule Business ou supérieure."); if (!(await preorderEnabled(store, ctx))) throw new HttpError(409, "Précommande automatique désactivée"); return autoPreorder(store, ctx, "all"); }
