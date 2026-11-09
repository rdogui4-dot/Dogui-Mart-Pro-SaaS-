import { DEFAULT_TIMEZONE, describeDiscount, findOverlaps, isAdvanced, promoStatus, utcToZoned, zonedToUtc, familyOf, type Promo } from "../../../src/domain/promotions";
import { fromScaled, scaleOf } from "../../../src/domain/quantity";
import { stockOf, type StockMove } from "../../../src/domain/stock";
import { isVirtualBundle } from "../../../src/domain/bundles";
import { needFeature } from "./articles";
import { loadPromo, promoPro, rowToPromo } from "./promotions";
import { HttpError, need, needModule, type Ctx, type Row, type Store } from "./store";

const J = <T,>(s: unknown, fb: T): T => { try { const v = JSON.parse(String(s)); return v ?? fb; } catch { return fb; } };
const DAY = 864e5;
const pct1 = (n: number) => Math.round(n * 10) / 10;

const tzOf = (shop: Row | null): string => (shop?.promoTz ? String(shop.promoTz) : DEFAULT_TIMEZONE);

/** Liste des campagnes visibles dans la boutique : les siennes (tous statuts) + celles des autres boutiques qui la visent (hors brouillons).
 *  Chaque campagne porte son statut effectif, ses résultats réels, son état « gelée » (campagne avancée hors formule Pro) et les chevauchements détectés. */
export async function listPromotions(store: Store, ctx: Ctx) {
  needModule(ctx, "stock"); need(ctx, "manager"); await needFeature(store, ctx, "promotions");
  const pro = await promoPro(store, ctx); const now = new Date();
  const all = (await store.scan("promotions", { tenantId: ctx.tenantId }, { maxRows: 5000 })).rows;
  const rows = all.filter((r) => r.shopId === ctx.shopId || (r.status !== "draft" && (r.storeScope === "all" || (r.storeScope === "some" && J<string[]>(r.shopIds, []).includes(ctx.shopId)))));
  const ids = new Set(rows.map((r) => r.$id)); const w = { tenantId: ctx.tenantId };
  const get = async (t: string) => (await store.scan(t, w, { maxRows: 100_000 })).rows.filter((x) => ids.has(String(x.promotionId)));
  const [items, conds, groups, rules, usage, coupons] = await Promise.all([get("promotion_items"), get("promotion_conditions"), get("promotion_customer_groups"), get("promotion_store_rules"), get("promotion_usage"), get("promotion_coupons")]);
  const kids = { items, conds, groups, rules };
  const shops = (await store.scan("shops", w, { maxRows: 200 })).rows; const shop = shops.find((s) => s.$id === ctx.shopId.slice(0, 36)) ?? null;
  const per = new Map<string, { uses: number; discount: number; revenue: number; here: number }>();
  for (const u of usage) { const a = per.get(String(u.promotionId)) ?? { uses: 0, discount: 0, revenue: 0, here: 0 }; a.uses++; a.discount += Number(u.discount ?? 0); a.revenue += Number(u.finalAmount ?? 0); if (u.shopId === ctx.shopId) a.here += Number(u.discount ?? 0); per.set(String(u.promotionId), a); }
  const promos = rows.map((r) => { const p = rowToPromo(r, kids); const a = per.get(p.id) ?? { uses: 0, discount: 0, revenue: 0, here: 0 };
    const adv = isAdvanced(p); const eff = promoStatus(p, now); const ov = p.storeOverrides?.[ctx.shopId];
    return { ...p, itemIds: p.itemIds.filter((x) => !x.startsWith("sku:")), excludeIds: (p.excludeIds ?? []).filter((x) => !x.startsWith("sku:")), effective: eff, describe: describeDiscount(p), advanced: adv, frozen: adv && !pro, foreign: r.shopId !== ctx.shopId,
      uses: a.uses, discountTotal: a.discount, revenue: a.revenue, budgetUsed: a.discount, budgetUsedHere: a.here, couponCount: coupons.filter((c) => c.promotionId === p.id).length, localEnabled: ov ? ov.enabled : true, localValue: ov?.value, localBudget: ov?.budget }; });
  const overlaps = findOverlaps(rows.map((r) => rowToPromo(r, kids))); const soon = promos.filter((p) => p.effective === "active" && Date.parse(p.endAt) - now.getTime() <= 3 * DAY).map((p) => ({ id: p.id, name: p.name, endAt: p.endAt }));
  return { pro, tz: tzOf(shop), settings: { tz: tzOf(shop), minMarginPct: Number(shop?.minMarginPct ?? 0), maxLinePct: shop?.promoMaxLinePct == null ? null : Number(shop.promoMaxLinePct), maxCartPct: shop?.promoMaxCartPct == null ? null : Number(shop.promoMaxCartPct), strategy: shop?.promoStrategy === "priority" ? "priority" : "best", typeRank: String(shop?.promoTypeRank ?? "").split(",").filter(Boolean) },
    promos, overlaps, expiringSoon: soon, shops: shops.map((s) => ({ id: String(s.$id), name: String(s.name) })), now: now.toISOString() };
}

