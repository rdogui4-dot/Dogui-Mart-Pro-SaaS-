import { aggregateSales, mergeAggregates, parsePeriod, type SaleRow, type SalesAggregate } from "../../../src/domain/reports";
import { stockOf, type StockMove } from "../../../src/domain/stock";
import { fromScaled, scaleOf } from "../../../src/domain/quantity";
import { trackingOf } from "../../../src/domain/tracking";
import { HttpError, roleOf, type Ctx, type Store, needModule } from "./store";

const parse = <T,>(s: unknown, fb: T): T => { try { return JSON.parse(String(s)) as T; } catch { return fb; } };
const MAX_SALES = 20_000;      // lignes de vente lues par boutique et par rapport
const MAX_MOVES = 100_000;     // mouvements de stock lus par boutique pour valoriser le stock

/** Rapport consolidé sur une période : propriétaire = toutes les boutiques ; gérant = ses boutiques ; caissier = refusé.
 *  Lecture seule (autorisée même abonnement expiré). Les volumes sont bornés : si une borne est atteinte, la boutique est marquée « tronquée »
 *  et le chiffre concerné n'est pas affiché plutôt que faux. */
export async function consolidatedReport(store: Store, ctx: Ctx, b: { from: string; to: string }) {
  const role = roleOf(ctx.roles);
  needModule(ctx, "reports");
  const period = parsePeriod(b.from, b.to); if (!period.ok) throw new HttpError(400, period.error);
  const all = await store.list("shops", { tenantId: ctx.tenantId }, 100);
  let allowed = all;
  if (role !== "owner") {
    const staff = await store.get("staff", ctx.userId);
    const ids: string[] = staff && staff.tenantId === ctx.tenantId && staff.active !== false ? parse(staff.shopIds, []) : [];
    allowed = all.filter((s) => ids.includes(String(s.$id)));
  }
  const perShop: { agg: SalesAggregate; row: Record<string, unknown> }[] = [];
  for (const shop of allowed) {
    const where = { tenantId: ctx.tenantId, shopId: String(shop.$id) };
    const [sales, products, moves, customers, invoices] = await Promise.all([
      store.scan("sales", where, { range: { field: "soldAt", from: period.gte, to: period.lt }, maxRows: MAX_SALES }),
      store.scan("products", where, { maxRows: 5_000 }), store.scan("stock_moves", where, { maxRows: MAX_MOVES }),
      store.scan("customers", where, { maxRows: 10_000 }), store.scan("invoices", where, { maxRows: 5_000 }),
    ]);
    const barcodes = Object.fromEntries(products.rows.filter((p) => p.barcode).map((p) => [String(p.$id), String(p.barcode)]));
    const rows: SaleRow[] = sales.rows.map((r) => ({ total: Number(r.total), vat: Number(r.vat ?? 0), soldAt: String(r.soldAt), status: String(r.status), payments: parse(r.payments, []), lines: parse(r.lines, []) }));
    const agg = aggregateSales(rows, { from: period.from, to: period.to }, barcodes);
    // Stock valorisé au coût moyen et ruptures : impossibles à calculer honnêtement si l'historique a été tronqué.
    let stockValue: number | null = null, stockouts: number | null = null;
    if (!moves.truncated && !products.truncated) {
      const byProduct = new Map<string, StockMove[]>(), byVariant = new Map<string, StockMove[]>(), byLot = new Map<string, StockMove[]>();
      for (const m of moves.rows) {
        const mv = { productId: String(m.productId), qty: Number(m.qty), kind: m.kind as StockMove["kind"] };
        const [map, k] = m.variantId ? [byVariant, String(m.variantId)] : [byProduct, String(m.productId)];
        (map.get(k) ?? map.set(k, []).get(k)!).push(mv);
        if (m.lotId) (byLot.get(String(m.lotId)) ?? byLot.set(String(m.lotId), []).get(String(m.lotId))!).push(mv);
      }
      // Articles suivis par lot : valorisés au coût de chaque lot (coût de revient de sa réception) ; le coût de l'article sert de repli.
      const lotRows = (await store.scan("article_lots", where, { maxRows: 20_000 })).rows;
      const lotValue = (productId: string, variantId: string, scale: number, fallback: number) => lotRows.filter((l) => l.productId === productId && String(l.variantId ?? "") === variantId).reduce((a, l) => a + Math.max(0, fromScaled(stockOf(byLot.get(String(l.$id)) ?? []), scale)) * (Number(l.unitCost) > 0 ? Number(l.unitCost) : fallback), 0);
      stockValue = 0; stockouts = 0;
      const productRows = products.rows.filter((x) => !x.archived);
      for (const p of productRows.filter((x) => !x.hasVariants)) {
        const n = fromScaled(stockOf(byProduct.get(String(p.$id)) ?? []), scaleOf(p)); // décimal pour les articles au kilo / au litre
        stockValue += trackingOf(p) === "lot" ? lotValue(String(p.$id), "", scaleOf(p), Number(p.cost ?? 0)) : Math.max(0, n) * Number(p.cost ?? 0);
        if (n <= Number(p.minStock ?? 0)) stockouts++;
      }
      // Articles déclinés : chaque variante active a son stock, son coût et son seuil.
      const variants = await store.scan("article_variants", where, { maxRows: 20_000 });
      const live = new Set(productRows.filter((x) => x.hasVariants).map((x) => String(x.$id)));
      for (const v of variants.rows.filter((x) => !x.archived && live.has(String(x.productId)))) {
        const n = fromScaled(stockOf(byVariant.get(String(v.$id)) ?? []), scaleOf(products.rows.find((x) => x.$id === v.productId)));
        const parent = products.rows.find((x) => x.$id === v.productId);
        stockValue += trackingOf(parent) === "lot" ? lotValue(String(v.productId), String(v.$id), scaleOf(parent), Number(v.cost ?? 0)) : Math.max(0, n) * Number(v.cost ?? 0);
        if (n <= Number(v.minStock ?? 0)) stockouts++;
      }
    }
    const sum = (rs: Record<string, unknown>[], f: (r: Record<string, unknown>) => number) => rs.reduce((s, r) => s + f(r), 0);
    const customerInv = invoices.rows.filter((i) => i.kind === "customer"), supplierInv = invoices.rows.filter((i) => i.kind === "supplier");
    perShop.push({ agg, row: {
      id: String(shop.$id), name: String(shop.name ?? shop.$id),
      openCredit: sum(customers.rows, (c) => Number(c.creditBalance ?? 0)),
      receivables: sum(customerInv, (i) => Math.max(0, Number(i.total) - Number(i.paid ?? 0))),
      payables: sum(supplierInv, (i) => Math.max(0, Number(i.total) - Number(i.paid ?? 0))),
      stockValue, stockouts, truncated: { sales: sales.truncated, stock: moves.truncated || products.truncated },
    } });
  }
  const merged = mergeAggregates(perShop.map((p) => p.agg), { from: period.from, to: period.to });
  const rowsOnly = perShop.map((p) => p.row);
  const total = (k: string) => rowsOnly.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const stockKnown = rowsOnly.every((r) => r.stockValue !== null);
  const { daily, products: topAll, ...totals } = merged;
  const strip = ({ daily: _d, products: _p, ...rest }: SalesAggregate) => rest;
  return {
    period: { from: period.from, to: period.to, days: period.days, note: "Jours en heure UTC" },
    shops: perShop.map((p) => ({ ...p.row, ...strip(p.agg) })),
    totals: { ...totals, openCredit: total("openCredit"), receivables: total("receivables"), payables: total("payables"), stockValue: stockKnown ? total("stockValue") : null, stockouts: stockKnown ? total("stockouts") : null },
    daily, topProducts: topAll.slice(0, 10), partial: rowsOnly.some((r) => (r.truncated as { sales: boolean }).sales),
  };
}
