import { DEFAULT_TIMEZONE, isTimezone } from "../../../src/domain/promotions";
import { addDays, boundsOf, daysIn, monthStart, resolvePeriod, todayIn, type Period } from "../../../src/domain/overview";
import * as A from "../../../src/domain/analytics";
import { fromScaled, scaleOf } from "../../../src/domain/quantity";
import { methodLabel } from "../../../src/domain/costing";
import { needFeature } from "./articles";
import { stockSnapshot } from "./stock-snapshot";
import { HttpError, roleOf, needModule, type Ctx, type Row, type Store } from "./store";

const parse = <T,>(s: unknown, fb: T): T => { try { const v = JSON.parse(String(s)); return v ?? fb; } catch { return fb; } };
const MAX_SALES = 20_000, MAX_MOVES = 100_000, MAX_DAYS = 400, DAY = 864e5;
const iso = (v: unknown): string => { const t = Date.parse(String(v)); return Number.isNaN(t) ? "" : new Date(t).toISOString(); };
const created = (r: Row): number => Date.parse(String(r.$createdAt ?? r.createdOn ?? "")) || 0;
const arr = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.map(String))].slice(0, 200) : []);
const r1 = (n: number) => Math.round(n * 10) / 10;
export const SPACES = ["exec", "sales", "profit", "stock", "purchases", "stores", "forecast"] as const;
export type Space = (typeof SPACES)[number];
const PRESET_PRO = ["year", "lastYear", "last90", "last365"] as const;