type UsageLine = { index?: number; productId: string; name: string; category?: string; qty?: number; base?: number; discount: number; cost?: number | null };
type Totals = { uses: number; discount: number; revenue: number; beneficiaries: number };
const totals = (rows: Row[]): Totals => ({ uses: rows.length, discount: rows.reduce((a, r) => a + Number(r.discount ?? 0), 0), revenue: rows.reduce((a, r) => a + Number(r.finalAmount ?? 0), 0), beneficiaries: new Set(rows.map((r) => String(r.customerId ?? "")).filter(Boolean)).size });

/** Analyse de performance (Pro) : uniquement des chiffres réels tirés des utilisations enregistrées. Marge brute seulement si le coût de revient est connu ; comparaison descriptive avec la période précédente de même durée (aucun lien de causalité affirmé).
 *  `scope: "all"` (propriétaire) agrège toutes les boutiques et les compare. */
export async function promotionAnalytics(store: Store, ctx: Ctx, b: { from?: string; to?: string; scope?: string } = {}) {
  needModule(ctx, "stock"); need(ctx, "manager"); await needFeature(store, ctx, "promotionsPro");
  const all = b.scope === "all"; if (all) need(ctx, "owner");
  const shops = (await store.scan("shops", { tenantId: ctx.tenantId }, { maxRows: 200 })).rows; const shop = shops.find((s) => s.$id === ctx.shopId.slice(0, 36)) ?? null; const tz = tzOf(shop);
  const day = /^\d{4}-\d{2}-\d{2}$/; const nowDay = utcToZoned(new Date().toISOString(), tz).slice(0, 10);
  const to = b.to && day.test(b.to) ? b.to : nowDay; const from = b.from && day.test(b.from) ? b.from : utcToZoned(new Date(Date.now() - 29 * DAY).toISOString(), tz).slice(0, 10);
  if (to < from) throw new HttpError(400, "La fin précède le début");
  const start = zonedToUtc(`${from}T00:00`, tz), end = new Date(Date.parse(zonedToUtc(`${to}T00:00`, tz)) + DAY).toISOString();
  const len = Date.parse(end) - Date.parse(start); if (len > 366 * DAY) throw new HttpError(400, "Période de 366 jours au maximum");
  const refStart = new Date(Date.parse(start) - len).toISOString(); const where: Record<string, string> = all ? { tenantId: ctx.tenantId } : { tenantId: ctx.tenantId, shopId: ctx.shopId };
  const [cur, ref] = await Promise.all([store.scan("promotion_usage", where, { range: { field: "usedAt", from: start, to: end }, maxRows: 100_000 }), store.scan("promotion_usage", where, { range: { field: "usedAt", from: refStart, to: start }, maxRows: 100_000 })]);
  const promoRows = (await store.scan("promotions", where, { maxRows: 5000 })).rows; const now = new Date();
  const counts: Record<string, number> = { draft: 0, scheduled: 0, active: 0, suspended: 0, ended: 0 }; for (const p of promoRows) counts[promoStatus({ status: p.status, startAt: String(p.startAt), endAt: String(p.endAt) }, now)]!++;
  const sales = await store.scan("sales", where, { range: { field: "soldAt", from: start, to: end }, maxRows: 50_000 }); const salesTotal = sales.rows.filter((s) => s.status === "paid").reduce((a, s) => a + Number(s.total ?? 0), 0);
  const name = new Map(promoRows.map((p) => [p.$id, String(p.name)])); const shopName = new Map(shops.map((s) => [String(s.$id), String(s.name)]));
  const t = totals(cur.rows), tr = totals(ref.rows);
  const grp = <K extends string>(keyOf: (r: Row) => string): Map<string, { uses: number; discount: number; revenue: number }> => { const m = new Map<string, { uses: number; discount: number; revenue: number }>(); for (const r of cur.rows) { const k = keyOf(r); const a = m.get(k) ?? { uses: 0, discount: 0, revenue: 0 }; a.uses++; a.discount += Number(r.discount ?? 0); a.revenue += Number(r.finalAmount ?? 0); m.set(k, a); } return m; };
  const byPromo = grp((r) => String(r.promotionId)), byShop = grp((r) => String(r.shopId)), byDay = grp((r) => utcToZoned(new Date(String(r.usedAt)).toISOString(), tz).slice(0, 10));
  // lignes : article, catégorie, marge réelle quand le coût est connu
  const art = new Map<string, { name: string; qty: number; discount: number; revenue: number }>(), cat = new Map<string, { qty: number; discount: number; revenue: number }>(); const lowMargin: { saleNumber: string; promotion: string; article: string; finalAmount: number; cost: number; marginPct: number }[] = []; const lowByPromo = new Map<string, number>();
  let withCost = 0, noCost = 0, marginSum = 0; const shopMin = Number(shop?.minMarginPct ?? 0);
  for (const u of cur.rows) for (const l of J<UsageLine[]>(u.lines, [])) {
    const fin = Number(l.base ?? 0) - Number(l.discount ?? 0); const a = art.get(l.productId) ?? { name: l.name, qty: 0, discount: 0, revenue: 0 }; a.qty += Number(l.qty ?? 0); a.discount += Number(l.discount ?? 0); a.revenue += fin; art.set(l.productId, a);
    const c = cat.get(l.category || "—") ?? { qty: 0, discount: 0, revenue: 0 }; c.qty += Number(l.qty ?? 0); c.discount += Number(l.discount ?? 0); c.revenue += fin; cat.set(l.category || "—", c);
    if (l.cost && l.cost > 0) { withCost++; marginSum += fin - l.cost; const rules = J<{ minMarginPct?: number }>(u.rules, {}); const m = rules.minMarginPct ?? shopMin; const mp = (fin - l.cost) / l.cost * 100;
      if (mp < m) { lowByPromo.set(String(u.promotionId), (lowByPromo.get(String(u.promotionId)) ?? 0) + 1); if (lowMargin.length < 30) lowMargin.push({ saleNumber: String(u.saleNumber), promotion: name.get(String(u.promotionId)) ?? "—", article: l.name, finalAmount: fin, cost: l.cost, marginPct: pct1(mp) }); } } else noCost++;
  }
  const top = <V extends { discount: number }>(m: Map<string, V>, n = 10) => [...m].map(([id, v]) => ({ id, ...v })).sort((x, y) => y.discount - x.discount).slice(0, n);
  const cu = await store.scan("promotion_coupon_usage", where, { range: { field: "usedAt", from: start, to: end }, maxRows: 100_000 }); const byCoupon = new Map<string, number>(); let invalid = 0; for (const r of cu.rows) { if (r.outcome === "used") byCoupon.set(String(r.code), (byCoupon.get(String(r.code)) ?? 0) + 1); else invalid++; }
  const delta = (a: number, c: number) => (c > 0 ? pct1((a - c) / c * 100) : null);
  // budgets par campagne et par boutique (utilisation réelle sur toute la durée de vie)
  const lifeUse = (await store.scan("promotion_usage", where, { maxRows: 100_000 })).rows; const spent = new Map<string, number>(); for (const u of lifeUse) { spent.set(String(u.promotionId), (spent.get(String(u.promotionId)) ?? 0) + Number(u.discount ?? 0)); const k = `${u.promotionId}|${u.shopId}`; spent.set(k, (spent.get(k) ?? 0) + Number(u.discount ?? 0)); }
  const kids = await Promise.all(promoRows.filter((p) => p.budget != null).map((p) => loadPromo(store, ctx, p)));
  const budgets = kids.map((p) => ({ id: p.id, name: p.name, budget: p.budget!, spent: spent.get(p.id) ?? 0, remaining: Math.max(0, p.budget! - (spent.get(p.id) ?? 0)), perStore: Object.entries(p.storeOverrides ?? {}).filter(([, v]) => v.budget !== undefined).map(([sid, v]) => ({ shopId: sid, shop: shopName.get(sid) ?? sid, budget: v.budget!, spent: spent.get(`${p.id}|${sid}`) ?? 0 })) }));
  return {
    period: { from, to, tz }, reference: { from: utcToZoned(refStart, tz).slice(0, 10), to: utcToZoned(new Date(Date.parse(start) - 1).toISOString(), tz).slice(0, 10) }, scope: all ? "all" : "shop",
    campaigns: { created: promoRows.length, byStatus: counts, active: counts.active },
    totals: t, reference_totals: tr, comparison: { uses: delta(t.uses, tr.uses), discount: delta(t.discount, tr.discount), revenue: delta(t.revenue, tr.revenue) },
    comparisonNote: "Comparaison descriptive avec la période précédente de même durée : elle n'établit pas que les promotions ont causé la variation (saison, prix, stock et autres facteurs jouent aussi).",
    salesTotal, promoShareOfSalesPct: salesTotal > 0 ? pct1(t.revenue / salesTotal * 100) : null,
    margin: withCost > 0 ? { grossMargin: marginSum, linesWithCost: withCost, linesWithoutCost: noCost, note: noCost ? `Marge calculée sur ${withCost} ligne(s) dont le coût est connu ; ${noCost} ligne(s) sans coût de revient sont exclues.` : "Marge brute = montant encaissé − coût de revient des lignes en promotion." } : { grossMargin: null, linesWithCost: 0, linesWithoutCost: noCost, note: noCost ? "Rentabilité non calculable : le coût de revient des articles vendus en promotion n'est pas renseigné." : "Aucune vente en promotion sur la période." },
    lowMargin, lowMarginByCampaign: [...lowByPromo].map(([id, n]) => ({ id, name: name.get(id) ?? "—", lines: n })),
    byCampaign: top(byPromo, 50).map((x) => ({ ...x, name: name.get(x.id) ?? "—" })), byArticle: top(art, 20), byCategory: top(cat, 20), byStore: top(byShop, 50).map((x) => ({ ...x, name: shopName.get(x.id) ?? x.id })),
    byDay: [...byDay].map(([d, v]) => ({ day: d, ...v })).sort((x, y) => x.day.localeCompare(y.day)),
    coupons: { top: [...byCoupon].map(([code, uses]) => ({ code, uses })).sort((x, y) => y.uses - x.uses).slice(0, 10), invalidAttempts: invalid }, budgets,
    truncated: cur.truncated || ref.truncated || sales.truncated,
    note: "Le chiffre d'affaires promotionnel est le montant encaissé sur les lignes en promotion, net de remise : ce n'est pas un bénéfice.",
  };
}

