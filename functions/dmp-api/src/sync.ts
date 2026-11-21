import { PULLED_TABLES, SYNC_CLASS_OF, syncClass } from "../../../src/domain/sync-tables";
import { HttpError, need, type Ctx, type DirectoryUser, type Row, type Store } from "./store";

/** Synchronisation d'un poste local avec le cloud (miroir du commerce). Réservée au PROPRIÉTAIRE du commerce, contrôlée ici : un poste ne porte jamais de clé d'administration.
 *  - `sync.push` : le poste envoie ses lignes modifiées (tables « locales » et « partagées » seulement) ; chaque ligne est rattachée de force au commerce de l'appelant ;
 *  - `sync.pull` : le poste reçoit les lignes d'une table modifiées depuis une date (tables « cloud » et « partagées » en continu ; toutes les tables pour le téléchargement initial). */
export const MAX_PUSH_ROWS = 200, MAX_ROW_BYTES = 64 * 1024, MAX_PULL_ROWS = 500;
const ID_RE = /^[A-Za-z0-9_.-]{1,36}$/;

export type PushRow = { table: string; id: string; op: "upsert" | "remove"; data?: Record<string, unknown>; createdAt?: string; baseAt?: string | null };
export type PushResult = { id: string; table: string; status: "applied" | "removed" | "overwrote" | "rejected"; remoteAt?: string; error?: string; /** version du cloud écrasée (tables partagées) : conservée côté poste pour examen */ overwritten?: Row };

const clean = (d: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(d).filter(([k, v]) => !k.startsWith("$") && v !== undefined));

export async function syncPush(store: Store, ctx: Ctx, b: { rows?: PushRow[] }): Promise<{ results: PushResult[] }> {
  need(ctx, "owner"); const rows = Array.isArray(b.rows) ? b.rows : []; if (rows.length > MAX_PUSH_ROWS) throw new HttpError(400, `${MAX_PUSH_ROWS} lignes au maximum par envoi`);
  const shopOk = new Map<string, boolean>(); const shopInTenant = async (id: string) => { if (!shopOk.has(id)) { const sh = await store.get("shops", id); shopOk.set(id, !!sh && sh.tenantId === ctx.tenantId); } return shopOk.get(id)!; };
  const out: PushResult[] = [];
  for (const r of rows) {
    const base = { id: String(r?.id ?? ""), table: String(r?.table ?? "") }; const reject = (error: string) => out.push({ ...base, status: "rejected", error });
    const cls = syncClass(base.table); if (!cls) { reject("Table inconnue"); continue; } if (cls === "cloud") { reject("Table gérée par la plateforme : jamais envoyée par un poste"); continue; }
    if (!ID_RE.test(base.id)) { reject("Identifiant invalide"); continue; }
    try {
      const cur = await store.get(base.table, base.id);
      if (cur && cur.tenantId !== ctx.tenantId) { reject("Ligne d'un autre commerce"); continue; } // jamais d'écrasement entre commerces
      if (r.op === "remove") { if (cur) await store.remove(base.table, base.id); out.push({ ...base, status: "removed" }); continue; }
      if (r.op !== "upsert" || !r.data || typeof r.data !== "object") { reject("Opération invalide"); continue; }
      const data = clean(r.data); if (JSON.stringify(data).length > MAX_ROW_BYTES) { reject("Ligne trop volumineuse"); continue; }
      data.tenantId = ctx.tenantId; // rattachement forcé : on n'écrit que dans le commerce de l'appelant
      if (base.table === "shops") { if (base.id.length > 36) { reject("Identifiant invalide"); continue; } } else if (typeof data.shopId === "string" && data.shopId && !(await shopInTenant(data.shopId))) { reject("Boutique inconnue dans ce commerce"); continue; }
      if (!cur) { const created = await store.create(base.table, base.id, ctx.tenantId, { ...data, ...(r.createdAt ? { $createdAt: r.createdAt } : {}) }); if (!created) { reject("Conflit de création"); continue; } }
      else {
        // tables partagées : si le cloud a changé depuis la dernière version vue par le poste, le poste l'emporte et la version écrasée lui est renvoyée (journal des conflits)
        const changedOnCloud = cls === "shared" && !!r.baseAt && String(cur.$updatedAt ?? "") > String(r.baseAt); const unseen = cls === "shared" && !r.baseAt;
        const before = changedOnCloud || unseen ? clean(cur) : undefined; await store.update(base.table, base.id, data);
        const after = await store.get(base.table, base.id); out.push({ ...base, status: before ? "overwrote" : "applied", remoteAt: String(after?.$updatedAt ?? ""), ...(before ? { overwritten: before as Row } : {}) }); continue;
      }
      const after = await store.get(base.table, base.id); out.push({ ...base, status: "applied", remoteAt: String(after?.$updatedAt ?? "") });
    } catch (e) { out.push({ ...base, status: "rejected", error: e instanceof HttpError ? e.message : "Erreur d'écriture" }); }
  }
  return { results: out };
}

