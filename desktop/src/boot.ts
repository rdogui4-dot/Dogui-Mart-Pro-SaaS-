import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startLocalServer } from "../../functions/dmp-local/src/main";
import type { SqliteStore } from "../../functions/dmp-api/src/sqlite-store";
import { backupName, backupsToDelete, needsBackup, parseConfig, type DesktopConfig } from "./logic";

/** Démarrage du poste principal et sauvegardes : Node pur (aucun import Electron), donc testable et exécutable sous le Node d'Electron. */
/** Cloud de Dogui Mart Pro : valeurs publiques (les mêmes que celles de l'application web). */
export const CLOUD = { endpoint: process.env.DMP_CLOUD_ENDPOINT || "https://fra.cloud.appwrite.io/v1", projectId: process.env.DMP_CLOUD_PROJECT || "6ae9d6010001952ea399", functionId: "dmp-api" };

const configFile = (dir: string) => join(dir, "poste.json");
export function loadConfig(dir: string): DesktopConfig { try { return parseConfig(JSON.parse(readFileSync(configFile(dir), "utf8"))); } catch { return parseConfig(undefined); } }
/** Écriture atomique : un arrêt brutal ne laisse jamais un fichier de configuration à moitié écrit. */
export function saveConfig(dir: string, cfg: DesktopConfig): void { mkdirSync(dir, { recursive: true }); const tmp = `${configFile(dir)}.tmp`; writeFileSync(tmp, JSON.stringify(cfg, null, 2)); renameSync(tmp, configFile(dir)); }

/** Une copie par jour dans « sauvegardes » (7 gardées). Renvoie le chemin créé, ou null si la copie du jour existe déjà. */
export function runBackup(store: SqliteStore, dataDir: string, cfg: DesktopConfig, now = new Date()): { path: string; removed: string[]; cfg: DesktopConfig } | null {
  if (!needsBackup(cfg.lastBackupAt, now)) return null;
  const dir = join(dataDir, "sauvegardes"); mkdirSync(dir, { recursive: true }); const path = join(dir, backupName(now)); if (existsSync(path)) rmSync(path);
  store.snapshotTo(path); const removed = backupsToDelete(readdirSync(dir)); for (const n of removed) rmSync(join(dir, n), { force: true });
  const next = { ...cfg, lastBackupAt: now.toISOString() }; saveConfig(dataDir, next); return { path, removed, cfg: next };
}

export type MainHandle = Awaited<ReturnType<typeof startMainServer>>;
/** Poste principal : serveur local HTTPS (certificat généré une fois), annonce `dogui.local`, liaison cloud, synchronisation automatique toutes les 5 minutes, sauvegarde quotidienne. */
export async function startMainServer(o: { dataDir: string; webRoot: string; port: number; host?: string; mdns?: boolean; cloud?: typeof CLOUD | null; autoSyncMs?: number; backupEveryMs?: number }) {
  mkdirSync(o.dataDir, { recursive: true });
  const srv = await startLocalServer({ dataDir: o.dataDir, webRoot: o.webRoot, port: o.port, host: o.host ?? "0.0.0.0", https: true, mdns: o.mdns ?? true, cloud: o.cloud === null ? undefined : { config: o.cloud ?? CLOUD }, autoSyncMs: o.autoSyncMs ?? 5 * 60_000 });
  let cfg = loadConfig(o.dataDir); const tick = () => { try { const r = runBackup(srv.store, o.dataDir, cfg); if (r) cfg = r.cfg; } catch (e) { console.error("Sauvegarde automatique impossible :", (e as Error).message); } };
  tick(); const timer = setInterval(tick, o.backupEveryMs ?? 60 * 60_000); timer.unref();
  return { ...srv, origin: `https://127.0.0.1:${srv.port}`, close: async () => { clearInterval(timer); await srv.close(); } };
}
