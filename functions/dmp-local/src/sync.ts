import { PULLED_TABLES, SYNC_CLASS_OF } from "../../../src/domain/sync-tables";
import { recordSecurityEvent } from "../../dmp-api/src/security-log";
import type { SqliteStore } from "../../dmp-api/src/sqlite-store";
import type { PushResult, PushRow, UserPushIn, UserPushResult } from "../../dmp-api/src/sync";
import type { DirectoryUser } from "../../dmp-api/src/store";

/** Moteur de synchronisation du poste : envoi des écritures locales au cloud (idempotent, dans l'ordre), réception des changements du cloud, téléchargement initial.
 *  Le cloud est joint par une interface minimale (`CloudApi`) : en production ce sont les actions `sync.push` / `sync.pull` appelées avec la session du propriétaire. */
export interface CloudApi {
  push(rows: PushRow[]): Promise<PushResult[]>;
  users(): Promise<DirectoryUser[]>;
  userPush(users: UserPushIn[]): Promise<UserPushResult[]>;
  fileUp(f: { fileId: string; name: string; data: string; readRoles: string[] }): Promise<{ status: "stored" | "exists" }>;
  fileDown(fileId: string): Promise<{ name: string; mime: string; data: string; readRoles: string[] } | null>;
  fileDelete(fileId: string): Promise<void>;
  ids(table: string): Promise<{ ids: string[]; truncated: boolean }>;
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
/** Envoie les fichiers créés sur le poste (après leurs lignes) et les suppressions. Un fichier refusé (format, taille) est signalé dans le journal des conflits et n'est plus renvoyé ; une erreur réseau laisse tout en attente. */
export async function pushFiles(store: SqliteStore, cloud: CloudApi): Promise<{ sent: number; refused: { fileId: string; error: string }[]; error?: string }> {
  const out = { sent: 0, refused: [] as { fileId: string; error: string }[] } as { sent: number; refused: { fileId: string; error: string }[]; error?: string };
  for (let guard = 0; guard < 1000; guard++) {
    const batch = store.filesPending(5); if (!batch.length) break;
    for (const f of batch) {
      try { await cloud.fileUp({ fileId: f.id, name: f.name, data: Buffer.from(f.data).toString("base64"), readRoles: f.readRoles }); store.fileAck(f.id); out.sent++; }
      catch (e) { const err = e as Error & { status?: number; network?: boolean }; if (err.network || !err.status || err.status >= 500) { out.error = err.message || "Cloud injoignable"; return out; }
        store.addConflict("files", f.id, "rejected_by_cloud", { name: f.name, mime: f.mime }, { error: err.message }); store.fileAck(f.id); out.refused.push({ fileId: f.id, error: err.message }); }
    }
  }
  for (const id of store.filesDeleted()) { try { await cloud.fileDelete(id); store.syncSet(`filedel:${id}`, null); } catch (e) { const err = e as Error & { status?: number }; if (!err.status || err.status >= 500) { out.error = err.message || "Cloud injoignable"; return out; } store.syncSet(`filedel:${id}`, null); } }
  return out;
}
/** Reçoit les fichiers cités par les lignes du poste et absents du poste. Un fichier absent du cloud est mémorisé (nouvel essai dans un jour). */
export async function pullFiles(store: SqliteStore, cloud: CloudApi): Promise<{ received: number; missing: number; error?: string }> {
  const out = { received: 0, missing: 0 } as { received: number; missing: number; error?: string }; const now = Date.now(); const seen = new Set<string>();
  for (const r of store.referencedFiles()) {
    if (seen.has(r.fileId) || store.hasFile(r.fileId)) continue; seen.add(r.fileId);
    const miss = store.syncGet(`filemiss:${r.fileId}`); if (miss && now - Date.parse(miss) < 864e5) { out.missing++; continue; }
    let f; try { f = await cloud.fileDown(r.fileId); } catch (e) { out.error = (e as Error).message || "Cloud injoignable"; return out; }
    if (!f) { store.syncSet(`filemiss:${r.fileId}`, new Date().toISOString()); out.missing++; continue; }
    store.applyFile(r.fileId, new Uint8Array(Buffer.from(f.data, "base64")), f.name, f.mime, f.readRoles); store.syncSet(`filemiss:${r.fileId}`, null); out.received++;
  }
  return out;
}
/** Applique les suppressions faites côté cloud sur les tables PARTAGÉES : une ligne connue du cloud, sans envoi en attente, et absente de la liste du cloud est retirée du poste (version gardée au journal).
 *  Garde-fous : liste tronquée ou vide, ou plus de 20 % de la table (au moins 5 lignes) : rien n'est supprimé, un constat est inscrit au journal pour examen. */
export async function reconcileDeletions(store: SqliteStore, cloud: CloudApi): Promise<{ removed: number; suspicious: string[]; error?: string }> {
  const out = { removed: 0, suspicious: [] as string[] } as { removed: number; suspicious: string[]; error?: string };
  for (const table of Object.keys(SYNC_CLASS_OF).filter((t) => SYNC_CLASS_OF[t] === "shared")) {
    const local = store.syncedIds(table); if (!local.length) continue;
    let r; try { r = await cloud.ids(table); } catch (e) { out.error = (e as Error).message || "Cloud injoignable"; return out; } if (r.truncated) continue;
    const there = new Set(r.ids); const gone = local.filter((id) => !there.has(id)); if (!gone.length) continue;
    if (!r.ids.length || (gone.length >= 5 && gone.length > local.length * 0.2)) { out.suspicious.push(table); store.addConflict(table, "*", "cloud_deletions_suspicious", { local: local.length, missing: gone.length }, { cloud: r.ids.length }); continue; }
    for (const id of gone) { store.addConflict(table, id, "deleted_on_cloud", (await store.get(table, id)) ?? null, null); store.removeRemote(table, id); out.removed++; }
  }
  return out;
}
/** Envoie au cloud les comptes créés sur le poste (nouveaux ou modifiés depuis le dernier envoi). Un compte refusé est signalé dans le journal des conflits et n'est pas renvoyé tant qu'il n'a pas changé. */
export async function pushUsers(store: SqliteStore, cloud: CloudApi, tenantId: string): Promise<{ sent: number; refused: { userId: string; error: string }[]; error?: string }> {
  const out = { sent: 0, refused: [] as { userId: string; error: string }[] } as { sent: number; refused: { userId: string; error: string }[]; error?: string };
  const todo = store.localAccounts(tenantId).filter((a) => store.syncGet(`userpush:${a.userId}`) !== a.fp); if (!todo.length) return out;
  for (let i = 0; i < todo.length; i += 50) {
    const part = todo.slice(i, i + 50); let res; try { res = await cloud.userPush(part.map(({ userId, email, name, active, roles, labels, hash }) => ({ userId, email, name, active, roles, labels, hash }))); } catch (e) { out.error = (e as Error).message || "Cloud injoignable"; return out; }
    for (const a of part) { const r = res.find((x) => x.userId === a.userId); if (!r) { out.error = "Réponse du cloud incomplète"; return out; }
      if (r.status === "refused") { out.refused.push({ userId: a.userId, error: r.error ?? "Refusé" }); store.addConflict("users", a.userId, "rejected_by_cloud", { email: a.email, name: a.name, roles: a.roles }, { error: r.error }); } else out.sent++;
      store.syncSet(`userpush:${a.userId}`, a.fp); }
  }
  return out;
}
export async function syncOnce(store: SqliteStore, cloud: CloudApi, tenantId: string): Promise<SyncReport> {
  const rep = await pushPending(store, cloud); if (rep.error) return rep;
  const pf = await pushFiles(store, cloud); if (pf.error) { rep.error = `fichiers : ${pf.error}`; return rep; } for (const r of pf.refused) rep.rejected.push({ table: "files", id: r.fileId, error: r.error });
  const up = await pushUsers(store, cloud, tenantId); if (up.error) { rep.error = `comptes envoyés : ${up.error}`; return rep; } for (const r of up.refused) rep.rejected.push({ table: "users", id: r.userId, error: r.error });
  const u = await syncUsers(store, cloud, tenantId); if (u.error) { rep.error = `comptes : ${u.error}`; return rep; }
  for (const t of PULLED_TABLES) { const r = await pullTable(store, cloud, tenantId, t); rep.pulled += r.pulled; rep.conflicts += r.conflicts; if (r.error) { rep.error = `${t} : ${r.error}`; break; } }
  if (!rep.error) { const last = Date.parse(store.syncGet("reconciledAt") ?? ""); if (!(Date.now() - last < 36e5)) { const d = await reconcileDeletions(store, cloud); if (d.error) rep.error = `suppressions : ${d.error}`; else store.syncSet("reconciledAt", new Date().toISOString()); } }
  if (!rep.error) { const g = await pullFiles(store, cloud); if (g.error) rep.error = `fichiers reçus : ${g.error}`; }
  store.syncSet("lastSyncAt", new Date().toISOString()); if (!rep.error) store.syncSet("lastSyncOkAt", new Date().toISOString());
  if (rep.conflicts > 0) await recordSecurityEvent(store, { tenantId, kind: "sync.conflict", outcome: "accepted", target: `conflits:${rep.conflicts}`, source: "poste", throttleKey: "sync" }); // le détail reste dans le journal des constats, jamais dans le journal de sécurité
  return rep;
}