export type Params = { space?: string; preset?: string; from?: string; to?: string; compare?: string; gran?: string; shopId?: string; filters?: Partial<Record<keyof A.Filters, unknown>>; saleState?: string; thresholds?: { slowDays?: unknown; fastDays?: unknown; overDays?: unknown; coverTarget?: unknown } };
const clampInt = (v: unknown, d: number, lo: number, hi: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const shiftYear = (day: string): string => { const [y, m, d] = day.split("-").map(Number); const dim = new Date(Date.UTC(y! - 1, m!, 0)).getUTCDate(); return `${y! - 1}-${String(m).padStart(2, "0")}-${String(Math.min(d!, dim)).padStart(2, "0")}`; };

/** Le monde chargé pour une requête : boutiques autorisées, période(s), ventes terminées (période, précédente, an dernier), produits, mouvements. Lecture seule, bornée, isolée par commerce et boutique. */
async function world(store: Store, ctx: Ctx, b: Params, needMoves: boolean) {
  needModule(ctx, "reports"); await needFeature(store, ctx, "proDashboard");
  const now = new Date(); const all = await store.list("shops", { tenantId: ctx.tenantId }, 100); let allowed = all;
  if (roleOf(ctx.roles) !== "owner") { const staff = await store.get("staff", ctx.userId); const ids: string[] = staff && staff.tenantId === ctx.tenantId && staff.active !== false ? parse(staff.shopIds, []) : []; allowed = all.filter((s) => ids.includes(String(s.$id))); }
  const filters: A.Filters = { categories: arr(b.filters?.categories), articles: arr(b.filters?.articles), suppliers: arr(b.filters?.suppliers), sellers: arr(b.filters?.sellers), shops: arr(b.filters?.shops), methods: arr(b.filters?.methods) };
  let target = b.shopId === "all" ? allowed : allowed.filter((s) => s.$id === String(b.shopId || ctx.shopId)); if (filters.shops.length) target = target.filter((s) => filters.shops.includes(String(s.$id)));
  if (!target.length) throw new HttpError(403, "Boutique non accessible");
  const home = all.find((s) => s.$id === ctx.shopId.slice(0, 36)) ?? target[0]!; const tz = home.promoTz && isTimezone(String(home.promoTz)) ? String(home.promoTz) : DEFAULT_TIMEZONE; const today = todayIn(now, tz);
  let preset = String(b.preset ?? "last30"); let pr: ReturnType<typeof resolvePeriod>;
  if ((PRESET_PRO as readonly string[]).includes(preset)) { const y = today.slice(0, 4); const [from, to] = preset === "year" ? [`${y}-01-01`, today] : preset === "lastYear" ? [`${Number(y) - 1}-01-01`, `${Number(y) - 1}-12-31`] : preset === "last90" ? [addDays(today, -89), today] : [addDays(today, -364), today]; pr = resolvePeriod("custom", today, { from, to }, MAX_DAYS); if (pr.ok) pr.period.preset = preset as never; if (pr.ok) pr.period.label = { year: "Cette année", lastYear: "Année précédente", last90: "90 derniers jours", last365: "365 derniers jours" }[preset as "year"]; }
  else { pr = resolvePeriod(preset, today, { from: b.from, to: b.to }, MAX_DAYS); }
  if (!pr.ok) throw new HttpError(400, pr.error); const period: Period = pr.period; const len = period.days;
  const compare = b.compare === "yoy" ? "yoy" : b.compare === "prev" ? "prev" : "none";
  const prev: Period | null = compare === "prev" ? { preset: "custom", label: "Période précédente", from: addDays(period.from, -len), to: addDays(period.from, -1), days: len } : compare === "yoy" ? { preset: "custom", label: "Même période l'an dernier", from: shiftYear(period.from), to: shiftYear(period.to), days: daysIn(shiftYear(period.from), shiftYear(period.to)).length } : null;
  const gran: A.Gran = (["day", "week", "month", "year"] as const).includes(b.gran as never) ? (b.gran as A.Gran) : len > 400 ? "month" : len > 120 ? "week" : "day";
  const th = { slowDays: clampInt(b.thresholds?.slowDays, 90, 7, 3650), fastDays: clampInt(b.thresholds?.fastDays, 15, 1, 365), overDays: clampInt(b.thresholds?.overDays, 180, 14, 3650), coverTarget: clampInt(b.thresholds?.coverTarget, 30, 1, 365) };
  const bnd = boundsOf(period.from, period.to, tz); const pb = prev ? boundsOf(prev.from, prev.to, tz) : null; const state = b.saleState === "open" ? "open" : "paid";
  const staff = (await store.scan("staff", { tenantId: ctx.tenantId }, { maxRows: 500 })).rows; const names = new Map<string, string>(staff.map((x) => [String(x.userId), String(x.name)]));
  try { for (const o of await store.listOwners(ctx.tenantId)) names.set(o.userId, o.name || "Propriétaire"); } catch { /* annuaire indisponible : identifiants affichés */ }
  const sellerName = (id: string) => names.get(id) ?? (id ? `Vendeur ${id.slice(0, 6)}` : "Vendeur non renseigné");
  const sales: A.RawSale[] = [], prevSales: A.RawSale[] = []; const products = new Map<string, Row>(); const perShop: { shop: Row; snap: Awaited<ReturnType<typeof stockSnapshot>>; moves: Row[]; lots: Row[]; orders: Row[]; movesTrunc: boolean }[] = []; let truncated = false; const rowsRead = { sales: 0, moves: 0 };
  const toSale = (r: Row): A.RawSale => ({ id: r.$id, number: String(r.number ?? ""), shopId: String(r.shopId), cashierId: String(r.cashierId ?? ""), soldAt: iso(r.soldAt), status: String(r.status), total: Number(r.total), vat: Number(r.vat ?? 0), customerId: r.customerId ? String(r.customerId) : undefined, payments: parse(r.payments, []), lines: parse(r.lines, []) });
  const suppliers = new Map<string, string>();
  for (const shop of target) {
    const sid = String(shop.$id); const where = { tenantId: ctx.tenantId, shopId: sid };
    const open = state === "open";
    const [cur, pv, snap, mv, lots, orders, sup] = await Promise.all([
      open ? store.scan("sales", { ...where, status: "pending" }, { range: { field: "soldAt", from: bnd.gte, to: bnd.lt }, maxRows: MAX_SALES }) : store.scan("sales", where, { range: { field: "soldAt", from: bnd.gte, to: bnd.lt }, maxRows: MAX_SALES }),
      pb && !open ? store.scan("sales", where, { range: { field: "soldAt", from: pb.gte, to: pb.lt }, maxRows: MAX_SALES }) : Promise.resolve({ rows: [] as Row[], truncated: false }),
      needMoves ? stockSnapshot(store, where, MAX_MOVES) : Promise.resolve({ partial: false, value: 0, stockouts: 0, items: [], products: (async () => [])() as never, activeProducts: 0 } as never),
      needMoves ? store.scan("stock_moves", where, { maxRows: MAX_MOVES }) : Promise.resolve({ rows: [] as Row[], truncated: false }),
      needMoves ? store.scan("article_lots", where, { maxRows: 20_000 }) : Promise.resolve({ rows: [] as Row[], truncated: false }),
      store.scan("purchase_orders", where, { maxRows: 5_000 }), store.scan("suppliers", where, { maxRows: 5_000 }),
    ]);
    const prodRows = needMoves ? (snap as Awaited<ReturnType<typeof stockSnapshot>>).products : (await store.scan("products", where, { maxRows: 5_000 })).rows;
    for (const p of prodRows) products.set(String(p.$id), p); for (const x of sup.rows) suppliers.set(String(x.$id), String(x.name));
    truncated ||= cur.truncated || pv.truncated || mv.truncated; rowsRead.sales += cur.rows.length + pv.rows.length; rowsRead.moves += mv.rows.length;
    let curRows = cur.rows; if (open) curRows = [...cur.rows, ...(await store.scan("sales", { ...where, status: "posted" }, { range: { field: "soldAt", from: bnd.gte, to: bnd.lt }, maxRows: MAX_SALES })).rows];
    sales.push(...curRows.map(toSale)); prevSales.push(...pv.rows.map(toSale));
    perShop.push({ shop, snap: snap as never, moves: mv.rows, lots: lots.rows, orders: orders.rows, movesTrunc: mv.truncated || (snap as { partial?: boolean }).partial === true });
  }
  const cat = (id: string) => String(products.get(id)?.category ?? ""); const sup = (id: string) => String(products.get(id)?.supplierId ?? "");
  const c: A.Ctx = { tz, categoryOf: cat, supplierOf: sup };
  const factsAll = A.buildFacts(sales, c, state); const prevAll = A.buildFacts(prevSales, c, "paid");
  const inP = (f: A.Fact) => f.day >= period.from && f.day <= period.to; const facts = A.applyFilters(factsAll.filter(inP), filters); const prevFacts = prev ? A.applyFilters(prevAll.filter((f) => f.day >= prev.from && f.day <= prev.to), filters) : [];
  const shopName = (id: string) => String(all.find((s) => s.$id === id)?.name ?? id);
  const refunds = { amount: 0, count: 0 };
  { const rb = boundsOf(period.from, period.to, tz); for (const shop of target) for (const r of (await store.scan("sale_returns", { tenantId: ctx.tenantId, shopId: String(shop.$id) }, { range: { field: "at", from: rb.gte, to: rb.lt }, maxRows: 20_000 })).rows) if (r.status !== "failed") { refunds.amount += Number(r.amount ?? 0); refunds.count++; } }
  return { refunds, ctx, now, tz, today, all, allowed, target, home, period, prev, compare, gran, th, filters, state, facts, prevFacts, factsAll, products, perShop, suppliers, sellerName, shopName, truncated, rowsRead, hasLineFilter: !!(filters.categories.length || filters.articles.length || filters.suppliers.length), sales };
}
type World = Awaited<ReturnType<typeof world>>;

const head = (w: World, space: string) => ({
  space, generatedAt: w.now.toISOString(), tz: w.tz, period: w.period, compare: w.compare, prevPeriod: w.prev, gran: w.gran, saleState: w.state, filters: w.filters, thresholds: w.th,
  scope: { shopId: w.target.length === w.allowed.length && w.allowed.length > 1 ? "all" : String(w.target[0]!.$id), shops: w.allowed.map((s) => ({ id: String(s.$id), name: String(s.name ?? s.$id) })), selected: w.target.map((s) => String(s.$id)) },
  truncated: w.truncated, rowsRead: w.rowsRead,
});
const cmp = (cur: A.Totals, ref: A.Totals | null) => (ref ? { revenue: A.delta(cur.revenue, ref.revenue), count: A.delta(cur.count, ref.count), basket: A.delta(cur.basket, ref.basket), margin: A.delta(cur.margin, ref.margin), marginRate: cur.marginRate !== null && ref.marginRate !== null ? r1(cur.marginRate - ref.marginRate) : null, available: ref.count > 0 } : null);

// ------------------------------------------------------------------ stocks (partagé entre exécutif, stocks, achats, magasins, prévisions)
type Prod = { productId: string; name: string; category: string; shopId: string; qty: number; value: number; unitCost: number | null; sold: number; opening: number; closing: number; rotation: number | null; coverage: number | null; cls: A.StockClass; lastSale: string; episodes: number; daysOut: number; lines: number };
function stockAnalysis(w: World) {
  const from = Date.parse(boundsOf(w.period.from, w.period.to, w.tz).gte), to = Date.parse(boundsOf(w.period.from, w.period.to, w.tz).lt); const days = w.period.days;
  const soldBy = new Map<string, number>(), lastSale = new Map<string, string>();
  for (const f of w.factsAll) for (const l of f.lines) { if (f.day >= w.period.from && f.day <= w.period.to) soldBy.set(`${f.shopId}|${l.productId}`, (soldBy.get(`${f.shopId}|${l.productId}`) ?? 0) + l.qty); const k = `${f.shopId}|${l.productId}`; if (f.soldAt > (lastSale.get(k) ?? "")) lastSale.set(k, f.soldAt); }
  const out: Prod[] = []; const partialShops: string[] = []; let valueTotal: number | null = 0;
  for (const ps of w.perShop) {
    const sid = String(ps.shop.$id); if (ps.movesTrunc) { partialShops.push(sid); valueTotal = null; continue; }
    valueTotal = (valueTotal ?? 0) + (ps.snap.value ?? 0);
    const items = new Map<string, { qty: number; value: number }>(); for (const it of ps.snap.items) { const a = items.get(it.productId) ?? { qty: 0, value: 0 }; a.qty += it.qty; a.value += it.value; items.set(it.productId, a); }
    const mv = new Map<string, { at: number; delta: number }[]>(); for (const m of ps.moves) { const p = w.products.get(String(m.productId)); const sc = scaleOf(p); const q = Number(m.qty); const kind = String(m.kind); const sign = kind === "adjust" ? 1 : ["sale", "loss", "transfer_out", "assembly_out"].includes(kind) ? -1 : 1; const d = fromScaled(kind === "adjust" ? q : sign * Math.abs(q), sc); (mv.get(String(m.productId)) ?? mv.set(String(m.productId), []).get(String(m.productId))!).push({ at: created(m), delta: d }); }
    for (const [pid, it] of items) {
      const p = w.products.get(pid); if (!p) continue; if (w.filters.categories.length && !w.filters.categories.includes(String(p.category ?? "") || "Sans catégorie")) continue; if (w.filters.articles.length && !w.filters.articles.includes(pid)) continue; if (w.filters.suppliers.length && !w.filters.suppliers.includes(String(p.supplierId ?? ""))) continue;
      const m = mv.get(pid) ?? []; const sinceFrom = m.filter((x) => x.at >= from).reduce((a, x) => a + x.delta, 0), sinceTo = m.filter((x) => x.at >= to).reduce((a, x) => a + x.delta, 0);
      const opening = it.qty - sinceFrom, closing = it.qty - sinceTo; const sold = soldBy.get(`${sid}|${pid}`) ?? 0; const so = A.stockoutStats(m, opening, from, Math.min(to, w.now.getTime()));
      out.push({ productId: pid, name: String(p.name), category: String(p.category ?? "") || "Sans catégorie", shopId: sid, qty: it.qty, value: Math.round(it.value), unitCost: it.qty > 0 && it.value > 0 ? it.value / it.qty : Number(p.cost) > 0 ? Number(p.cost) : null, sold, opening, closing, rotation: A.rotation(sold, opening, closing), coverage: A.coverageDays(it.qty, sold, days), cls: A.classifyStock(it.qty, sold, days, w.th), lastSale: lastSale.get(`${sid}|${pid}`) ?? "", episodes: so.episodes, daysOut: so.daysOut, lines: 0 });
    }
  }
  return { rows: out, valueTotal, partialShops, days };
}
const stockValueRotation = (w: World, st: ReturnType<typeof stockAnalysis>, cogs: number | null) => {
  if (st.valueTotal === null) return { value: null as number | null, rotation: null as number | null, avgValue: null as number | null };
  const avg = st.rows.reduce((a, r) => a + ((Math.max(0, r.opening) + Math.max(0, r.closing)) / 2) * (r.unitCost ?? 0), 0);
  return { value: st.valueTotal, avgValue: Math.round(avg), rotation: cogs !== null && avg > 0 ? r1(cogs / avg) : null };
};

// ------------------------------------------------------------------ espace 1 : vue exécutive
function exec(w: World) {
  const t = A.totalsOf(w.facts); const pt = w.compare !== "none" ? A.totalsOf(w.prevFacts) : null; const st = stockAnalysis(w); const svr = stockValueRotation(w, st, t.cogs);
  return { ...head(w, "exec"), totals: t, refunds: w.refunds, previous: pt, comparison: cmp(t, pt), comparisonNote: w.compare === "none" ? null : pt && pt.count > 0 ? "Comparaison descriptive : elle n'établit pas de lien de cause." : "Aucune vente sur la période de comparaison : pas de comparaison.",
    series: A.series(w.facts, w.period, w.gran), previousSeries: w.prev ? A.series(w.prevFacts, { from: w.prev.from, to: w.prev.to }, w.gran) : null, stock: { ...svr, partialShops: st.partialShops, methodLabel: methodLabel(String(w.home.costMethod ?? "cmup")) },
    unavailable: [
      { id: "expenses", label: "Dépenses d'exploitation", reason: "Les dépenses hors achats de marchandises ne sont pas saisies dans l'application." },
      { id: "operating", label: "Résultat opérationnel estimé", reason: "Non calculable : il exige les charges d'exploitation (loyer, salaires, transport…) qui ne sont pas enregistrées. La marge brute n'est pas un bénéfice." },
    ],
    highlights: { out: st.rows.filter((r) => r.cls === "out").length, dormant: st.rows.filter((r) => r.cls === "dormant").length, overstock: st.rows.filter((r) => r.cls === "overstock").length, lowMarginLines: t.cost.linesWithoutCost },
    definitions: DEFS,
  };
}
const DEFS = {
  revenue: ["comptable", "Somme des ventes terminées (TTC). Une vente non finalisée n'est jamais comptée."], encaisse: ["comptable", "Paiements reçus hors crédit, plafonnés au total de la vente (monnaie rendue exclue ; fractionnés comptés une fois)."], credit: ["comptable", "Part des ventes réglée à crédit, non encaissée."],
  cogs: ["comptable", "Coût des marchandises vendues = quantités × coût de revient FIGÉ au moment de la vente. Absent si une ligne n'a pas de coût."], margin: ["comptable", "Marge brute = CA HT − coût des marchandises vendues. Ce n'est PAS un bénéfice net (charges non déduites)."],
  marginRate: ["comptable", "Taux de marge = marge brute ÷ CA HT."], markup: ["comptable", "Taux de marque = marge brute ÷ coût des marchandises vendues."], purchases: ["comptable", "Achats enregistrés = débits du compte 601 du journal (HT)."], stockValue: ["comptable", "Quantité en stock × coût de revient de la fiche (méthode de valorisation configurée) ; lots à leur coût."],
  count: ["commercial", "Nombre de ventes terminées."], basket: ["commercial", "CA TTC ÷ nombre de ventes."], rotation: ["estimatif", "Rotation = coût des marchandises vendues ÷ valeur moyenne du stock ((ouverture + clôture) ÷ 2, quantités reconstituées depuis les mouvements, valorisées au coût actuel)."],
} as const;

// ------------------------------------------------------------------ espace 2 : performance commerciale
function sales(w: World) {
  const t = A.totalsOf(w.facts); const pt = w.compare !== "none" ? A.totalsOf(w.prevFacts) : null; const arts = A.byArticle(w.facts); const sold = arts.filter((a) => a.qty > 0);
  const hours = A.byHour(w.facts); const peak = hours.reduce((a, h) => (h.revenue > a.revenue ? h : a), hours[0]!);
  return { ...head(w, "sales"), totals: t, previous: pt, comparison: cmp(t, pt), series: A.series(w.facts, w.period, w.gran), previousSeries: w.prev ? A.series(w.prevFacts.map((f) => f), { from: w.prev.from, to: w.prev.to }, w.gran) : null,
    comparisonNote: w.compare === "yoy" && pt && pt.count === 0 ? "Aucune donnée l'an dernier sur cette période : comparaison indisponible." : null,
    byArticle: arts.slice(0, 50), best: sold.slice(0, 10), worst: [...sold].sort((a, b) => a.revenue - b.revenue).slice(0, 10), byCategory: A.byCategory(w.facts), bySeller: A.bySeller(w.facts, w.sellerName), byShop: A.byShop(w.facts, w.shopName), byMethod: A.byMethod(w.facts),
    byHour: hours, peakHour: t.count ? { hour: peak.hour, revenue: peak.revenue } : null, basket: A.basketStats(w.facts), perfNote: "Les moins performants sont les articles VENDUS sur la période ; les articles sans aucune vente sont dans l'espace Stocks (dormants).",
    definitions: DEFS };
}

// ------------------------------------------------------------------ espace 3 : rentabilité
function profit(w: World, minMarginPct: number) {
  const t = A.totalsOf(w.facts); const arts = A.byArticle(w.facts); const cats = A.byCategory(w.facts); const shops = A.byShop(w.facts, w.shopName);
  const lowLines: { saleNumber: string; day: string; name: string; qty: number; revenueHt: number; cost: number; marginPct: number; shop: string }[] = []; const lossLines: typeof lowLines = [];
  for (const f of w.facts) for (const l of f.lines) { if (l.cost === null || l.cost <= 0) continue; const mp = (l.revenueHt - l.cost) / l.cost * 100; const row = { saleNumber: f.number, day: f.day, name: l.name, qty: l.qty, revenueHt: l.revenueHt, cost: l.cost, marginPct: r1(mp), shop: w.shopName(f.shopId) };
    if (l.revenueHt < l.cost) lossLines.push(row); else if (mp < minMarginPct) lowLines.push(row); }
  const lowByArt = new Map<string, number>(); for (const l of [...lowLines, ...lossLines]) lowByArt.set(l.name, (lowByArt.get(l.name) ?? 0) + 1);
  const totalHt = t.revenueHt || 0, totalMargin = t.margin ?? t.cost.indicativeMargin;
  const contribution = cats.map((c) => ({ key: c.key, revenueSharePct: totalHt > 0 ? r1(c.revenueHt / totalHt * 100) : null, marginSharePct: c.margin !== null && totalMargin !== 0 && t.margin !== null ? r1(c.margin / totalMargin * 100) : null }));
  // évolution des coûts d'achat et des prix de vente (moyennes hebdomadaires pondérées par les quantités, sur les articles les plus vendus)
  const top = arts.slice(0, 5).map((a) => a.key); const wk = new Map<string, Map<string, { q: number; price: number; cost: number; qc: number }>>();
  for (const f of w.facts) for (const l of f.lines) { if (!top.includes(l.productId)) continue; const k = A.weekStart(f.day); const m = wk.get(l.productId) ?? new Map(); const a = m.get(k) ?? { q: 0, price: 0, cost: 0, qc: 0 }; a.q += l.qty; a.price += l.unitPrice * l.qty; if (l.unitCost !== null) { a.cost += l.unitCost * l.qty; a.qc += l.qty; } m.set(k, a); wk.set(l.productId, m); }
  const evolution = top.map((id) => ({ productId: id, name: arts.find((a) => a.key === id)!.name, weeks: [...(wk.get(id) ?? new Map())].sort((a, b) => a[0].localeCompare(b[0])).map(([week, a]) => ({ week, avgPrice: a.q ? Math.round(a.price / a.q) : null, avgCost: a.qc ? Math.round(a.cost / a.qc) : null })) }));
  return { ...head(w, "profit"), totals: t, margin: { amount: t.margin, rate: t.marginRate, markup: t.markup, cost: t.cost, note: t.margin === null ? (t.count ? `Marge non calculable : ${t.cost.linesWithoutCost} ligne(s) sans coût de revient (${t.cost.coveragePct} % du CA couvert). Marge sur les seules lignes avec coût : ${t.cost.indicativeMargin} FCFA (indicative).` : "Aucune vente sur la période.") : "Marge brute sur coûts historiques figés : ce n'est pas un bénéfice net." },
    byArticle: arts.slice(0, 100), byCategory: cats, byShop: shops, contribution, lowMargin: { thresholdPct: minMarginPct, thresholdSource: "Marge minimale de la boutique (Réglages) ou 10 % si non définie", count: lowLines.length, lines: lowLines.slice(0, 50), topArticles: [...lowByArt].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, n]) => ({ name, lines: n })) },
    loss: { count: lossLines.length, amount: lossLines.reduce((a, l) => a + (l.cost - l.revenueHt), 0), lines: lossLines.slice(0, 50) }, evolution, missingCost: { articles: arts.filter((a) => a.linesWithoutCost > 0).slice(0, 50).map((a) => ({ key: a.key, name: a.name, lines: a.linesWithoutCost, coveragePct: a.coveragePct })) },
    method: "Coût = coût de revient FIGÉ dans chaque ligne au moment de la vente (historique réel). Une marge n'est affichée que si toutes les lignes concernées ont un coût.", definitions: DEFS };
}

