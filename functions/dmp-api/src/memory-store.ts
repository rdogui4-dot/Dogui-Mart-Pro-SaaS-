import type { Row, Store } from "./store";
/** Store en mémoire pour les tests. */
export class MemoryStore implements Store {
  tables = new Map<string, Map<string, Row>>();
  members = new Map<string, string[]>();
  addMember(tenantId: string, userId: string, roles: string[]) { this.members.set(`${tenantId}:${userId}`, roles); }
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
  rows(table: string) { return [...this.t(table).values()]; }
}
