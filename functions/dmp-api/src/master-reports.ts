/** MASTER DOGUI — étape 2 : rapport de clôture (accroché à closeSession) et briefing d'ouverture, SANS IA.
 *  Idempotents (une clé par rapport), versionnés (« remplacé »), partiels si des données manquent, jamais bloquants pour la caisse. */
import { createHash } from "node:crypto";
import { boundsOf, addDays, todayIn } from "../../../src/domain/overview";
import { DEFAULT_TIMEZONE, isTimezone } from "../../../src/domain/promotions";
import { buildClosing, buildOpening, marginOf, type ClosingFacts, type DayFacts, type MarginLine, type Missing, type OpeningFacts, type Report, type RStatus, STATUS_LABEL } from "../../../src/domain/master-report";
import { needFeature } from "./articles";
import { closeHooks, sessionTotals } from "./cashier";
import { MIN, iso, parse } from "./crm";
import { roleKind } from "./fin-rules";
import { names } from "./inventory";
import { needMaster } from "./master";
import { trackReportRecos } from "./master-reco";
import { shopStock } from "./stock-biz";
import { HttpError, type Ctx, type Row, type Store } from "./store";

const sha = (s: string) => createHash("sha1").update(s).digest("hex");
const audit = (store: Store, ctx: Ctx, action: string, detail: string) => store.create("audit_log", crypto.randomUUID().replace(/-/g, "").slice(0, 30), ctx.tenantId, { tenantId: ctx.tenantId, shopId: ctx.shopId || "platform", userId: ctx.userId, action, detail: detail.slice(0, 500) });
const tzOf = (shop: Row | null) => (shop?.promoTz && isTimezone(String(shop.promoTz)) ? String(shop.promoTz) : DEFAULT_TIMEZONE);
const mgr = (ctx: Ctx) => { if (roleKind(ctx) === "other") throw new HttpError(403, "Réservé au propriétaire et aux gérants"); if (!ctx.shopId) throw new HttpError(400, "Choisissez une boutique"); };
const methodsOf = (s: Row): Record<string, number> => { const out: Record<string, number> = {}; const pays = parse<{ method: string; amount: number }[]>(s.payments, []); if (!pays.length) { out.cash = Number(s.total); return out; } for (const p of pays) out[p.method] = (out[p.method] ?? 0) + Number(p.amount); return out; };

/** Marge brute sur le coût FIGÉ de chaque ligne de vente (unitCost enregistré à la vente) ; une ligne sans coût figé rend la marge non calculable (jamais estimée au coût actuel). */
const marginFor = async (_store: Store, _ctx: Ctx, sales: Row[]) => { try { const lines: MarginLine[] = []; for (const s of sales) for (const l of parse<{ qty: number; amount: number; unitCost?: number }[]>(s.lines, [])) lines.push({ qty: Number(l.qty), amount: Number(l.amount), cost: l.unitCost !== undefined && Number(l.unitCost) > 0 ? Number(l.unitCost) : null }); return marginOf(lines); } catch { return null; } };