// ------------------------------------------------------------------ espace 4 : stocks
function stocks(w: World) {
  const st = stockAnalysis(w); const rows = st.rows; const t = A.totalsOf(w.facts); const svr = stockValueRotation(w, st, t.cogs); const top = (cls: A.StockClass, key: (r: Prod) => number, n = 30) => rows.filter((r) => r.cls === cls).sort((a, b) => key(b) - key(a)).slice(0, n);
  const byShop = w.perShop.filter((p) => !p.movesTrunc).map((p) => { const sid = String(p.shop.$id); const rs = rows.filter((r) => r.shopId === sid); const shopFacts = w.facts.filter((f) => f.shopId === sid); const cg = A.totalsOf(shopFacts).cogs; const avg = rs.reduce((a, r) => a + ((Math.max(0, r.opening) + Math.max(0, r.closing)) / 2) * (r.unitCost ?? 0), 0);
    return { shopId: sid, name: String(p.shop.name ?? sid), value: Math.round(p.snap.value ?? 0), articles: rs.length, rotation: cg !== null && avg > 0 ? r1(cg / avg) : null, out: rs.filter((r) => r.cls === "out").length }; });
  const now = w.now.getTime(); const exp: { expired: boolean; productId: string; name: string; lotNo: string; expiresAt: string; qty: number; value: number; daysLeft: number; shop: string }[] = [];
  for (const ps of w.perShop) { if (ps.movesTrunc) continue; const byLot = new Map<string, number>(); for (const m of ps.moves) if (m.lotId) { const p = w.products.get(String(m.productId)); const kind = String(m.kind); const sign = kind === "adjust" ? 1 : ["sale", "loss", "transfer_out", "assembly_out"].includes(kind) ? -1 : 1; byLot.set(String(m.lotId), (byLot.get(String(m.lotId)) ?? 0) + fromScaled(kind === "adjust" ? Number(m.qty) : sign * Math.abs(Number(m.qty)), scaleOf(p))); }
    for (const l of ps.lots) { if (!l.expiresAt) continue; const qty = byLot.get(String(l.$id)) ?? 0; if (qty <= 0) continue; const p = w.products.get(String(l.productId)); if (w.filters.categories.length && !w.filters.categories.includes(String(p?.category ?? "") || "Sans catégorie")) continue; if (w.filters.articles.length && !w.filters.articles.includes(String(l.productId))) continue;
      const days = Math.ceil((Date.parse(String(l.expiresAt)) - now) / DAY); const isExp = Date.parse(String(l.expiresAt)) < now; exp.push({ expired: isExp, productId: String(l.productId), name: String(p?.name ?? "Article"), lotNo: String(l.lotNo), expiresAt: iso(l.expiresAt), qty, value: Math.round(qty * (Number(l.unitCost) > 0 ? Number(l.unitCost) : Number(p?.cost ?? 0))), daysLeft: days, shop: String(ps.shop.name ?? ps.shop.$id) }); } }
  const from = boundsOf(w.period.from, w.period.to, w.tz); const gaps: { name: string; kind: string; qty: number; value: number; at: string; shop: string }[] = [];
  for (const ps of w.perShop) for (const m of ps.moves) { const at = created(m); if (at < Date.parse(from.gte) || at >= Date.parse(from.lt)) continue; const kind = String(m.kind); const isInv = kind === "adjust" && String(m.refId ?? "").startsWith("inventaire"); const isLoss = kind === "loss"; const isOther = kind === "adjust" && !String(m.refId ?? "").startsWith("inventaire") && m.refId !== "stock-initial"; if (!isInv && !isLoss && !isOther) continue;
    const p = w.products.get(String(m.productId)); if (w.filters.articles.length && !w.filters.articles.includes(String(m.productId))) continue; const qty = fromScaled(kind === "adjust" ? Number(m.qty) : -Math.abs(Number(m.qty)), scaleOf(p)); const cost = Number(p?.cost ?? 0); gaps.push({ name: String(p?.name ?? "Article"), kind: isInv ? "inventaire" : isLoss ? "perte" : "ajustement", qty, value: cost > 0 ? Math.round(qty * cost) : 0, at: iso(m.$createdAt), shop: String(ps.shop.name ?? ps.shop.$id) }); }
  const sum = (k: string) => gaps.filter((g) => g.kind === k);
  const filteredByState = (r: Prod[]) => r;
  return { ...head(w, "stock"), valueTotal: svr.value, avgValue: svr.avgValue, rotationGlobal: svr.rotation, partialShops: st.partialShops, methodLabel: methodLabel(String(w.home.costMethod ?? "cmup")), byShop,
    counts: { products: rows.length, out: rows.filter((r) => r.cls === "out").length, dormant: rows.filter((r) => r.cls === "dormant").length, slow: rows.filter((r) => r.cls === "slow").length, fast: rows.filter((r) => r.cls === "fast").length, overstock: rows.filter((r) => r.cls === "overstock").length },
    lists: { slow: top("slow", (r) => r.coverage ?? 0), fast: top("fast", (r) => r.rotation ?? 0), dormant: top("dormant", (r) => r.value), overstock: top("overstock", (r) => r.coverage ?? 0), out: top("out", (r) => r.sold) }, frequentStockouts: rows.filter((r) => r.episodes >= 2).sort((a, b) => b.episodes - a.episodes || b.daysOut - a.daysOut).slice(0, 30),
    expiry: { expired: exp.filter((e) => e.expired).sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 50), soon: exp.filter((e) => !e.expired && e.daysLeft <= 30).sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 50), expiredValue: exp.filter((e) => e.expired).reduce((a, e) => a + e.value, 0), soonValue: exp.filter((e) => !e.expired && e.daysLeft <= 30).reduce((a, e) => a + e.value, 0) },
    gaps: { inventory: { count: sum("inventaire").length, net: sum("inventaire").reduce((a, g) => a + g.qty, 0), value: sum("inventaire").reduce((a, g) => a + g.value, 0) }, loss: { count: sum("perte").length, value: sum("perte").reduce((a, g) => a + g.value, 0) }, other: { count: sum("ajustement").length, value: sum("ajustement").reduce((a, g) => a + g.value, 0) }, entries: gaps.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50), note: "Valorisation des écarts au coût actuel de la fiche (0 si le coût est inconnu). Les stocks initiaux de création ne sont pas des écarts." },
    methods: { rotation: "Rotation = quantités vendues ÷ stock moyen ((ouverture + clôture) ÷ 2). Le stock d'ouverture/clôture est reconstitué : stock actuel − mouvements postérieurs.", coverage: `Couverture = stock actuel ÷ ventes moyennes par jour sur la période (${w.period.days} j). Indéfinie sans vente.`,
      classes: `Dormant : stock sans aucune vente sur la période. Lent : couverture > ${w.th.slowDays} j. Fort : ≤ ${w.th.fastDays} j. Surstock : > ${w.th.overDays} j. Rupture : stock ≤ 0. (Conventions modifiables ci-dessus.)`, stockouts: "Ruptures fréquentes : au moins 2 passages à stock ≤ 0 reconstitués depuis les mouvements de la période.", expiry: "Lots avec stock restant : expiré si la date est passée ; proche si ≤ 30 jours." },
    dataUsed: { products: rows.length, moves: w.rowsRead.moves, window: `${w.period.from} → ${w.period.to}` }, definitions: DEFS, _f: filteredByState };
}

