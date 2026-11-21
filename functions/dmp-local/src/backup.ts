import { accessSync, constants, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { SqliteStore } from "../../dmp-api/src/sqlite-store";
import { BACKUP_KEEP, BACKUP_KEEP_MAX, BACKUP_KEEP_MIN, backupAlert, backupName, backupsToDelete, kindOf, needsDaily, validPassphrase, type BackupKind } from "./backup-logic";
import { BackupFormatError, decodeBackup, encodeBackup, peekBackup, type BackupHeader } from "./backup-format";

export type Verification = { ok: boolean; rows: number; tenantId?: string; teamName?: string; error?: string; checkedAt: string };
export type BackupItem = { name: string; kind: BackupKind; size: number; at: string; verification?: Verification };
const REQUIRED = ["rows", "teams", "users", "members", "sessions", "sync_state", "outbox"];

/** Vérifie un fichier de base SQLite SANS le modifier : intégrité, tables attendues, nombre de lignes, commerce. */
export function verifyDbFile(path: string): Verification {
  const checkedAt = new Date().toISOString(); let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const ic = db.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[]; if (ic.length !== 1 || ic[0]!.integrity_check !== "ok") return { ok: false, rows: 0, error: "La base est endommagée (contrôle d'intégrité)", checkedAt };
    const have = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name)); const missing = REQUIRED.filter((t) => !have.has(t)); if (missing.length) return { ok: false, rows: 0, error: `Ce n'est pas une base Dogui Mart Pro (tables absentes : ${missing.join(", ")})`, checkedAt };
    const rows = Number((db.prepare("SELECT COUNT(*) AS n FROM rows").get() as { n: number }).n); const t = db.prepare("SELECT id, name FROM teams ORDER BY created_at LIMIT 1").get() as { id: string; name: string } | undefined;
    return { ok: true, rows, tenantId: t?.id, teamName: t?.name, checkedAt };
  } catch (e) { return { ok: false, rows: 0, error: `Fichier illisible (${(e as Error).message.slice(0, 80)})`, checkedAt }; }
  finally { try { db?.close(); } catch { /* déjà fermée */ } }
}

export type BackupSettings = { keep: number; externalDir: string | null; externalOk: boolean; externalError: string | null; externalLastAt: string | null };
export class BackupError extends Error { constructor(public status: number, message: string) { super(message); } }

