import { Account, Client, ID, Query, TablesDB, Teams } from "appwrite";

const env = import.meta.env;
export const DATABASE_ID = (env.VITE_APPWRITE_DATABASE_ID as string) || "dmp";

export const client = new Client()
  .setEndpoint(env.VITE_APPWRITE_ENDPOINT as string)
  .setProject(env.VITE_APPWRITE_PROJECT_ID as string);

export const account = new Account(client);
export const teams = new Teams(client);
export const tables = new TablesDB(client);
export { ID, Query };