export async function syncPull(store: Store, ctx: Ctx, b: { table?: string; since?: string; limit?: number }): Promise<{ rows: { id: string; createdAt: string; updatedAt: string; data: Record<string, unknown> }[]; next: string; more: boolean }> {
  need(ctx, "owner"); const table = String(b.table ?? ""); if (!(table in SYNC_CLASS_OF)) throw new HttpError(400, "Table inconnue");
  const limit = Math.min(MAX_PULL_ROWS, Math.max(1, Math.floor(Number(b.limit) || MAX_PULL_ROWS))); const since = typeof b.since === "string" && b.since ? b.since : "";
  const scan = await store.scan(table, { tenantId: ctx.tenantId }, { range: { field: "$updatedAt", ...(since ? { from: since } : {}) }, orderBy: "$updatedAt", maxRows: 20_000 }); // trié par date de modification : une lecture tronquée est un début de liste sûr
  const sorted = scan.rows.sort((a, c) => String(a.$updatedAt ?? "").localeCompare(String(c.$updatedAt ?? "")) || a.$id.localeCompare(c.$id)); let end = Math.min(limit, sorted.length); while (end < sorted.length && end < 5_000 && String(sorted[end]!.$updatedAt ?? "") === String(sorted[end - 1]!.$updatedAt ?? "")) end++; // un même instant n'est jamais coupé en deux (le curseur serait bloqué)
  const page = sorted.slice(0, end);
  const more = sorted.length > end || scan.truncated; const next = page.length ? String(page[page.length - 1]!.$updatedAt ?? since) : since;
  return { rows: page.map((r) => ({ id: r.$id, createdAt: String(r.$createdAt ?? ""), updatedAt: String(r.$updatedAt ?? r.$createdAt ?? ""), data: clean(r) })), next, more };
}
/** Identifiants présents au cloud pour une table PARTAGÉE : le poste en déduit les lignes supprimées côté cloud. `truncated` : liste incomplète, le poste ne conclut rien. */
export async function syncIds(store: Store, ctx: Ctx, b: { table?: string }): Promise<{ ids: string[]; truncated: boolean }> {
  need(ctx, "owner"); const table = String(b.table ?? ""); if (SYNC_CLASS_OF[table] !== "shared") throw new HttpError(400, "Table inconnue ou non partagée");
  const s = await store.scan(table, { tenantId: ctx.tenantId }, { maxRows: 20_000 }); return { ids: s.rows.map((r) => r.$id), truncated: !!s.truncated };
}
/** Annuaire du commerce pour le poste : comptes, rôles, étiquettes et empreintes de mots de passe (Argon2, jamais le mot de passe). Propriétaire seulement ; uniquement les membres de CE commerce. */
export async function syncUsers(store: Store, ctx: Ctx): Promise<{ users: DirectoryUser[] }> { need(ctx, "owner"); return { users: await store.userDirectory(ctx.tenantId) }; }
/** Comptes créés sur le poste (employés) : le cloud les crée avec l'empreinte scrypt locale (le mot de passe n'est jamais connu) pour qu'ils puissent se connecter après un retour au cloud.
 *  Propriétaire seulement ; jamais le rôle « owner » ; étiquettes limitées aux boutiques du commerce ; un compte déjà membre voit seulement ses rôles, étiquettes et activation mis à jour. */