// ------------------------------------------------------------------ persistance idempotente
const rid = (ctx: Ctx, type: string, key: string, v: number) => `mr${sha(`${ctx.tenantId}|${ctx.shopId}|${type}|${key}|${v}`).slice(0, 30)}`;
const viewOf = (r: Row) => ({ id: r.$id, type: String(r.type), businessDate: String(r.businessDate), sessionId: String(r.sessionId ?? ""), status: String(r.status) as RStatus, statusLabel: STATUS_LABEL[String(r.status) as RStatus] ?? String(r.status), version: Number(r.version ?? 1), generatedAt: r.generatedAt ? iso(r.generatedAt) : "", error: String(r.error ?? ""), replacedBy: String(r.replacedBy ?? ""), trigger: String(r.trigger ?? "") });
const fullOf = (r: Row) => ({ ...viewOf(r), report: parse<Report | null>(r.data, null), missing: parse<Missing[]>(r.missing, []) });
async function rowsOf(store: Store, ctx: Ctx, type: string, key: string): Promise<Row[]> { const all = (await store.scan("md_reports", { ...MIN(ctx), type }, { maxRows: 500 })).rows.filter((r) => (type === "closing" ? String(r.sessionId) === key : String(r.businessDate) === key)); return all.sort((a, b) => Number(a.version ?? 1) - Number(b.version ?? 1)); }
async function persist(store: Store, ctx: Ctx, type: "opening" | "closing", key: string, businessDate: string, build: () => Promise<Report>, opts: { regenerate?: boolean; trigger: string }): Promise<{ row: Row; created: boolean }> {
  const rows = await rowsOf(store, ctx, type, key); const live = rows.filter((r) => r.status !== "superseded").at(-1);
  if (live && !opts.regenerate && live.status !== "failed" && live.status !== "generating") return { row: live, created: false };
  if (live && live.status === "generating" && !opts.regenerate) { const age = live.$createdAt ? Date.now() - Date.parse(String(live.$createdAt)) : 0; if (age < 60_000) return { row: live, created: false }; }
  let row: Row; let version: number;
  if (live && live.status === "failed" && !opts.regenerate) { row = live; version = Number(live.version ?? 1); await store.update("md_reports", live.$id, { status: "generating", error: "" }); }
  else { version = (rows.at(-1)?.version ? Number(rows.at(-1)!.version) : 0) + 1; const id = rid(ctx, type, key, version); const ok = await store.create("md_reports", id, ctx.tenantId, { ...MIN(ctx), type, businessDate, sessionId: type === "closing" ? key : "", status: "generating", version, trigger: opts.trigger, createdBy: ctx.userId }); if (!ok) { const again = await store.get("md_reports", id); return { row: again!, created: false }; } row = (await store.get("md_reports", id))!; }
  try { const rep = await build(); const status: RStatus = rep.missing.length ? "partial" : "ready"; await store.update("md_reports", row.$id, { status, data: JSON.stringify(rep), missing: JSON.stringify(rep.missing), generatedAt: new Date().toISOString(), error: "" }); if (live && opts.regenerate && live.$id !== row.$id) await store.update("md_reports", live.$id, { status: "superseded", replacedBy: row.$id }); await audit(store, ctx, `master.report.${type}`, `${row.$id} v${version} ${status} ${key}${opts.regenerate ? " (régénéré)" : ""}`); await trackReportRecos(store, ctx, rep.recommendations); }
  catch (e) { await store.update("md_reports", row.$id, { status: "failed", error: String((e as Error).message ?? e).slice(0, 200) }); await audit(store, ctx, `master.report.${type}.failed`, `${row.$id} ${(e as Error).message}`); }
  return { row: (await store.get("md_reports", row.$id))!, created: true };
}

