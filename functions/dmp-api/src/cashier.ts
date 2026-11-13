import { createHash } from "node:crypto";
import { MAX_AMOUNT } from "../../../src/domain/articles";
import { methodsOf } from "../../../src/domain/reports";
import { needFeature } from "./articles";
import { hasRight, isProPos, ledgerWrite, needRight } from "./pos-pro";
import { HttpError, need, needModule, roleOf, type Ctx, type Row, type Store } from "./store";

const sha = (s: string) => createHash("sha1").update(s).digest("hex");
const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 30);
const parse = <T,>(s: unknown, fb: T): T => { try { const v = JSON.parse(String(s)); return v ?? fb; } catch { return fb; } };
const isManager = (ctx: Ctx) => { const r = roleOf(ctx.roles); return r === "owner" || r === "manager"; };
const audit = (store: Store, ctx: Ctx, action: string, detail: string) => store.create("audit_log", newId(), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, action, detail: detail.slice(0, 1000) });
const money = (v: unknown, label: string, min = 0): number => { const n = Number(String(v ?? "").replace(/\s/g, "")); if (!Number.isInteger(n) || n < min || n > MAX_AMOUNT) throw new HttpError(400, `${label} invalide (entier de ${min} à ${MAX_AMOUNT.toLocaleString("fr-FR")} FCFA)`); return n; };
const iso = (v: unknown): string => { const t = Date.parse(String(v)); return Number.isNaN(t) ? "" : new Date(t).toISOString(); };

export type Totals = { float: number; sales: { count: number; total: number; byMethod: Record<string, number> }; refunds: { count: number; total: number; byMethod: Record<string, number> }; movements: { out: number; in: number; pending: number; expenseOut?: number; expenseIn?: number; supplierOut?: number }; theoreticalCash: number; nonCash: Record<string, number> };

/** Totaux d'une session : ventes terminées du vendeur depuis l'ouverture (par moyen de paiement, monnaie rendue exclue, fractionnés comptés une fois), remboursements traités depuis cette caisse,
 *  mouvements AUTORISÉS. Solde théorique en espèces = fond + espèces encaissées − espèces remboursées − sorties + entrées. Les mouvements en attente ne comptent pas. */
export async function sessionTotals(store: Store, ctx: Ctx, sess: Row, until?: string): Promise<Totals> {
  const where = { tenantId: ctx.tenantId, shopId: String(sess.shopId), cashierId: String(sess.userId), status: "paid" };
  const sales = (await store.scan("sales", where, { range: { field: "soldAt", from: iso(sess.openedAt), ...(until ? { to: until } : {}) }, maxRows: 20_000 })).rows;
  const byMethod: Record<string, number> = {}; let total = 0;
  for (const s of sales) { total += Number(s.total); for (const [m, a] of Object.entries(methodsOf({ total: Number(s.total), payments: parse(s.payments, []) }))) byMethod[m] = (byMethod[m] ?? 0) + a; }
  const rets = (await store.scan("sale_returns", { tenantId: ctx.tenantId, shopId: String(sess.shopId), sessionId: sess.$id }, { maxRows: 5_000 })).rows; const rm: Record<string, number> = {}; let rt = 0;
  for (const r of rets) for (const x of parse<{ method: string; amount: number }[]>(r.refunds, [])) { rm[x.method] = (rm[x.method] ?? 0) + Number(x.amount); rt += Number(x.amount); }
  const mv = (await store.scan("cash_movements", { sessionId: sess.$id }, { maxRows: 2_000 })).rows; const out = mv.filter((m) => m.kind === "out" && m.status === "authorized").reduce((a, m) => a + Number(m.amount), 0), inn = mv.filter((m) => m.kind === "in" && m.status === "authorized").reduce((a, m) => a + Number(m.amount), 0);
  const nonCash = Object.fromEntries(Object.entries(byMethod).filter(([m]) => m !== "cash").map(([m, a]) => [m, a - (rm[m] ?? 0)]));
  const float = Number(sess.openingFloat ?? 0);
  return { float, sales: { count: sales.length, total, byMethod }, refunds: { count: rets.length, total: rt, byMethod: rm }, movements: { out, in: inn, pending: mv.filter((m) => m.status === "pending").length, expenseOut: mv.filter((m) => m.kind === "out" && m.status === "authorized" && m.expenseId).reduce((a, m) => a + Number(m.amount), 0), expenseIn: mv.filter((m) => m.kind === "in" && m.status === "authorized" && m.expenseId).reduce((a, m) => a + Number(m.amount), 0), supplierOut: mv.filter((m) => m.kind === "out" && m.status === "authorized" && m.supplierPaymentId).reduce((a, m) => a + Number(m.amount), 0) }, theoreticalCash: float + (byMethod.cash ?? 0) - (rm.cash ?? 0) - out + inn, nonCash };
}
const view = (s: Row) => ({ id: s.$id, userId: String(s.userId), shopId: String(s.shopId), status: String(s.status), openedAt: iso(s.openedAt), closedAt: s.closedAt ? iso(s.closedAt) : null, openingFloat: Number(s.openingFloat ?? 0), countedCash: s.countedCash == null ? null : Number(s.countedCash), theoreticalCash: s.theoreticalCash == null ? null : Number(s.theoreticalCash), variance: s.variance == null ? null : Number(s.variance), note: s.note ? String(s.note) : "", register: String(s.register ?? ""), varianceStatus: String(s.varianceStatus ?? ""), handoverFrom: String(s.handoverFrom ?? "") });

