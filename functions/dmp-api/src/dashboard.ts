import { createHash } from "node:crypto";
import { ALERT_LABEL, alertKey, buildAlerts, type Alert, type LotItem, type PriceItem, type StockItem } from "../../../src/domain/alerts";
import { bundleAvailable } from "../../../src/domain/bundles";
import { aggregateProfit, type ProfitRow } from "../../../src/domain/costing";
import { fromScaled, scaleOf } from "../../../src/domain/quantity";
import { stockOf, type StockMove } from "../../../src/domain/stock";
import { kindOf } from "../../../src/domain/bundles";
import { trackingOf } from "../../../src/domain/tracking";
import { needFeature } from "./articles";
import { HttpError, needModule, type Ctx, type Row, type Store } from "./store";

const MAX_MOVES = 100_000, MAX_SALES = 20_000;
const parse = <T,>(s: unknown, fb: T): T => { try { return JSON.parse(String(s)) as T; } catch { return fb; } };
const alertRowId = (key: string) => `x${createHash("sha1").update(key).digest("hex").slice(0, 30)}`;

/** Tableau de bord Articles (Pro) : indicateurs réels de la boutique active, alertes du jour persistées (une ligne par type/objet/jour : dédupliquées, traçables, accusées de lecture).
 *  Si l'historique de mouvements est trop volumineux pour être lu en entier, les chiffres de stock sont omis (`partial`) plutôt que faux. Lecture + enregistrement des alertes du jour. */
