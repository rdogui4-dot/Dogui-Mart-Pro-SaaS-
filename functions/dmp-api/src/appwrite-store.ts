import { Client, Permission, Query, Role, TablesDB, Teams, Users } from "node-appwrite";
import { HttpError, type Row, type Store } from "./store";

export function appwriteStore(endpoint: string, project: string, key: string, databaseId: string): Store {
  const client = new Client().setEndpoint(endpoint).setProject(project).setKey(key);
  const db = new TablesDB(client); const teams = new Teams(client); const users = new Users(client);
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
    async create(tableId, rowId, tenantId, data) {
      try {
        // Lecture pour l'équipe ; aucune écriture client : tout passe par cette fonction.
        await db.createRow({ databaseId, tableId, rowId, data, permissions: [Permission.read(Role.team(tenantId))] });
        return true;
      } catch (e: any) { if (e?.code === 409) return false; throw e; }
    },
    async update(tableId, rowId, data) { await db.updateRow({ databaseId, tableId, rowId, data }); },
    async createUser(a) {
      try { await users.create({ userId: a.userId, email: a.email, password: a.password, name: a.name }); }
      catch (e: any) { if (e?.code === 409) throw new HttpError(409, "Identifiant déjà utilisé"); throw e; }
    },
    async deleteUser(userId) { await users.delete({ userId }); },
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
