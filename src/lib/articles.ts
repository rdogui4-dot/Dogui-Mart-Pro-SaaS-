import { useEffect, useState } from "react";
import { DATABASE_ID, Query, tables } from "./appwrite";
import type { Session } from "./session";
import type { Row } from "./data";

/** Ligne de la table `products` vue comme article. Prix de vente = price, prix d'achat = cost (voir README : la table historique est conservée). */
export type ArticleRow = Row<{
  name: string; sku?: string; barcode?: string; category?: string; description?: string; price: number; cost?: number;
  unit?: string; minStock?: number; supplierId?: string; imageFileId?: string; archived?: boolean; qtyScale?: number; hasVariants?: boolean; tracking?: string; kind?: string; bundleMode?: string;
}>;
export type PriceHistoryRow = Row<{ productId: string; oldPrice?: number; newPrice?: number; oldCost?: number; newCost?: number; userId?: string }>;

export const PAGE_SIZE = 20;
export type Filters = { q: string; status: "active" | "archived" | "all"; category: string; sort: "name_asc" | "name_desc" | "new" | "old" };

/** Requêtes Appwrite du catalogue : recherche (désignation, référence, code-barres), filtres, tri et curseur de pagination. */
export function articleQueries(s: Session, f: Filters, cursor?: string): string[] {
  const q = f.q.trim();
  return [
    Query.equal("tenantId", s.tenantId), Query.equal("shopId", s.shopId),
    ...(f.status === "all" ? [] : [Query.equal("archived", f.status === "archived")]),
    Query.or([Query.isNull("kind"), Query.equal("kind", "simple")]), // les bundles ont leur propre module
    ...(f.category ? [Query.equal("category", f.category)] : []),
    ...(q ? [Query.or([Query.search("name", q), Query.startsWith("sku", q), Query.equal("barcode", q)])] : []),
    f.sort === "name_asc" ? Query.orderAsc("name") : f.sort === "name_desc" ? Query.orderDesc("name") : f.sort === "old" ? Query.orderAsc("$createdAt") : Query.orderDesc("$createdAt"),
    Query.limit(PAGE_SIZE), ...(cursor ? [Query.cursorAfter(cursor)] : []),
  ];
}
export async function fetchArticles(s: Session, f: Filters, cursor?: string): Promise<{ rows: ArticleRow[]; next?: string; total: number }> {
  const r = await tables.listRows({ databaseId: DATABASE_ID, tableId: "products", queries: articleQueries(s, f, cursor) });
  const rows = r.rows as unknown as ArticleRow[];
  return { rows, total: r.total, next: rows.length === PAGE_SIZE ? rows[rows.length - 1]!.$id : undefined };
}
export async function fetchPriceHistory(s: Session, productId: string): Promise<PriceHistoryRow[]> {
  const r = await tables.listRows({ databaseId: DATABASE_ID, tableId: "price_history", queries: [Query.equal("productId", productId), Query.orderDesc("$createdAt"), Query.limit(50)] });
  void s; return r.rows as unknown as PriceHistoryRow[];
}

// ---------------------------------------------------------------- photos
export const MAX_SIDE = 800, TARGET_BYTES = 300_000;
/** Réduit la photo (côté max 800 px, JPEG) jusqu'à tenir sous ~300 Ko ; renvoie le base64 sans préfixe. */
export async function compressImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Ce fichier n'est pas une image");
  const bmp = await createImageBitmap(file).catch(() => { throw new Error("Image illisible"); });
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
  for (const q of [0.85, 0.75, 0.65, 0.5, 0.4]) {
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", q));
    if (blob && blob.size <= TARGET_BYTES) return blobToBase64(blob);
  }
  throw new Error("Image trop lourde même après compression : choisissez une autre photo");
}
const blobToBase64 = (b: Blob) => new Promise<string>((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] ?? ""); r.onerror = () => ko(new Error("Lecture de l'image impossible")); r.readAsDataURL(b); });

const cache = new Map<string, string>();
/** Affiche une photo privée. Un <img src> ne porte pas la session Appwrite (cookies tiers bloqués) : on charge le fichier avec l'en-tête de session puis on l'affiche. */
export function useArticleImage(fileId?: string, size = 200): string | null {
  const key = fileId ? `${fileId}:${size}` : "";
  const [url, setUrl] = useState<string | null>(key ? cache.get(key) ?? null : null);
  useEffect(() => {
    if (!key || !fileId) { setUrl(null); return; }
    const hit = cache.get(key); if (hit) { setUrl(hit); return; }
    let live = true;
    const env = import.meta.env; let fallback = ""; try { fallback = localStorage.getItem("cookieFallback") ?? ""; } catch { /* navigation privée */ }
    const base = `${env.VITE_APPWRITE_ENDPOINT}/storage/buckets/articles/files/${fileId}`; const init: RequestInit = { headers: { "X-Appwrite-Project": String(env.VITE_APPWRITE_PROJECT_ID), "X-Fallback-Cookies": fallback }, credentials: "include" };
    // L'aperçu redimensionné (transformations d'image) n'est pas disponible sur toutes les formules Appwrite : à défaut, on affiche le fichier d'origine (déjà compressé à l'enregistrement).
    fetch(`${base}/preview?width=${size}&height=${size}&output=webp`, init)
      .then((r) => (r.ok ? r : fetch(`${base}/view`, init)))
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => { const u = URL.createObjectURL(b); cache.set(key, u); if (live) setUrl(u); })
      .catch(() => { if (live) setUrl(null); });
    return () => { live = false; };
  }, [key, fileId, size]);
  return url;
}