export type Reco = { id: string; kind: string; title: string; why: string; data: Record<string, string | number>; limits: string; prefill?: { family?: string; name?: string; productIds?: string[]; comboProductIds?: string[] } };
/** Recommandations (Pro) : suggestions justifiées par des données réelles de la boutique, avec leurs limites. Jamais créées ni activées automatiquement : le gérant décide. */
export async function promotionRecommendations(store: Store, ctx: Ctx) {
  needModule(ctx, "stock"); need(ctx, "manager"); await needFeature(store, ctx, "promotionsPro");
  const where = { tenantId: ctx.tenantId, shopId: ctx.shopId }; const now = new Date(); const from60 = new Date(now.getTime() - 60 * DAY).toISOString();
  const shop = await store.get("shops", ctx.shopId.slice(0, 36)); const tz = tzOf(shop); const shopMin = Number(shop?.minMarginPct ?? 0);
  const [prods, moves, sales, promoRows] = await Promise.all([store.scan("products", where, { maxRows: 10_000 }), store.scan("stock_moves", where, { maxRows: 100_000 }), store.scan("sales", where, { range: { field: "soldAt", from: from60 }, maxRows: 20_000 }), store.scan("promotions", where, { maxRows: 5000 })]);
  const out: Reco[] = []; const limitsData = "Basé sur les 60 derniers jours de ventes de cette boutique ; ne tient pas compte de la saisonnalité, des ruptures passées ni des arrivages à venir.";
  const paid = sales.rows.filter((s) => s.status === "paid"); const sold = new Map<string, { qty: number; last: string }>(); const baskets: string[][] = [];
  for (const s of paid) { const lines = J<{ productId: string; qty: number }[]>(s.lines, []); const set = new Set<string>(); for (const l of lines) { const a = sold.get(l.productId) ?? { qty: 0, last: "" }; a.qty += Number(l.qty ?? 0); if (String(s.soldAt) > a.last) a.last = String(s.soldAt); sold.set(l.productId, a); set.add(l.productId); } baskets.push([...set]); }
  const byProd = new Map<string, StockMove[]>(); for (const m of moves.rows) { const mv = { productId: String(m.productId), qty: Number(m.qty), kind: m.kind as StockMove["kind"] }; (byProd.get(mv.productId) ?? byProd.set(mv.productId, []).get(mv.productId)!).push(mv); }
  const partial = moves.truncated || prods.truncated; const pname = new Map(prods.rows.map((p) => [String(p.$id), String(p.name)]));
  const eligible = prods.rows.filter((p) => !p.archived && !p.hasVariants && !isVirtualBundle(p));
  if (!partial) {
    const stocks = eligible.map((p) => ({ p, stock: fromScaled(stockOf(byProd.get(String(p.$id)) ?? []), scaleOf(p)) })).filter((x) => x.stock > 0);
    const old = (p: Row) => !p.$createdAt || now.getTime() - Date.parse(String(p.$createdAt)) >= 60 * DAY;
    const low = stocks.filter((x) => !sold.has(String(x.p.$id)) && old(x.p)).sort((a, b) => b.stock * Number(b.p.cost ?? b.p.price) - a.stock * Number(a.p.cost ?? a.p.price)).slice(0, 8);
    for (const x of low) out.push({ id: `low:${x.p.$id}`, kind: "low_rotation", title: `Faible rotation : ${x.p.name}`, why: `${x.p.name} a ${x.stock} en stock et aucune vente en 60 jours.`, data: { stock: x.stock, ventes60j: 0, valeurStockAuCoût: Number(x.p.cost) > 0 ? Math.round(x.stock * Number(x.p.cost)) : "coût inconnu" }, limits: limitsData, prefill: { family: "simple", name: `Déstockage ${x.p.name}`.slice(0, 60), productIds: [String(x.p.$id)] } });
    const over = stocks.map((x) => ({ ...x, s: sold.get(String(x.p.$id)) })).filter((x) => x.s && x.s.qty > 0 && x.stock / (x.s.qty / 60) > 120).sort((a, b) => b.stock / b.s!.qty - a.stock / a.s!.qty).slice(0, 8);
    for (const x of over) out.push({ id: `over:${x.p.$id}`, kind: "overstock", title: `Surstock : ${x.p.name}`, why: `Au rythme des 60 derniers jours (${x.s!.qty} vendus), le stock de ${x.stock} couvre environ ${Math.round(x.stock / (x.s!.qty / 60))} jours.`, data: { stock: x.stock, vendus60j: x.s!.qty, joursDeCouverture: Math.round(x.stock / (x.s!.qty / 60)) }, limits: limitsData, prefill: { family: "tiers", name: `Prix dégressifs ${x.p.name}`.slice(0, 60), productIds: [String(x.p.$id)] } });
  }
  // campagnes
  const kidsFor = async (r: Row) => loadPromo(store, ctx, r); const usageAll = (await store.scan("promotion_usage", where, { maxRows: 100_000 })).rows; const uses = new Map<string, number>(); for (const u of usageAll) uses.set(String(u.promotionId), (uses.get(String(u.promotionId)) ?? 0) + 1);
  for (const r of promoRows.rows) {
    const eff = promoStatus({ status: r.status, startAt: String(r.startAt), endAt: String(r.endAt) }, now); if (eff !== "active") continue;
    const left = Date.parse(String(r.endAt)) - now.getTime(); const n = uses.get(r.$id) ?? 0; const age = now.getTime() - Date.parse(String(r.startAt));
    if (left <= 3 * DAY) out.push({ id: `exp:${r.$id}`, kind: "expiring", title: `Campagne bientôt terminée : ${r.name}`, why: `« ${r.name} » se termine dans ${Math.max(1, Math.ceil(left / 3_600_000))} h avec ${n} utilisation(s).`, data: { utilisations: n, fin: new Date(String(r.endAt)).toISOString() }, limits: "Prolonger n'est utile que si la campagne a produit des résultats : voir l'analyse de performance." });
    if (age >= 7 * DAY && n <= 2) out.push({ id: `little:${r.$id}`, kind: "little_used", title: `Peu utilisée : ${r.name}`, why: `« ${r.name} » est active depuis ${Math.floor(age / DAY)} jours pour ${n} utilisation(s).`, data: { jours: Math.floor(age / DAY), utilisations: n }, limits: "Peut venir d'un ciblage trop étroit (articles, clients, coupon exigé), d'un stock absent ou d'une remise peu attractive ; vérifiez les décisions du moteur." });
  }
  const lowBy = new Map<string, number>(); for (const u of usageAll) if (Date.parse(String(u.usedAt)) >= now.getTime() - 30 * DAY) for (const l of J<UsageLine[]>(u.lines, [])) if (l.cost && l.cost > 0) { const fin = Number(l.base ?? 0) - Number(l.discount ?? 0); const m = J<{ minMarginPct?: number }>(u.rules, {}).minMarginPct ?? shopMin; if ((fin - l.cost) / l.cost * 100 < m) lowBy.set(String(u.promotionId), (lowBy.get(String(u.promotionId)) ?? 0) + 1); }
  for (const [id, n] of lowBy) { const r = promoRows.rows.find((x) => x.$id === id); if (r) out.push({ id: `margin:${id}`, kind: "low_margin", title: `Marge insuffisante : ${r.name}`, why: `${n} ligne(s) vendues en promotion sous la marge minimale en 30 jours.`, data: { lignes: n, margeMinimale: shopMin }, limits: "Seules les lignes dont le coût de revient est connu sont évaluées." }); }
  // ventes liées : paires achetées ensemble sans offre de pack
  const pairs = new Map<string, number>(); for (const bk of baskets) { const s = [...bk].sort(); for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) pairs.set(`${s[i]}|${s[j]}`, (pairs.get(`${s[i]}|${s[j]}`) ?? 0) + 1); }
  const packs = await Promise.all(promoRows.rows.filter((r) => r.family === "combo" && r.status !== "ended").map(kidsFor)); const covered = (a: string, b: string) => packs.some((p) => (p.comboItems ?? []).some((c) => c.key === a) && (p.comboItems ?? []).some((c) => c.key === b));
  for (const [k, n] of [...pairs].filter(([, n]) => n >= 5).sort((a, b) => b[1] - a[1]).slice(0, 5)) { const [a, b] = k.split("|") as [string, string]; if (covered(a, b)) continue; out.push({ id: `cross:${k}`, kind: "cross_sell", title: `Vente liée : ${pname.get(a) ?? a} + ${pname.get(b) ?? b}`, why: `Ces deux articles figurent ensemble dans ${n} tickets sur ${paid.length} en 60 jours.`, data: { ticketsEnsemble: n, tickets60j: paid.length }, limits: "Une corrélation d'achat n'implique pas qu'un pack augmentera les ventes.", prefill: { family: "combo", name: `Pack ${pname.get(a) ?? ""} + ${pname.get(b) ?? ""}`.slice(0, 60), comboProductIds: [a, b] } }); }
  // périodes de forte demande (jours de semaine), seulement avec assez d'historique
  const first = paid.reduce((m, s) => Math.min(m, Date.parse(String(s.soldAt))), Infinity);
  if (paid.length >= 30 && now.getTime() - first >= 28 * DAY) { const wd = new Map<number, number>(); const WD = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"]; for (const s of paid) { const d = new Date(`${utcToZoned(new Date(String(s.soldAt)).toISOString(), tz).slice(0, 10)}T12:00:00Z`).getUTCDay(); wd.set(d, (wd.get(d) ?? 0) + 1); }
    const avg = paid.length / 7; const hot = [...wd].filter(([, n]) => n > avg * 1.25).sort((a, b) => b[1] - a[1]); if (hot.length) out.push({ id: "demand:weekday", kind: "high_demand", title: `Forte demande : ${hot.map(([d]) => WD[d]).join(", ")}`, why: `${hot.map(([d, n]) => `${WD[d]} ${n} ventes`).join(", ")} sur 60 jours (moyenne ${pct1(avg)} par jour de semaine).`, data: { ventes60j: paid.length, moyenneParJour: pct1(avg) }, limits: "Motif observé sur peu de semaines ; une promotion les jours de forte demande peut surtout rogner la marge sans créer de ventes en plus." }); }
  else out.push({ id: "demand:insufficient", kind: "info", title: "Périodes de forte demande : historique insuffisant", why: "Il faut au moins 4 semaines et 30 ventes pour repérer un rythme.", data: { ventes60j: paid.length }, limits: "Aucune recommandation n'est produite sans données suffisantes." });
  if (partial) out.push({ id: "partial", kind: "info", title: "Stock non évalué", why: "L'historique de mouvements est trop volumineux pour être lu en entier : les recommandations de stock sont omises plutôt qu'approximatives.", data: {}, limits: "" });
  return { recommendations: out, generatedAt: now.toISOString(), note: "Suggestions fondées sur vos données réelles. Rien n'est créé ni activé automatiquement." };
}