// ------------------------------------------------------------------ espace 5 : achats et fournisseurs
function purchases(w: World, journalByShop: Map<string, number>) {
  const from = Date.parse(boundsOf(w.period.from, w.period.to, w.tz).gte), to = Date.parse(boundsOf(w.period.from, w.period.to, w.tz).lt); const st = stockAnalysis(w);
  type Obs = { at: string; price: number; supplier: string; qty: number; ref: string };
  const perProd = new Map<string, Obs[]>(); const sup = new Map<string, { name: string; orders: number; total: number; lead: number[]; items: Set<string> }>(); const hist: Record<string, unknown>[] = []; const onOrder = new Map<string, number>(); let orderedTotal = 0;
  for (const ps of w.perShop) {
    const recv = new Map<string, number[]>(); for (const m of ps.moves) if (m.kind === "purchase" && m.refId) { const k = String(m.refId); (recv.get(k) ?? recv.set(k, []).get(k)!).push(created(m)); }
    for (const o of ps.orders) {
      const at = created(o); const lines = parse<{ productId: string; qty: number; unitCost: number; received?: number }[]>(o.lines, []); const sName = w.suppliers.get(String(o.supplierId)) ?? "Fournisseur"; const rc = (recv.get(String(o.number)) ?? []).sort((a, b) => a - b); const total = Number(o.total ?? lines.reduce((a, l) => a + l.qty * l.unitCost, 0));
      if (o.status === "ordered" || o.status === "partial") for (const l of lines) onOrder.set(`${ps.shop.$id}|${l.productId}`, (onOrder.get(`${ps.shop.$id}|${l.productId}`) ?? 0) + Math.max(0, l.qty - Number(l.received ?? 0)));
      for (const l of lines) { if (w.filters.articles.length && !w.filters.articles.includes(l.productId)) continue; const p = w.products.get(l.productId); if (w.filters.categories.length && !w.filters.categories.includes(String(p?.category ?? "") || "Sans catégorie")) continue; (perProd.get(l.productId) ?? perProd.set(l.productId, []).get(l.productId)!).push({ at: new Date(at).toISOString(), price: Number(l.unitCost), supplier: String(o.supplierId), qty: l.qty, ref: String(o.number) }); }
      if (at < from || at >= to || (w.filters.suppliers.length && !w.filters.suppliers.includes(String(o.supplierId))) || o.status === "cancelled") continue;
      orderedTotal += total; const s = sup.get(String(o.supplierId)) ?? { name: sName, orders: 0, total: 0, lead: [], items: new Set() }; s.orders++; s.total += total; if (rc.length && at > 0) s.lead.push(Math.max(0, (rc[0]! - at) / DAY)); for (const l of lines) s.items.add(l.productId); sup.set(String(o.supplierId), s);
      hist.push({ number: String(o.number), supplier: sName, shop: String(ps.shop.name ?? ps.shop.$id), status: String(o.status), total, orderedAt: new Date(at).toISOString(), firstReceipt: rc.length ? new Date(rc[0]!).toISOString() : null, lastReceipt: rc.length ? new Date(rc.at(-1)!).toISOString() : null, leadDays: rc.length ? r1(Math.max(0, (rc[0]! - at) / DAY)) : null, lines: lines.length });
    }
  }
  const supplierRows = [...sup].map(([id, s]) => ({ id, name: s.name, orders: s.orders, total: s.total, items: s.items.size, avgLeadDays: s.lead.length ? r1(s.lead.reduce((a, b) => a + b, 0) / s.lead.length) : null, leadObservations: s.lead.length })).sort((a, b) => b.total - a.total);
  const anomalies: { productId: string; name: string; at: string; price: number; baseline: number; deviationPct: number; ref?: string }[] = []; const evolution: { productId: string; name: string; observations: number; first: number; last: number; changePct: number | null; points: { at: string; price: number }[] }[] = []; const compareSup: { productId: string; name: string; suppliers: { id: string; name: string; avgPrice: number; orders: number }[]; spreadPct: number | null }[] = [];
  for (const [pid, obs] of perProd) { const name = String(w.products.get(pid)?.name ?? "Article"); const sorted = [...obs].sort((a, b) => a.at.localeCompare(b.at));
    for (const a of A.priceAnomalies(sorted.map((o) => ({ at: o.at, price: o.price, ref: o.ref })))) if (Date.parse(a.at) >= from && Date.parse(a.at) < to) anomalies.push({ productId: pid, name, ...a });
    const inP = sorted.filter((o) => Date.parse(o.at) >= from && Date.parse(o.at) < to); if (inP.length) evolution.push({ productId: pid, name, observations: inP.length, first: inP[0]!.price, last: inP.at(-1)!.price, changePct: A.delta(inP.at(-1)!.price, inP[0]!.price), points: inP.slice(-12).map((o) => ({ at: o.at, price: o.price })) });
    const bySup = new Map<string, { sum: number; q: number; n: number }>(); for (const o of inP) { const a = bySup.get(o.supplier) ?? { sum: 0, q: 0, n: 0 }; a.sum += o.price * o.qty; a.q += o.qty; a.n++; bySup.set(o.supplier, a); }
    if (bySup.size >= 2) { const rowsS = [...bySup].map(([id, a]) => ({ id, name: w.suppliers.get(id) ?? "Fournisseur", avgPrice: Math.round(a.sum / a.q), orders: a.n })).sort((x, y) => x.avgPrice - y.avgPrice); compareSup.push({ productId: pid, name, suppliers: rowsS, spreadPct: A.delta(rowsS.at(-1)!.avgPrice, rowsS[0]!.avgPrice) }); } }
  const lead = supplierRows.filter((s) => s.avgLeadDays !== null); const avgLead = lead.length ? lead.reduce((a, s) => a + s.avgLeadDays! * s.leadObservations, 0) / lead.reduce((a, s) => a + s.leadObservations, 0) : null;
  // réapprovisionnement : besoin = ventes/jour × (délai moyen observé + couverture cible) − stock − déjà commandé
  const reorder = st.rows.filter((r) => r.sold > 0 && r.qty >= 0).map((r) => { const perDay = r.sold / st.days; const need = perDay * ((avgLead ?? 0) + w.th.coverTarget) - r.qty - (onOrder.get(`${r.shopId}|${r.productId}`) ?? 0); return { productId: r.productId, name: r.name, shop: w.shopName(r.shopId), stock: r.qty, perDay: Math.round(perDay * 100) / 100, onOrder: onOrder.get(`${r.shopId}|${r.productId}`) ?? 0, coverageDays: r.coverage, suggested: Math.ceil(need) }; }).filter((r) => r.suggested > 0).sort((a, b) => (a.coverageDays ?? 0) - (b.coverageDays ?? 0)).slice(0, 50);
  const invoiced = [...journalByShop.values()].reduce((a, b) => a + b, 0);
  return { ...head(w, "purchases"), invoicedHt: invoiced, orderedTotal, orders: hist.length, bySupplier: supplierRows, mostSolicited: [...supplierRows].sort((a, b) => b.orders - a.orders).slice(0, 5), leadTimes: { avgDays: avgLead === null ? null : r1(avgLead), suppliers: lead }, evolution: evolution.sort((a, b) => b.observations - a.observations).slice(0, 30), anomalies: anomalies.sort((a, b) => Math.abs(b.deviationPct) - Math.abs(a.deviationPct)).slice(0, 50), compare: compareSup.sort((a, b) => (b.spreadPct ?? 0) - (a.spreadPct ?? 0)).slice(0, 30),
    reorder: { items: reorder, method: `Besoin = ventes moyennes/jour de la période × (délai fournisseur observé${avgLead === null ? " : inconnu, 0 utilisé" : ` ${r1(avgLead)} j`} + ${w.th.coverTarget} j de couverture cible) − stock − quantités déjà commandées.`, reliability: st.days >= 28 ? "moyenne" : "faible", limits: "Suppose une demande stable ; ne tient compte ni de la saisonnalité ni des promotions à venir." }, history: hist.sort((a, b) => String(b.orderedAt).localeCompare(String(a.orderedAt))).slice(0, 60),
    methods: { invoiced: "Montant facturé HT = débits du compte 601 du journal dans la période.", ordered: "Montant commandé = total des commandes créées dans la période (hors annulées).", lead: "Délai observé = date de la première réception (mouvement d'achat portant le numéro de commande) − date de création de la commande.", anomalies: "Une observation est anormale si son prix s'écarte de plus de 15 % ET de plus de 3 écarts médians de la médiane des commandes précédentes (≥ 3 observations antérieures)." }, definitions: DEFS };
}