/** Session ouverte de CE vendeur dans CETTE boutique (une seule à la fois). */
/** Abonnés à la clôture confirmée d'une session (rapports MASTER DOGUI…). Exécutés APRÈS la clôture ; une erreur ne doit jamais empêcher ni annuler la clôture. */
export const closeHooks: ((store: Store, ctx: Ctx, sessionId: string) => Promise<void>)[] = [];
export async function openSessionOf(store: Store, ctx: Ctx): Promise<Row | null> { return (await store.list("cash_sessions", { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, status: "open" }, 5))[0] ?? null; }
/** La boutique exige-t-elle une session pour vendre ? Si oui, une session du vendeur doit couvrir l'instant de la vente (les ventes hors ligne gardent leur date réelle). */
export async function assertSessionForSale(store: Store, ctx: Ctx, soldAt: string): Promise<void> {
  const shop = await store.get("shops", ctx.shopId.slice(0, 36)); if (!shop || shop.cashRequired !== true) return;
  const t = Date.parse(soldAt); const all = await store.list("cash_sessions", { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId }, 500);
  if (!all.some((s) => Date.parse(iso(s.openedAt)) <= t + 1000 && (s.status === "open" || (s.closedAt && t < Date.parse(iso(s.closedAt)))))) throw new HttpError(409, "Ouvrez la caisse avant de vendre (session de caisse obligatoire dans cette boutique)");
}

