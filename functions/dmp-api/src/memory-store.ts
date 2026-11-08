import { HttpError, type Row, type Store } from "./store";
/** Store en mémoire pour les tests. */
export class MemoryStore implements Store {
  tables = new Map<string, Map<string, Row>>();
  members = new Map<string, string[]>();
  private t(n: string) { if (!this.tables.has(n)) this.tables.set(n, new Map()); return this.tables.get(n)!; }
  async membership(tenantId: string, userId: string) { const r = this.members.get(`${tenantId}:${userId}`); return r ? { roles: r } : null; }
  async get(table: string, id: string) { const r = this.t(table).get(id); return r ? { ...r } : null; }
  async list(table: string, where: Record<string, string | number>, limit = 100) {
    return [...this.t(table).values()].filter((r) => Object.entries(where).every(([k, v]) => r[k] === v)).slice(0, limit).map((r) => ({ ...r }));
  }
  async create(table: string, id: string, _tenantId: string, data: Record<string, unknown>) {
    if (this.t(table).has(id)) return false;
    this.t(table).set(id, { ...data, $id: id }); return true;
  }
  async update(table: string, id: string, data: Record<string, unknown>) {
    const r = this.t(table).get(id); if (!r) throw new Error("introuvable"); Object.assign(r, data);
  }
  users = new Map<string, { email: string; password: string; active: boolean; name: string }>();
  async createUser(a: { userId: string; email: string; password: string; name: string }) {
    if ([...this.users.values()].some((u) => u.email === a.email)) throw new HttpError(409, "Identifiant déjà utilisé");
    this.users.set(a.userId, { email: a.email, password: a.password, active: true, name: a.name });
  }
  async deleteUser(userId: string) { this.users.delete(userId); }
  async setUserActive(userId: string, active: boolean) { const u = this.users.get(userId); if (u) u.active = active; }
  async setPassword(userId: string, password: string) { const u = this.users.get(userId); if (u) u.password = password; }
  failAddMember = false;
  async addMember(tenantId: string, userId: string, roles: string[]) { if (this.failAddMember) throw new Error("boom"); this.members.set(`${tenantId}:${userId}`, roles); }
  async setMemberRoles(tenantId: string, userId: string, roles: string[]) { this.members.set(`${tenantId}:${userId}`, roles); }
  async removeMember(tenantId: string, userId: string) { this.members.delete(`${tenantId}:${userId}`); }
  /** Raccourci de test : membre + fiche employé affectée à des boutiques. */
  async grant(tenantId: string, userId: string, roles: string[], shopIds: string[]) {
    this.addMemberSync(tenantId, userId, roles);
    if (!roles.includes("owner")) await this.create("staff", userId, tenantId, { tenantId, userId, name: userId, role: roles[0], shopIds: JSON.stringify(shopIds), active: true });
  }
  private addMemberSync(tenantId: string, userId: string, roles: string[]) { this.members.set(`${tenantId}:${userId}`, roles); }
  async addShop(tenantId: string, shopId: string, name = shopId) { await this.create("shops", shopId, tenantId, { tenantId, name, vatRatePct: 18 }); }
  rows(table: string) { return [...this.t(table).values()]; }
}
