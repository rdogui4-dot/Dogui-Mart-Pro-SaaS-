import { Client, Permission, Query, Role, TablesDB, Teams } from "node-appwrite";
import type { Row, Store } from "./store";

export function appwriteStore(endpoint: string, project: string, key: string, databaseId: string): Store {
  const client = new Client().setEndpoint(endpoint).setProject(project).setKey(key);
  const db = new TablesDB(client); const teams = new Teams(client);
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
    async create(tableId, rowId, tenantId, data) {
      try {
        // Lecture pour l'équipe ; aucune écriture client : tout passe par cette fonction.
        await db.createRow({ databaseId, tableId, rowId, data, permissions: [Permission.read(Role.team(tenantId))] });
        return true;
      } catch (e: any) { if (e?.code === 409) return false; throw e; }
    },
    async update(tableId, rowId, data) { await db.updateRow({ databaseId, tableId, rowId, data }); },
  };
}
