import { earnedPoints, redeemablePoints, tierFor } from "../../../src/domain/loyalty";
import { lineTotal } from "../../../src/domain/money";
import { DEFAULT_TIMEZONE, isTimezone, utcToZoned } from "../../../src/domain/promotions";
import { needFeature } from "./articles";
import { checkout, stockFor, type CheckoutInput } from "./checkout";
import { hasRight, needRight, voucherByCode } from "./pos-pro";
import { HttpError, needModule, type Ctx, type Row, type Store } from "./store";

const DAY = 864e5;
const parse = <T,>(s: unknown, fb: T): T => { try { const v = JSON.parse(String(s)); return v ?? fb; } catch { return fb; } };
const iso = (v: unknown): string => { const t = Date.parse(String(v)); return Number.isNaN(t) ? "" : new Date(t).toISOString(); };
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) : 0; };
type L = { productId: string; variantId?: string; name: string; qty: number; unitPrice: number; discountPct?: number; amount?: number; baseAmount?: number; unitCost?: number; unit?: string };
const linesOf = (s: Row) => parse<L[]>(s.lines, []);
const MIN_SUPPORT = 3;

async function recentSales(store: Store, ctx: Ctx, days: number, max = 4000) {
  const from = new Date(Date.now() - days * DAY).toISOString(); const to = new Date(Date.now() + DAY).toISOString();
  return (await store.scan("sales", { tenantId: ctx.tenantId, shopId: ctx.shopId, status: "paid" }, { range: { field: "soldAt", from, to }, maxRows: max })).rows;
}

