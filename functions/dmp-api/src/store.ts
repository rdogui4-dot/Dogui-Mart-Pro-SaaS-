export type Row = Record<string, any> & { $id: string };
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
/** Accès aux données. Implémenté par Appwrite en production et en mémoire dans les tests. */
export type BatchOp = { kind: "create"; table: string; id: string; tenantId: string; data: Record<string, unknown> } | { kind: "update"; table: string; id: string; data: Record<string, unknown> } | { kind: "remove"; table: string; id: string };
/** Au-delà, une transaction Appwrite sort des limites usuelles : l'appelant bascule sur l'enchaînement idempotent. */
export const MAX_BATCH = 90;
export interface Store {
  /** Écritures ATOMIQUES : tout est appliqué ou rien (transaction TablesDB d'Appwrite : création → opérations → validation ; annulation en cas d'échec). Une création sur un identifiant existant fait échouer le lot (409). */
  batch(ops: BatchOp[]): Promise<void>;
  membership(tenantId: string, userId: string): Promise<{ roles: string[] } | null>;
  get(table: string, id: string): Promise<Row | null>;
  list(table: string, where: Record<string, string | number | boolean>, limit?: number): Promise<Row[]>;
  /** Lecture paginée de toutes les lignes correspondantes (bornée par maxRows) : ne dépend d'aucune limite de page de la base.
   *  `range` borne un champ (date ISO) : from inclus, to exclu. `truncated` vaut true si maxRows a été atteint. */
  scan(table: string, where: Record<string, string | number | boolean>, opts?: { range?: { field: string; from?: string; to?: string }; maxRows?: number; /** tri croissant sur ce champ (ex. $updatedAt) : une lecture tronquée est alors un début de liste sûr */ orderBy?: string }): Promise<{ rows: Row[]; truncated: boolean }>;
  /** Crée la ligne ; renvoie false si l'identifiant existe déjà (idempotence). Les droits de lecture viennent de permissions.ts (par boutique / rôle). */
  create(table: string, id: string, tenantId: string, data: Record<string, unknown>): Promise<boolean>;
  update(table: string, id: string, data: Record<string, unknown>): Promise<void>;
  /** Supprime une ligne (absente : sans effet). Réservé aux cas où l'historique n'est pas compromis (voir articles.ts). */
  remove(table: string, id: string): Promise<void>;
  /** Fichiers (photos d'articles) : créés par la fonction uniquement, avec les mêmes droits de lecture que la ligne qui les porte. */
  putFile(fileId: string, data: Uint8Array, name: string, mime: string, readRoles: string[]): Promise<void>;
  deleteFile(fileId: string): Promise<void>;
  /** Nom, type et droits de lecture d'un fichier (synchronisation d'un poste local). Absent : null. */
  fileInfo(fileId: string): Promise<{ name: string; mime: string; readRoles: string[] } | null>;
  /** Relit un fichier (contrôle d'intégrité des pièces : l'empreinte recalculée est comparée à celle enregistrée). Absent : null. */
  readFile(fileId: string): Promise<Uint8Array | null>;
  // Annuaire des comptes (Appwrite Users + Teams). Réservé aux actions « équipe » du propriétaire.
  createUser(a: { userId: string; email: string; password: string; name: string }): Promise<void>; // 409 si l'identifiant existe déjà
  /** Crée un compte à partir d'une empreinte scrypt locale (`scrypt$sel$hex`, N=16384 r=8 p=1, 32 octets) : le mot de passe n'est jamais connu du cloud. 409 si l'identifiant ou l'e-mail existe. */
  importUser(a: { userId: string; email: string; name: string; passwordHash: string }): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  /** Propriétaires d'un commerce (nom et e-mail du compte), pour les relances de la plateforme. */
  listOwners(tenantId: string): Promise<{ userId: string; name: string; email: string }[]>;
  /** Étiquettes du compte : elles donnent la lecture des lignes d'une boutique (voir permissions.ts). */
  setLabels(userId: string, labels: string[]): Promise<void>;
  setUserActive(userId: string, active: boolean): Promise<void>;
  /** Ferme TOUTES les sessions ouvertes d'un compte (l'appareil doit se reconnecter) ; renvoie le nombre de sessions fermées. */
  revokeUserSessions(userId: string): Promise<number>;
  setPassword(userId: string, password: string): Promise<void>;
  /** Sécurité d'un compte lue dans l'annuaire : dernière ouverture de session, sessions ouvertes ces dernières 24 h, double authentification activée. */
  userSecurity(userId: string): Promise<UserSecurity>;
  addMember(tenantId: string, userId: string, roles: string[], name: string): Promise<void>;
  setMemberRoles(tenantId: string, userId: string, roles: string[]): Promise<void>;
  removeMember(tenantId: string, userId: string): Promise<void>;
  /** Membres du commerce (propriétaires et personnel) avec leurs comptes : annuaire à copier sur un poste local. */
  userDirectory(tenantId: string): Promise<DirectoryUser[]>;
}
/** shopId vaut "" pour les actions qui ne dépendent d'aucune boutique (équipe, création de boutique). */
/** Mesures que seule la machine hôte peut fournir (le poste Windows : sauvegardes, synchronisation, constats). Absentes dans le cloud : les contrôles correspondants sont alors « inconnus », jamais « ok ». */
export type StatusProbe = { /** le poste n'a pas de double authentification : sa valeur n'y est pas mesurable (le magasin local répond toujours « non ») */ noMfa?: boolean; station?: () => { lastSyncOkAt: string | null; pending: number; sessionOk: boolean; openConflicts: number; alertHours: number } | null; backups?: () => { lastOkAt: string | null; hasBackups: boolean; externalError: string | null } | null };
export type Ctx = { userId: string; tenantId: string; shopId: string; roles: string[]; shopIds?: string[] | "all"; admin?: boolean; probe?: StatusProbe; /** machine qui exécute l'action (journal de sécurité) */ source?: "cloud" | "poste"; /** numéro de la requête (journal de sécurité) */ requestId?: string; /** Accès effectifs (le propriétaire les a tous) : calculés par handle(), jamais fournis par le client. */ modules?: Module[] };
import { MODULES, MODULE_LABEL, type Module } from "../../../src/domain/access";
export type Role = "owner" | "manager" | "cashier";
/** Compte d'un membre du commerce tel que l'annuaire du cloud le connaît : sert à la connexion du personnel sur le poste local (empreinte du mot de passe, jamais le mot de passe). */
export type DirectoryUser = { userId: string; email: string; name: string; active: boolean; labels: string[]; roles: string[]; /** empreinte Argon2 au format PHC ; null si le serveur ne l'expose pas */ passwordHash: string | null; passwordUpdatedAt: string | null };
export type UserSecurity = { lastLogin: string | null; sessions24h: number; mfa: boolean };
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
