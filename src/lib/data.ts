import { DATABASE_ID, ID, Query, rowPerms, tables } from "./appwrite";
import { delta } from "@/domain/stock";
import type { Session } from "./session";

export type Row<T> = T & { $id: string; $createdAt: string };
export type Product = { sku?: string; barcode?: string; name: string; category?: string; price: number; cost?: number; minStock?: number; archived?: boolean };
export type Customer = { name: string; phone?: string; creditLimit?: number; creditBalance?: number; points?: number; annualSpend?: number };
export type Supplier = { name: string; phone?: string; email?: string; balance?: number };

const scope = (s: Session) => [Query.equal("tenantId", s.tenantId), Query.equal("shopId", s.shopId)];

export async function list<T>(table: string, s: Session, extra: string[] = [], limit = 200): Promise<Row<T>[]> {
  const r = await tables.listRows({ databaseId: DATABASE_ID, tableId: table, queries: [...scope(s), Query.limit(limit), Query.orderDesc("$createdAt"), ...extra] });
  return r.rows as unknown as Row<T>[];
}

export async function create<T extends object>(table: string, s: Session, data: T, rowId: string = ID.unique()) {
  return tables.createRow({
    databaseId: DATABASE_ID, tableId: table, rowId,
    data: { ...data, tenantId: s.tenantId, shopId: s.shopId },
    permissions: rowPerms(s.tenantId),
  });
}

/** Les ventes sont immuables côté caissier : lecture équipe, aucune écriture ultérieure sauf owner/manager. */
export async function stockLevels(s: Session): Promise<Map<string, number>> {
  const moves = await list<{ productId: string; qty: number; kind: string }>("stock_moves", s, [], 5000);
  const m = new Map<string, number>();
  for (const x of moves) m.set(x.productId, (m.get(x.productId) ?? 0) + delta({ productId: x.productId, qty: x.qty, kind: x.kind as never }));
  return m;
}