// ------------------------------------------------------------------ espace 6 : magasins
function stores(w: World) {
  const st = stockAnalysis(w); const shops = w.target.map((s) => { const sid = String(s.$id); const fs = w.facts.filter((f) => f.shopId === sid); const t = A.totalsOf(fs); const pf = w.prevFacts.filter((f) => f.shopId === sid); const pt = w.compare !== "none" ? A.totalsOf(pf) : null; const ps = w.perShop.find((p) => p.shop.$id === s.$id)!; const rs = st.rows.filter((r) => r.shopId === sid); const avg = rs.reduce((a, r) => a + ((Math.max(0, r.opening) + Math.max(0, r.closing)) / 2) * (r.unitCost ?? 0), 0);
    return { id: sid, name: String(s.name ?? sid), revenue: t.revenue, count: t.count, basket: t.basket, margin: t.margin, marginRate: t.marginRate, coveragePct: t.cost.coveragePct, stockValue: ps.movesTrunc ? null : Math.round(ps.snap.value ?? 0), rotation: t.cogs !== null && avg > 0 ? r1(t.cogs / avg) : null, out: rs.filter((r) => r.cls === "out").length, revenueDelta: pt ? A.delta(t.revenue, pt.revenue) : null, sellers: A.bySeller(fs, w.sellerName).slice(0, 20) }; });
  const mean = (k: "revenue" | "marginRate" | "basket") => { const v = shops.map((s) => s[k]).filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }; const mr = mean("revenue"), mm = mean("marginRate"), mb = mean("basket");
  const ranked = [...shops].sort((a, b) => b.revenue - a.revenue).map((s, i) => ({ ...s, rankRevenue: i + 1 })).map((s) => ({ ...s, revenueGapPct: mr ? A.delta(s.revenue, mr) : null, basketGapPct: mb ? A.delta(s.basket, mb) : null, marginGapPts: s.marginRate !== null && mm !== null ? r1(s.marginRate - mm) : null }));
  return { ...head(w, "stores"), shops: ranked, averages: { revenue: mr === null ? null : Math.round(mr), marginRate: mm === null ? null : r1(mm), basket: mb === null ? null : Math.round(mb) }, comparable: shops.length > 1, note: shops.length > 1 ? "Écarts exprimés par rapport à la moyenne des magasins sélectionnés. Chaque magasin est calculé avec ses seules données." : "Un seul magasin sélectionné : pas de comparaison.", definitions: DEFS };
}

