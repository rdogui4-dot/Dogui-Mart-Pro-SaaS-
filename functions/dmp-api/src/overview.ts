import { DEFAULT_TIMEZONE, isTimezone } from "../../../src/domain/promotions";
import { methodLabel } from "../../../src/domain/costing";
import { addDays, boundsOf, monthStart, resolvePeriod, summarize, todayIn, type SaleIn } from "../../../src/domain/overview";
import { needFeature } from "./articles";
import { stockSnapshot } from "./stock-snapshot";
import { HttpError, roleOf, needModule, type Ctx, type Row, type Store } from "./store";

const parse = <T,>(s: unknown, fb: T): T => { try { const v = JSON.parse(String(s)); return v ?? fb; } catch { return fb; } };
const MAX_SALES = 20_000, MAX_MOVES = 100_000, DAY = 864e5, STUCK_MS = 10 * 60_000;
const at = (r: Row): string => String(r.$createdAt ?? r.createdOn ?? "");
const iso = (v: unknown): string => { const t = Date.parse(String(v)); return Number.isNaN(t) ? "" : new Date(t).toISOString(); };
const toSale = (r: Row): SaleIn & { shopId: string } => ({ id: r.$id, number: String(r.number ?? ""), total: Number(r.total), vat: Number(r.vat ?? 0), soldAt: iso(r.soldAt), status: String(r.status), payments: parse(r.payments, []), lines: parse(r.lines, []), shopId: String(r.shopId) });
const MOVE_LABEL: Record<string, string> = { sale: "Vente", purchase: "Réception d'achat", adjust: "Ajustement", loss: "Perte", transfer_in: "Transfert reçu", transfer_out: "Transfert envoyé", assembly_in: "Assemblage (entrée)", assembly_out: "Assemblage (sortie)" };

/** Tableau de bord de l'activité (Business) : indicateurs réels de la boutique choisie (ou de toutes vos boutiques), jours en heure de l'entreprise.
 *  Définitions : chiffre d'affaires = ventes « paid » (TTC) ; encaissé = paiements hors crédit (monnaie rendue exclue, fractionnés comptés une fois) ; crédit = vendu mais non encaissé ;
 *  marge = HT − coût de revient figé des lignes, seulement si TOUTES les lignes ont un coût ; achats = débits du compte 601 du journal. */