/** Sauvegardes du poste : une copie automatique par jour, copies manuelles, copie avant restauration, copie externe (clé USB, disque réseau), exports chiffrés, restauration. */
export function createBackupManager(store: SqliteStore, dataDir: string, clock: () => Date = () => new Date()) {
  const dir = join(dataDir, "sauvegardes"); const tmp = join(dataDir, "tmp"); const indexFile = join(dir, "index.json");
  const readIndex = (): Record<string, Verification> => { try { return JSON.parse(readFileSync(indexFile, "utf8")); } catch { return {}; } };
  const writeIndex = (i: Record<string, Verification>) => { mkdirSync(dir, { recursive: true }); const t = `${indexFile}.tmp`; writeFileSync(t, JSON.stringify(i)); renameSync(t, indexFile); };
  const names = () => { try { return readdirSync(dir).filter((n) => kindOf(n)); } catch { return []; } };
  const keepN = () => { const k = Number(store.syncGet("backup.keep") ?? BACKUP_KEEP); return Number.isFinite(k) ? Math.min(BACKUP_KEEP_MAX, Math.max(BACKUP_KEEP_MIN, k)) : BACKUP_KEEP; };
  const extDir = () => store.syncGet("backup.externalDir");

  function copyExternal(name: string) {
    const d = extDir(); if (!d) return; const src = join(dir, name);
    try { mkdirSync(d, { recursive: true }); copyFileSync(src, join(d, `${name}.part`)); renameSync(join(d, `${name}.part`), join(d, name)); // copie complète ou rien
      for (const old of backupsToDelete(readdirSync(d).filter((n) => kindOf(n)), keepN())) rmSync(join(d, old), { force: true });
      store.syncSet("backup.externalLastAt", clock().toISOString()); store.syncSet("backup.externalError", null);
    } catch (e) { store.syncSet("backup.externalError", `Dossier externe indisponible (${d}) : ${(e as Error).message.slice(0, 120)}. La copie sera refaite dès qu'il sera disponible.`); }
  }
  function create(kind: BackupKind = "manuel", now = clock()): BackupItem {
    mkdirSync(dir, { recursive: true }); const name = backupName(now, kind); const path = join(dir, name); const part = `${path}.part`; rmSync(part, { force: true }); rmSync(path, { force: true });
    store.snapshotTo(part); renameSync(part, path); const v = verifyDbFile(path); const idx = readIndex(); idx[name] = v; writeIndex(idx);
    if (!v.ok) { store.syncSet("backup.lastFailed", now.toISOString()); throw new BackupError(500, `La sauvegarde a été créée mais elle est invalide : ${v.error}`); }
    store.syncSet("backup.lastFailed", null); for (const old of backupsToDelete(names(), keepN())) { rmSync(join(dir, old), { force: true }); delete idx[old]; } writeIndex(idx);
    if (kind !== "avant-restauration") copyExternal(name); return { name, kind, size: statSync(path).size, at: now.toISOString(), verification: v };
  }
  /** À appeler régulièrement : fait la copie du jour si elle manque, et rattrape la copie externe si le dossier est de nouveau disponible. */
  function runDaily(now = clock()): BackupItem | null {
    let made: BackupItem | null = null; if (needsDaily(names(), now)) made = create("auto", now);
    const d = extDir(); if (d && (store.syncGet("backup.externalError") || !existsSync(join(d, backupName(now, "auto"))))) { const today = backupName(now, "auto"); if (existsSync(join(dir, today))) copyExternal(today); }
    return made;
  }
  function list(): BackupItem[] {
    const idx = readIndex(); return names().map((name) => { const st = statSync(join(dir, name)); return { name, kind: kindOf(name)!, size: st.size, at: st.mtime.toISOString(), verification: idx[name] }; }).sort((a, b) => b.at.localeCompare(a.at));
  }
  const verify = (name: string): Verification => { if (!kindOf(name) || !existsSync(join(dir, name))) throw new BackupError(404, "Sauvegarde introuvable"); const v = verifyDbFile(join(dir, name)); const idx = readIndex(); idx[name] = v; writeIndex(idx); return v; };
  function settings(): BackupSettings { const d = extDir(); return { keep: keepN(), externalDir: d, externalOk: !!d && !store.syncGet("backup.externalError"), externalError: store.syncGet("backup.externalError"), externalLastAt: store.syncGet("backup.externalLastAt") }; }
  function setSettings(b: { keep?: unknown; externalDir?: unknown }): BackupSettings {
    if (b.keep !== undefined) { const k = Math.round(Number(b.keep)); if (!Number.isFinite(k) || k < BACKUP_KEEP_MIN || k > BACKUP_KEEP_MAX) throw new BackupError(400, `Nombre de sauvegardes à garder : ${BACKUP_KEEP_MIN} à ${BACKUP_KEEP_MAX}`); store.syncSet("backup.keep", String(k)); }
    if (b.externalDir !== undefined) {
      const d = b.externalDir === null || b.externalDir === "" ? null : String(b.externalDir).trim();
      if (d === null) { store.syncSet("backup.externalDir", null); store.syncSet("backup.externalError", null); }
      else {
        if (!isAbsolute(d) && !/^[A-Za-z]:[\\/]/.test(d) && !d.startsWith("\\\\")) throw new BackupError(400, "Saisissez un chemin complet (par exemple E:\\Sauvegardes)");
        const rel = relative(resolve(dataDir), resolve(d)); if (!rel.startsWith("..") && !isAbsolute(rel)) throw new BackupError(400, "Le dossier externe ne peut pas être dans le dossier des données du poste");
        try { mkdirSync(d, { recursive: true }); const probe = join(d, `.test-${Date.now()}`); writeFileSync(probe, "ok"); rmSync(probe); accessSync(d, constants.W_OK); } catch (e) { throw new BackupError(400, `Dossier inutilisable : ${(e as Error).message.slice(0, 100)}`); }
        store.syncSet("backup.externalDir", d); store.syncSet("backup.externalError", null);
      }
    }
    return settings();
  }
  const status = (hosted: boolean) => {
    const l = list(); const ok = l.filter((x) => x.verification?.ok && x.kind !== "avant-restauration")[0]; const s = settings();
    return { backups: l, settings: s, lastOkAt: ok?.at ?? null, canRestoreFile: !hosted, alert: backupAlert({ lastOkAt: ok?.at, hasBackups: l.length > 0, externalError: s.externalError, now: clock().getTime() }) };
  };
  /** Exporte une sauvegarde (de la liste, ou l'état actuel) en fichier chiffré. */
  function exportEncrypted(name: string | null, passphrase: unknown): { file: Buffer; filename: string } {
    if (!validPassphrase(passphrase)) throw new BackupError(400, "Phrase secrète : 8 caractères au moins");
    let path: string; let cleanup = false;
    if (name) { if (!kindOf(name) || !existsSync(join(dir, name))) throw new BackupError(404, "Sauvegarde introuvable"); path = join(dir, name); }
    else { mkdirSync(tmp, { recursive: true }); path = join(tmp, `export-${Date.now()}.sqlite`); store.snapshotTo(path); cleanup = true; }
    try { const v = verifyDbFile(path); if (!v.ok) throw new BackupError(409, `Cette sauvegarde est invalide : ${v.error}`); const file = encodeBackup(readFileSync(path), passphrase, { tenantId: v.tenantId, teamName: v.teamName, rows: v.rows }, clock()); return { file, filename: `dogui-mart-pro-${clock().toISOString().slice(0, 10)}.dmpbackup` }; }
    finally { if (cleanup) rmSync(path, { force: true }); }
  }
  /** Restaure une base (déjà en clair, fichier temporaire) : vérifications, copie de sécurité de l'existant, remplacement. */
  function restoreDb(srcPath: string, opts: { hosted: boolean }): { rows: number; teamName?: string; before?: string } {
    if (opts.hosted) throw new BackupError(409, "Ce poste est rattaché au cloud : restaurer un fichier ferait reculer ce poste par rapport au cloud. Utilisez « Rétablir depuis le cloud » (Paramètres → Synchronisation).");
    const v = verifyDbFile(srcPath); if (!v.ok) throw new BackupError(422, `Sauvegarde invalide : ${v.error}`);
    const cur = store.db.prepare("SELECT id FROM teams LIMIT 1").get() as { id: string } | undefined; if (cur && v.tenantId && cur.id !== v.tenantId) throw new BackupError(409, "Cette sauvegarde est celle d'un autre commerce : elle n'a pas été restaurée.");
    let before: string | undefined; if (cur) before = create("avant-restauration").name; // copie de sécurité de ce qui existe
    store.replaceDatabase(srcPath); return { rows: v.rows, teamName: v.teamName, before };
  }
  /** Restaure depuis une sauvegarde de la liste. */
  const restoreFromList = (name: string, opts: { hosted: boolean }) => { if (!kindOf(name) || !existsSync(join(dir, name))) throw new BackupError(404, "Sauvegarde introuvable"); mkdirSync(tmp, { recursive: true }); const t = join(tmp, `restore-${Date.now()}.sqlite`); copyFileSync(join(dir, name), t); try { return restoreDb(t, opts); } finally { rmSync(t, { force: true }); } };
  /** Restaure depuis un fichier exporté (.dmpbackup) et sa phrase secrète. */
  function restoreFromFile(buf: Buffer, passphrase: unknown, opts: { hosted: boolean }) {
    if (typeof passphrase !== "string" || !passphrase) throw new BackupError(400, "Phrase secrète requise");
    let dec: { header: BackupHeader; db: Buffer }; try { dec = decodeBackup(buf, passphrase); } catch (e) { if (e instanceof BackupFormatError) throw new BackupError(e.code === "passphrase" ? 403 : 422, e.message); throw e; }
    mkdirSync(tmp, { recursive: true }); const t = join(tmp, `import-${Date.now()}.sqlite`); writeFileSync(t, dec.db); try { return restoreDb(t, opts); } finally { rmSync(t, { force: true }); }
  }
  const peek = (buf: Buffer) => { try { const h = peekBackup(buf); return { createdAt: h.createdAt, teamName: h.teamName, rows: h.rows }; } catch (e) { if (e instanceof BackupFormatError) throw new BackupError(422, e.message); throw e; } };
  return { dir, create, runDaily, list, verify, settings, setSettings, status, exportEncrypted, restoreFromList, restoreFromFile, peek, tmp };
}
export type BackupManager = ReturnType<typeof createBackupManager>;