export type UserPushIn = { userId: string; email: string; name: string; active: boolean; roles: string[]; labels: string[]; hash: string };
export type UserPushResult = { userId: string; status: "created" | "updated" | "refused"; error?: string };
const LABEL_RE = /^([sgkuia])([A-Za-z0-9]{1,35})$/;
export async function syncUserPush(store: Store, ctx: Ctx, b: { users?: UserPushIn[] }): Promise<{ results: UserPushResult[] }> {
  need(ctx, "owner"); const list = Array.isArray(b.users) ? b.users : []; if (list.length > 50) throw new HttpError(400, "Trop de comptes (50 maximum)");
  const shops = new Set((await store.scan("shops", { tenantId: ctx.tenantId }, { maxRows: 500 })).rows.map((r) => String(r.$id))); const members = new Map((await store.userDirectory(ctx.tenantId)).map((d) => [d.userId, d]));
  const results: UserPushResult[] = [];
  for (const u of list) {
    const r = (status: UserPushResult["status"], error?: string) => results.push({ userId: String(u?.userId ?? ""), status, error });
    if (!u || !ID_RE.test(String(u.userId)) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(u.email)) || !Array.isArray(u.roles) || !Array.isArray(u.labels)) { r("refused", "Compte invalide"); continue; }
    if (u.roles.length === 0 || u.roles.some((x) => x !== "manager" && x !== "cashier")) { r("refused", "Rôle non autorisé (le rôle propriétaire ne se transmet jamais)"); continue; }
    if (u.labels.length > 200 || u.labels.some((l) => { const m = LABEL_RE.exec(String(l)); return !m || !shops.has(m[2]!); })) { r("refused", "Étiquette hors des boutiques du commerce"); continue; }
    const name = String(u.name ?? "").trim().slice(0, 100) || String(u.email); const ex = members.get(u.userId);
    try {
      if (ex) { if (ex.roles.includes("owner")) { r("refused", "Ce compte est propriétaire"); continue; } await store.setLabels(u.userId, u.active ? u.labels : []); await store.setMemberRoles(ctx.tenantId, u.userId, u.roles); await store.setUserActive(u.userId, !!u.active); r("updated"); continue; }
      await store.importUser({ userId: u.userId, email: String(u.email).trim().toLowerCase(), name, passwordHash: String(u.hash) });
      try { await store.setLabels(u.userId, u.active ? u.labels : []); await store.addMember(ctx.tenantId, u.userId, u.roles, name); if (!u.active) await store.setUserActive(u.userId, false); } catch (e) { await store.deleteUser(u.userId).catch(() => {}); throw e; }
      r("created");
    } catch (e) { r("refused", e instanceof HttpError ? e.message : "Erreur interne"); }
  }
  return { results };
}
/** Fichiers (photos, logos, pièces) d'un poste. Propriétaire seulement ; 5 Mo maximum ; le contenu fait foi (type reconnu par ses premiers octets) ; les droits de lecture ne peuvent viser que ce commerce
 *  (rôle propriétaire du commerce obligatoire, étiquettes de ses boutiques seulement). Un fichier existant n'est jamais écrasé (identifiants uniques, contenu immuable). */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const FILE_ID_RE = /^[A-Za-z0-9_.-]{1,36}$/;