export async function businessDashboard(store: Store, ctx: Ctx, b: { preset?: string; from?: string; to?: string; shopId?: string } = {}) {
  needModule(ctx, "reports"); await needFeature(store, ctx, "businessDashboard");
  const now = new Date(); const all = await store.list("shops", { tenantId: ctx.tenantId }, 100); let allowed = all;
  if (roleOf(ctx.roles) !== "owner") { const staff = await store.get("staff", ctx.userId); const ids: string[] = staff && staff.tenantId === ctx.tenantId && staff.active !== false ? parse(staff.shopIds, []) : []; allowed = all.filter((s) => ids.includes(String(s.$id))); }
  const wantAll = b.shopId === "all"; const target = wantAll ? allowed : allowed.filter((s) => s.$id === String(b.shopId || ctx.shopId));
  if (!target.length) throw new HttpError(403, "Boutique non accessible");
  const home = all.find((s) => s.$id === ctx.shopId.slice(0, 36)) ?? target[0]!; const tz = home.promoTz && isTimezone(String(home.promoTz)) ? String(home.promoTz) : DEFAULT_TIMEZONE;
  const today = todayIn(now, tz); const mFrom = monthStart(today); const p = resolvePeriod(b.preset ?? "last30", today, { from: b.from, to: b.to }); if (!p.ok) throw new HttpError(400, p.error); const period = p.period;
  const winFrom = [period.from, mFrom, addDays(today, -6)].sort()[0]!; const winTo = [period.to, today].sort().at(-1)!; const win = boundsOf(winFrom, winTo, tz);
  const pb = boundsOf(period.from, period.to, tz); const since30 = new Date(now.getTime() - 30 * DAY).toISOString(); const since7 = new Date(now.getTime() - 7 * DAY).toISOString();
  const rows: (SaleIn & { shopId: string })[] = []; const catOf = new Map<string, string>(); const nameOf = new Map<string, string>();
  let refunds = 0, refundCount = 0, purchases = 0, truncSales = false, partialStock = false, stockValue: number | null = 0, articles = 0, noPrice: string[] = [];
  const out: { name: string; qty: number }[] = [], low: { name: string; qty: number; min: number }[] = []; const recentPurchases: Record<string, unknown>[] = [], recentMoves: Record<string, unknown>[] = [], created: Record<string, unknown>[] = [], important: Record<string, unknown>[] = [];
  const stuck: Row[] = []; const pending: Row[] = [];
  for (const shop of target) {
    const sid = String(shop.$id); const where = { tenantId: ctx.tenantId, shopId: sid };
    const retRows = await store.scan("sale_returns", where, { range: { field: "at", from: pb.gte, to: pb.lt }, maxRows: 20_000 }); for (const r of retRows.rows) if (r.status !== "failed") { refunds += Number(r.amount ?? 0); refundCount++; }
    const [sales, snap, journal, orders, moves, suppliers, pend, post] = await Promise.all([
      store.scan("sales", where, { range: { field: "soldAt", from: win.gte, to: win.lt }, maxRows: MAX_SALES }), stockSnapshot(store, where, MAX_MOVES),
      store.scan("journal_entries", { ...where, account: "601" }, { range: { field: "date", from: pb.gte, to: pb.lt }, maxRows: 20_000 }),
      store.scan("purchase_orders", where, { maxRows: 2_000 }), store.scan("stock_moves", where, { range: { field: "$createdAt", from: since30 }, maxRows: 20_000 }), store.scan("suppliers", where, { maxRows: 5_000 }),
      store.scan("sales", { ...where, status: "pending" }, { maxRows: 500 }), store.scan("sales", { ...where, status: "posted" }, { maxRows: 500 }),
    ]);
    truncSales ||= sales.truncated; rows.push(...sales.rows.map(toSale)); purchases += journal.rows.reduce((a, r) => a + Number(r.debit ?? 0), 0);
    for (const x of snap.products) { catOf.set(String(x.$id), String(x.category ?? "")); nameOf.set(String(x.$id), String(x.name)); }
    articles += snap.activeProducts; if (snap.partial) { partialStock = true; stockValue = null; } else if (stockValue !== null) stockValue += snap.value!;
    const sname = shop.name ? String(shop.name) : sid; const tag = target.length > 1 ? ` · ${sname}` : "";
    for (const it of snap.items) { if (it.qty <= 0) out.push({ name: it.name + tag, qty: it.qty }); else if (it.min > 0 && it.qty <= it.min) low.push({ name: it.name + tag, qty: it.qty, min: it.min }); }
    noPrice.push(...snap.products.filter((x) => !x.archived && !(Number(x.price) > 0)).map((x) => String(x.name) + tag));
    const supName = new Map(suppliers.rows.map((x) => [String(x.$id), String(x.name)]));
    for (const o of orders.rows) { if (o.status === "ordered" || o.status === "partial") pending.push(o); recentPurchases.push({ id: o.$id, number: String(o.number), supplier: supName.get(String(o.supplierId)) ?? "", total: Number(o.total ?? 0), status: String(o.status), at: at(o), shop: sname }); }
    for (const s of [...pend.rows, ...post.rows]) if (now.getTime() - Date.parse(String(s.soldAt)) > STUCK_MS) stuck.push(s);
    for (const m of moves.rows) { const nm = nameOf.get(String(m.productId)) ?? "Article"; const e = { id: m.$id, productId: String(m.productId), name: nm, kind: String(m.kind), label: MOVE_LABEL[String(m.kind)] ?? String(m.kind), qty: Number(m.qty), at: at(m), shop: sname };
      if (Date.parse(e.at) >= Date.parse(since7)) recentMoves.push(e);
      if (m.kind === "loss" || m.kind === "transfer_out" || m.kind === "transfer_in" || (m.kind === "adjust" && String(m.refId ?? "").startsWith("inventaire"))) important.push({ ...e, label: m.kind === "adjust" ? "Inventaire : écart constaté" : e.label });
    }
    for (const x of snap.products.filter((x) => Date.parse(at(x)) >= Date.parse(since30))) created.push({ id: x.$id, name: String(x.name), price: Number(x.price ?? 0), at: at(x), shop: sname });
  }
  const per = summarize(rows, period, tz, (id) => catOf.get(id) ?? "");
  const day = summarize(rows, { from: today, to: today }, tz); const month = summarize(rows, { from: mFrom, to: today }, tz); const wk = summarize(rows, { from: addDays(today, -6), to: today }, tz);
  const recentSales = rows.filter((s) => s.status === "paid").sort((a, c) => c.soldAt.localeCompare(a.soldAt)).slice(0, 10).map((s) => ({ id: s.id, number: s.number, total: s.total, at: s.soldAt, shop: all.find((x) => x.$id === s.shopId)?.name ? String(all.find((x) => x.$id === s.shopId)!.name) : s.shopId, methods: [...new Set(s.payments.map((x) => x.method))], lines: s.lines.slice(0, 20).map((l) => ({ name: l.name, qty: l.qty, amount: l.amount ?? Math.round(l.unitPrice * l.qty) })) }));
  const byShop = target.length > 1 ? target.map((s) => { const r = summarize(rows.filter((x) => x.shopId === s.$id), period, tz); return { id: String(s.$id), name: String(s.name ?? s.$id), revenue: r.revenue, count: r.count }; }) : [];
  const top = <T,>(list: T[], key: (x: T) => number, n = 10) => [...list].sort((a, c) => key(c) - key(a)).slice(0, n);
  const alerts: { id: string; type: string; severity: "critical" | "warning" | "info"; label: string; detail: string; count: number; link: string }[] = [];
  const names = (l: { name: string }[]) => l.slice(0, 5).map((x) => x.name).join(", ") + (l.length > 5 ? ` et ${l.length - 5} autre(s)` : "");
  if (out.length) alerts.push({ id: "out", type: "out", severity: "critical", label: `${out.length} article(s) en rupture`, detail: names(out), count: out.length, link: "/stock" });
  if (low.length) alerts.push({ id: "low", type: "low", severity: "warning", label: `${low.length} article(s) sous le seuil de stock`, detail: names(low), count: low.length, link: "/stock" });
  if (stuck.length) alerts.push({ id: "stuck", type: "stuck", severity: "warning", label: `${stuck.length} vente(s) non finalisée(s)`, detail: `Ventes commencées mais jamais encaissées (${stuck.slice(0, 3).map((s) => s.number).join(", ")}) : exclues du chiffre d'affaires.`, count: stuck.length, link: "/pos" });
  if (noPrice.length) alerts.push({ id: "noprice", type: "noprice", severity: "warning", label: `${noPrice.length} article(s) sans prix de vente`, detail: names(noPrice.map((name) => ({ name }))), count: noPrice.length, link: "/articles" });
  if (pending.length) alerts.push({ id: "po", type: "po", severity: "info", label: `${pending.length} achat(s) en attente de réception`, detail: pending.slice(0, 4).map((o) => String(o.number)).join(", "), count: pending.length, link: "/achats" });
  const costMethod = String(home.costMethod ?? "cmup");
  return {
    tz, asOf: now.toISOString(), today, scope: { shopId: wantAll ? "all" : String(target[0]!.$id), shops: allowed.map((s) => ({ id: String(s.$id), name: String(s.name ?? s.$id) })), many: allowed.length > 1 }, period,
    kpis: {
      today: { from: today, to: today, revenue: day.revenue, count: day.count }, month: { from: mFrom, to: today, revenue: month.revenue, count: month.count },
      period: { count: per.count, revenue: per.revenue, avgBasket: per.avgBasket, encaisse: per.encaisse, credit: per.credit, vat: per.vat, purchases, margin: per.margin, refunds: { amount: refunds, count: refundCount } },
      stock: { articles, value: stockValue, method: costMethod, methodLabel: methodLabel(costMethod), partial: partialStock, low: partialStock ? null : low.length, out: partialStock ? null : out.length },
    },
    charts: { last7: wk.daily, series: per.daily, byMethod: Object.entries(per.byMethod).map(([method, amount]) => ({ method, amount })).sort((a, c) => c.amount - a.amount), top: per.top, byCategory: per.byCategory, byShop },
    activity: { sales: recentSales, purchases: top(recentPurchases, (x) => Date.parse(String(x.at)) || 0, 5), moves: top(recentMoves, (x) => Date.parse(String(x.at)) || 0, 10), created: top(created, (x) => Date.parse(String(x.at)) || 0, 5), important: top(important, (x) => Date.parse(String(x.at)) || 0, 10) },
    alerts, truncated: { sales: truncSales },
    notes: ["Chiffre d'affaires = ventes terminées (TTC) ; une vente non finalisée n'est jamais comptée.", "Encaissé = paiements reçus hors crédit ; « à crédit » = vendu mais pas encore payé ; la monnaie rendue n'est pas un encaissement.", "Annulation complète : la vente est exclue du chiffre d'affaires. Remboursement partiel : la vente reste comptée et le montant remboursé (opérations tracées) est affiché séparément ; il se déduit du CA net.", "Les dépenses hors achats ne sont pas saisies dans l'application : seuls les achats enregistrés (compte 601, HT) sont affichés.", "La marge n'est calculée que si toutes les lignes vendues ont un coût de revient connu.", "Les écarts d'inventaire sont appliqués immédiatement au stock (aucun écart « en attente ») : ils figurent dans les opérations importantes."],
  };
}
