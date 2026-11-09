import { dehydrate, hydrate, type DehydratedState, type QueryClient } from "@tanstack/react-query";
import { openDB } from "idb";

/** Données mises en cache sur l'appareil pour que la caisse démarre sans réseau (les ventes, elles, sont déjà gardées par offline.ts). */
const KEYS = new Set(["products", "products-all", "variants-all", "variants-every", "stock", "customers", "units-all", "rules-all", "shop", "subscription", "pay-settings", "components-all"]);
const db = () => openDB("dmp-cache", 1, { upgrade(d) { if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv"); } });
const enc = (v: unknown): string => JSON.stringify(v, (_k, x) => (x instanceof Map ? { __map: [...x] } : x));
const dec = (t: string): unknown => JSON.parse(t, (_k, x) => (x && typeof x === "object" && Array.isArray((x as { __map?: unknown }).__map) ? new Map((x as { __map: [unknown, unknown][] }).__map) : x));

/** Recharge le cache de l'utilisateur AVANT l'affichage des écrans ; sans effet (et sans erreur) si rien n'est enregistré. */
export async function restoreCache(qc: QueryClient, userId: string): Promise<void> {
  try { const t = await (await db()).get("kv", `rq:${userId}`); if (typeof t === "string") hydrate(qc, dec(t) as DehydratedState); } catch { /* cache absent ou illisible : on repart du réseau */ }
}
let stop: (() => void) | null = null;
/** Enregistre (avec un court délai) les requêtes utiles à la caisse à chaque mise à jour du cache. */
export function startPersist(qc: QueryClient, userId: string): void {
  stop?.(); let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => { void (async () => { try { await (await db()).put("kv", enc(dehydrate(qc, { shouldDehydrateQuery: (q) => q.state.status === "success" && KEYS.has(String(q.queryKey[0])) })), `rq:${userId}`); } catch { /* quota / navigation privée : on s'en passe */ } })(); };
  const unsub = qc.getQueryCache().subscribe((e) => { if (e.type === "updated" && e.action.type === "success") { clearTimeout(timer); timer = setTimeout(save, 1500); } });
  stop = () => { unsub(); clearTimeout(timer); };
}
export async function clearCache(userId: string): Promise<void> { stop?.(); stop = null; try { await (await db()).delete("kv", `rq:${userId}`); } catch { /* rien à effacer */ } }
