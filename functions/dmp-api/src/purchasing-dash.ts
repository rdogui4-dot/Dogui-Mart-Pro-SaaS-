import { priceTrend, toDeliver, poState, type OrderLine } from "../../../src/domain/purchasing-plus";
import { stockFor } from "./checkout";
import { gate, invView, poTotalsOf, today } from "./purchasing-plus";
import { HttpError, need, type Ctx, type Row, type Store } from "./store";

const parse = <T,>(s: unknown, fb: T): T => { try { const v = JSON.parse(String(s)); return v ?? fb; } catch { return fb; } };
const day10 = (v: unknown): string => { const t = Date.parse(String(v ?? "")); return Number.isNaN(t) ? "" : new Date(t).toISOString().slice(0, 10); };
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const inRange = (d: string, from: string, to: string) => !!d && d >= from && d <= to;
const top = <T extends { value: number }>(m: Map<string, T>, n = 5) => [...m.values()].sort((a, b) => b.value - a.value).slice(0, n);

/**
 * Tableau de bord Achats (Business). Quatre mesures DISTINCTES, jamais additionnées :
 *  - commandé  = valeur HT des commandes validées créées dans la période,
 *  - reçu      = valeur (prix de commande) des quantités ACCEPTÉES par les réceptions validées de la période,
 *  - facturé   = montant des factures fournisseur émises dans la période,
 *  - payé      = règlements réellement effectués dans la période (sortie financière).
 * « À payer » et « échu » sont des soldes à date (toutes factures non soldées), pas des flux de période.
 */