// ------------------------------------------------------------------ clôture
async function closingFacts(store: Store, ctx: Ctx, s: Row): Promise<ClosingFacts> {
  const shop = await store.get("shops", String(s.shopId).slice(0, 36)); const tz = tzOf(shop); const who = await names(store, ctx); const closedAt = iso(s.closedAt); const t = await sessionTotals(store, { ...ctx, shopId: String(s.shopId) }, s, closedAt);
  const win = { range: { field: "soldAt", from: iso(s.openedAt), to: closedAt }, maxRows: 20_000 }; const base = { tenantId: ctx.tenantId, shopId: String(s.shopId), cashierId: String(s.userId) };
  const paid = (await store.scan("sales", { ...base, status: "paid" }, win)).rows; const cancelled = (await store.scan("sales", { ...base, status: "cancelled" }, win)).rows.length;
  const exps = (await store.scan("expenses", { tenantId: ctx.tenantId, shopId: String(s.shopId), sessionId: s.$id }, { maxRows: 500 })).rows.map((e) => ({ label: String(e.label), amount: Number(e.amount), status: String(e.status) }));
  const prevRows = (await store.list("cash_sessions", { tenantId: ctx.tenantId, shopId: String(s.shopId), userId: String(s.userId), status: "closed" }, 200)).filter((x) => x.$id !== s.$id && Date.parse(iso(x.closedAt)) < Date.parse(iso(s.openedAt))).sort((a, b) => Date.parse(iso(b.closedAt)) - Date.parse(iso(a.closedAt)));
  const pv = prevRows[0]; const pvSum = pv ? parse<{ sales?: { total?: number; count?: number } }>(pv.summary, {}) : null;
  const tol = Math.max(0, Number(shop?.varianceTolerance ?? 0));
  return { shop: String(shop?.name ?? "Boutique"), cashier: who.get(String(s.userId)) ?? "", businessDate: todayIn(new Date(Date.parse(iso(s.openedAt))), tz), session: { id: s.$id, openedAt: iso(s.openedAt), closedAt, float: Number(s.openingFloat ?? 0), counted: Number(s.countedCash ?? 0), theoretical: Number(s.theoreticalCash ?? 0), variance: Number(s.variance ?? 0), varianceStatus: String(s.varianceStatus ?? ""), tolerance: tol }, sales: { count: t.sales.count, total: t.sales.total, byMethod: t.sales.byMethod }, refunds: { count: t.refunds.count, total: t.refunds.total, byMethod: t.refunds.byMethod }, cancelled, movements: { in: t.movements.in, out: t.movements.out, expenseOut: t.movements.expenseOut }, expenses: exps, margin: await marginFor(store, { ...ctx, shopId: String(s.shopId) }, paid), previous: pv && pvSum?.sales ? { total: Number(pvSum.sales.total ?? 0), count: Number(pvSum.sales.count ?? 0), closedAt: iso(pv.closedAt) } : null } as ClosingFacts;
}
/** Appelé après chaque clôture confirmée : génère le rapport (silencieusement ignoré sans licence valide ; jamais bloquant). */
async function onClose(store: Store, ctx: Ctx, sessionId: string) {
  try { await needMaster(store, ctx); } catch { return; }
  const s = await store.get("cash_sessions", sessionId); if (!s || s.status !== "closed" || s.tenantId !== ctx.tenantId) return; const cx = { ...ctx, shopId: String(s.shopId) };
  await persist(store, cx, "closing", sessionId, todayIn(new Date(Date.parse(iso(s.openedAt))), tzOf(await store.get("shops", String(s.shopId).slice(0, 36)))), async () => buildClosing(await closingFacts(store, ctx, s)), { trigger: "event" });
}
closeHooks.push(onClose);
export async function closingGet(store: Store, ctx: Ctx, b: { sessionId?: string; regenerate?: boolean }) {
  mgr(ctx); await needMaster(store, ctx); const s = await store.get("cash_sessions", String(b.sessionId ?? "")); if (!s || s.tenantId !== ctx.tenantId || s.shopId !== ctx.shopId) throw new HttpError(404, "Session introuvable");
  if (s.status !== "closed") throw new HttpError(409, "Le rapport de clôture n'existe qu'après la clôture confirmée de la session");
  const date = todayIn(new Date(Date.parse(iso(s.openedAt))), tzOf(await store.get("shops", ctx.shopId.slice(0, 36)))); const r = await persist(store, ctx, "closing", s.$id, date, async () => buildClosing(await closingFacts(store, ctx, s)), { regenerate: b.regenerate === true, trigger: "user" }); return { ...fullOf(r.row), created: r.created };
}

// ------------------------------------------------------------------ ouverture
const dayFacts = async (store: Store, ctx: Ctx, day: string, tz: string) => { const b = boundsOf(day, day, tz); const sales = (await store.scan("sales", { ...MIN(ctx), status: "paid" }, { range: { field: "soldAt", from: b.gte, to: b.lt }, maxRows: 20_000 })).rows.filter((x) => iso(x.soldAt) >= b.gte && iso(x.soldAt) < b.lt); const byMethod: Record<string, number> = {}; let total = 0; for (const s of sales) { total += Number(s.total); for (const [m, a] of Object.entries(methodsOf(s))) byMethod[m] = (byMethod[m] ?? 0) + a; }
  const rets = (await store.scan("sale_returns", MIN(ctx), { range: { field: "at", from: b.gte, to: b.lt }, maxRows: 5000 })).rows.filter((r) => r.status !== "failed" && iso(r.at) >= b.gte && iso(r.at) < b.lt); return { sales, count: sales.length, total, byMethod, refunds: rets.reduce((a, r) => a + Number(r.amount), 0) }; };
