import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import { copyFileSync, rmSync } from "node:fs";
import { argon2Verify } from "hash-wasm";
import { HttpError, type BatchOp, type DirectoryUser, type Row, type Store, type UserSecurity } from "./store";
import { readRoles } from "./permissions";
import { syncClass } from "../../../src/domain/sync-tables";

/** Stockage local (SQLite) : mêmes garanties que le stockage Appwrite de production, pour la version Windows et son réseau local.
 *  - une ligne = un document JSON dans la table `rows` (comme une table Appwrite : colonnes libres), avec ses rôles de lecture calculés à la création (permissions.ts) ;
 *  - `batch` est une vraie transaction (tout ou rien) ; `create` est idempotent (identifiant existant → false) ;
 *  - annuaire local : comptes (mots de passe hachés scrypt), équipes, appartenances, étiquettes, sessions ;
 *  - fichiers (photos, justificatifs, pièces) dans la même base : une sauvegarde = un fichier. */
export type SqliteStoreOptions = { path?: string };

const iso = () => new Date().toISOString();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const bool = (v: unknown): SQLInputValue => (typeof v === "boolean" ? (v ? 1 : 0) : (v as SQLInputValue));
/** Hachage de mot de passe (scrypt, sel aléatoire) : `scrypt$sel$empreinte`. */
export const hashPassword = (pw: string): string => { const salt = randomBytes(16).toString("hex"); return `scrypt$${salt}$${scryptSync(pw, salt, 32).toString("hex")}`; };
export const verifyPassword = (pw: string, stored: string): boolean => {
  const [alg, salt, h] = stored.split("$"); if (alg !== "scrypt" || !salt || !h) return false;
  const a = Buffer.from(h, "hex"), b = scryptSync(pw, salt, 32); return a.length === b.length && timingSafeEqual(a, b);
};

/** Vérifie un mot de passe contre une empreinte : locale (scrypt) ou venue d'Appwrite (Argon2, format PHC). Jamais d'exception : une empreinte illisible ne valide rien. */
export async function verifyCredential(pw: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored || stored === "*") return false;
  try { if (stored.startsWith("scrypt$")) return verifyPassword(pw, stored); if (/^\$argon2(id|i|d)\$/.test(stored)) return await argon2Verify({ password: pw, hash: stored }); } catch { /* empreinte illisible */ }
  return false;
}

export class SqliteStore implements Store {
  db!: DatabaseSync; // remplaçable : restauration d'une sauvegarde (replaceDatabase)
  private readonly path: string;
  /** Changements de données (table, identifiant) : alimente le temps réel du serveur local. */
  readonly events = new EventEmitter();
  private depth = 0;