/** Journal d'audit des promotions et coupons de la boutique (création, modification, activation, suspension, coupons, réglages), le plus récent d'abord. */
export async function promotionJournal(store: Store, ctx: Ctx, b: { limit?: number } = {}) {
  needModule(ctx, "stock"); need(ctx, "manager"); await needFeature(store, ctx, "promotions");
  const lim = Math.min(500, Math.max(20, Math.floor(Number(b.limit ?? 200)) || 200));
  const [log, staff] = await Promise.all([store.scan("audit_log", { tenantId: ctx.tenantId, shopId: ctx.shopId }, { maxRows: 50_000 }), store.scan("staff", { tenantId: ctx.tenantId }, { maxRows: 500 })]);
  const who = new Map(staff.rows.map((s) => [String(s.userId), String(s.name)]));
  const entries = log.rows.filter((r) => /^(promotion|coupon)/.test(String(r.action))).sort((a, c) => String(c.$createdAt ?? c.createdOn ?? "").localeCompare(String(a.$createdAt ?? a.createdOn ?? ""))).slice(0, lim).map((r) => ({ at: String(r.$createdAt ?? ""), action: String(r.action), detail: String(r.detail ?? ""), user: who.get(String(r.userId)) ?? String(r.userId ?? "") }));
  return { entries, truncated: log.truncated };
}
export { familyOf };
