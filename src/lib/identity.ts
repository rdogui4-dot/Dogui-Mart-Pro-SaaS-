/** Identité de l'utilisateur (compte, équipes, session) : Appwrite par défaut, remplaçable par le serveur local de la version Windows.
 *  Les parcours « mot de passe oublié » et « vérification d'adresse » restent propres à Appwrite (ils envoient des e-mails) : `local` permet à l'écran de les masquer. */
import { ID, account, teams } from "./appwrite";

export type AuthUser = { $id: string; name: string; email: string; emailVerification?: boolean };
export type Membership = { userId: string; roles: string[] };
export interface Identity {
  /** Vrai pour le serveur local (aucun e-mail, aucun cloud). */
  readonly local: boolean;
  me(): Promise<AuthUser>;
  teams(): Promise<{ $id: string; name: string }[]>;
  memberships(teamId: string): Promise<Membership[]>;
  login(email: string, password: string): Promise<void>;
  /** Crée le compte puis ouvre la session. */
  signup(email: string, password: string, name: string): Promise<void>;
  logout(): Promise<void>;
  /** Crée l'entreprise (équipe) dont l'utilisateur est propriétaire ; renvoie son identifiant. */
  createTeam(name: string): Promise<string>;
}

export const appwriteIdentity: Identity = {
  local: false,
  me: async () => { const m = await account.get(); return { $id: m.$id, name: m.name, email: m.email, emailVerification: m.emailVerification }; },
  teams: async () => (await teams.list()).teams.map((t) => ({ $id: t.$id, name: t.name })),
  memberships: async (teamId) => (await teams.listMemberships({ teamId })).memberships.map((m) => ({ userId: m.userId, roles: m.roles })),
  login: async (email, password) => { await account.createEmailPasswordSession({ email, password }); },
  signup: async (email, password, name) => { await account.create({ userId: ID.unique(), email, password, name }); await account.createEmailPasswordSession({ email, password }); },
  logout: async () => { await account.deleteSession({ sessionId: "current" }); },
  createTeam: async (name) => (await teams.create({ teamId: ID.unique(), name, roles: ["owner"] })).$id,
};

let current: Identity = appwriteIdentity;
export const identity = (): Identity => current;
export const setIdentity = (i?: Identity): void => { current = i ?? appwriteIdentity; };
