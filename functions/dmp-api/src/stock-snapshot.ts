import { stockOf, type StockMove } from "../../../src/domain/stock";
import { fromScaled, scaleOf } from "../../../src/domain/quantity";
import { trackingOf } from "../../../src/domain/tracking";
import { isVirtualBundle } from "../../../src/domain/bundles";
import type { Row, Store } from "./store";

export type StockItem = { productId: string; variantId?: string; name: string; qty: number; min: number };
export type StockSnapshot = { partial: boolean; value: number | null; stockouts: number | null; items: StockItem[]; products: Row[]; activeProducts: number };

/** État du stock d'une boutique, UNE seule définition partagée par les rapports et le tableau de bord (mêmes chiffres partout) :
 *  stock = somme des mouvements ; valeur = quantité × coût de la fiche (coût de revient selon la méthode configurée), lots à leur propre coût, jamais en négatif.
 *  Si l'historique est trop volumineux pour être lu en entier, valeur et ruptures sont `null` (jamais un chiffre faux). */
export async function stockSnapshot(store: Store, where: Record<string, string>, maxMoves = 100_000): Promise<StockSnapshot> {
  const [products, moves] = await Promise.all([store.scan("products", where, { maxRows: 5_000 }), store.scan("stock_moves", where, { maxRows: maxMoves })]);
  const live = products.rows.filter((x) => !x.archived); const activeProducts = live.length;
  if (moves.truncated || products.truncated) return { partial: true, value: null, stockouts: null, items: [], products: products.rows, activeProducts };
  const byProduct = new Map<string, StockMove[]>(), byVariant = new Map<string, StockMove[]>(), byLot = new Map<string, StockMove[]>();
  for (const m of moves.rows) {
    const mv = { productId: String(m.productId), qty: Number(m.qty), kind: m.kind as StockMove["kind"] };
    const [map, k] = m.variantId ? [byVariant, String(m.variantId)] : [byProduct, String(m.productId)];
    (map.get(k) ?? map.set(k, []).get(k)!).push(mv);
    if (m.lotId) (byLot.get(String(m.lotId)) ?? byLot.set(String(m.lotId), []).get(String(m.lotId))!).push(mv);
  }
  const lotRows = (await store.scan("article_lots", where, { maxRows: 20_000 })).rows;
  const lotValue = (productId: string, variantId: string, scale: number, fallback: number) => lotRows.filter((l) => l.productId === productId && String(l.variantId ?? "") === variantId).reduce((a, l) => a + Math.max(0, fromScaled(stockOf(byLot.get(String(l.$id)) ?? []), scale)) * (Number(l.unitCost) > 0 ? Number(l.unitCost) : fallback), 0);
  let value = 0, stockouts = 0; const items: StockItem[] = [];
  const productRows = live.filter((x) => !isVirtualBundle(x)); // un bundle virtuel n'a pas de stock propre
  for (const p of productRows.filter((x) => !x.hasVariants)) {
    const n = fromScaled(stockOf(byProduct.get(String(p.$id)) ?? []), scaleOf(p));
    value += trackingOf(p) === "lot" ? lotValue(String(p.$id), "", scaleOf(p), Number(p.cost ?? 0)) : Math.max(0, n) * Number(p.cost ?? 0);
    if (n <= Number(p.minStock ?? 0)) stockouts++;
    items.push({ productId: String(p.$id), name: String(p.name), qty: n, min: Number(p.minStock ?? 0) });
  }
  const variants = await store.scan("article_variants", where, { maxRows: 20_000 }); const liveV = new Set(productRows.filter((x) => x.hasVariants).map((x) => String(x.$id)));
  for (const v of variants.rows.filter((x) => !x.archived && liveV.has(String(x.productId)))) {
    const parent = products.rows.find((x) => x.$id === v.productId); const n = fromScaled(stockOf(byVariant.get(String(v.$id)) ?? []), scaleOf(parent));
    value += trackingOf(parent) === "lot" ? lotValue(String(v.productId), String(v.$id), scaleOf(parent), Number(v.cost ?? 0)) : Math.max(0, n) * Number(v.cost ?? 0);
    if (n <= Number(v.minStock ?? 0)) stockouts++;
    items.push({ productId: String(v.productId), variantId: String(v.$id), name: `${parent?.name ?? "Article"} — ${v.label}`, qty: n, min: Number(v.minStock ?? 0) });
  }
  return { partial: false, value, stockouts, items, products: products.rows, activeProducts };
}