// ------------------------------------------------------------------ espace 7 : prévisions et recommandations
type Rec = { id: string; kind: string; title: string; severity: "info" | "warning" | "critical"; subject: string; period: { from: string; to: string }; data: Record<string, string | number | null>; method: string; reliability: A.Reliability; limits: string };
function forecast(w: World) {
  const end = w.period.to; const weeks = 12; const wkStart = A.weekStart(addDays(end, -(weeks * 7 - 1))); const weekKeys = A.bucketsIn(wkStart, end, "week"); const first = w.factsAll.reduce((m, f) => (f.day < m ? f.day : m), "9999"); const hist = w.factsAll.length ? Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / DAY) + 1 : 0;
  const win = { from: wkStart, to: end }; const days = Math.max(1, daysIn(win.from, win.to).length);
  if (!w.factsAll.length || hist < 28) return { ...head(w, "forecast"), insufficient: true, reason: !w.factsAll.length ? "Aucune vente enregistrée : aucune prévision n'est possible." : `Historique de ${hist} jour(s) : il en faut au moins 28 pour une tendance exploitable. Aucune prévision n'est produite plutôt qu'une prévision fragile.`, recommendations: [] as Rec[], window: win, definitions: DEFS };
  const st = stockAnalysis({ ...w, period: { ...w.period, from: win.from, to: win.to, days } } as World); const stockBy = new Map(st.rows.map((r) => [`${r.shopId}|${r.productId}`, r]));
  const fs = w.factsAll.filter((f) => f.day >= win.from && f.day <= win.to && w.target.some((s) => s.$id === f.shopId)); const byProd = new Map<string, { name: string; qty: Map<string, number>; rev: Map<string, number> }>();
  for (const f of fs) for (const l of f.lines) { const a = byProd.get(l.productId) ?? { name: l.name, qty: new Map(), rev: new Map() }; const k = A.weekStart(f.day); a.qty.set(k, (a.qty.get(k) ?? 0) + l.qty); a.rev.set(k, (a.rev.get(k) ?? 0) + l.revenue); byProd.set(l.productId, a); }
  const recs: Rec[] = []; const period = { from: win.from, to: win.to }; const lead = 0;
  for (const [pid, a] of byProd) {
    if (w.filters.articles.length && !w.filters.articles.includes(pid)) continue; const q = weekKeys.map((k) => a.qty.get(k) ?? 0); const nonZero = q.filter((x) => x > 0).length; if (nonZero < 4) continue; const tr = A.trendOf(q); const rel = A.reliability(q, tr.fit.r2); const stockRows = w.target.map((s) => stockBy.get(`${s.$id}|${pid}`)).filter((x): x is Prod => !!x); const stock = stockRows.reduce((s, r) => s + r.qty, 0); const hasStock = stockRows.length > 0;
    const perDay = q.slice(-4).reduce((x, y) => x + y, 0) / 28; const sd = Math.sqrt(q.reduce((x, y) => x + (y - tr.fit.mean) ** 2, 0) / q.length) / 7; const base = { weeksAnalysed: weekKeys.length, weeksWithSales: nonZero, avgWeeklyQty: Math.round(tr.fit.mean * 10) / 10, trendPctPerWeek: tr.pctPerWeek };
    const method = "Régression linéaire sur les quantités hebdomadaires (12 semaines) ; demande/jour = moyenne des 4 dernières semaines ÷ 7.";
    if (tr.kind === "baisse") recs.push({ id: `decl:${pid}`, kind: "declining", title: `Perte de vitesse : ${a.name}`, severity: "warning", subject: a.name, period, data: { ...base }, method, reliability: rel, limits: "Une baisse peut venir d'une rupture passée, d'un prix, de la saison ou d'une promotion terminée." });
    if (tr.kind === "hausse") { const m = w.facts.length ? A.byArticle(w.facts).find((x) => x.key === pid) : undefined; recs.push({ id: `up:${pid}`, kind: "potential", title: `Produit en progression : ${a.name}`, severity: "info", subject: a.name, period, data: { ...base, marginRate: m?.marginRate ?? null }, method, reliability: rel, limits: "La hausse récente peut être temporaire ; vérifier la marge et la disponibilité avant d'investir." }); }
    if (hasStock && perDay > 0) { const cover = stock / perDay; const lo = perDay + sd, hi = Math.max(0, perDay - sd); const covLow = lo > 0 ? stock / lo : null, covHigh = hi > 0 ? stock / hi : null;
      if (stock <= 0 || cover < 14) recs.push({ id: `out:${pid}`, kind: "stockout", title: stock <= 0 ? `Rupture en cours : ${a.name}` : `Rupture probable : ${a.name}`, severity: stock <= 0 || cover < 7 ? "critical" : "warning", subject: a.name, period, data: { ...base, stock, demandPerDay: Math.round(perDay * 100) / 100, coverageDays: Math.round(cover), coverageRange: covLow !== null && covHigh !== null ? `${Math.round(covLow)}–${Math.round(covHigh)} j` : null }, method: `${method} Couverture = stock ÷ demande/jour (fourchette : demande ± écart-type).`, reliability: rel, limits: "Prévision indicative ; n'intègre ni réception en cours (voir Achats) ni variation soudaine de la demande." });
      if (stock > 0 && cover > w.th.overDays) recs.push({ id: `over:${pid}`, kind: "overstock", title: `Risque de surstock : ${a.name}`, severity: "warning", subject: a.name, period, data: { ...base, stock, coverageDays: Math.round(cover) }, method, reliability: rel, limits: `Seuil de surstock = ${w.th.overDays} jours de couverture (convention modifiable).` });
      const need = Math.ceil(perDay * (lead + w.th.coverTarget) - stock); if (need > 0 && cover >= 14) recs.push({ id: `reorder:${pid}`, kind: "reorder", title: `À réapprovisionner : ${a.name}`, severity: "info", subject: a.name, period, data: { ...base, stock, suggestedQty: need, coverTargetDays: w.th.coverTarget }, method: `${method} Besoin = demande/jour × ${w.th.coverTarget} j − stock.`, reliability: rel, limits: "Délai fournisseur et commandes en cours à vérifier dans Achats et fournisseurs." }); }
  }
  // baisse inhabituelle de marge : 7 derniers jours vs 28 jours précédents, seulement si le coût est connu partout
  const last7 = A.totalsOf(fs.filter((f) => f.day >= addDays(end, -6))), prior = A.totalsOf(fs.filter((f) => f.day >= addDays(end, -34) && f.day <= addDays(end, -7)));
  if (last7.marginRate !== null && prior.marginRate !== null && prior.count >= 10 && last7.count >= 3 && last7.marginRate < prior.marginRate - 2 && last7.marginRate < prior.marginRate * 0.9) recs.push({ id: "margin:global", kind: "margin_drop", title: "Baisse inhabituelle du taux de marge", severity: "warning", subject: "Toutes ventes sélectionnées", period: { from: addDays(end, -34), to: end }, data: { recentRatePct: last7.marginRate, priorRatePct: prior.marginRate, recentSales: last7.count, priorSales: prior.count }, method: "Taux de marge des 7 derniers jours comparé à celui des 28 jours précédents ; signalé si −2 points ET −10 % relatifs (coûts connus sur toutes les lignes).", reliability: prior.count >= 30 ? "moyenne" : "faible", limits: "Peut venir d'un changement de mix de produits, de promotions ou d'une hausse des coûts d'achat." });
  const order = { critical: 0, warning: 1, info: 2 } as const;
  return { ...head(w, "forecast"), insufficient: false, window: win, historyDays: hist, recommendations: recs.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 80), disclaimer: "Prévisions indicatives fondées sur l'historique de ventes : ce ne sont pas des certitudes. Chacune indique sa période, ses données, sa méthode, sa fiabilité et ses limites.", definitions: DEFS };
}

