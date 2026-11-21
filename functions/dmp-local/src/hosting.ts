import type { SqliteStore } from "../../dmp-api/src/sqlite-store";
import { CloudError, createCloudClient, type CloudClient, type CloudConfig, type CloudSession } from "./cloud";
import { initialDownload, pullFiles, pushPending, syncOnce, syncUsers, type SyncReport } from "./sync";

/** Rattachement d'un poste local au cloud : le poste télécharge le commerce (mêmes identifiants), en devient l'hébergeur, puis synchronise. */
export type HostState = { hosted: boolean; tenantId?: string; stationName?: string; cloudEmail?: string; attachedAt?: string; lastSyncAt?: string; lastSyncOkAt?: string; lastError?: string; pending: number; conflicts: number; sessionOk: boolean; /** échecs de synchronisation consécutifs */ failures: number; /** prochain essai automatique (après des échecs) */ nextTryAt?: string };

export const hostState = (store: SqliteStore): HostState => ({
  hosted: store.syncGet("hosted") === "1", tenantId: store.syncGet("tenantId") ?? undefined, stationName: store.syncGet("stationName") ?? undefined, cloudEmail: store.syncGet("cloudEmail") ?? undefined, attachedAt: store.syncGet("attachedAt") ?? undefined,
  lastSyncAt: store.syncGet("lastSyncAt") ?? undefined, lastSyncOkAt: store.syncGet("lastSyncOkAt") ?? undefined, lastError: store.syncGet("lastError") ?? undefined, pending: store.outboxCount(), conflicts: store.conflicts().length, sessionOk: !!store.syncGet("cloud.session"), failures: Number(store.syncGet("failures") ?? 0), nextTryAt: store.syncGet("nextTryAt") ?? undefined,
});
/** Client du cloud dont la session (cookie du propriétaire) est conservée dans la base du poste. */
export function cloudFor(store: SqliteStore, cfg: CloudConfig, f?: typeof fetch): CloudClient {
  let session: CloudSession | null = null; try { const raw = store.syncGet("cloud.session"); if (raw) session = JSON.parse(raw); } catch { /* session illisible : reconnexion demandée */ }
  return createCloudClient(cfg, { fetch: f, session, onSession: (s) => store.syncSet("cloud.session", s ? JSON.stringify(s) : null) });
}

export type AttachResult = { ok: true; tenantId: string; report: SyncReport } | { ok: false; error: string; choose?: { id: string; name: string }[] };
/** Rattache ce poste (vierge) à un commerce du cloud dont l'utilisateur est propriétaire. Aucune donnée locale n'est écrasée : un poste qui contient déjà un autre commerce est refusé. */
export async function attachToCloud(store: SqliteStore, cloud: CloudClient, p: { email: string; password: string; stationName: string; tenantId?: string }, onProgress?: (table: string, done: number, total: number) => void): Promise<AttachResult> {
  const station = p.stationName.trim().slice(0, 60); if (!station) return { ok: false, error: "Donnez un nom à ce poste (par exemple « Caisse principale »)" };
  try {
    await cloud.login(p.email.trim(), p.password);
    const mine = await cloud.myTeams(); const owned: { id: string; name: string }[] = []; for (const t of mine) if (await cloud.ownerOf(t.id)) owned.push(t);
    if (!owned.length) { await cloud.logout(); return { ok: false, error: "Ce compte n'est propriétaire d'aucun commerce : seul le propriétaire peut rattacher un poste" }; }
    const team = p.tenantId ? owned.find((t) => t.id === p.tenantId) : owned.length === 1 ? owned[0] : undefined;
    if (!team) { await cloud.logout(); return p.tenantId ? { ok: false, error: "Commerce introuvable pour ce compte" } : { ok: false, error: "Plusieurs commerces : choisissez celui à héberger", choose: owned }; }
    const existing = store.db.prepare("SELECT id FROM teams").all().map((r) => String(r.id)); if (existing.length && !(existing.length === 1 && existing[0] === team.id)) { await cloud.logout(); return { ok: false, error: "Ce poste contient déjà un autre commerce" }; }
    await cloud.execute("host.claim", team.id, { name: station }); // le cloud passe en lecture : une seule saisie des opérations
    store.createTeam(team.id, team.name); const api = cloud.api(team.id);
    const rep = await initialDownload(store, api, team.id, onProgress); if (rep.error) return { ok: false, error: `Téléchargement interrompu (${rep.error}) : relancez le rattachement` };
    const u = await syncUsers(store, api, team.id); if (u.error) return { ok: false, error: `Comptes non copiés (${u.error}) : relancez le rattachement` };
    const g = await pullFiles(store, api); if (g.error) return { ok: false, error: `Fichiers non copiés (${g.error}) : relancez le rattachement` };
    store.syncSet("tenantId", team.id); store.syncSet("stationName", station); store.syncSet("cloudEmail", p.email.trim()); store.syncSet("attachedAt", new Date().toISOString()); store.syncSet("hosted", "1"); store.syncOn = true; store.syncSet("syncOn", "1");
    return { ok: true, tenantId: team.id, report: rep };
  } catch (e) { return { ok: false, error: e instanceof CloudError ? e.message : (e as Error).message || "Rattachement impossible" }; }
}
/** Relance la synchronisation après un redémarrage du serveur local. */
export const resumeSync = (store: SqliteStore) => { if (store.syncGet("syncOn") === "1") store.syncOn = true; };