const sniff = (b: Uint8Array): string | null => b.length < 12 ? null : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? "image/jpeg" : b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 ? "image/png" : String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP" ? "image/webp" : String.fromCharCode(...b.slice(0, 4)) === "%PDF" ? "application/pdf" : null;
async function checkRoles(store: Store, ctx: Ctx, roles: unknown): Promise<string[]> {
  if (!Array.isArray(roles) || roles.length === 0 || roles.length > 100) throw new HttpError(400, "Droits de lecture invalides");
  const owner = `team:${ctx.tenantId}/owner`; if (!roles.includes(owner)) throw new HttpError(403, "Fichier d'un autre commerce"); const shops = new Set((await store.scan("shops", { tenantId: ctx.tenantId }, { maxRows: 500 })).rows.map((r) => String(r.$id)));
  for (const r of roles) { const s = String(r); if (s === owner) continue; const m = /^label:([sgkuia])([A-Za-z0-9]{1,35})$/.exec(s); if (!m || !shops.has(m[2]!)) throw new HttpError(403, "Droit de lecture hors des boutiques du commerce"); }
  return roles.map(String);
}
export async function syncFileUp(store: Store, ctx: Ctx, b: { fileId?: string; name?: string; data?: string; readRoles?: unknown }): Promise<{ status: "stored" | "exists" }> {
  need(ctx, "owner"); const fileId = String(b.fileId ?? ""); if (!FILE_ID_RE.test(fileId)) throw new HttpError(400, "Identifiant de fichier invalide");
  if (typeof b.data !== "string" || !/^[A-Za-z0-9+/]+=*$/.test(b.data)) throw new HttpError(400, "Contenu invalide"); const bytes = new Uint8Array(Buffer.from(b.data, "base64"));
  if (bytes.length > MAX_FILE_BYTES) throw new HttpError(413, "Fichier trop lourd (5 Mo maximum)"); const mime = sniff(bytes); if (!mime) throw new HttpError(400, "Format non pris en charge (JPEG, PNG, WebP ou PDF)");
  const roles = await checkRoles(store, ctx, b.readRoles); const have = await store.fileInfo(fileId);
  if (have) { if (!have.readRoles.includes(`team:${ctx.tenantId}/owner`)) throw new HttpError(403, "Identifiant de fichier déjà utilisé"); return { status: "exists" }; }
  const name = String(b.name ?? "").replace(/[^\w.\- ]/g, "_").slice(0, 100) || fileId; await store.putFile(fileId, bytes, name, mime, roles); return { status: "stored" };
}
export async function syncFileDown(store: Store, ctx: Ctx, b: { fileId?: string }): Promise<{ name: string; mime: string; data: string; readRoles: string[] }> {
  need(ctx, "owner"); const fileId = String(b.fileId ?? ""); if (!FILE_ID_RE.test(fileId)) throw new HttpError(400, "Identifiant de fichier invalide");
  const info = await store.fileInfo(fileId); if (!info || !info.readRoles.includes(`team:${ctx.tenantId}/owner`)) throw new HttpError(404, "Fichier introuvable"); const data = await store.readFile(fileId); if (!data) throw new HttpError(404, "Fichier introuvable");
  return { name: info.name, mime: info.mime, data: Buffer.from(data).toString("base64"), readRoles: info.readRoles };
}
export async function syncFileDelete(store: Store, ctx: Ctx, b: { fileId?: string }): Promise<{ deleted: boolean }> {
  need(ctx, "owner"); const fileId = String(b.fileId ?? ""); if (!FILE_ID_RE.test(fileId)) throw new HttpError(400, "Identifiant de fichier invalide");
  const info = await store.fileInfo(fileId); if (!info) return { deleted: false }; if (!info.readRoles.includes(`team:${ctx.tenantId}/owner`)) throw new HttpError(403, "Fichier d'un autre commerce"); await store.deleteFile(fileId); return { deleted: true };
}
/** Tables que le poste interroge en continu (le téléchargement initial les interroge toutes). */
export { PULLED_TABLES };
