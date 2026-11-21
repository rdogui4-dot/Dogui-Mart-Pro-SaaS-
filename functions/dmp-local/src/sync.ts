import { PULLED_TABLES, SYNC_CLASS_OF } from "../../../src/domain/sync-tables";
import type { SqliteStore } from "../../dmp-api/src/sqlite-store";
import type { PushResult, PushRow } from "../../dmp-api/src/sync";
import type { DirectoryUser } from "../../dmp-api/src/store";

/** Moteur de synchronisation du poste : envoi des écritures locales au cloud (idempotent, dans l'ordre), réception des changements du cloud, téléchargement initial.
 *  Le cloud est joint par une interface minimale (`CloudApi`) : en production ce sont les actions `sync.push` / `sync.pull` appelées avec la session du propriétaire. */
export interface CloudApi {
  push(rows: PushRow[]): Promise<PushResult[]>;
  users(): Promise<DirectoryUser[]>;
  pull(table: string, since: string, limit: number): Promise<{ rows: { id: string; createdAt: string; updatedAt: string; data: Record<string, unknown> }[]; next: string; more: boolean }>;
}
export type SyncReport = { pushed: number; overwrittenOnCloud: number; rejected: { table: string; id: string; error: string }[]; pulled: number; conflicts: number; error?: string };
const empty = (): SyncReport => ({ pushed: 0, overwrittenOnCloud: 0, rejected: [], pulled: 0, conflicts: 0 });

/** Envoie ce qui est en attente, par lots, jusqu'à épuisement (ou `maxBatches`). Une ligne refusée est signalée et retirée de la file (elle ne bloquerait sinon jamais la suite) ;
 *  une erreur de réseau ou de serveur arrête l'envoi et laisse tout en attente (rien n'est perdu, la reprise renvoie les mêmes lignes). */
export async function pushPending(store: SqliteStore, cloud: CloudApi, opts: { batch?: number; maxBatches?: number } = {}): Promise<SyncReport> {
  const rep = empty(); const batch = opts.batch ?? 100;
  for (let i = 0; i < (opts.maxBatches ?? 200); i++) {
    const pending = store.outboxPending(batch); if (!pending.length) break;
    const rows: PushRow[] = pending.map((p) => p.op === "remove" ? { table: p.table, id: p.id, op: "remove" } : { table: p.table, id: p.id, op: "upsert", data: p.row as Record<string, unknown>, createdAt: String(p.row!.$createdAt ?? ""), baseAt: p.remoteAt });
    let results: PushResult[]; try { results = await cloud.push(rows); } catch (e) { rep.error = (e as Error).message || "Cloud injoignable"; return rep; }
    const byKey = new Map(results.map((r) => [`${r.table}/${r.id}`, r]));
    for (const p of pending) {
      const r = byKey.get(`${p.table}/${p.id}`); if (!r) { rep.error = "Réponse du cloud incomplète"; return rep; }
      if (r.status === "rejected") { rep.rejected.push({ table: p.table, id: p.id, error: r.error ?? "Refusé" }); store.addConflict(p.table, p.id, "rejected_by_cloud", p.row ?? null, { error: r.error }); store.outboxAck(p.table, p.id, p.mx); continue; }
      if (r.status === "overwrote") { rep.overwrittenOnCloud++; rep.conflicts++; store.addConflict(p.table, p.id, "cloud_version_overwritten", p.row ?? null, r.overwritten ?? null); }
      store.outboxAck(p.table, p.id, p.mx, r.remoteAt); rep.pushed++;
    }
  }
  return rep;
}

/** Reçoit les changements du cloud pour une table depuis le dernier curseur. Tables partagées : une ligne modifiée aussi sur le poste n'est pas écrasée (le poste l'emporte, la version du cloud est gardée pour examen). */
export async function pullTable(store: SqliteStore, cloud: CloudApi, tenantId: string, table: string, opts: { from?: string } = {}): Promise<SyncReport> {
  const rep = empty(); const key = `pull:${table}`; let since = opts.from ?? store.syncGet(key) ?? "";
  for (let guard = 0; guard < 10_000; guard++) {
    let page; try { page = await cloud.pull(table, since, 500); } catch (e) { rep.error = (e as Error).message || "Cloud injoignable"; return rep; }
    for (const r of page.rows) {
      if (store.remoteAtOf(table, r.id) === r.updatedAt) continue; // déjà reçue (bord de page)
      if (SYNC_CLASS_OF[table] === "shared" && store.hasPending(table, r.id)) { const mine = (await store.get(table, r.id)) ?? null; store.addConflict(table, r.id, "cloud_changed_while_local_pending", mine, r.data); rep.conflicts++; continue; }
      store.applyRemote(table, r.id, tenantId, r.data, r.createdAt || r.updatedAt, r.updatedAt); rep.pulled++;
    }
    if (page.next && page.next !== since) { since = page.next; store.syncSet(key, since); }
    if (!page.more) break; if (!page.rows.length) break;
    if (page.next === since && page.rows.length && guard > 50) { rep.error = "Curseur bloqué"; return rep; }
  }
  return rep;
}

/** Téléchargement initial : toutes les tables du commerce, depuis l'origine. Le poste devient une copie exacte (mêmes identifiants), sans rien renvoyer au cloud. */
export async function initialDownload(store: SqliteStore, cloud: CloudApi, tenantId: string, onProgress?: (table: string, done: number, total: number) => void): Promise<SyncReport> {
  const rep = empty(); const tables = Object.keys(SYNC_CLASS_OF); let done = 0;
  for (const t of tables) { onProgress?.(t, done, tables.length); const r = await pullTable(store, cloud, tenantId, t, { from: "" }); rep.pulled += r.pulled; rep.conflicts += r.conflicts; if (r.error) { rep.error = `${t} : ${r.error}`; return rep; } done++; }
  onProgress?.("", tables.length, tables.length); return rep;
}

/** Copie l'annuaire du commerce sur le poste (comptes du personnel, empreintes Argon2, rôles, étiquettes) : tout le monde peut se connecter hors ligne dès la première synchronisation. */
export async function syncUsers(store: SqliteStore, cloud: CloudApi, tenantId: string): Promise<{ created: number; updated: number; removed: number; skipped: string[]; error?: string }> {
  try { return store.applyDirectory(tenantId, await cloud.users()); } catch (e) { return { created: 0, updated: 0, removed: 0, skipped: [], error: (e as Error).message || "Cloud injoignable" }; }
}

/** Un tour de synchronisation : envoi puis réception des tables du cloud et partagées. */
export async function syncOnce(store: SqliteStore, cloud: CloudApi, tenantId: string): Promise<SyncReport> {
  const rep = await pushPending(store, cloud); if (rep.error) return rep;
  const u = await syncUsers(store, cloud, tenantId); if (u.error) { rep.error = `comptes : ${u.error}`; return rep; }
  for (const t of PULLED_TABLES) { const r = await pullTable(store, cloud, tenantId, t); rep.pulled += r.pulled; rep.conflicts += r.conflicts; if (r.error) { rep.error = `${t} : ${r.error}`; break; } }
  store.syncSet("lastSyncAt", new Date().toISOString()); if (!rep.error) store.syncSet("lastSyncOkAt", new Date().toISOString());
  return rep;
}