export async function purchasingDashboard(store: Store, ctx: Ctx, b: { from?: string; to?: string; supplierId?: string; shopId?: string } = {}) {
  await gate(store, ctx); need(ctx, "manager"); const t = await today(store, ctx);
  const to = b.to ?? t; const from = b.from ?? `${to.slice(0, 8)}01`; if (!isDay(from) || !isDay(to) || from > to) throw new HttpError(400, "Période invalide");
  const all = b.shopId === "all"; if (all && !ctx.roles.includes("owner")) throw new HttpError(403, "Seul le propriétaire consolide toutes les boutiques");
  const where: Record<string, string> = all ? { tenantId: ctx.tenantId } : { tenantId: ctx.tenantId, shopId: ctx.shopId }; const sid = b.supplierId ? String(b.supplierId) : "";
  const sups = (await store.scan("suppliers", where, { maxRows: 3000 })).rows; const names = new Map(sups.map((s) => [s.$id, String(s.name)]));
  if (sid && !names.has(sid)) throw new HttpError(404, "Fournisseur introuvable");
  const bySup = <R extends Row>(rows: R[], key: string) => (sid ? rows.filter((r) => String(r[key]) === sid) : rows);
  const pos = bySup((await store.scan("purchase_orders", where, { maxRows: 10_000 })).rows, "supplierId");
  const recs = bySup((await store.scan("purchase_receipts", where, { maxRows: 10_000 })).rows, "supplierId").filter((r) => r.status === "validated");
  const invs = bySup((await store.scan("invoices", { ...where, kind: "supplier" }, { maxRows: 10_000 })).rows, "partyId").map((i) => invView(i, t)).filter((i) => !i.provisional && i.state !== "cancelled");

  // ----- commandes
  const states: Record<string, number> = {}; let orderedValue = 0, orderedCount = 0;
  for (const p of pos) { const s = poState(p.status); if (inRange(day10(p.$createdAt), from, to)) { states[s] = (states[s] ?? 0) + 1; if (s !== "draft" && s !== "cancelled") { orderedValue += poTotalsOf(p).totalHt; orderedCount++; } } }
  const open = pos.filter((p) => ["pending", "validated", "partial"].includes(poState(p.status)));
  const inProgress = open.filter((p) => ["validated", "partial"].includes(poState(p.status)));
  const expected = inProgress.map((p) => { const lines = parse<OrderLine[]>(p.lines, []); const remaining = lines.reduce((a, l) => a + toDeliver(l), 0); const d = day10(p.deliveryOn); return { id: p.$id, number: String(p.number), supplier: names.get(String(p.supplierId)) ?? "", deliveryOn: d, remainingQty: remaining, remainingValue: lines.reduce((a, l) => a + Math.round(toDeliver(l) * (l.unitCost ?? 0)), 0), late: !!d && d < t && remaining > 0, lateDays: d && d < t ? Math.round((Date.parse(t) - Date.parse(d)) / 864e5) : 0 }; }).filter((e) => e.remainingQty > 0).sort((a, c) => (a.deliveryOn || "9999").localeCompare(c.deliveryOn || "9999"));

  // ----- réceptions (quantités acceptées seulement)
  const poById = new Map(pos.map((p) => [p.$id, p])); let receivedValue = 0, receivedCount = 0, damagedQty = 0, refusedQty = 0; const artRecv = new Map<string, { productId: string; name: string; qty: number; value: number }>(); const supRecv = new Map<string, { supplierId: string; name: string; value: number; orders: number }>();
  for (const r of recs) { if (!inRange(day10(r.receivedOn), from, to)) continue; receivedCount++; const po = poById.get(String(r.poId)); const plines = po ? parse<OrderLine[]>(po.lines, []) : []; let v = 0;
    for (const l of parse<{ productId: string; variantId?: string; name: string; accepted: number; damaged: number; refused: number }[]>(r.lines, [])) { const pl = plines.find((x) => x.productId === l.productId && (x.variantId ?? "") === (l.variantId ?? "")); const val = Math.round(l.accepted * (pl?.unitCost ?? 0)); v += val; damagedQty += l.damaged; refusedQty += l.refused; const k = `${l.productId}|${l.variantId ?? ""}`; const a = artRecv.get(k) ?? { productId: l.productId, name: l.name, qty: 0, value: 0 }; a.qty += l.accepted; a.value += val; artRecv.set(k, a); }
    receivedValue += v; const sk = String(r.supplierId); const s = supRecv.get(sk) ?? { supplierId: sk, name: names.get(sk) ?? "", value: 0, orders: 0 }; s.value += v; supRecv.set(sk, s); }

  // ----- factures et paiements
  const invoicedIn = invs.filter((i) => inRange(i.issuedOn, from, to)); const invoicedValue = invoicedIn.reduce((a, i) => a + i.total, 0);
  const payments = invs.flatMap((i) => i.payments.map((p) => ({ ...p, invoice: i.number, supplierId: i.supplierId }))).filter((p) => inRange(p.date, from, to)); const paidValue = payments.reduce((a, p) => a + p.amount, 0);
  const payable = invs.filter((i) => i.remaining > 0); const toPay = payable.reduce((a, i) => a + i.remaining, 0); const overdue = payable.filter((i) => i.overdue); const disputed = payable.filter((i) => i.disputed);
  const payByMethod: Record<string, number> = {}; for (const p of payments) payByMethod[`${p.source === "till" ? "caisse" : p.method}`] = (payByMethod[`${p.source === "till" ? "caisse" : p.method}`] ?? 0) + p.amount;
  const topSup = new Map<string, { supplierId: string; name: string; value: number; orders: number }>(); for (const p of pos) { if (!inRange(day10(p.$createdAt), from, to) || ["draft", "cancelled"].includes(poState(p.status))) continue; const k = String(p.supplierId); const s = topSup.get(k) ?? { supplierId: k, name: names.get(k) ?? "", value: 0, orders: 0 }; s.value += poTotalsOf(p).totalHt; s.orders++; topSup.set(k, s); }

  return {
    period: { from, to, today: t }, scope: all ? "all" : "shop", supplierId: sid,
    suppliers: { active: sups.filter((s) => s.archived !== true).length, archived: sups.filter((s) => s.archived === true).length },
    orders: { byState: states, pending: open.filter((p) => poState(p.status) === "pending").length, inProgress: inProgress.length, awaitingValidation: open.filter((p) => poState(p.status) === "pending").length, orderedCount, orderedValue },
    receipts: { count: receivedCount, value: receivedValue, damagedQty, refusedQty, expected, lateCount: expected.filter((e) => e.late).length },
    invoices: { issuedCount: invoicedIn.length, invoiced: invoicedValue, toPay, toPayCount: payable.length, overdue: overdue.reduce((a, i) => a + i.remaining, 0), overdueCount: overdue.length, disputedCount: disputed.length, disputed: disputed.reduce((a, i) => a + i.remaining, 0), overdueList: overdue.sort((a, c) => c.lateDays - a.lateDays).slice(0, 10).map((i) => ({ id: i.id, number: i.number, ref: i.ref, supplier: names.get(i.supplierId) ?? "", remaining: i.remaining, dueOn: i.dueOn, lateDays: i.lateDays })) },
    payments: { count: payments.length, paid: paidValue, byMethod: payByMethod },
    topSuppliers: top(topSup), topSuppliersReceived: top(supRecv), topArticles: top(artRecv),
    note: "Commandé, reçu, facturé et payé sont quatre mesures distinctes : ne les additionnez pas. « À payer » et « échu » sont des soldes à date.",
  };
}