/** Point d'entrée : un espace du tableau de bord Pro. Formule Pro vérifiée côté serveur ; lecture seule ; isolation commerce/boutique. */
export async function proDashboard(store: Store, ctx: Ctx, b: Params = {}) {
  const space = (SPACES as readonly string[]).includes(String(b.space)) ? (b.space as Space) : "exec"; const needMoves = space !== "sales" && space !== "profit"; const w = await world(store, ctx, b, needMoves);
  const minMargin = Number(w.home.minMarginPct ?? 0) > 0 ? Number(w.home.minMarginPct) : 10;
  let journal = new Map<string, number>();
  if (space === "purchases" || space === "exec") { const pb = boundsOf(w.period.from, w.period.to, w.tz); for (const s of w.target) { const rows = (await store.scan("journal_entries", { tenantId: ctx.tenantId, shopId: String(s.$id), account: "601" }, { range: { field: "date", from: pb.gte, to: pb.lt }, maxRows: 20_000 })).rows; journal.set(String(s.$id), rows.reduce((a, r) => a + Number(r.debit ?? 0), 0)); } }
  const out = space === "exec" ? { ...exec(w), purchasesHt: [...journal.values()].reduce((a, b2) => a + b2, 0) } : space === "sales" ? sales(w) : space === "profit" ? profit(w, minMargin) : space === "stock" ? (({ _f, ...x }) => x)(stocks(w)) : space === "purchases" ? purchases(w, journal) : space === "stores" ? stores(w) : forecast(w);
  const checks = w.hasLineFilter ? null : (() => { const t = A.totalsOf(w.facts); const s = A.series(w.facts, w.period, "day").reduce((a, p) => a + p.revenue, 0); return { seriesEqualsTotal: s === t.revenue, paymentsEqualRevenue: t.encaisse + t.credit === t.revenue }; })();
  return { ...out, checks };
}