/** Délai avant le prochain essai automatique après N échecs consécutifs : 1, 2, 4, 8 puis 15 minutes au plus. */
export const backoffMs = (failures: number): number => Math.min(15 * 60_000, 60_000 * 2 ** Math.max(0, failures - 1));
const running = new WeakSet<SqliteStore>();
/** Un tour de synchronisation avec erreurs lisibles et état conservé. Un seul tour à la fois par poste ; après des échecs, les essais AUTOMATIQUES attendent (délai croissant) ; `force` (bouton « Synchroniser maintenant ») passe outre. */
export async function runSync(store: SqliteStore, cloud: CloudClient, opts: { force?: boolean } = {}): Promise<SyncReport & { skipped?: boolean; waiting?: boolean }> {
  const none = (): SyncReport => ({ pushed: 0, overwrittenOnCloud: 0, rejected: [], pulled: 0, conflicts: 0 });
  const tenantId = store.syncGet("tenantId"); if (!tenantId || store.syncGet("hosted") !== "1") return { ...none(), skipped: true };
  if (running.has(store)) return { ...none(), skipped: true };
  const next = Date.parse(store.syncGet("nextTryAt") ?? ""); if (!opts.force && next > Date.now()) return { ...none(), skipped: true, waiting: true };
  running.add(store);
  try {
    const fail = (msg: string) => { const n = Number(store.syncGet("failures") ?? 0) + 1; store.syncSet("failures", String(n)); store.syncSet("nextTryAt", new Date(Date.now() + backoffMs(n)).toISOString()); store.syncSet("lastError", msg); store.syncSet("lastSyncAt", new Date().toISOString()); return { ...none(), error: msg }; };
    if (!cloud.hasSession()) return fail("Session cloud absente : reconnectez ce poste au cloud");
    let rep: SyncReport; try { rep = await syncOnce(store, cloud.api(tenantId), tenantId); } catch (e) { return fail((e as Error).message || "Synchronisation impossible"); }
    if (rep.error) { const f = fail(rep.error); return { ...rep, ...{ error: f.error } }; }
    store.syncSet("failures", null); store.syncSet("nextTryAt", null); store.syncSet("lastError", null); return rep;
  } finally { running.delete(store); }
}
/** Rend l'hébergement au cloud : dernière synchronisation complète (refus s'il reste des envois), puis le cloud reprend l'écriture. */
export async function releaseToCloud(store: SqliteStore, cloud: CloudClient): Promise<{ ok: true } | { ok: false; error: string }> {
  const tenantId = store.syncGet("tenantId"); if (!tenantId) return { ok: false, error: "Ce poste n'héberge aucun commerce" };
  try {
    const rep = await pushPending(store, cloud.api(tenantId)); if (rep.error) return { ok: false, error: `Envoi incomplet (${rep.error}) : rien n'est rendu au cloud` };
    if (store.outboxCount() > 0) return { ok: false, error: "Des opérations restent à envoyer : rien n'est rendu au cloud" };
    await cloud.execute("host.release", tenantId, {}); store.syncOn = false; for (const k of ["hosted", "syncOn"]) store.syncSet(k, null); return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof CloudError ? e.message : (e as Error).message || "Retour au cloud impossible" }; }
}