export async function openSession(store: Store, ctx: Ctx, b: { openingFloat?: unknown; note?: string; requestId?: string; register?: string }) {
  needModule(ctx, "pos"); await needFeature(store, ctx, "smartPos"); const pro = await isProPos(store, ctx); if (pro) await needRight(store, ctx, "open");
  const register = String(b.register ?? "").trim().slice(0, 40);
  const float = money(b.openingFloat ?? 0, "Fond de caisse"); const cur = await openSessionOf(store, ctx);
  const id = b.requestId ? `cs${sha(`${ctx.userId}|${b.requestId}`).slice(0, 28)}` : newId();
  if (cur) { if (cur.$id === id) return { id: cur.$id, duplicate: true }; throw new HttpError(409, "Une session de caisse est déjà ouverte : fermez-la d'abord"); }
  if (pro && register) { // une caisse (poste) = une session ouverte à la fois ; le rang de réservation départage deux ouvertures simultanées
    const all = (await store.list("cash_sessions", { tenantId: ctx.tenantId, shopId: ctx.shopId }, 5000)).filter((x) => String(x.register ?? "").toLowerCase() === register.toLowerCase()); const busy = all.find((x) => x.status === "open"); if (busy) throw new HttpError(409, `La caisse « ${register} » est déjà ouverte${busy.userId === ctx.userId ? "" : " par un autre vendeur"}`);
    if (!(await store.create("payment_refs", `rg${sha(`${ctx.tenantId}|${ctx.shopId}|${register.toLowerCase()}|${all.length}`).slice(0, 28)}`, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, saleId: id, method: "register", reference: register.slice(0, 64), amount: 0 }))) throw new HttpError(409, `La caisse « ${register} » vient d'être ouverte par un autre vendeur`);
  }
  const data = { tenantId: ctx.tenantId, shopId: ctx.shopId, userId: ctx.userId, openedAt: new Date().toISOString(), status: "open", openingFloat: float, note: String(b.note ?? "").slice(0, 200), register };
  if (!(await store.create("cash_sessions", id, ctx.tenantId, data))) return { id, duplicate: true };
  if (pro) await ledgerWrite(store, ctx, { kind: "session_open", ref: id, amount: float, at: data.openedAt, sessionId: id, payload: { register } });
  await audit(store, ctx, "cash.open", `${id} fond ${float}${register ? ` caisse ${register}` : ""}`); return { id };
}
export async function currentSession(store: Store, ctx: Ctx) {
  needModule(ctx, "pos"); await needFeature(store, ctx, "smartPos");
  const s = await openSessionOf(store, ctx); const shop = await store.get("shops", ctx.shopId.slice(0, 36)); const required = shop?.cashRequired === true;
  if (!s) return { session: null, required };
  const mv = (await store.scan("cash_movements", { sessionId: s.$id }, { maxRows: 2_000 })).rows.map((m) => ({ id: m.$id, kind: String(m.kind), amount: Number(m.amount), reason: String(m.reason ?? ""), status: String(m.status), at: iso(m.at), userId: String(m.userId ?? ""), beneficiary: String(m.beneficiary ?? ""), expenseId: String(m.expenseId ?? "") })).sort((a, c) => c.at.localeCompare(a.at));
  return { session: view(s), totals: await sessionTotals(store, ctx, s), movements: mv, required };
}
/** Sortie (ou entrée) d'espèces : tracée avec son motif ; autorisée tout de suite si saisie par un gérant/propriétaire, sinon « en attente » d'autorisation (ne compte pas dans le solde). */
export async function cashMovement(store: Store, ctx: Ctx, b: { kind?: string; amount?: unknown; reason?: string; requestId?: string; beneficiary?: string }) {
  needModule(ctx, "pos"); await needFeature(store, ctx, "smartPos");
  const s = await openSessionOf(store, ctx); if (!s) throw new HttpError(409, "Ouvrez la caisse avant d'enregistrer une sortie ou une entrée");
  const kind = b.kind === "in" ? "in" : b.kind === "out" ? "out" : ""; if (!kind) throw new HttpError(400, "Type de mouvement inconnu"); const amount = money(b.amount, "Montant", 1); const reason = String(b.reason ?? "").trim(); if (reason.length < 3 || reason.length > 200) throw new HttpError(400, "Motif obligatoire (3 à 200 caractères)");
  const pro = await isProPos(store, ctx); const canAuth = pro ? await hasRight(store, ctx, "authorize") : isManager(ctx);
  const status = canAuth ? "authorized" : "pending"; if (kind === "out" && status === "authorized") { const t = await sessionTotals(store, ctx, s); if (amount > t.theoreticalCash) throw new HttpError(409, `Caisse insuffisante : solde théorique ${t.theoreticalCash.toLocaleString("fr-FR")} FCFA`); }
  const id = b.requestId ? `cm${sha(`${s.$id}|${b.requestId}`).slice(0, 28)}` : newId();
  const created = await store.create("cash_movements", id, ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId, sessionId: s.$id, kind, amount, reason, status, userId: ctx.userId, authorizedBy: status === "authorized" ? ctx.userId : "", at: new Date().toISOString(), beneficiary: String(b.beneficiary ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 120) });
  if (created) { await audit(store, ctx, `cash.${kind}`, `${amount} ${reason} (${status})`); if (pro && status === "authorized") await ledgerWrite(store, ctx, { kind: `cash_${kind}`, ref: id, amount: kind === "out" ? -amount : amount, at: new Date().toISOString(), sessionId: s.$id, payload: { reason } }); } return { id, status, duplicate: !created };
}
/** Autorisation (ou refus) d'un mouvement en attente : gérant ou propriétaire uniquement. */
export async function authorizeMovement(store: Store, ctx: Ctx, b: { id: string; approve?: boolean }) {
  needModule(ctx, "pos"); await needFeature(store, ctx, "smartPos"); const pro = await isProPos(store, ctx); if (pro) await needRight(store, ctx, "authorize"); else need(ctx, "manager");
  const m = await store.get("cash_movements", String(b.id)); if (!m || m.tenantId !== ctx.tenantId || m.shopId !== ctx.shopId) throw new HttpError(404, "Mouvement introuvable");
  if (m.status !== "pending") throw new HttpError(409, `Mouvement déjà ${m.status === "authorized" ? "autorisé" : "refusé"}`);
  const s = await store.get("cash_sessions", String(m.sessionId)); if (!s || s.status !== "open") throw new HttpError(409, "La session de ce mouvement est fermée");
  if (b.approve !== false && m.kind === "out") { const t = await sessionTotals(store, ctx, s); if (Number(m.amount) > t.theoreticalCash) throw new HttpError(409, `Caisse insuffisante : solde théorique ${t.theoreticalCash.toLocaleString("fr-FR")} FCFA`); }
  await store.update("cash_movements", m.$id, { status: b.approve === false ? "rejected" : "authorized", authorizedBy: ctx.userId }); if (pro && b.approve !== false) await ledgerWrite(store, ctx, { kind: `cash_${m.kind}`, ref: m.$id, amount: m.kind === "out" ? -Number(m.amount) : Number(m.amount), at: new Date().toISOString(), sessionId: s.$id, payload: { reason: String(m.reason ?? ""), authorizedBy: ctx.userId } }); await audit(store, ctx, b.approve === false ? "cash.reject" : "cash.authorize", `${m.$id} ${m.amount}`); return { id: m.$id, status: b.approve === false ? "rejected" : "authorized" };
}
/** Fermeture : montant réellement compté saisi par le vendeur ; écart = compté − solde théorique. Mouvements en attente à traiter d'abord. Rejouable (même montant). */
export async function closeSession(store: Store, ctx: Ctx, b: { sessionId?: string; counted?: unknown; note?: string }) {
  needModule(ctx, "pos"); await needFeature(store, ctx, "smartPos"); const pro = await isProPos(store, ctx); if (pro) await needRight(store, ctx, "close");
  const s = b.sessionId ? await store.get("cash_sessions", b.sessionId) : await openSessionOf(store, ctx); if (!s || s.tenantId !== ctx.tenantId || s.shopId !== ctx.shopId) throw new HttpError(404, "Session introuvable");
  if (s.userId !== ctx.userId && !isManager(ctx)) throw new HttpError(403, "Seul le vendeur de la session ou un gérant peut la fermer");
  const counted = money(b.counted, "Montant compté"); if (s.status === "closed") { if (Number(s.countedCash) === counted) return { id: s.$id, duplicate: true, variance: Number(s.variance), theoreticalCash: Number(s.theoreticalCash) }; throw new HttpError(409, "Session déjà fermée"); }
  const pendExp = (await store.list("expenses", { tenantId: ctx.tenantId, shopId: ctx.shopId, sessionId: s.$id, status: "pending" }, 50)).length; if (pendExp > 0) throw new HttpError(409, `${pendExp} dépense(s) payée(s) depuis cette caisse en attente de validation : faites-les valider ou rejeter avant la fermeture`);
  const until = new Date(Date.now() + 1).toISOString(); const t = await sessionTotals(store, ctx, s, until); if (t.movements.pending > 0) throw new HttpError(409, `${t.movements.pending} mouvement(s) de caisse en attente d'autorisation : faites-les autoriser ou refuser avant la fermeture`);
  const variance = counted - t.theoreticalCash; const tol = Math.max(0, Number((await store.get("shops", ctx.shopId.slice(0, 36)))?.varianceTolerance ?? 0)); const varianceStatus = pro ? (Math.abs(variance) > tol ? "pending" : "ok") : "";
  await store.update("cash_sessions", s.$id, { status: "closed", closedAt: until, countedCash: counted, theoreticalCash: t.theoreticalCash, variance, ...(varianceStatus ? { varianceStatus } : {}), closedBy: ctx.userId, summary: JSON.stringify(t), note: String(b.note ?? s.note ?? "").slice(0, 200) });
  if (pro) await ledgerWrite(store, ctx, { kind: "session_close", ref: s.$id, amount: counted, at: until, sessionId: s.$id, userId: String(s.userId), payload: { theoretical: t.theoreticalCash, variance, varianceStatus } });
  await audit(store, ctx, "cash.close", `${s.$id} compté ${counted} théorique ${t.theoreticalCash} écart ${variance}`); for (const h of closeHooks) { try { await h(store, ctx, s.$id); } catch (e) { /* la clôture reste valide ; l'échec est tracé pour être rejoué */ await audit(store, ctx, "master.hook.failed", `${s.$id} ${String((e as Error)?.message ?? e)}`.slice(0, 200)).catch(() => undefined); } } return { id: s.$id, variance, varianceStatus, theoreticalCash: t.theoreticalCash, totals: t };
}
const dayStart = (d: string) => new Date(`${d}T00:00:00Z`).toISOString();
async function nameMap(store: Store, ctx: Ctx): Promise<Map<string, string>> { const m = new Map<string, string>((await store.scan("staff", { tenantId: ctx.tenantId }, { maxRows: 500 })).rows.map((x) => [String(x.userId), String(x.name)])); try { for (const o of await store.listOwners(ctx.tenantId)) m.set(o.userId, o.name || "Propriétaire"); } catch { /* annuaire indisponible */ } return m; }
/** Historique des sessions : le vendeur voit les siennes, le gérant toutes celles de la boutique. */
export async function listSessions(store: Store, ctx: Ctx, b: { from?: string; to?: string; userId?: string } = {}) {
  needModule(ctx, "pos"); await needFeature(store, ctx, "smartPos"); const mgr = isManager(ctx); const day = /^\d{4}-\d{2}-\d{2}$/;
  const from = b.from && day.test(b.from) ? dayStart(b.from) : new Date(Date.now() - 30 * 864e5).toISOString(); const to = b.to && day.test(b.to) ? new Date(Date.parse(dayStart(b.to)) + 864e5).toISOString() : new Date(Date.now() + 864e5).toISOString();
  const where: Record<string, string> = { tenantId: ctx.tenantId, shopId: ctx.shopId }; if (!mgr) where.userId = ctx.userId; else if (b.userId) where.userId = String(b.userId);
  const rows = (await store.scan("cash_sessions", where, { range: { field: "openedAt", from, to }, maxRows: 500 })).rows.sort((a, c) => iso(c.openedAt).localeCompare(iso(a.openedAt))).slice(0, 200); const names = await nameMap(store, ctx);
  return { sessions: await Promise.all(rows.map(async (s) => ({ ...view(s), seller: names.get(String(s.userId)) ?? String(s.userId), totals: s.status === "closed" ? parse<Totals | null>(s.summary, null) : await sessionTotals(store, ctx, s) }))) };
}
/** Rapport par vendeur : sessions, ventes, remboursements et écarts de caisse cumulés (gérant/propriétaire). */
export async function sellerReport(store: Store, ctx: Ctx, b: { from?: string; to?: string } = {}) {
  needModule(ctx, "pos"); need(ctx, "manager"); await needFeature(store, ctx, "smartPos"); const { sessions } = await listSessions(store, ctx, b); const by = new Map<string, { userId: string; seller: string; sessions: number; closed: number; sales: number; salesTotal: number; refunds: number; variance: number; cashIn: number }>();
  for (const s of sessions) { const a = by.get(s.userId) ?? { userId: s.userId, seller: s.seller, sessions: 0, closed: 0, sales: 0, salesTotal: 0, refunds: 0, variance: 0, cashIn: 0 }; a.sessions++; if (s.status === "closed") { a.closed++; a.variance += s.variance ?? 0; } a.sales += s.totals?.sales.count ?? 0; a.salesTotal += s.totals?.sales.total ?? 0; a.refunds += s.totals?.refunds.total ?? 0; a.cashIn += s.totals?.sales.byMethod.cash ?? 0; by.set(s.userId, a); }
  return { sellers: [...by.values()].sort((a, c) => c.salesTotal - a.salesTotal), note: "Écart = compté − solde théorique, sur les sessions fermées. Les ventes et remboursements d'une session ouverte sont ceux en cours." };
}
