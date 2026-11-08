import { Client, Permission, Query, Storage, TablesDB, Teams, Users } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import { HttpError, type Row, type Store } from "./store";
import { readRoles } from "./permissions";

export function appwriteStore(endpoint: string, project: string, key: string, databaseId: string): Store {
  const client = new Client().setEndpoint(endpoint).setProject(project).setKey(key);
  const db = new TablesDB(client); const storage = new Storage(client); const teams = new Teams(client); const users = new Users(client);
  const membershipId = async (tenantId: string, userId: string) => {
    const r = await teams.listMemberships({ teamId: tenantId, queries: [Query.equal("userId", userId), Query.limit(1)] });
    return r.memberships[0]?.$id ?? null;
  };
  return {
    async membership(tenantId, userId) {
      const r = await teams.listMemberships({ teamId: tenantId, queries: [Query.equal("userId", userId), Query.limit(1)] });
      const m = r.memberships[0];
      return m && m.confirm ? { roles: m.roles } : null;
    },
    async get(tableId, rowId) {
      try { return (await db.getRow({ databaseId, tableId, rowId })) as unknown as Row; }
      catch (e: any) { if (e?.code === 404) return null; throw e; }
    },
    async list(tableId, where, limit = 100) {
      const queries = [...Object.entries(where).map(([k, v]) => Query.equal(k, v)), Query.limit(limit)];
      return (await db.listRows({ databaseId, tableId, queries })).rows as unknown as Row[];
    },
    async scan(tableId, where, opts = {}) {
      const max = opts.maxRows ?? 10_000; const PAGE = 100; const rows: Row[] = []; let cursor: string | undefined;
      const filters = [...Object.entries(where).map(([k, v]) => Query.equal(k, v)),
        ...(opts.range?.from ? [Query.greaterThanEqual(opts.range.field, opts.range.from)] : []), ...(opts.range?.to ? [Query.lessThan(opts.range.field, opts.range.to)] : [])];
      // On s'arrête sur une page vide (et non « plus petite que demandée ») : si la base plafonne la taille des pages, on ne perd rien.
      for (;;) {
        const page = (await db.listRows({ databaseId, tableId, queries: [...filters, Query.limit(PAGE), ...(cursor ? [Query.cursorAfter(cursor)] : [])] })).rows as unknown as Row[];
        if (!page.length) return { rows, truncated: false };
        for (const r of page) { rows.push(r); if (rows.length >= max) return { rows, truncated: true }; }
        cursor = page[page.length - 1]!.$id;
      }
    },
    async create(tableId, rowId, tenantId, data) {
      try {
        // Lecture pour l'équipe ; aucune écriture client : tout passe par cette fonction.
        // Lecture limitée à la boutique / au rôle concerné (permissions.ts) ; jamais d'écriture client.
        await db.createRow({ databaseId, tableId, rowId, data, permissions: readRoles(tableId, tenantId, data, rowId).map((r) => Permission.read(r)) });
        return true;
      } catch (e: any) { if (e?.code === 409) return false; throw e; }
    },
    async update(tableId, rowId, data) { await db.updateRow({ databaseId, tableId, rowId, data }); },
    async remove(tableId, rowId) { try { await db.deleteRow({ databaseId, tableId, rowId }); } catch (e: any) { if (e?.code !== 404) throw e; } },
    async putFile(fileId, data, name, mime, readRoles) {
      void mime; // le type est déduit par Appwrite de l'extension et du contenu
      await storage.createFile({ bucketId: "articles", fileId, file: InputFile.fromBuffer(Buffer.from(data), name), permissions: readRoles.map((r) => Permission.read(r)) });
    },
    async deleteFile(fileId) { try { await storage.deleteFile({ bucketId: "articles", fileId }); } catch (e: any) { if (e?.code !== 404) throw e; } },
    async createUser(a) {
      try { await users.create({ userId: a.userId, email: a.email, password: a.password, name: a.name }); }
      catch (e: any) { if (e?.code === 409) throw new HttpError(409, "Identifiant déjà utilisé"); throw e; }
    },
    async deleteUser(userId) { await users.delete({ userId }); },
    async listOwners(tenantId) {
      const r = await teams.listMemberships({ teamId: tenantId, queries: [Query.limit(100)] });
      return r.memberships.filter((m) => m.roles.includes("owner")).map((m) => ({ userId: m.userId, name: m.userName, email: m.userEmail }));
    },
    async setLabels(userId, labels) { await users.updateLabels({ userId, labels }); },
    async setUserActive(userId, active) { await users.updateStatus({ userId, status: active }); },
    async setPassword(userId, password) { await users.updatePassword({ userId, password }); },
    // Création serveur avec userId : le membre est ajouté et actif immédiatement (pas d'e-mail d'invitation).
    async addMember(tenantId, userId, roles, name) { await teams.createMembership({ teamId: tenantId, roles, userId, name }); },
    async setMemberRoles(tenantId, userId, roles) {
      const id = await membershipId(tenantId, userId); if (!id) throw new HttpError(404, "Membre introuvable");
      await teams.updateMembership({ teamId: tenantId, membershipId: id, roles });
    },
    async removeMember(tenantId, userId) {
      const id = await membershipId(tenantId, userId); if (id) await teams.deleteMembership({ teamId: tenantId, membershipId: id });
    },
  };
}