/** Pour un article : quantités attendues (commandes validées non reçues), reçues, disponibles ; historique des prix d'achat. */
export async function articlePurchaseView(store: Store, ctx: Ctx, b: { productId?: string; variantId?: string } = {}) {
  await gate(store, ctx); const p = await store.get("products", String(b.productId ?? "")); if (!p || p.tenantId !== ctx.tenantId || p.shopId !== ctx.shopId) throw new HttpError(404, "Article introuvable"); const vid = String(b.variantId ?? "");
  const pos = (await store.scan("purchase_orders", { tenantId: ctx.tenantId, shopId: ctx.shopId }, { maxRows: 10_000 })).rows; const names = new Map((await store.scan("suppliers", { tenantId: ctx.tenantId, shopId: ctx.shopId }, { maxRows: 3000 })).rows.map((s) => [s.$id, String(s.name)]));
  let expected = 0, received = 0, ordered = 0; const lines: { po: string; supplier: string; state: string; qty: number; received: number; remaining: number; unitPrice: number; discountPct: number; deliveryOn: string; at: string }[] = [];
  for (const po of pos) { const st = poState(po.status); if (st === "draft" || st === "cancelled") continue; for (const l of parse<OrderLine[]>(po.lines, [])) { if (l.productId !== p.$id || (l.variantId ?? "") !== vid) continue; const rem = toDeliver(l); ordered += l.qty; received += l.received; if (st === "validated" || st === "partial") expected += rem; lines.push({ po: String(po.number), supplier: names.get(String(po.supplierId)) ?? "", state: st, qty: l.qty, received: l.received, remaining: rem, unitPrice: l.unitPrice ?? l.unitCost, discountPct: l.discountPct ?? 0, deliveryOn: day10(po.deliveryOn), at: day10(po.$createdAt) }); } }
  const events = (await store.list("article_cost_events", { productId: p.$id }, 500)).filter((e) => (e.variantId ?? "") === vid).sort((a, c) => String(a.$createdAt ?? "").localeCompare(String(c.$createdAt ?? "")));
  const history = events.map((e, i) => ({ at: day10(e.$createdAt), supplier: names.get(String(e.supplierId)) ?? "", ref: String(e.ref ?? ""), unitCost: Number(e.unitCost ?? 0), landedCost: Number(e.landedCost ?? e.unitCost ?? 0), qty: Number(e.qty ?? 0), costBefore: Number(e.costBefore ?? 0), costAfter: Number(e.costAfter ?? 0), method: String(e.method ?? ""), variationPct: i ? priceTrend(Number(events[i - 1]!.unitCost ?? 0), Number(e.unitCost ?? 0)) : null }));
  const last = history.at(-1) ?? null;
  return { productId: p.$id, name: String(p.name), unit: String(p.unit ?? ""), available: await stockFor(store, p.$id), ordered, received, expected, lines: lines.sort((a, c) => c.at.localeCompare(a.at)), history: history.slice().reverse(), lastPrice: last?.unitCost ?? null, lastVariationPct: last?.variationPct ?? null, currentCost: Number(p.cost ?? 0), costMethod: String(history.at(-1)?.method ?? "cmup"),
    note: "Disponible = stock réel (mouvements). Attendu = reste à recevoir des commandes validées : il n'est PAS dans le stock disponible. Les anciennes ventes gardent leur propre prix et coût figés." };
}
