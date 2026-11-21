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
/** Annuaire du commerce pour le poste : comptes, rôles, étiquettes et empreintes de mots de passe (Argon2, jamais le mot de passe). Propriétaire seulement ; uniquement les membres de CE commerce. */
export async function syncUsers(store: Store, ctx: Ctx): Promise<{ users: DirectoryUser[] }> { need(ctx, "owner"); return { users: await store.userDirectory(ctx.tenantId) }; }
/** Tables que le poste interroge en continu (le téléchargement initial les interroge toutes). */
export { PULLED_TABLES };