  constructor(opts: SqliteStoreOptions = {}) { this.path = opts.path ?? ":memory:"; this.init(); }
  private init() {
    this.db = new DatabaseSync(this.path);
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS rows (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT, remote_at TEXT,
        data TEXT NOT NULL, read_roles TEXT NOT NULL DEFAULT '[]',
        shop_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.shopId')) VIRTUAL, UNIQUE (tbl, id));
      CREATE INDEX IF NOT EXISTS rows_tenant ON rows (tbl, tenant_id, shop_id);
      CREATE INDEX IF NOT EXISTS rows_created ON rows (tbl, created_at);
      CREATE TABLE IF NOT EXISTS outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, id TEXT NOT NULL, at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS outbox_key ON outbox (tbl, id);
      CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_conflicts (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, tbl TEXT NOT NULL, row_id TEXT NOT NULL, kind TEXT NOT NULL, local_data TEXT, cloud_data TEXT, resolved INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL, read_roles TEXT NOT NULL DEFAULT '[]', synced INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '', password TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'local', cred_cloud TEXT, cred_cache TEXT);
      CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS members (tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, roles TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', PRIMARY KEY (tenant_id, user_id));
      CREATE TABLE IF NOT EXISTS labels (user_id TEXT PRIMARY KEY, labels TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, last_seen TEXT NOT NULL, device TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '');`);
    // bases créées avant le réseau local : on ajoute l'appareil et l'adresse aux sessions
    const ucols = this.db.prepare("PRAGMA table_info(users)").all().map((c) => String(c.name));
    if (!(this.db.prepare("PRAGMA table_info(files)").all() as { name: string }[]).some((c) => c.name === "synced")) this.db.exec("ALTER TABLE files ADD COLUMN synced INTEGER NOT NULL DEFAULT 1");
    if (!ucols.includes("source")) this.db.exec("ALTER TABLE users ADD COLUMN source TEXT NOT NULL DEFAULT 'local'");
    if (!ucols.includes("cred_cloud")) this.db.exec("ALTER TABLE users ADD COLUMN cred_cloud TEXT");
    if (!ucols.includes("cred_cache")) this.db.exec("ALTER TABLE users ADD COLUMN cred_cache TEXT");
    const rcols = this.db.prepare("PRAGMA table_info(rows)").all().map((c) => String(c.name));
    if (!rcols.includes("updated_at")) { this.db.exec("ALTER TABLE rows ADD COLUMN updated_at TEXT"); this.db.exec("UPDATE rows SET updated_at = created_at WHERE updated_at IS NULL"); }
    if (!rcols.includes("remote_at")) this.db.exec("ALTER TABLE rows ADD COLUMN remote_at TEXT");
    const cols = this.db.prepare("PRAGMA table_info(sessions)").all().map((c) => String(c.name));
    if (!cols.includes("device")) this.db.exec("ALTER TABLE sessions ADD COLUMN device TEXT NOT NULL DEFAULT ''");
    if (!cols.includes("ip")) this.db.exec("ALTER TABLE sessions ADD COLUMN ip TEXT NOT NULL DEFAULT ''");
  }
  close() { this.db.close(); }
  /** Remplace TOUTE la base par une sauvegarde déjà vérifiée (restauration). Les liens avec le cloud (rattachement, file d'envoi, curseurs) sont retirés : le poste restauré redevient un poste local ordinaire. Les sessions ouvertes sont celles de la sauvegarde. */
  replaceDatabase(srcPath: string): void {
    if (this.path === ":memory:") throw new Error("Restauration impossible sur une base en mémoire");
    this.db.close(); for (const suf of ["", "-wal", "-shm"]) rmSync(this.path + suf, { force: true }); copyFileSync(srcPath, this.path); this.syncOn = false; this.init();
    this.db.exec("DELETE FROM sync_state; DELETE FROM outbox; UPDATE rows SET remote_at = NULL;"); this.events.emit("change", { table: "*", id: "*" });
  }

  // ------------------------------------------------------------------ transactions
  /** Exécute `fn` dans une transaction (imbriquée : réutilise l'externe). Toute exception annule tout. */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.db.exec("BEGIN IMMEDIATE"); this.depth++;
    try { const r = fn(); this.db.exec("COMMIT"); return r; } catch (e) { try { this.db.exec("ROLLBACK"); } catch { /* déjà annulée */ } throw e; } finally { this.depth--; }
  }
  private emit(table: string, id: string) { this.events.emit("change", { table, id }); }

  // ------------------------------------------------------------------ lignes
  private shape(r: Record<string, unknown>): Row { return { ...(JSON.parse(String(r.data)) as object), $id: String(r.id), $createdAt: String(r.created_at), $updatedAt: String(r.updated_at ?? r.created_at) } as Row; }
  private exists(table: string, id: string): boolean { return !!this.db.prepare("SELECT 1 FROM rows WHERE tbl = ? AND id = ?").get(table, id); }
  async get(table: string, id: string): Promise<Row | null> { const r = this.db.prepare("SELECT id, created_at, updated_at, data FROM rows WHERE tbl = ? AND id = ?").get(table, id); return r ? this.shape(r) : null; }
  private where(table: string, where: Record<string, string | number | boolean>, range?: { field: string; from?: string; to?: string }) {
    const sql: string[] = ["tbl = ?"]; const args: SQLInputValue[] = [table];
    for (const [k, v] of Object.entries(where)) { if (k === "tenantId") { sql.push("tenant_id = ?"); args.push(v as SQLInputValue); } else if (k === "$id") { sql.push("id = ?"); args.push(String(v)); } else { sql.push("json_extract(data, ?) = ?"); args.push(`$.${k}`, bool(v)); } }
    if (range) { const sys = range.field === "$createdAt" ? "created_at" : range.field === "$updatedAt" ? "updated_at" : ""; const f = sys || "json_extract(data, ?)"; const fa: SQLInputValue[] = sys ? [] : [`$.${range.field}`];
      if (range.from !== undefined) { sql.push(`COALESCE(${f}, '') >= ?`); args.push(...fa, range.from); } if (range.to !== undefined) { sql.push(`COALESCE(${f}, '') < ?`); args.push(...fa, range.to); } }
    return { sql: sql.join(" AND "), args };
  }
  async list(table: string, where: Record<string, string | number | boolean>, limit = 100): Promise<Row[]> {
    const w = this.where(table, where); return this.db.prepare(`SELECT id, created_at, updated_at, data FROM rows WHERE ${w.sql} ORDER BY seq LIMIT ?`).all(...w.args, limit).map((r) => this.shape(r));
  }
  async scan(table: string, where: Record<string, string | number | boolean>, opts: { range?: { field: string; from?: string; to?: string }; maxRows?: number; orderBy?: string } = {}): Promise<{ rows: Row[]; truncated: boolean }> {
    const max = opts.maxRows ?? 10_000; const w = this.where(table, where, opts.range);
    const ob = opts.orderBy === "$updatedAt" ? "updated_at, seq" : opts.orderBy === "$createdAt" ? "created_at, seq" : "seq";
    const all = this.db.prepare(`SELECT id, created_at, updated_at, data FROM rows WHERE ${w.sql} ORDER BY ${ob} LIMIT ?`).all(...w.args, max + 1);
    return { rows: all.slice(0, max).map((r) => this.shape(r)), truncated: all.length > max };
  }
  async create(table: string, id: string, tenantId: string, data: Record<string, unknown>): Promise<boolean> {
    if (this.exists(table, id)) return false; // idempotence : aucune politique de lecture n'est évaluée pour une ligne déjà là
    const { $createdAt, $id: _id, ...rest } = data as Record<string, unknown>; void _id;
    const r = this.db.prepare("INSERT OR IGNORE INTO rows (tbl, id, tenant_id, created_at, updated_at, data, read_roles) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(table, id, tenantId, String($createdAt ?? iso()), iso(), JSON.stringify(rest), JSON.stringify(readRoles(table, tenantId, rest, id)));
    if (Number(r.changes) > 0) { this.track(table, id); this.emit(table, id); }
    return Number(r.changes) > 0;
  }
  async update(table: string, id: string, data: Record<string, unknown>): Promise<void> {
    const cur = this.db.prepare("SELECT data FROM rows WHERE tbl = ? AND id = ?").get(table, id); if (!cur) throw new Error("introuvable");
    const merged = { ...(JSON.parse(String(cur.data)) as object), ...Object.fromEntries(Object.entries(data).filter(([k, v]) => v !== undefined && k !== "$id" && k !== "$createdAt")) };
    this.db.prepare("UPDATE rows SET data = ?, updated_at = ? WHERE tbl = ? AND id = ?").run(JSON.stringify(merged), iso(), table, id); this.track(table, id); this.emit(table, id);
  }
  async remove(table: string, id: string): Promise<void> { const r = this.db.prepare("DELETE FROM rows WHERE tbl = ? AND id = ?").run(table, id); if (Number(r.changes) > 0) this.track(table, id); this.emit(table, id); }
  /** Transaction : contrôles préalables (doublons, lignes absentes) puis application ; l'échec d'un contrôle n'écrit RIEN. */
  async batch(ops: BatchOp[]): Promise<void> {
    this.tx(() => {
      const seen = new Set<string>();
      for (const o of ops) { const k = `${o.table}/${o.id}`; if (o.kind === "create") { if (this.exists(o.table, o.id) || seen.has(k)) throw new HttpError(409, "Conflit d'écriture : la ligne existe déjà"); seen.add(k); } else if (o.kind === "update" && !this.exists(o.table, o.id) && !seen.has(k)) throw new HttpError(404, "Ligne introuvable"); }
      for (const o of ops) { if (o.kind === "create") { this.syncCreate(o); } else if (o.kind === "update") { this.syncUpdate(o.table, o.id, o.data); } else { const d = this.db.prepare("DELETE FROM rows WHERE tbl = ? AND id = ?").run(o.table, o.id); if (Number(d.changes) > 0) this.track(o.table, o.id); this.emit(o.table, o.id); } }
    });
  }
  private syncCreate(o: Extract<BatchOp, { kind: "create" }>) {
    const { $createdAt, $id: _id, ...rest } = o.data as Record<string, unknown>; void _id;
    this.db.prepare("INSERT INTO rows (tbl, id, tenant_id, created_at, updated_at, data, read_roles) VALUES (?, ?, ?, ?, ?, ?, ?)").run(o.table, o.id, o.tenantId, String($createdAt ?? iso()), iso(), JSON.stringify(rest), JSON.stringify(readRoles(o.table, o.tenantId, rest, o.id))); this.track(o.table, o.id); this.emit(o.table, o.id);
  }
  private syncUpdate(table: string, id: string, data: Record<string, unknown>) {
    const cur = this.db.prepare("SELECT data FROM rows WHERE tbl = ? AND id = ?").get(table, id); if (!cur) throw new Error("introuvable");
    const merged = { ...(JSON.parse(String(cur.data)) as object), ...Object.fromEntries(Object.entries(data).filter(([k, v]) => v !== undefined && k !== "$id" && k !== "$createdAt")) };
    this.db.prepare("UPDATE rows SET data = ?, updated_at = ? WHERE tbl = ? AND id = ?").run(JSON.stringify(merged), iso(), table, id); this.track(table, id); this.emit(table, id);
  }

  // ------------------------------------------------------------------ fichiers
  async putFile(fileId: string, data: Uint8Array, name: string, mime: string, readRoles: string[]): Promise<void> { this.db.prepare("INSERT OR REPLACE INTO files (id, name, mime, data, read_roles, synced) VALUES (?, ?, ?, ?, ?, ?)").run(fileId, name, mime, data, JSON.stringify(readRoles), this.syncOn && !this.applying ? 0 : 1); }
  async deleteFile(fileId: string): Promise<void> {
    const f = this.db.prepare("SELECT synced FROM files WHERE id = ?").get(fileId); this.db.prepare("DELETE FROM files WHERE id = ?").run(fileId);
    if (f && f.synced === 1 && this.syncOn && !this.applying) this.syncSet(`filedel:${fileId}`, iso()); // le cloud a ce fichier : la suppression lui sera transmise
  }
  async fileInfo(fileId: string) { const r = this.db.prepare("SELECT name, mime, read_roles FROM files WHERE id = ?").get(fileId); return r ? { name: String(r.name), mime: String(r.mime), readRoles: JSON.parse(String(r.read_roles)) as string[] } : null; }
  // Synchronisation des fichiers : envoyés après leurs lignes, reçus pour les lignes téléchargées.
  filesPending(limit = 10): { id: string; name: string; mime: string; readRoles: string[]; data: Uint8Array }[] { return this.db.prepare("SELECT id, name, mime, read_roles, data FROM files WHERE synced = 0 LIMIT ?").all(limit).map((r) => ({ id: String(r.id), name: String(r.name), mime: String(r.mime), readRoles: JSON.parse(String(r.read_roles)) as string[], data: new Uint8Array(r.data as Uint8Array) })); }
  fileAck(fileId: string): void { this.db.prepare("UPDATE files SET synced = 1 WHERE id = ?").run(fileId); }
  filesDeleted(): string[] { return (this.db.prepare("SELECT key FROM sync_state WHERE key LIKE 'filedel:%'").all() as { key: string }[]).map((r) => r.key.slice(8)); }
  hasFile(fileId: string): boolean { return !!this.db.prepare("SELECT 1 FROM files WHERE id = ?").get(fileId); }
  applyFile(fileId: string, data: Uint8Array, name: string, mime: string, readRoles: string[]): void { this.db.prepare("INSERT OR REPLACE INTO files (id, name, mime, data, read_roles, synced) VALUES (?, ?, ?, ?, ?, 1)").run(fileId, name, mime, data, JSON.stringify(readRoles)); }
  /** Fichiers cités par les lignes du poste (photo d'article, logo, pièces comptables, documents d'inventaire et d'achats) : identifiant et ligne porteuse. */
  referencedFiles(): { fileId: string; table: string; rowId: string }[] {
    const out: { fileId: string; table: string; rowId: string }[] = [];
    for (const r of this.db.prepare("SELECT tbl, id, data FROM rows WHERE data LIKE '%FileId%' OR data LIKE '%\"file\":%' OR data LIKE '%fileId%'").all()) {
      let d: Record<string, unknown>; try { d = JSON.parse(String(r.data)); } catch { continue; }
      const ids = new Set<string>(); for (const k of ["imageFileId", "logoFileId"]) if (typeof d[k] === "string" && d[k]) ids.add(d[k] as string);
      for (const k of ["pieces", "docs"]) { try { const a = typeof d[k] === "string" ? JSON.parse(d[k] as string) : d[k]; if (Array.isArray(a)) for (const x of a) { const f = (x as { file?: string; fileId?: string })?.file ?? (x as { fileId?: string })?.fileId; if (typeof f === "string" && f) ids.add(f); } } catch { /* colonne illisible : ignorée */ } }
      for (const fileId of ids) out.push({ fileId, table: String(r.tbl), rowId: String(r.id) });
    }
    return out;
  }
  async readFile(fileId: string): Promise<Uint8Array | null> { const r = this.db.prepare("SELECT data FROM files WHERE id = ?").get(fileId); return r ? new Uint8Array(r.data as Uint8Array) : null; }
  fileMeta(fileId: string): { name: string; mime: string; readRoles: string[]; data: Uint8Array } | null { const r = this.db.prepare("SELECT name, mime, read_roles, data FROM files WHERE id = ?").get(fileId); return r ? { name: String(r.name), mime: String(r.mime), readRoles: JSON.parse(String(r.read_roles)), data: new Uint8Array(r.data as Uint8Array) } : null; }

  // ------------------------------------------------------------------ annuaire local
  async membership(tenantId: string, userId: string) { const r = this.db.prepare("SELECT roles FROM members WHERE tenant_id = ? AND user_id = ?").get(tenantId, userId); return r ? { roles: JSON.parse(String(r.roles)) as string[] } : null; }
  async createUser(a: { userId: string; email: string; password: string; name: string }): Promise<void> {
    if (this.db.prepare("SELECT 1 FROM users WHERE email = ? OR id = ?").get(a.email, a.userId)) throw new HttpError(409, "Identifiant déjà utilisé");
    this.db.prepare("INSERT INTO users (id, email, name, password, active, created_at) VALUES (?, ?, ?, ?, 1, ?)").run(a.userId, a.email, a.name, hashPassword(a.password), iso());
  }
  async importUser(a: { userId: string; email: string; name: string; passwordHash: string }): Promise<void> {
    if (this.db.prepare("SELECT 1 FROM users WHERE email = ? OR id = ?").get(a.email, a.userId)) throw new HttpError(409, "Identifiant déjà utilisé");
    this.db.prepare("INSERT INTO users (id, email, name, password, active, created_at) VALUES (?, ?, ?, ?, 1, ?)").run(a.userId, a.email, a.name, a.passwordHash, iso());
  }
  /** Comptes créés SUR ce poste (jamais venus du cloud) pour le commerce, avec une empreinte de synchronisation : un changement (nom, rôle, étiquettes, activation) les fait renvoyer. */
  localAccounts(tenantId: string): { userId: string; email: string; name: string; active: boolean; roles: string[]; labels: string[]; hash: string; fp: string }[] {
    return this.db.prepare("SELECT m.user_id AS id, m.roles AS roles, u.email AS email, u.name AS name, u.active AS active, u.password AS pw FROM members m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ? AND u.source = 'local'").all(tenantId)
      .filter((r) => String(r.pw).startsWith("scrypt$")).map((r) => {
        const lab = this.db.prepare("SELECT labels FROM labels WHERE user_id = ?").get(String(r.id)); const labels = lab ? (JSON.parse(String(lab.labels)) as string[]) : []; const roles = JSON.parse(String(r.roles)) as string[];
        const fp = createHash("sha256").update(JSON.stringify([r.email, r.name, r.active, roles, [...labels].sort(), r.pw])).digest("hex");
        return { userId: String(r.id), email: String(r.email), name: String(r.name), active: r.active !== 0, roles, labels, hash: String(r.pw), fp };
      });
  }
  async deleteUser(userId: string): Promise<void> { this.db.prepare("DELETE FROM users WHERE id = ?").run(userId); this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId); }
  async listOwners(tenantId: string) {
    return this.db.prepare("SELECT m.user_id AS id, m.roles AS roles, u.name AS name, u.email AS email FROM members m LEFT JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ?").all(tenantId)
      .filter((r) => (JSON.parse(String(r.roles)) as string[]).includes("owner")).map((r) => ({ userId: String(r.id), name: String(r.name ?? r.id), email: String(r.email ?? "") }));
  }
  async userDirectory(tenantId: string): Promise<DirectoryUser[]> {
    return this.db.prepare("SELECT m.user_id AS id, m.roles AS roles, u.email AS email, u.name AS name, u.active AS active, u.password AS pw, u.cred_cloud AS cc FROM members m LEFT JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ?").all(tenantId)
      .map((r) => { const lab = this.db.prepare("SELECT labels FROM labels WHERE user_id = ?").get(String(r.id)); return { userId: String(r.id), email: String(r.email ?? ""), name: String(r.name ?? r.id), active: r.active !== 0, labels: lab ? (JSON.parse(String(lab.labels)) as string[]) : [], roles: JSON.parse(String(r.roles)) as string[], passwordHash: r.cc ? String(r.cc) : null, passwordUpdatedAt: null }; });
  }
  /** Connexion locale : cherche l'identifiant puis vérifie le mot de passe contre l'empreinte locale, celle copiée du cloud (Argon2) ou celle gardée après une première connexion en ligne. */
  async verifyLogin(email: string, password: string): Promise<{ id: string; email: string; name: string; active: boolean; known: boolean } | null> {
    const r = this.db.prepare("SELECT id, email, name, active, password, cred_cloud, cred_cache FROM users WHERE email = ?").get(email); if (!r) return null;
    const ok = (await verifyCredential(password, String(r.password))) || (await verifyCredential(password, r.cred_cloud ? String(r.cred_cloud) : null)) || (await verifyCredential(password, r.cred_cache ? String(r.cred_cache) : null));
    return ok ? { id: String(r.id), email: String(r.email), name: String(r.name), active: !!r.active, known: true } : { id: String(r.id), email: String(r.email), name: String(r.name), active: !!r.active, known: false };
  }
  /** Première connexion réussie EN LIGNE (vérifiée par le cloud) : on garde une empreinte locale pour les connexions hors ligne suivantes. */
  cacheCredential(userId: string, password: string): void { this.db.prepare("UPDATE users SET cred_cache = ? WHERE id = ?").run(hashPassword(password), userId); }
  userHasCredential(userId: string): boolean { const r = this.db.prepare("SELECT cred_cloud, cred_cache FROM users WHERE id = ?").get(userId); return !!(r?.cred_cloud || r?.cred_cache); }
  /** Copie l'annuaire du cloud sur le poste : comptes, empreintes Argon2, rôles et étiquettes. Un mot de passe modifié ferme les sessions de la personne ; un compte désactivé ou retiré perd l'accès. Les comptes créés sur le poste ne sont jamais retirés. */
  applyDirectory(tenantId: string, dir: DirectoryUser[]): { created: number; updated: number; removed: number; skipped: string[] } {
    const out = { created: 0, updated: 0, removed: 0, skipped: [] as string[] }; const seen = new Set<string>();
    this.tx(() => {
      for (const d of dir) {
        seen.add(d.userId); const ex = this.db.prepare("SELECT id, source, cred_cloud, active FROM users WHERE id = ?").get(d.userId);
        const clash = this.db.prepare("SELECT id FROM users WHERE email = ? AND id <> ?").get(d.email, d.userId); if (clash) { out.skipped.push(`${d.email} : identifiant déjà utilisé par un autre compte du poste`); continue; }
        if (!ex) { this.db.prepare("INSERT INTO users (id, email, name, password, active, created_at, source, cred_cloud) VALUES (?, ?, ?, '*', ?, ?, 'cloud', ?)").run(d.userId, d.email, d.name, d.active ? 1 : 0, iso(), d.passwordHash); out.created++; }
        else {
          const changed = d.passwordHash !== null && d.passwordHash !== (ex.cred_cloud ? String(ex.cred_cloud) : null);
          this.db.prepare("UPDATE users SET email = ?, name = ?, active = ?, source = CASE WHEN source = 'local' THEN 'local' ELSE 'cloud' END, cred_cloud = COALESCE(?, cred_cloud)" + (changed ? ", cred_cache = NULL" : "") + " WHERE id = ?").run(d.email, d.name, d.active ? 1 : 0, d.passwordHash, d.userId);
          if (changed || !d.active) this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(d.userId); out.updated++;
        }
        this.db.prepare("INSERT OR REPLACE INTO members (tenant_id, user_id, roles, name) VALUES (?, ?, ?, ?)").run(tenantId, d.userId, JSON.stringify(d.roles), d.name);
        this.db.prepare("INSERT OR REPLACE INTO labels (user_id, labels) VALUES (?, ?)").run(d.userId, JSON.stringify(d.labels));
      }
      for (const m of this.db.prepare("SELECT m.user_id AS id FROM members m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ? AND u.source = 'cloud'").all(tenantId)) if (!seen.has(String(m.id))) { this.db.prepare("DELETE FROM members WHERE tenant_id = ? AND user_id = ?").run(tenantId, String(m.id)); this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(String(m.id)); this.db.prepare("DELETE FROM labels WHERE user_id = ?").run(String(m.id)); out.removed++; }
    });
    return out;
  }
  async setLabels(userId: string, labels: string[]): Promise<void> { this.db.prepare("INSERT OR REPLACE INTO labels (user_id, labels) VALUES (?, ?)").run(userId, JSON.stringify(labels)); }
  async setUserActive(userId: string, active: boolean): Promise<void> { this.db.prepare("UPDATE users SET active = ? WHERE id = ?").run(active ? 1 : 0, userId); if (!active) this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId); }
  async setPassword(userId: string, password: string): Promise<void> { this.db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hashPassword(password), userId); this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId); }
  async userSecurity(userId: string): Promise<UserSecurity> {
    const last = this.db.prepare("SELECT MAX(created_at) AS t FROM sessions WHERE user_id = ?").get(userId); const since = new Date(Date.now() - 864e5).toISOString();
    const n = this.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND created_at >= ?").get(userId, since);
    return { lastLogin: last?.t ? String(last.t) : null, sessions24h: Number(n?.n ?? 0), mfa: false };
  }
  async addMember(tenantId: string, userId: string, roles: string[], name = ""): Promise<void> { this.db.prepare("INSERT OR REPLACE INTO members (tenant_id, user_id, roles, name) VALUES (?, ?, ?, ?)").run(tenantId, userId, JSON.stringify(roles), name); }
  async setMemberRoles(tenantId: string, userId: string, roles: string[]): Promise<void> { this.db.prepare("UPDATE members SET roles = ? WHERE tenant_id = ? AND user_id = ?").run(JSON.stringify(roles), tenantId, userId); }
  async removeMember(tenantId: string, userId: string): Promise<void> { this.db.prepare("DELETE FROM members WHERE tenant_id = ? AND user_id = ?").run(tenantId, userId); }

  // ------------------------------------------------------------------ synchronisation avec le cloud
  /** Vrai quand ce poste héberge le commerce : chaque écriture d'une table envoyée au cloud est notée dans le journal des envois. */
  syncOn = false; private applying = false;
  private track(table: string, id: string) { if (!this.syncOn || this.applying) return; const c = syncClass(table); if (!c || c === "cloud") return; this.db.prepare("INSERT INTO outbox (tbl, id, at) VALUES (?, ?, ?)").run(table, id, iso()); }
  syncGet(key: string): string | null { const r = this.db.prepare("SELECT value FROM sync_state WHERE key = ?").get(key); return r ? String(r.value) : null; }
  syncSet(key: string, value: string | null): void { if (value === null) this.db.prepare("DELETE FROM sync_state WHERE key = ?").run(key); else this.db.prepare("INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)").run(key, value); }
  /** Envois en attente : une entrée par ligne (la dernière écriture seule compte), dans l'ordre de première modification. `upsert` si la ligne existe encore, `remove` sinon. */
  outboxPending(limit = 200): { table: string; id: string; op: "upsert" | "remove"; mx: number; row?: Row; remoteAt: string | null }[] {
    const keys = this.db.prepare("SELECT tbl, id, MAX(seq) AS mx, MIN(seq) AS mn FROM outbox GROUP BY tbl, id ORDER BY mn LIMIT ?").all(limit);
    return keys.map((k) => { const t = String(k.tbl), id = String(k.id); const r = this.db.prepare("SELECT id, created_at, updated_at, remote_at, data FROM rows WHERE tbl = ? AND id = ?").get(t, id);
      return r ? { table: t, id, op: "upsert" as const, mx: Number(k.mx), row: this.shape(r), remoteAt: r.remote_at ? String(r.remote_at) : null } : { table: t, id, op: "remove" as const, mx: Number(k.mx), remoteAt: null }; });
  }
  outboxCount(): number { return Number(this.db.prepare("SELECT COUNT(*) AS n FROM (SELECT 1 FROM outbox GROUP BY tbl, id)").get()?.n ?? 0); }
  /** Envoi réussi : retire les écritures jusqu'à `mx` pour cette ligne (une écriture plus récente reste en attente) et mémorise la date côté cloud. */
  outboxAck(table: string, id: string, mx: number, remoteAt?: string): void { this.db.prepare("DELETE FROM outbox WHERE tbl = ? AND id = ? AND seq <= ?").run(table, id, mx); if (remoteAt) this.db.prepare("UPDATE rows SET remote_at = ? WHERE tbl = ? AND id = ?").run(remoteAt, table, id); }
  /** Date de la dernière version du cloud connue pour cette ligne (null si la ligne n'est que locale). */
  remoteAtOf(table: string, id: string): string | null { const r = this.db.prepare("SELECT remote_at FROM rows WHERE tbl = ? AND id = ?").get(table, id); return r?.remote_at ? String(r.remote_at) : null; }
  hasPending(table: string, id: string): boolean { return !!this.db.prepare("SELECT 1 FROM outbox WHERE tbl = ? AND id = ?").get(table, id); }
  /** Applique une ligne reçue du cloud (sans la renvoyer) : conserve les dates du cloud. */
  applyRemote(table: string, id: string, tenantId: string, data: Record<string, unknown>, createdAt: string, updatedAt: string): void {
    this.applying = true; try { const clean = Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith("$")));
      const roles = JSON.stringify(readRoles(table, tenantId, clean, id)); const ex = this.db.prepare("SELECT 1 FROM rows WHERE tbl = ? AND id = ?").get(table, id);
      if (ex) this.db.prepare("UPDATE rows SET data = ?, updated_at = ?, remote_at = ?, read_roles = ? WHERE tbl = ? AND id = ?").run(JSON.stringify(clean), updatedAt, updatedAt, roles, table, id);
      else this.db.prepare("INSERT INTO rows (tbl, id, tenant_id, created_at, updated_at, remote_at, data, read_roles) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(table, id, tenantId, createdAt, updatedAt, updatedAt, JSON.stringify(clean), roles);
      this.emit(table, id); } finally { this.applying = false; }
  }
  /** Copie cohérente de la base dans un fichier (avant une restauration). */
  snapshotTo(path: string): void { this.db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`); }
  /** Vide le miroir du commerce (lignes, fichiers, file d'envoi, curseurs) avant un nouveau téléchargement complet. Comptes, équipe et journal des conflits sont conservés. */
  wipeMirror(): void {
    this.applying = true;
    try { this.tx(() => { this.db.exec("DELETE FROM rows; DELETE FROM outbox; DELETE FROM files;"); for (const k of this.db.prepare("SELECT key FROM sync_state WHERE key LIKE 'pull:%' OR key LIKE 'filemiss:%' OR key LIKE 'filedel:%' OR key LIKE 'userpush:%' OR key = 'reconciledAt'").all() as { key: string }[]) this.db.prepare("DELETE FROM sync_state WHERE key = ?").run(k.key); }); } finally { this.applying = false; }
  }
  /** Lignes de la table connues du cloud (reçues ou déjà envoyées et acquittées) et sans envoi en attente. */
  syncedIds(table: string): string[] { return (this.db.prepare("SELECT id FROM rows WHERE tbl = ? AND remote_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.tbl = rows.tbl AND o.id = rows.id)").all(table) as { id: string }[]).map((r) => String(r.id)); }
  removeRemote(table: string, id: string): void { this.applying = true; try { this.db.prepare("DELETE FROM rows WHERE tbl = ? AND id = ?").run(table, id); this.emit(table, id); } finally { this.applying = false; } }
  addConflict(table: string, rowId: string, kind: string, local: unknown, cloud: unknown): void { this.db.prepare("INSERT INTO sync_conflicts (at, tbl, row_id, kind, local_data, cloud_data) VALUES (?, ?, ?, ?, ?, ?)").run(iso(), table, rowId, kind, JSON.stringify(local ?? null), JSON.stringify(cloud ?? null)); }
  conflicts(onlyOpen = true): { id: number; at: string; table: string; rowId: string; kind: string; local: unknown; cloud: unknown; resolved: boolean }[] {
    return this.db.prepare(`SELECT id, at, tbl, row_id, kind, local_data, cloud_data, resolved FROM sync_conflicts ${onlyOpen ? "WHERE resolved = 0" : ""} ORDER BY id DESC LIMIT 200`).all().map((r) => ({ id: Number(r.id), at: String(r.at), table: String(r.tbl), rowId: String(r.row_id), kind: String(r.kind), local: JSON.parse(String(r.local_data ?? "null")), cloud: JSON.parse(String(r.cloud_data ?? "null")), resolved: !!r.resolved }));
  }
  resolveConflict(id: number): void { this.db.prepare("UPDATE sync_conflicts SET resolved = 1 WHERE id = ?").run(id); }

  // ------------------------------------------------------------------ authentification locale (serveur local)
  createTeam(teamId: string, name: string): void { this.db.prepare("INSERT OR IGNORE INTO teams (id, name, created_at) VALUES (?, ?, ?)").run(teamId, name, iso()); }
  teamsOf(userId: string): { id: string; name: string; roles: string[] }[] {
    return this.db.prepare("SELECT m.tenant_id AS id, m.roles AS roles, t.name AS name FROM members m LEFT JOIN teams t ON t.id = m.tenant_id WHERE m.user_id = ?").all(userId).map((r) => ({ id: String(r.id), name: String(r.name ?? ""), roles: JSON.parse(String(r.roles)) as string[] }));
  }
  membersOf(tenantId: string): { userId: string; roles: string[] }[] { return this.db.prepare("SELECT user_id, roles FROM members WHERE tenant_id = ?").all(tenantId).map((r) => ({ userId: String(r.user_id), roles: JSON.parse(String(r.roles)) as string[] })); }
  userByEmail(email: string): { id: string; email: string; name: string; active: boolean; password: string } | null {
    const r = this.db.prepare("SELECT id, email, name, active, password FROM users WHERE email = ?").get(email); return r ? { id: String(r.id), email: String(r.email), name: String(r.name), active: !!r.active, password: String(r.password) } : null;
  }
  userById(id: string): { id: string; email: string; name: string; active: boolean } | null { const r = this.db.prepare("SELECT id, email, name, active FROM users WHERE id = ?").get(id); return r ? { id: String(r.id), email: String(r.email), name: String(r.name), active: !!r.active } : null; }
  /** Ouvre une session : renvoie le jeton (seule son empreinte est conservée). */
  openSession(userId: string, device = "", ip = ""): string { const token = randomBytes(32).toString("hex"); const now = iso(); this.db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, last_seen, device, ip) VALUES (?, ?, ?, ?, ?, ?)").run(sha(token), userId, now, now, device.slice(0, 80), ip.slice(0, 60)); return token; }
  /** Marque la session comme vue (au plus une écriture par 30 secondes) : sert à la liste des appareils connectés. */
  touchSession(token: string): void { const now = iso(); this.db.prepare("UPDATE sessions SET last_seen = ? WHERE token_hash = ? AND last_seen < ?").run(now, sha(token), new Date(Date.now() - 30_000).toISOString()); }
  /** Appareils connectés à un commerce : sessions des membres de l'équipe, avec dernier passage. `id` est un identifiant court (jamais le jeton). */
  sessionsOfTenant(tenantId: string): { id: string; userId: string; name: string; roles: string[]; device: string; ip: string; createdAt: string; lastSeen: string }[] {
    return this.db.prepare("SELECT s.token_hash AS h, s.user_id AS uid, s.device AS device, s.ip AS ip, s.created_at AS c, s.last_seen AS l, m.roles AS roles, u.name AS name FROM sessions s JOIN members m ON m.user_id = s.user_id AND m.tenant_id = ? LEFT JOIN users u ON u.id = s.user_id ORDER BY s.last_seen DESC").all(tenantId)
      .map((r) => ({ id: String(r.h).slice(0, 16), userId: String(r.uid), name: String(r.name ?? r.uid), roles: JSON.parse(String(r.roles)) as string[], device: String(r.device), ip: String(r.ip), createdAt: String(r.c), lastSeen: String(r.l) }));
  }
  /** Ferme une session d'un membre du commerce (identifiant court) : l'appareil doit se reconnecter. Renvoie vrai si une session a été fermée. */
  revokeSession(tenantId: string, id: string): boolean {
    const r = this.db.prepare("DELETE FROM sessions WHERE substr(token_hash, 1, 16) = ? AND user_id IN (SELECT user_id FROM members WHERE tenant_id = ?)").run(id, tenantId); return Number(r.changes) > 0;
  }
  sessionUser(token: string): string | null { const r = this.db.prepare("SELECT s.user_id AS id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND u.active = 1").get(sha(token)); return r ? String(r.id) : null; }
  closeSession(token: string): void { this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha(token)); }
  /** Rôles d'authentification d'un utilisateur, comme Appwrite les calcule : compte, équipes, rôles d'équipe, étiquettes. */
  rolesOf(userId: string): string[] {
    const lab = this.db.prepare("SELECT labels FROM labels WHERE user_id = ?").get(userId); const out = [`user:${userId}`, ...(lab ? (JSON.parse(String(lab.labels)) as string[]).map((l) => `label:${l}`) : [])];
    for (const t of this.teamsOf(userId)) out.push(`team:${t.id}`, ...t.roles.map((r) => `team:${t.id}/${r}`));
    return out;
  }
}