export async function articleDashboard(store: Store, ctx: Ctx, b: { days?: number } = {}) {
  needModule(ctx, "stock"); await needFeature(store, ctx, "dashboard");
  const days = Math.min(90, Math.max(7, Math.floor(Number(b.days ?? 30)) || 30)); const now = new Date(); const day = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - (days - 1) * 864e5).toISOString().slice(0, 10);
  const where = { tenantId: ctx.tenantId, shopId: ctx.shopId };
  const [products, variants, moves, lotsRows, comps, sales] = await Promise.all([
    store.scan("products", where, { maxRows: 10_000 }), store.scan("article_variants", where, { maxRows: 20_000 }), store.scan("stock_moves", where, { maxRows: MAX_MOVES }),
    store.scan("article_lots", where, { maxRows: 20_000 }), store.scan("article_components", where, { maxRows: 20_000 }),
    store.scan("sales", where, { range: { field: "soldAt", from: `${from}T00:00:00.000Z`, to: new Date(now.getTime() + 864e5).toISOString().slice(0, 10) + "T00:00:00.000Z" }, maxRows: MAX_SALES }),
  ]);
  const partial = moves.truncated || products.truncated;
  const live = products.rows.filter((p) => !p.archived);
  const byProduct = new Map<string, StockMove[]>(), byVariant = new Map<string, StockMove[]>(), byLot = new Map<string, StockMove[]>();
  for (const m of moves.rows) {
    const mv = { productId: String(m.productId), qty: Number(m.qty), kind: m.kind as StockMove["kind"] };
    const [map, k] = m.variantId ? [byVariant, String(m.variantId)] : [byProduct, String(m.productId)];
    (map.get(k) ?? map.set(k, []).get(k)!).push(mv);
    if (m.lotId) (byLot.get(String(m.lotId)) ?? byLot.set(String(m.lotId), []).get(String(m.lotId))!).push(mv);
  }
  const qtyP = (p: Row) => fromScaled(stockOf(byProduct.get(String(p.$id)) ?? []), scaleOf(p));
  const stockItems: StockItem[] = []; const lots: LotItem[] = []; const prices: PriceItem[] = [];
  let stockValue = 0, bundles = 0, simple = 0;
  const compsBy = new Map<string, { productId: string; qty: number }[]>();
  for (const c of comps.rows) compsBy.set(String(c.bundleId), [...(compsBy.get(String(c.bundleId)) ?? []), { productId: String(c.componentId), qty: Number(c.qty) }]);
  if (!partial) {
    for (const p of live) {
      const name = String(p.name);
      if (kindOf(p) === "bundle") { bundles++; stockItems.push({ productId: p.$id, label: name, qty: bundleAvailable(compsBy.get(p.$id) ?? [], (id) => stockOf(byProduct.get(id) ?? [])), minStock: Number(p.minStock ?? 0), bundle: true }); continue; }
      simple++;
      if (!p.hasVariants) {
        const n = qtyP(p);
        if (trackingOf(p) === "lot") { for (const l of lotsRows.rows.filter((x) => x.productId === p.$id && !(x.variantId))) { const q = fromScaled(stockOf(byLot.get(l.$id) ?? []), scaleOf(p)); stockValue += Math.max(0, q) * Number(l.unitCost || p.cost || 0); } }
        else stockValue += Math.max(0, n) * Number(p.cost ?? 0);
        stockItems.push({ productId: p.$id, label: name, qty: n, minStock: Number(p.minStock ?? 0) });
        prices.push({ productId: p.$id, label: name, price: Number(p.price), cost: Number(p.cost ?? 0) });
      }
    }
    for (const v of variants.rows.filter((x) => !x.archived)) {
      const p = live.find((x) => x.$id === v.productId); if (!p?.hasVariants) continue;
      const n = fromScaled(stockOf(byVariant.get(v.$id) ?? []), scaleOf(p)); const label = `${p.name} — ${v.label}`;
      stockValue += Math.max(0, n) * Number(v.cost ?? 0); stockItems.push({ productId: p.$id, variantId: v.$id, label, qty: n, minStock: Number(v.minStock ?? 0) });
      prices.push({ productId: p.$id, variantId: v.$id, label, price: Number(v.price), cost: Number(v.cost ?? 0) });
    }
    for (const l of lotsRows.rows) {
      const p = live.find((x) => x.$id === l.productId); if (!p) continue;
      lots.push({ lotId: l.$id, productId: p.$id, lotNo: String(l.lotNo), label: String(p.name), qty: fromScaled(stockOf(byLot.get(l.$id) ?? []), scaleOf(p)), expiresAt: l.expiresAt ? String(l.expiresAt) : null });
    }
  }
  // Alertes du jour : identifiant déterministe → une ligne par (type, objet, jour), créée une seule fois ; l'accusé de lecture est conservé.
  const stored = new Map((await store.list("article_alerts", { ...where, day }, 500)).map((r) => [r.$id, r]));
  const alerts: (Alert & { status: string })[] = [];
  for (const a of buildAlerts({ day, stock: stockItems, lots, prices })) {
    const id = alertRowId(alertKey(a.type, a.refId, day)); let row = stored.get(id);
    if (!row) { await store.create("article_alerts", id, ctx.tenantId, { ...where, day, type: a.type, productId: a.productId, refId: a.refId, severity: a.severity, label: a.label.slice(0, 255), detail: a.detail.slice(0, 500), status: "open" }); row = await store.get("article_alerts", id) ?? undefined; }
    alerts.push({ ...a, id, status: String(row?.status ?? "open") });
  }
  // Ventes : meilleurs articles par chiffre d'affaires et par marge sur la période (coût figé à chaque vente ; jamais de marge inventée).
  const info = Object.fromEntries(products.rows.map((p) => [p.$id, { category: String(p.category ?? ""), name: String(p.name) }]));
  const agg = aggregateProfit(sales.rows.map((r) => ({ total: Number(r.total), vat: Number(r.vat ?? 0), status: String(r.status), soldAt: String(r.soldAt), lines: parse(r.lines, []) })), { from, to: day }, info);
  const slim = (r: ProfitRow) => ({ key: r.key, name: r.name, qty: r.qty, revenueHt: r.revenueHt, margin: r.margin, marginPct: r.marginPct, costedPct: r.costedPct });
  const byRevenue = [...agg.items].sort((a, b) => b.revenueHt - a.revenueHt).slice(0, 5).map(slim);
  const byMargin = agg.items.filter((r) => r.costedPct >= 50 && r.margin > 0).slice(0, 5).map(slim);
  const count = (t: string) => alerts.filter((a) => a.type === t).length;
  return {
    day, period: { from, to: day, days }, partial, truncatedSales: sales.truncated,
    kpis: partial ? null : { articles: simple, bundles, variants: variants.rows.filter((v) => !v.archived).length, stockValue: Math.round(stockValue), out: count("stock_out"), low: count("stock_low"), expired: count("lot_expired"), expiring: count("lot_expiring"), negativeMargin: count("margin_negative"), bundlesBlocked: count("bundle_blocked") },
    alerts: alerts.map((a) => ({ ...a, typeLabel: ALERT_LABEL[a.type] })), top: { byRevenue, byMargin },
  };
}

/** Accuse lecture d'une alerte (ou de toutes celles du jour) : conserve qui et quand. */
export async function ackAlerts(store: Store, ctx: Ctx, b: { id?: string; all?: boolean }) {
  needModule(ctx, "stock"); await needFeature(store, ctx, "dashboard");
  const day = new Date().toISOString().slice(0, 10); let n = 0;
  const targets = b.all ? await store.list("article_alerts", { tenantId: ctx.tenantId, shopId: ctx.shopId, day, status: "open" }, 500) : [await store.get("article_alerts", String(b.id ?? ""))];
  for (const r of targets) {
    if (!r) throw new HttpError(404, "Alerte introuvable");
    if (r.tenantId !== ctx.tenantId || r.shopId !== ctx.shopId) throw new HttpError(403, "Accès refusé");
    if (r.status !== "read") { await store.update("article_alerts", r.$id, { status: "read", readBy: ctx.userId, readAt: new Date().toISOString() }); n++; }
  }
  return { acknowledged: n };
}