// ------------------------------------------------------------------ rapports et exports
export type ReportSection = { name: string; columns: string[]; rows: (string | number | null)[][] };
export type Report = { kind: string; title: string; generatedAt: string; tz: string; period: { from: string; to: string }; scope: string[]; filters: Record<string, string[]>; notes: string[]; sections: ReportSection[] };
export const REPORT_KINDS = ["commercial", "profit", "stock", "inventory", "purchases", "suppliers", "store", "seller"] as const;
const pctv = (n: number | null) => (n === null ? null : n);
/** Données d'un rapport : mêmes calculs que les écrans, mêmes filtres (période, magasin, catégories…). Le format (PDF/Excel/CSV) est produit par le client à partir de ces lignes. */
export async function proReport(store: Store, ctx: Ctx, b: Params & { kind?: string } = {}): Promise<Report> {
  const kind = (REPORT_KINDS as readonly string[]).includes(String(b.kind)) ? String(b.kind) : ""; if (!kind) throw new HttpError(400, "Type de rapport inconnu");
  const base = { ...b, space: kind === "commercial" || kind === "seller" ? "sales" : kind === "profit" ? "profit" : kind === "stock" || kind === "inventory" ? "stock" : kind === "purchases" || kind === "suppliers" ? "purchases" : "stores" } as Params;
  const d = (await proDashboard(store, ctx, base)) as unknown as Record<string, any>; const H = d; const sections: ReportSection[] = []; const notes: string[] = []; let title = "";
  const money = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n));
  if (kind === "commercial") { title = "Rapport commercial"; const t = d.totals; sections.push({ name: "Synthèse", columns: ["Indicateur", "Valeur"], rows: [["Chiffre d'affaires TTC", money(t.revenue)], ["Ventes", t.count], ["Panier moyen", money(t.basket)], ["Encaissé", money(t.encaisse)], ["Vendu à crédit", money(t.credit)]] });
    sections.push({ name: "Évolution", columns: ["Période", "CA TTC", "Ventes"], rows: d.series.map((p: any) => [p.key, p.revenue, p.count]) }); sections.push({ name: "Par article", columns: ["Article", "Quantité", "CA TTC", "Tickets"], rows: d.byArticle.map((a: any) => [a.name, a.qty, a.revenue, a.tickets]) }); sections.push({ name: "Par catégorie", columns: ["Catégorie", "Quantité", "CA TTC"], rows: d.byCategory.map((a: any) => [a.name, a.qty, a.revenue]) });
    sections.push({ name: "Par mode de paiement", columns: ["Mode", "Montant", "Ventes"], rows: d.byMethod.map((m: any) => [m.method, m.amount, m.sales]) }); sections.push({ name: "Par tranche horaire", columns: ["Heure", "CA TTC", "Ventes"], rows: d.byHour.map((h: any) => [`${String(h.hour).padStart(2, "0")}h`, h.revenue, h.count]) }); }
  if (kind === "seller") { title = "Rapport par vendeur"; sections.push({ name: "Vendeurs", columns: ["Vendeur", "Ventes", "CA TTC", "Quantité", "Marge brute", "Taux de marge %"], rows: d.bySeller.map((s: any) => [s.name, s.tickets, s.revenue, s.qty, money(s.margin), pctv(s.marginRate)]) }); notes.push("Vendeur = utilisateur ayant enregistré la vente (caissier)."); }
  if (kind === "profit") { title = "Rapport de rentabilité"; sections.push({ name: "Synthèse", columns: ["Indicateur", "Valeur"], rows: [["CA HT", money(d.totals.revenueHt)], ["Coût des marchandises vendues", money(d.totals.cogs)], ["Marge brute", money(d.margin.amount)], ["Taux de marge %", d.margin.rate], ["Taux de marque %", d.margin.markup], ["Couverture des coûts %", d.margin.cost.coveragePct]] });
    sections.push({ name: "Par article", columns: ["Article", "CA HT", "Coût", "Marge brute", "Taux de marge %", "Taux de marque %", "Couverture coût %"], rows: d.byArticle.map((a: any) => [a.name, a.revenueHt, money(a.cogs), money(a.margin), a.marginRate, a.markup, a.coveragePct]) }); sections.push({ name: "Par catégorie", columns: ["Catégorie", "CA HT", "Marge brute", "Taux de marge %"], rows: d.byCategory.map((a: any) => [a.name, a.revenueHt, money(a.margin), a.marginRate]) });
    sections.push({ name: "Ventes à perte", columns: ["Vente", "Jour", "Article", "Qté", "CA HT", "Coût"], rows: d.loss.lines.map((l: any) => [l.saleNumber, l.day, l.name, l.qty, l.revenueHt, l.cost]) }); sections.push({ name: "Faible marge", columns: ["Vente", "Jour", "Article", "Marge %"], rows: d.lowMargin.lines.map((l: any) => [l.saleNumber, l.day, l.name, l.marginPct]) }); notes.push(d.margin.note, d.method); }
  if (kind === "stock") { title = "Rapport de stock"; const all = [...d.lists.out, ...d.lists.dormant, ...d.lists.slow, ...d.lists.overstock, ...d.lists.fast]; sections.push({ name: "Par magasin", columns: ["Magasin", "Valeur du stock", "Articles", "Rotation", "Ruptures"], rows: d.byShop.map((s: any) => [s.name, s.value, s.articles, s.rotation, s.out]) });
    sections.push({ name: "Articles classés", columns: ["Article", "Magasin", "Classe", "Stock", "Valeur", "Vendu", "Rotation", "Couverture (j)"], rows: all.map((r: any) => [r.name, w2(H, r.shopId), r.cls, r.qty, r.value, r.sold, r.rotation, r.coverage]) }); sections.push({ name: "Lots expirés", columns: ["Article", "Lot", "Expiration", "Quantité", "Valeur"], rows: d.expiry.expired.map((e: any) => [e.name, e.lotNo, e.expiresAt.slice(0, 10), e.qty, e.value]) }); sections.push({ name: "Lots proches de l'expiration (≤ 30 j)", columns: ["Article", "Lot", "Expiration", "Jours restants", "Quantité", "Valeur"], rows: d.expiry.soon.map((e: any) => [e.name, e.lotNo, e.expiresAt.slice(0, 10), e.daysLeft, e.qty, e.value]) }); notes.push(...Object.values(d.methods) as string[]); }
  if (kind === "inventory") { title = "Rapport d'inventaire, pertes et ajustements"; sections.push({ name: "Synthèse", columns: ["Type", "Opérations", "Valeur (coût actuel)"], rows: [["Écarts d'inventaire", d.gaps.inventory.count, d.gaps.inventory.value], ["Pertes", d.gaps.loss.count, d.gaps.loss.value], ["Autres ajustements", d.gaps.other.count, d.gaps.other.value]] }); sections.push({ name: "Détail", columns: ["Date", "Magasin", "Article", "Type", "Quantité", "Valeur"], rows: d.gaps.entries.map((g: any) => [g.at.slice(0, 10), g.shop, g.name, g.kind, g.qty, g.value]) }); notes.push(d.gaps.note); }
  if (kind === "purchases") { title = "Rapport d'achats"; sections.push({ name: "Synthèse", columns: ["Indicateur", "Valeur"], rows: [["Facturé HT (journal 601)", money(d.invoicedHt)], ["Commandé", money(d.orderedTotal)], ["Commandes", d.orders], ["Délai moyen observé (j)", d.leadTimes.avgDays]] }); sections.push({ name: "Historique des commandes", columns: ["N°", "Fournisseur", "Magasin", "Statut", "Total", "Commandée", "1re réception", "Délai (j)"], rows: d.history.map((h: any) => [h.number, h.supplier, h.shop, h.status, h.total, h.orderedAt.slice(0, 10), h.firstReceipt?.slice(0, 10) ?? null, h.leadDays]) });
    sections.push({ name: "Variations anormales de prix", columns: ["Article", "Date", "Prix", "Référence (médiane)", "Écart %"], rows: d.anomalies.map((a: any) => [a.name, a.at.slice(0, 10), a.price, a.baseline, a.deviationPct]) }); sections.push({ name: "À réapprovisionner", columns: ["Article", "Magasin", "Stock", "Ventes/jour", "Déjà commandé", "Quantité suggérée"], rows: d.reorder.items.map((r: any) => [r.name, r.shop, r.stock, r.perDay, r.onOrder, r.suggested]) }); notes.push(...Object.values(d.methods) as string[], d.reorder.method); }
  if (kind === "suppliers") { title = "Rapport fournisseurs"; sections.push({ name: "Fournisseurs", columns: ["Fournisseur", "Commandes", "Montant", "Articles", "Délai moyen (j)", "Observations de délai"], rows: d.bySupplier.map((s: any) => [s.name, s.orders, s.total, s.items, s.avgLeadDays, s.leadObservations]) }); sections.push({ name: "Comparaison de prix", columns: ["Article", "Fournisseur", "Prix moyen", "Commandes", "Écart max %"], rows: d.compare.flatMap((c: any) => c.suppliers.map((s: any) => [c.name, s.name, s.avgPrice, s.orders, c.spreadPct])) }); sections.push({ name: "Évolution des prix d'achat", columns: ["Article", "Observations", "Premier", "Dernier", "Variation %"], rows: d.evolution.map((e: any) => [e.name, e.observations, e.first, e.last, e.changePct]) }); notes.push(d.methods.lead, d.methods.anomalies); }
  if (kind === "store") { title = "Rapport par magasin"; sections.push({ name: "Magasins", columns: ["Rang", "Magasin", "CA TTC", "Ventes", "Panier moyen", "Marge brute", "Taux de marge %", "Valeur du stock", "Rotation", "Écart CA vs moyenne %"], rows: d.shops.map((s: any) => [s.rankRevenue, s.name, s.revenue, s.count, s.basket, money(s.margin), s.marginRate, s.stockValue, s.rotation, s.revenueGapPct]) }); for (const s of d.shops) sections.push({ name: `Vendeurs — ${s.name}`, columns: ["Vendeur", "Ventes", "CA TTC", "Marge brute"], rows: s.sellers.map((v: any) => [v.name, v.tickets, v.revenue, money(v.margin)]) }); notes.push(d.note); }
  return { kind, title, generatedAt: new Date().toISOString(), tz: H.tz, period: { from: H.period.from, to: H.period.to }, scope: H.scope.selected.map((id: string) => H.scope.shops.find((s: any) => s.id === id)?.name ?? id), filters: Object.fromEntries(Object.entries(H.filters as Record<string, string[]>).filter(([, v]) => v.length)), notes: notes.filter(Boolean), sections };
}
const w2 = (d: Record<string, any>, shopId: string) => d.scope.shops.find((s: any) => s.id === shopId)?.name ?? shopId;
void monthStart;

/** Listes pour les filtres avancés (catégories, articles, fournisseurs, vendeurs, modes de paiement) des boutiques accessibles. */
export async function proOptions(store: Store, ctx: Ctx, b: { shopId?: string } = {}) {
  const w = await world(store, ctx, { preset: "today", shopId: b.shopId ?? "all", space: "sales" }, false);
  const cats = new Set<string>(), arts: { id: string; name: string }[] = [], sup = new Map<string, string>();
  for (const p of w.products.values()) { if (p.archived) continue; cats.add(String(p.category ?? "") || "Sans catégorie"); arts.push({ id: String(p.$id), name: String(p.name) }); }
  for (const [id, name] of w.suppliers) sup.set(id, name);
  const sellers = new Map<string, string>(); for (const s of w.sales) sellers.set(s.cashierId, w.sellerName(s.cashierId)); for (const f of w.factsAll) sellers.set(f.cashierId, w.sellerName(f.cashierId));
  return { categories: [...cats].sort((a, c) => a.localeCompare(c, "fr")), articles: arts.sort((a, c) => a.name.localeCompare(c.name, "fr")).slice(0, 3000), suppliers: [...sup].map(([id, name]) => ({ id, name })).sort((a, c) => a.name.localeCompare(c.name, "fr")), sellers: [...sellers].filter(([id]) => id).map(([id, name]) => ({ id, name })).sort((a, c) => a.name.localeCompare(c.name, "fr")), methods: ["cash", "wave", "orange", "card", "credit"], shops: w.allowed.map((s) => ({ id: String(s.$id), name: String(s.name ?? s.$id) })) };
}
