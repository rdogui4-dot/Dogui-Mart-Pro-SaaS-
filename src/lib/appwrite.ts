import { Account, Client, ID, Permission, Query, Role, TablesDB, Teams } from "appwrite";

const env = import.meta.env;
export const DATABASE_ID = (env.VITE_APPWRITE_DATABASE_ID as string) || "dmp";

const client = new Client()
  .setEndpoint(env.VITE_APPWRITE_ENDPOINT as string)
  .setProject(env.VITE_APPWRITE_PROJECT_ID as string);

export const account = new Account(client);
export const teams = new Teams(client);
export const tables = new TablesDB(client);
export { ID, Query };

/** Droits d'une ligne : lecture pour toute l'équipe, écriture pour owner/manager. */
export const rowPerms = (tenantId: string, writers: string[] = ["owner", "manager"]) => [
  Permission.read(Role.team(tenantId)),
  ...writers.flatMap((r) => [Permission.update(Role.team(tenantId, r)), Permission.delete(Role.team(tenantId, r))]),
];
