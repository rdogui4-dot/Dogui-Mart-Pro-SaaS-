import { DATABASE_ID, Query, tables } from "./appwrite";
import type { Shop } from "@/domain/documents";
import { api } from "./api";
import { delta } from "@/domain/stock";
import type { Session } from "./session";

export type Row<T> = T & { $id: string; $createdAt: string };
export type Product = { sku?: string; barcode?: string; name: string; category?: string; price: number; cost?: number; minStock?: number; archived?: boolean };
export type Customer = { name: string; phone?: string; creditLimit?: number; creditBalance?: number; points?: number; annualSpend?: number };
export type Supplier = { name: string; phone?: string; email?: string; balance?: number };

const scope = (s: Session) => [Query.equal("tenantId", s.tenantId), Query.equal("shopId", s.shopId)];

/** Lecture directe (droits de lecture de la Team) ; l'écriture, elle, passe uniquement par la fonction serveur. */
export async function list<T>(table: string, s: Session, extra: string[] = [], limit = 200): Promise<Row<T>[]> {
  const r = await tables.listRows({ databaseId: DATABASE_ID, tableId: table, queries: [...scope(s), Query.limit(limit), Query.orderDesc("$createdAt"), ...extra] });
  return r.rows as unknown as Row<T>[];
}

export const saveEntity = (s: Session, table: "products" | "customers" | "suppliers", data: object, id?: string) =>
  api<{ id: string }>(s, "entity.save", { table, id, data });

export async function stockLevels(s: Session): Promise<Map<string, number>> {
  const moves = await list<{ productId: string; qty: number; kind: string }>("stock_moves", s, [], 5000);
  const m = new Map<string, number>();
  for (const x of moves) m.set(x.productId, (m.get(x.productId) ?? 0) + delta({ productId: x.productId, qty: x.qty, kind: x.kind as never }));
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
