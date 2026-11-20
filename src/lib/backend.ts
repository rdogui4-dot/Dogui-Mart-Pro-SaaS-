/** Couche d'accès au serveur : tout ce que l'interface lit, appelle ou écoute passe par ici, jamais par le SDK Appwrite directement.
 *  Par défaut c'est Appwrite (comportement inchangé) ; la version Windows branche ici un serveur local (même contrat : lignes, requêtes, appels de fonction, temps réel).
 *  Les requêtes sont les chaînes JSON produites par `Query.*` d'Appwrite (equal, limit, orderDesc…) : un serveur local doit comprendre ces mêmes requêtes. */
import { ExecutionMethod, Functions } from "appwrite";
import { DATABASE_ID, client, tables } from "./appwrite";

export type DataRow = Record<string, unknown> & { $id: string; $createdAt?: string };
/** Lecture de lignes. `listRows` renvoie la page demandée par les requêtes (limit, cursorAfter…) ; `getRow` échoue si la ligne est absente ou non lisible. */
export interface DataSource {
  listRows(table: string, queries: string[]): Promise<{ rows: DataRow[]; total: number }>;
  getRow(table: string, id: string): Promise<DataRow>;
}
/** Exécution d'une action serveur (`dmp-api`) : corps JSON en entrée, statut HTTP et corps JSON en sortie. */
export interface Transport { execute(body: string): Promise<{ status: number; body: string }> }
/** Temps réel : abonnement à des canaux de changements ; renvoie la fonction de désabonnement. */
export interface Realtime { subscribe(channels: string[], onChange: () => void): () => void }
/** Fichiers privés (photos d'articles, logos, justificatifs) : lus avec la session de l'utilisateur. `preview` demande une miniature carrée (peut ne pas être disponible : l'appelant se rabat sur `view`). */
export interface Files { fetch(fileId: string, mode: "view" | "preview", size?: number): Promise<Response> }
export type Backend = { data: DataSource; transport: Transport; realtime: Realtime; files: Files; databaseId: string };

const fn = new Functions(client);
export const appwriteBackend: Backend = {
  databaseId: DATABASE_ID,
  data: {
    listRows: async (table, queries) => { const r = await tables.listRows({ databaseId: DATABASE_ID, tableId: table, queries }); return { rows: r.rows as unknown as DataRow[], total: r.total }; },
    getRow: async (table, id) => (await tables.getRow({ databaseId: DATABASE_ID, tableId: table, rowId: id })) as unknown as DataRow,
  },
  transport: {
    execute: async (body) => {
      const ex = await fn.createExecution({ functionId: "dmp-api", body, async: false, xpath: "/", method: ExecutionMethod.POST, headers: { "content-type": "application/json" } });
      return { status: ex.responseStatusCode, body: ex.responseBody };
    },
  },
  realtime: { subscribe: (channels, onChange) => client.subscribe(channels, () => onChange()) as unknown as () => void },
  files: {
    fetch: (fileId, mode, size = 96) => {
      const env = import.meta.env; let fallback = ""; try { fallback = localStorage.getItem("cookieFallback") ?? ""; } catch { /* navigation privée */ }
      const base = `${env.VITE_APPWRITE_ENDPOINT}/storage/buckets/articles/files/${fileId}`;
      return fetch(mode === "preview" ? `${base}/preview?width=${size}&height=${size}&output=webp` : `${base}/view`, { headers: { "X-Appwrite-Project": String(env.VITE_APPWRITE_PROJECT_ID), "X-Fallback-Cookies": fallback }, credentials: "include" });
    },
  },
};

let current: Backend = appwriteBackend;
export const backend = (): Backend => current;
/** Remplace le serveur (version Windows, tests). Sans argument : retour à Appwrite. */
export const setBackend = (b?: Partial<Backend>): void => { current = { ...appwriteBackend, ...(b ?? {}) }; };
export const dataSource = (): DataSource => current.data;
