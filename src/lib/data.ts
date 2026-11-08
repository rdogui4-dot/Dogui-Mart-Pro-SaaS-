import { DATABASE_ID, Query, tables } from "./appwrite";
import type { Shop } from "@/domain/documents";
import { api } from "./api";
import { delta } from "@/domain/stock";
import { fromScaled } from "@/domain/quantity";
import type { Session } from "./session";

export type Row<T> = T & { $id: string; $createdAt: string };
export type Product = { sku?: string; barcode?: string; name: string; category?: string; price: number; cost?: number; minStock?: number; archived?: boolean; qtyScale?: number; unit?: string; hasVariants?: boolean };
export type Customer = { name: string; phone?: string; creditLimit?: number; creditBalance?: number; points?: number; annualSpend?: number; category?: string };
export type Supplier = { name: string; phone?: string; email?: string; balance?: number };

const scope = (s: Session) => [Query.equal("tenantId", s.tenantId), Query.equal("shopId", s.shopId)];

/** Lecture directe (droits de lecture de la Team) ; l'écriture, elle, passe uniquement par la fonction serveur. */
export async function list<T>(table: string, s: Session, extra: string[] = [], limit = 200): Promise<Row<T>[]> {
  const r = await tables.listRows({ databaseId: DATABASE_ID, tableId: table, queries: [...scope(s), Query.limit(limit), Query.orderDesc("$createdAt"), ...extra] });
  return r.rows as unknown as Row<T>[];
}

export const saveEntity = (s: Session, table: "products" | "customers" | "suppliers", data: object, id?: string) =>
  api<{ id: string }>(s, "entity.save", { table, id, data });

/** Lit toutes les lignes d'une boutique par pages (curseur) : ne dépend d'aucune limite de taille de page. */
export async function listAll<T>(table: string, s: Session, maxRows = 200_000): Promise<Row<T>[]> {
  const rows: Row<T>[] = []; let cursor: string | undefined;
  for (;;) {
    const page = (await tables.listRows({ databaseId: DATABASE_ID, tableId: table, queries: [...scope(s), Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])] })).rows as unknown as Row<T>[];
    if (!page.length || rows.length + page.length > maxRows) return rows.concat(page.slice(0, Math.max(0, maxRows - rows.length)));
    rows.push(...page); cursor = page[page.length - 1]!.$id;
  }
}

export async function stockLevels(s: Session): Promise<Map<string, number>> {
  const moves = await listAll<{ productId: string; variantId?: string; qty: number; kind: string }>("stock_moves", s);
  const m = new Map<string, number>();
  for (const x of moves) {
    const d = delta({ productId: x.productId, qty: x.qty, kind: x.kind as never });
    m.set(x.productId, (m.get(x.productId) ?? 0) + d); // total de l'article (toutes variantes)
    if (x.variantId) m.set(`v:${x.variantId}`, (m.get(`v:${x.variantId}`) ?? 0) + d); // stock propre à la variante
  }
  return m;
}

/** Fiche boutique (en-tête des documents). Absente tant que le propriétaire ne l'a pas renseignée. */
export async function getShop(s: Session): Promise<Shop | null> {
  try { return (await tables.getRow({ databaseId: DATABASE_ID, tableId: "shops", rowId: s.shopId.slice(0, 36) })) as unknown as Shop; }
  catch { return null; }
}

/** Tables propres au commerce entier (boutiques, employés) : pas de filtre par boutique. */
export async function listTenant<T>(table: string, s: Session, limit = 100): Promise<Row<T>[]> {
  const r = await tables.listRows({ databaseId: DATABASE_ID, tableId: table, queries: [Query.equal("tenantId", s.tenantId), Query.limit(limit)] });
  return r.rows as unknown as Row<T>[];
}

/** Stock lisible d'un article : `stockLevels` renvoie des entiers de sous-unités, on les remet à l'échelle de l'article (kg, litre…). */
export const qtyOf = (levels: Map<string, number> | undefined, p: { $id: string; qtyScale?: number }): number => fromScaled(levels?.get(p.$id) ?? 0, p.qtyScale ?? 0);
export type UnitRow = Row<{ productId: string; unit: string; factor: number; active?: boolean }>;
export type VariantRow = Row<{ productId: string; attributes: string; label: string; sku?: string; barcode?: string; price: number; cost?: number; minStock?: number; imageFileId?: string; archived?: boolean }>;
/** Stock lisible d'une variante, à l'échelle de son article. */
export const variantQty = (levels: Map<string, number> | undefined, v: { $id: string }, scale = 0): number => fromScaled(levels?.get(`v:${v.$id}`) ?? 0, scale);
export type RuleRow = Row<{ productId: string; variantId?: string; kind: string; price: number; unit?: string; minQty?: number; customerCategory?: string; startsAt?: string; endsAt?: string; priority?: number; active?: boolean; label?: string }>;