/** Suggestions de vente — uniquement tirées de l'historique RÉEL de cette boutique (90 jours) : articles achetés avec ceux du panier, habitudes du client, quantité habituelle. Chaque suggestion indique le nombre de ventes sur lequel elle repose ; sous 3 ventes, rien n'est suggéré. */
export async function suggest(store: Store, ctx: Ctx, b: { productIds?: string[]; customerId?: string }) {
  needModule(ctx, "pos"); await needFeature(store, ctx, "smartPosPro");
  const cart = new Set((Array.isArray(b.productIds) ? b.productIds : []).map(String).slice(0, 50)); const sales = await recentSales(store, ctx, 90); const basis = { sales: sales.length, days: 90 };
  const withCart = cart.size ? sales.filter((s) => linesOf(s).some((l) => cart.has(l.productId))) : []; const co = new Map<string, { n: number; name: string; with: Set<string> }>();
  for (const s of withCart) { const ls = linesOf(s); const mine = ls.filter((l) => cart.has(l.productId)).map((l) => l.productId); for (const l of ls) if (!cart.has(l.productId)) { const a = co.get(l.productId) ?? { n: 0, name: l.name, with: new Set<string>() }; a.n++; for (const m of mine) a.with.add(m); co.set(l.productId, a); } }
  const nameOf = new Map<string, string>(); for (const s of withCart) for (const l of linesOf(s)) nameOf.set(l.productId, l.name);
  const crossSell = [...co.entries()].filter(([, a]) => a.n >= MIN_SUPPORT).sort((a, c) => c[1].n - a[1].n).slice(0, 6).map(([productId, a]) => ({ productId, name: a.name, kind: "cross" as const, count: a.n, of: withCart.length, pct: Math.round((a.n / withCart.length) * 100), reason: `Acheté avec ${[...a.with].slice(0, 2).map((i) => `« ${nameOf.get(i) ?? "cet article"} »`).join(" et ")} dans ${a.n} vente${a.n > 1 ? "s" : ""} sur ${withCart.length} (${Math.round((a.n / withCart.length) * 100)} %)` }));
  let favorites: typeof crossSell = [];
  if (b.customerId) { const cu = await store.get("customers", b.customerId); if (cu && cu.tenantId === ctx.tenantId && cu.shopId === ctx.shopId) { const mine = sales.filter((s) => s.customerId === b.customerId); const cnt = new Map<string, { n: number; name: string }>(); for (const s of mine) for (const l of linesOf(s)) if (!cart.has(l.productId)) { const a = cnt.get(l.productId) ?? { n: 0, name: l.name }; a.n++; cnt.set(l.productId, a); }
    favorites = [...cnt.entries()].filter(([, a]) => a.n >= 2).sort((a, c) => c[1].n - a[1].n).slice(0, 4).map(([productId, a]) => ({ productId, name: a.name, kind: "cross" as const, count: a.n, of: mine.length, pct: Math.round((a.n / mine.length) * 100), reason: `Habitude de ce client : acheté dans ${a.n} de ses ${mine.length} achats` })); } }
  let top: typeof crossSell = []; if (!cart.size && !favorites.length) { const cnt = new Map<string, { n: number; name: string }>(); for (const s of sales.filter((x) => Date.parse(iso(x.soldAt)) > Date.now() - 30 * DAY)) for (const l of linesOf(s)) { const a = cnt.get(l.productId) ?? { n: 0, name: l.name }; a.n++; cnt.set(l.productId, a); }
    top = [...cnt.entries()].filter(([, a]) => a.n >= MIN_SUPPORT).sort((a, c) => c[1].n - a[1].n).slice(0, 6).map(([productId, a]) => ({ productId, name: a.name, kind: "cross" as const, count: a.n, of: 0, pct: 0, reason: `Parmi les plus vendus : ${a.n} ventes en 30 jours` })); }
  const seen = new Set<string>(); const items = [...favorites, ...crossSell, ...top].filter((x) => !seen.has(x.productId) && seen.add(x.productId)).slice(0, 8);
  const out = [];
  for (const it of items) { const p = await store.get("products", it.productId); if (!p || p.tenantId !== ctx.tenantId || p.active === false || p.archived === true) continue; const stock = await stockFor(store, p.$id); if (stock <= 0) continue; out.push({ ...it, price: Number(p.price), stock }); }
  const quantities = []; for (const pid of cart) { const q: number[] = []; const units = new Map<string, number>(); for (const s of sales) for (const l of linesOf(s)) if (l.productId === pid) { q.push(Number(l.qty)); if (l.unit) units.set(l.unit, (units.get(l.unit) ?? 0) + 1); } if (q.length >= 5) quantities.push({ productId: pid, typicalQty: median(q), sales: q.length, topUnit: [...units.entries()].sort((a, c) => c[1] - a[1])[0]?.[0] ?? "", reason: `Quantité habituelle ${median(q)} (médiane de ${q.length} ventes)` }); }
  return { items: out, quantities, basedOn: basis, note: out.length ? "Suggestions tirées de vos ventes réelles ; ce ne sont pas des certitudes." : basis.sales < MIN_SUPPORT ? "Pas encore assez d'historique de ventes pour suggérer." : "Aucune association assez fréquente (3 ventes minimum) pour ce panier." };
}

/** Simulation AVANT validation : exactement le calcul d'une vente (prix, promotions, remises, marges, droits) sans rien écrire. Renvoie les alertes (bloquantes ou non). */
export async function simulate(store: Store, ctx: Ctx, b: CheckoutInput) {
  needModule(ctx, "pos"); await needFeature(store, ctx, "smartPosPro");
  try {
    const r = await checkout(store, ctx, { ...b, dryRun: true, payments: [] }) as unknown as { needsApproval: { discount: boolean; margin: boolean }; margin: { alerts: { index: number; name: string; level: string; marginPct: number | null; thresholdPct: number }[] }; total: number; fp: string };
    const alerts: { level: "block" | "warn"; code: string; message: string }[] = [];
    for (const a of r.margin.alerts) alerts.push({ level: r.needsApproval.margin ? "block" : "warn", code: a.level, message: a.level === "below_cost" ? `${a.name} : vendu sous le coût d'achat` : `${a.name} : marge ${a.marginPct} % sous le seuil de ${a.thresholdPct} %` });
    if (r.needsApproval.discount) alerts.push({ level: "block", code: "discount", message: "Remise manuelle : votre droit ne la permet pas, l'approbation d'un responsable est nécessaire" });
    return { ok: true as const, ...r, alerts };
  } catch (e) { if (e instanceof HttpError) return { ok: false as const, status: e.status, blocked: e.message, alerts: [{ level: "block" as const, code: e.message.startsWith("APPROBATION") ? "approval" : "stock", message: e.message.replace(/^APPROBATION_REQUISE:[a-z]+:[0-9a-f]* — /, "") }] }; throw e; }
}

