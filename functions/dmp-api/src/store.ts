export type Row = Record<string, any> & { $id: string };
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
/** Accès aux données. Implémenté par Appwrite en production et en mémoire dans les tests. */
export interface Store {
  membership(tenantId: string, userId: string): Promise<{ roles: string[] } | null>;
  get(table: string, id: string): Promise<Row | null>;
  list(table: string, where: Record<string, string | number | boolean>, limit?: number): Promise<Row[]>;
  /** Lecture paginée de toutes les lignes correspondantes (bornée par maxRows) : ne dépend d'aucune limite de page de la base.
   *  `range` borne un champ (date ISO) : from inclus, to exclu. `truncated` vaut true si maxRows a été atteint. */
  scan(table: string, where: Record<string, string | number | boolean>, opts?: { range?: { field: string; from?: string; to?: string }; maxRows?: number }): Promise<{ rows: Row[]; truncated: boolean }>;
  /** Crée la ligne ; renvoie false si l'identifiant existe déjà (idempotence). Les droits de lecture viennent de permissions.ts (par boutique / rôle). */
  create(table: string, id: string, tenantId: string, data: Record<string, unknown>): Promise<boolean>;
  update(table: string, id: string, data: Record<string, unknown>): Promise<void>;
  /** Supprime une ligne (absente : sans effet). Réservé aux cas où l'historique n'est pas compromis (voir articles.ts). */
  remove(table: string, id: string): Promise<void>;
  /** Fichiers (photos d'articles) : créés par la fonction uniquement, avec les mêmes droits de lecture que la ligne qui les porte. */
  putFile(fileId: string, data: Uint8Array, name: string, mime: string, readRoles: string[]): Promise<void>;
  deleteFile(fileId: string): Promise<void>;
  // Annuaire des comptes (Appwrite Users + Teams). Réservé aux actions « équipe » du propriétaire.
  createUser(a: { userId: string; email: string; password: string; name: string }): Promise<void>; // 409 si l'identifiant existe déjà
  deleteUser(userId: string): Promise<void>;
  /** Propriétaires d'un commerce (nom et e-mail du compte), pour les relances de la plateforme. */
  listOwners(tenantId: string): Promise<{ userId: string; name: string; email: string }[]>;
  /** Étiquettes du compte : elles donnent la lecture des lignes d'une boutique (voir permissions.ts). */
  setLabels(userId: string, labels: string[]): Promise<void>;
  setUserActive(userId: string, active: boolean): Promise<void>;
  setPassword(userId: string, password: string): Promise<void>;
  addMember(tenantId: string, userId: string, roles: string[], name: string): Promise<void>;
  setMemberRoles(tenantId: string, userId: string, roles: string[]): Promise<void>;
  removeMember(tenantId: string, userId: string): Promise<void>;
}
/** shopId vaut "" pour les actions qui ne dépendent d'aucune boutique (équipe, création de boutique). */
export type Ctx = { userId: string; tenantId: string; shopId: string; roles: string[]; shopIds?: string[] | "all"; admin?: boolean; /** Accès effectifs (le propriétaire les a tous) : calculés par handle(), jamais fournis par le client. */ modules?: Module[] };
import { MODULES, MODULE_LABEL, type Module } from "../../../src/domain/access";
export type Role = "owner" | "manager" | "cashier";
export const roleOf = (roles: string[]): Role => (roles.includes("owner") ? "owner" : roles.includes("manager") ? "manager" : "cashier");
export const need = (ctx: Ctx, min: Role) => {
  const rank = { cashier: 0, manager: 1, owner: 2 } as const;
  if (rank[roleOf(ctx.roles)] < rank[min]) throw new HttpError(403, "Droits insuffisants");
};

/** Accès à un module : le propriétaire toujours ; un employé seulement si le module figure dans ses accès (préréglage de son rôle ou liste personnalisée). */
export const needModule = (ctx: Ctx, m: Module): void => {
  if (roleOf(ctx.roles) === "owner") return;
  if (!ctx.modules?.includes(m)) throw new HttpError(403, `Accès « ${MODULE_LABEL[m]} » non attribué à votre compte`);
};
export { MODULES };