async function openingFacts(store: Store, ctx: Ctx, date: string, tz: string): Promise<OpeningFacts> {
  const shop = await store.get("shops", ctx.shopId.slice(0, 36)); const y = await dayFacts(store, ctx, addDays(date, -1), tz); const b = await dayFacts(store, ctx, addDays(date, -2), tz); const unavailable: Missing[] = [];
  const sect = async <T,>(name: string, f: () => Promise<T>, feature?: Parameters<typeof needFeature>[2], module?: string): Promise<T | null> => { try { if (module && !ctx.modules?.includes(module as never)) throw new Error(`module ${module} non accessible avec votre rôle`); if (feature) await needFeature(store, ctx, feature); return await f(); } catch (e) { unavailable.push({ section: name, reason: String((e as Error).message ?? e).slice(0, 120) }); return null; } };
  const stock = await sect("Stock", async () => { const { items } = await shopStock(store, ctx); const out = items.filter((i) => i.qty <= 0).map((i) => i.name); const low = items.filter((i) => i.qty > 0 && i.min > 0 && i.qty <= i.min).map((i) => i.name); return { out, low, articles: items.length }; }, undefined, "stock");
  const purchases = await sect("Achats", async () => { const po = (await store.scan("purchase_orders", MIN(ctx), { maxRows: 5000 })).rows; return { toReceive: po.filter((o) => o.status === "ordered").length, partial: po.filter((o) => o.status === "partial").length }; }, "purchasing", "purchases");
  const expenses = await sect("Dépenses", async () => ({ pending: (await store.scan("expenses", { ...MIN(ctx), status: "pending" }, { maxRows: 2000 })).rows.length }), "expenses");
  const cash = await sect("Caisse", async () => { const closed = (await store.scan("cash_sessions", { ...MIN(ctx), status: "closed" }, { maxRows: 2000 })).rows.sort((a, c) => Date.parse(iso(c.closedAt)) - Date.parse(iso(a.closedAt))); return { pendingVariances: closed.filter((c) => c.varianceStatus === "pending").length, lastVariance: closed[0] ? Number(closed[0].variance ?? 0) : null }; }, "smartPos");
  const crm = await sect("CRM", async () => ({ overdue: (await store.scan("crm_tasks", { ...MIN(ctx), status: "open" }, { maxRows: 5000 })).rows.filter((t) => t.dueAt && Date.parse(iso(t.dueAt)) < Date.now()).length }), "crm");
  void shop; return { shop: String(shop?.name ?? "Boutique"), businessDate: date, yesterday: { count: y.count, total: y.total, byMethod: y.byMethod, refunds: y.refunds } as DayFacts, dayBefore: { count: b.count, total: b.total }, margin: y.count ? await marginFor(store, ctx, y.sales) : null, stock, purchases, expenses, cash, crm, unavailable };
}
export async function opening(store: Store, ctx: Ctx, b: { regenerate?: boolean } = {}) {
  mgr(ctx); const lic = await (async () => { try { await needMaster(store, ctx); return null; } catch (e) { return (e as Error).message; } })(); if (lic) return { skipped: "license", message: lic };
  const open = await store.list("cash_sessions", { ...MIN(ctx), status: "open" }, 20); if (open.length) return { skipped: "session_open", message: "Une session de caisse est ouverte : aucun briefing d'ouverture n'est produit.", sessions: open.length };
  const shop = await store.get("shops", ctx.shopId.slice(0, 36)); const tz = tzOf(shop); const date = todayIn(new Date(), tz); const r = await persist(store, ctx, "opening", date, date, async () => buildOpening(await openingFacts(store, ctx, date, tz)), { regenerate: b.regenerate === true, trigger: "user" });
  return { skipped: null, ...fullOf(r.row), created: r.created };
}

// ------------------------------------------------------------------ consultation (reste accessible après expiration)
export async function reportList(store: Store, ctx: Ctx, b: { type?: string; limit?: unknown } = {}) { mgr(ctx); const lim = Math.min(100, Math.max(1, Math.round(Number(b.limit ?? 30)) || 30)); const rows = (await store.scan("md_reports", { ...MIN(ctx), ...(b.type === "opening" || b.type === "closing" ? { type: b.type } : {}) }, { maxRows: 1000 })).rows; return { reports: rows.map((r) => { const v = viewOf(r); const rep = parse<Report | null>(r.data, null); return { ...v, title: rep?.title ?? "", alerts: rep ? rep.alerts.length : 0, missing: parse<Missing[]>(r.missing, []).length }; }).sort((a, c) => c.businessDate.localeCompare(a.businessDate) || c.version - a.version).slice(0, lim) }; }
export async function reportGet(store: Store, ctx: Ctx, b: { id?: string }) { mgr(ctx); const r = await store.get("md_reports", String(b.id ?? "")); if (!r || r.tenantId !== ctx.tenantId || r.shopId !== ctx.shopId) throw new HttpError(404, "Rapport introuvable"); return fullOf(r); }