/** Profil client enrichi : historique, statistiques, fidélité, bons d'achat ; le crédit n'apparaît que si une limite de crédit est accordée à ce client. */
export async function customerProfile(store: Store, ctx: Ctx, b: { customerId?: string; code?: string }) {
  needModule(ctx, "pos"); await needFeature(store, ctx, "smartPosPro");
  const c = await store.get("customers", String(b.customerId ?? "")); if (!c || c.tenantId !== ctx.tenantId || c.shopId !== ctx.shopId) throw new HttpError(404, "Client introuvable");
  const sales = (await store.scan("sales", { tenantId: ctx.tenantId, shopId: ctx.shopId, customerId: c.$id }, { maxRows: 2000 })).rows.sort((a, d) => iso(d.soldAt).localeCompare(iso(a.soldAt))); const paid = sales.filter((s) => s.status === "paid" || s.status === "refunded");
  const total = paid.reduce((a, s) => a + Number(s.total), 0); const dates = paid.map((s) => Date.parse(iso(s.soldAt))).sort((a, d) => a - d); const gaps = dates.slice(1).map((t, i) => (t - dates[i]!) / DAY);
  const cnt = new Map<string, { n: number; name: string; qty: number }>(); for (const s of paid) for (const l of linesOf(s)) { const a = cnt.get(l.productId) ?? { n: 0, name: l.name, qty: 0 }; a.n++; a.qty += Number(l.qty); cnt.set(l.productId, a); }
  const last90 = paid.filter((s) => Date.parse(iso(s.soldAt)) > Date.now() - 90 * DAY).length; const regular = last90 >= 4;
  const vouchers = (await store.list("customer_vouchers", { tenantId: ctx.tenantId, customerId: c.$id, kind: "voucher" }, 50)); const vs = []; for (const v of vouchers) { const x = await voucherByCode(store, ctx, String(v.code)); if (x && x.status === "active" && x.balance > 0 && (!x.expiresAt || Date.parse(x.expiresAt) > Date.now())) vs.push({ code: x.code, balance: x.balance, expiresAt: x.expiresAt }); }
  const spend = Number(c.annualSpend ?? 0); const limit = Number(c.creditLimit ?? 0);
  return { id: c.$id, name: String(c.name), phone: String(c.phone ?? ""), category: String(c.category ?? ""), stats: { purchases: paid.length, total, avgBasket: paid.length ? Math.round(total / paid.length) : 0, lastPurchaseAt: dates.length ? new Date(dates[dates.length - 1]!).toISOString() : null, avgDaysBetween: gaps.length ? Math.round(median(gaps)) : null, last90 }, regular, regularRule: "Client régulier : au moins 4 achats sur les 90 derniers jours",
    loyalty: { points: Number(c.points ?? 0), tier: tierFor(spend), annualSpend: spend, nextEarn: (t: number) => earnedPoints(t, tierFor(spend)), redeemableForSample: redeemablePoints(Number(c.points ?? 0), 10000) },
    ...(limit > 0 ? { credit: { limit, balance: Number(c.creditBalance ?? 0), available: Math.max(0, limit - Number(c.creditBalance ?? 0)), alert: Number(c.creditBalance ?? 0) >= limit * 0.8 ? "Crédit presque atteint" : "" } } : {}),
    topItems: [...cnt.entries()].sort((a, d) => d[1].n - a[1].n).slice(0, 5).map(([productId, a]) => ({ productId, name: a.name, times: a.n, qty: a.qty })), vouchers: vs,
    history: sales.slice(0, 20).map((s) => ({ id: s.$id, number: String(s.number), total: Number(s.total), status: String(s.status), soldAt: iso(s.soldAt) })) };
}
const withoutFn = <T extends { loyalty: Record<string, unknown> }>(o: T) => { const { nextEarn: _n, ...rest } = o.loyalty; return { ...o, loyalty: rest }; };
export async function customerProfileSafe(store: Store, ctx: Ctx, b: { customerId?: string }) { return withoutFn(await customerProfile(store, ctx, b)); }

