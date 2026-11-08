export type Row = Record<string, any> & { $id: string };
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
/** Accès aux données. Implémenté par Appwrite en production et en mémoire dans les tests. */
export interface Store {
  membership(tenantId: string, userId: string): Promise<{ roles: string[] } | null>;
  get(table: string, id: string): Promise<Row | null>;
  list(table: string, where: Record<string, string | number>, limit?: number): Promise<Row[]>;
  /** Crée la ligne ; renvoie false si l'identifiant existe déjà (idempotence). Lecture réservée à l'équipe du tenant. */
  create(table: string, id: string, tenantId: string, data: Record<string, unknown>): Promise<boolean>;
  update(table: string, id: string, data: Record<string, unknown>): Promise<void>;
  // Annuaire des comptes (Appwrite Users + Teams). Réservé aux actions « équipe » du propriétaire.
  createUser(a: { userId: string; email: string; password: string; name: string }): Promise<void>; // 409 si l'identifiant existe déjà
  deleteUser(userId: string): Promise<void>;
  setUserActive(userId: string, active: boolean): Promise<void>;
  setPassword(userId: string, password: string): Promise<void>;
  addMember(tenantId: string, userId: string, roles: string[], name: string): Promise<void>;
  setMemberRoles(tenantId: string, userId: string, roles: string[]): Promise<void>;
  removeMember(tenantId: string, userId: string): Promise<void>;
}
/** shopId vaut "" pour les actions qui ne dépendent d'aucune boutique (équipe, création de boutique). */
export type Ctx = { userId: string; tenantId: string; shopId: string; roles: string[]; shopIds?: string[] | "all"; admin?: boolean };
export type Role = "owner" | "manager" | "cashier";
export const roleOf = (roles: string[]): Role => (roles.includes("owner") ? "owner" : roles.includes("manager") ? "manager" : "cashier");
export const need = (ctx: Ctx, min: Role) => {
  const rank = { cashier: 0, manager: 1, owner: 2 } as const;
  if (rank[roleOf(ctx.roles)] < rank[min]) throw new HttpError(403, "Droits insuffisants");
};
