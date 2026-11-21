import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import { HttpError, type BatchOp, type Row, type Store, type UserSecurity } from "./store";
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

export class SqliteStore implements Store {
  readonly db: DatabaseSync;
  /** Changements de données (table, identifiant) : alimente le temps réel du serveur local. */
  readonly events = new EventEmitter();
  private depth = 0;

  constructor(opts: SqliteStoreOptions = {}) {
    this.db = new DatabaseSync(opts.path ?? ":memory:");
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
      CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL, read_roles TEXT NOT NULL DEFAULT '[]');
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '', password TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS members (tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, roles TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', PRIMARY KEY (tenant_id, user_id));
      CREATE TABLE IF NOT EXISTS labels (user_id TEXT PRIMARY KEY, labels TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, last_seen TEXT NOT NULL, device TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '');`);
    // bases créées avant le réseau local : on ajoute l'appareil et l'adresse aux sessions
    const rcols = this.db.prepare("PRAGMA table_info(rows)").all().map((c) => String(c.name));
    if (!rcols.includes("updated_at")) { this.db.exec("ALTER TABLE rows ADD COLUMN updated_at TEXT"); this.db.exec("UPDATE rows SET updated_at = created_at WHERE updated_at IS NULL"); }
    if (!rcols.includes("remote_at")) this.db.exec("ALTER TABLE rows ADD COLUMN remote_at TEXT");
    const cols = this.db.prepare("PRAGMA table_info(sessions)").all().map((c) => String(c.name));
    if (!cols.includes("device")) this.db.exec("ALTER TABLE sessions ADD COLUMN device TEXT NOT NULL DEFAULT ''");
    if (!cols.includes("ip")) this.db.exec("ALTER TABLE sessions ADD COLUMN ip TEXT NOT NULL DEFAULT ''");
  }
  close() { this.db.close(); }

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
  async putFile(fileId: string, data: Uint8Array, name: string, mime: string, readRoles: string[]): Promise<void> { this.db.prepare("INSERT OR REPLACE INTO files (id, name, mime, data, read_roles) VALUES (?, ?, ?, ?, ?)").run(fileId, name, mime, data, JSON.stringify(readRoles)); }
  async deleteFile(fileId: string): Promise<void> { this.db.prepare("DELETE FROM files WHERE id = ?").run(fileId); }
  async readFile(fileId: string): Promise<Uint8Array | null> { const r = this.db.prepare("SELECT data FROM files WHERE id = ?").get(fileId); return r ? new Uint8Array(r.data as Uint8Array) : null; }
  fileMeta(fileId: string): { name: string; mime: string; readRoles: string[]; data: Uint8Array } | null { const r = this.db.prepare("SELECT name, mime, read_roles, data FROM files WHERE id = ?").get(fileId); return r ? { name: String(r.name), mime: String(r.mime), readRoles: JSON.parse(String(r.read_roles)), data: new Uint8Array(r.data as Uint8Array) } : null; }

  // ------------------------------------------------------------------ annuaire local
  async membership(tenantId: string, userId: string) { const r = this.db.prepare("SELECT roles FROM members WHERE tenant_id = ? AND user_id = ?").get(tenantId, userId); return r ? { roles: JSON.parse(String(r.roles)) as string[] } : null; }
  async createUser(a: { userId: string; email: string; password: string; name: string }): Promise<void> {
    if (this.db.prepare("SELECT 1 FROM users WHERE email = ? OR id = ?").get(a.email, a.userId)) throw new HttpError(409, "Identifiant déjà utilisé");
    this.db.prepare("INSERT INTO users (id, email, name, password, active, created_at) VALUES (?, ?, ?, ?, 1, ?)").run(a.userId, a.email, a.name, hashPassword(a.password), iso());
  }
  async deleteUser(userId: string): Promise<void> { this.db.prepare("DELETE FROM users WHERE id = ?").run(userId); this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId); }
  async listOwners(tenantId: string) {
    return this.db.prepare("SELECT m.user_id AS id, m.roles AS roles, u.name AS name, u.email AS email FROM members m LEFT JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ?").all(tenantId)
      .filter((r) => (JSON.parse(String(r.roles)) as string[]).includes("owner")).map((r) => ({ userId: String(r.id), name: String(r.name ?? r.id), email: String(r.email ?? "") }));
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