/** Intelligence commerciale : chiffres réels de la boutique, anomalies expliquées, prévision indicative (méthode, limites, fiabilité). Droit « valider ». */
export async function insights(store: Store, ctx: Ctx, b: { days?: number }) {
  needModule(ctx, "pos"); await needFeature(store, ctx, "smartPosPro"); await needRight(store, ctx, "approve");
  const days = Math.max(7, Math.min(90, Math.round(Number(b.days ?? 30)))); const shop = await store.get("shops", ctx.shopId.slice(0, 36)); const tz = shop?.promoTz && isTimezone(String(shop.promoTz)) ? String(shop.promoTz) : DEFAULT_TIMEZONE;
  const all = await recentSales(store, ctx, Math.max(days, 56), 20_000); const from = Date.now() - days * DAY; const sales = all.filter((s) => Date.parse(iso(s.soldAt)) >= from);
  const names = new Map<string, string>((await store.scan("staff", { tenantId: ctx.tenantId }, { maxRows: 500 })).rows.map((x) => [String(x.userId), String(x.name)])); try { for (const o of await store.listOwners(ctx.tenantId)) names.set(o.userId, o.name || "Propriétaire"); } catch { /* annuaire indisponible */ }
  let revenue = 0, gross = 0, discount = 0, costKnownRev = 0, costKnown = 0; const items = new Map<string, { name: string; qty: number; revenue: number }>(); const pairs = new Map<string, { a: string; b: string; n: number }>(); const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, sales: 0, total: 0 }));
  const sel = new Map<string, { userId: string; seller: string; count: number; total: number; gross: number; discount: number; refunds: number; cancels: number }>();
  for (const s of sales) { const ls = linesOf(s); const g = ls.reduce((a, l) => a + (l.baseAmount ?? Math.round(l.unitPrice * l.qty)), 0); const n = ls.reduce((a, l) => a + lineTotal(l as never), 0); revenue += Number(s.total); gross += g; const d = Math.max(0, g - n); discount += d;
    for (const l of ls) { const net = lineTotal(l as never); if (l.unitCost) { costKnownRev += net; costKnown += Math.round(l.unitCost * l.qty); } const a = items.get(l.productId) ?? { name: l.name, qty: 0, revenue: 0 }; a.qty += Number(l.qty); a.revenue += net; items.set(l.productId, a); }
    const ids = [...new Set(ls.map((l) => l.productId))].sort(); for (let i = 0; i < ids.length && i < 8; i++) for (let j = i + 1; j < ids.length && j < 8; j++) { const k = `${ids[i]}|${ids[j]}`; const a = pairs.get(k) ?? { a: ls.find((l) => l.productId === ids[i])!.name, b: ls.find((l) => l.productId === ids[j])!.name, n: 0 }; a.n++; pairs.set(k, a); }
    const h = Number(utcToZoned(iso(s.soldAt), tz).slice(11, 13)); hours[h]!.sales++; hours[h]!.total += Number(s.total);
    const e = sel.get(String(s.cashierId)) ?? { userId: String(s.cashierId), seller: names.get(String(s.cashierId)) ?? "", count: 0, total: 0, gross: 0, discount: 0, refunds: 0, cancels: 0 }; e.count++; e.total += Number(s.total); e.gross += g; e.discount += d; sel.set(e.userId, e); }
  const rets = (await store.scan("sale_returns", { tenantId: ctx.tenantId, shopId: ctx.shopId }, { range: { field: "at", from: new Date(from).toISOString(), to: new Date(Date.now() + DAY).toISOString() }, maxRows: 10_000 })).rows.filter((r) => r.status !== "failed");
  for (const r of rets) { const e = sel.get(String(r.userId)) ?? { userId: String(r.userId), seller: names.get(String(r.userId)) ?? "", count: 0, total: 0, gross: 0, discount: 0, refunds: 0, cancels: 0 }; if (r.kind === "cancel") e.cancels++; else e.refunds++; sel.set(e.userId, e); }
  const shopRate = gross > 0 ? discount / gross : 0; const anomalies: { level: "warn" | "info"; code: string; message: string; basis: string }[] = [];
  for (const e of sel.values()) { const rate = e.gross > 0 ? e.discount / e.gross : 0; if (e.count >= 5 && rate - shopRate >= 0.03 && rate >= shopRate * 2) anomalies.push({ level: "warn", code: "seller_discount", message: `${e.seller || "Un vendeur"} accorde ${(rate * 100).toFixed(1)} % de remise contre ${(shopRate * 100).toFixed(1)} % pour la boutique`, basis: `${e.count} ventes sur ${days} jours ; seuil : au moins 2× la moyenne et +3 points` }); const ops = e.refunds + e.cancels; if (ops >= 3 && ops / Math.max(1, e.count) >= 0.1) anomalies.push({ level: "warn", code: "seller_refunds", message: `${e.seller || "Un vendeur"} : ${ops} remboursements/annulations pour ${e.count} ventes`, basis: `seuil : au moins 3 opérations et 10 % des ventes` }); }
  const sess = (await store.scan("cash_sessions", { tenantId: ctx.tenantId, shopId: ctx.shopId }, { range: { field: "openedAt", from: new Date(from).toISOString(), to: new Date(Date.now() + DAY).toISOString() }, maxRows: 2000 })).rows.filter((s) => s.status === "closed"); const pend = sess.filter((s) => s.varianceStatus === "pending").length; if (pend) anomalies.push({ level: "warn", code: "variance_pending", message: `${pend} écart(s) de caisse à valider`, basis: "sessions fermées avec écart non validé" });
  const byUserVar = new Map<string, number>(); for (const s of sess) if (Number(s.variance ?? 0) !== 0) byUserVar.set(String(s.userId), (byUserVar.get(String(s.userId)) ?? 0) + 1); for (const [u, n] of byUserVar) if (n >= 2) anomalies.push({ level: "warn", code: "variance_streak", message: `${names.get(u) ?? "Un vendeur"} : ${n} sessions avec écart sur ${days} jours`, basis: "au moins 2 sessions avec écart non nul" });
  const neg = (await store.scan("audit_log", { tenantId: ctx.tenantId, shopId: ctx.shopId, action: "stock.negative" }, { maxRows: 200 })).rows.filter((r) => Date.parse(iso(r.$createdAt)) >= from).length; if (neg) anomalies.push({ level: "warn", code: "stock_negative", message: `${neg} vente(s) simultanée(s) ont rendu un stock négatif : vérifiez l'inventaire`, basis: "trace d'audit « stock.negative »" });
  // Comparaison avec le même jour de semaine (jusqu'à l'heure actuelle)
  const nowLocal = utcToZoned(new Date().toISOString(), tz); const hourNow = Number(nowLocal.slice(11, 13)); const dow = new Date(`${nowLocal.slice(0, 10)}T00:00:00Z`).getUTCDay(); const dayKey = (t: string) => utcToZoned(t, tz).slice(0, 10); const dowOf = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
  const perDay = new Map<string, { total: number; upToNow: number }>(); for (const s of all) { const t = iso(s.soldAt); const k = dayKey(t); const a = perDay.get(k) ?? { total: 0, upToNow: 0 }; a.total += Number(s.total); if (Number(utcToZoned(t, tz).slice(11, 13)) <= hourNow) a.upToNow += Number(s.total); perDay.set(k, a); }
  const today = nowLocal.slice(0, 10); const sameDow = [...perDay.entries()].filter(([k]) => k !== today && dowOf(k) === dow); const avgUp = sameDow.length ? sameDow.reduce((a, [, v]) => a + v.upToNow, 0) / sameDow.length : 0; const todayUp = perDay.get(today)?.upToNow ?? 0;
  if (sameDow.length >= 3 && avgUp > 0 && todayUp < avgUp * 0.5) anomalies.push({ level: "info", code: "sales_drop", message: `Ventes du jour (${todayUp.toLocaleString("fr-FR")} FCFA) inférieures de ${Math.round((1 - todayUp / avgUp) * 100)} % à la moyenne des mêmes jours à la même heure`, basis: `${sameDow.length} mêmes jours de semaine comparés` });
  // Prévision indicative : moyenne des mêmes jours de semaine passés
  const forecast = []; for (let i = 1; i <= 7; i++) { const d = new Date(Date.parse(`${today}T00:00:00Z`) + i * DAY); const k = d.toISOString().slice(0, 10); const hist = [...perDay.entries()].filter(([x]) => dowOf(x) === d.getUTCDay() && x < today).map(([, v]) => v.total); const mean = hist.length ? hist.reduce((a, c) => a + c, 0) / hist.length : 0; const sd = hist.length > 1 ? Math.sqrt(hist.reduce((a, c) => a + (c - mean) ** 2, 0) / (hist.length - 1)) : 0; const cv = mean > 0 ? sd / mean : 1;
    forecast.push({ day: k, expected: Math.round(mean), low: Math.max(0, Math.round(mean - sd)), high: Math.round(mean + sd), basedOn: hist.length, reliability: hist.length >= 6 && cv < 0.3 ? "élevée" : hist.length >= 3 && cv < 0.6 ? "moyenne" : "faible" }); }
  return { days, tz, totals: { sales: sales.length, revenue, avgBasket: sales.length ? Math.round(revenue / sales.length) : 0, discount, discountRate: gross > 0 ? Math.round((discount / gross) * 1000) / 10 : 0, estimatedMargin: costKnownRev - costKnown, marginCoveragePct: revenue > 0 ? Math.round((costKnownRev / revenue) * 100) : 0, perDay: Math.round((sales.length / days) * 10) / 10 },
    topItems: [...items.entries()].sort((a, c) => c[1].revenue - a[1].revenue).slice(0, 10).map(([productId, a]) => ({ productId, ...a })), associations: [...pairs.values()].filter((p) => p.n >= MIN_SUPPORT).sort((a, c) => c.n - a.n).slice(0, 8), busyHours: hours, sellers: [...sel.values()].map((e) => ({ ...e, avgBasket: e.count ? Math.round(e.total / e.count) : 0, discountRate: e.gross > 0 ? Math.round((e.discount / e.gross) * 1000) / 10 : 0 })).sort((a, c) => c.total - a.total), anomalies,
    forecast: { method: "Moyenne des ventes des mêmes jours de la semaine sur les 8 dernières semaines, avec écart-type", limits: "Ne tient pas compte des promotions, jours fériés, ruptures de stock ni de la météo ; indicatif, pas une certitude.", days: forecast },
    recommendations: [...(discount / Math.max(1, gross) > 0.1 ? [{ text: "Le taux de remise dépasse 10 % : vérifiez les promotions et remises manuelles les plus coûteuses.", basis: `taux ${(shopRate * 100).toFixed(1)} % sur ${days} jours` }] : []), ...(pend ? [{ text: "Validez les écarts de caisse en attente avant de les laisser vieillir.", basis: `${pend} session(s) concernée(s)` }] : [])],
    basedOn: { sales: sales.length, days }, note: "Tous les chiffres viennent des ventes enregistrées ; marge estimée sur les lignes dont le coût est connu." };
}
void hasRight;
