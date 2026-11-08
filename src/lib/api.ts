import { ExecutionMethod, Functions } from "appwrite";
import { client } from "./appwrite";
import type { Session } from "./session";

const fn = new Functions(client);
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

/** Toutes les écritures passent par la fonction serveur `dmp-api` (droits, prix, stock et compta vérifiés côté serveur). */
export async function api<T = unknown>(s: Session, action: string, payload: object = {}): Promise<T> {
  const ex = await fn.createExecution({
    functionId: "dmp-api", body: JSON.stringify({ action, tenantId: s.tenantId, shopId: s.shopId, payload }),
    async: false, xpath: "/", method: ExecutionMethod.POST, headers: { "content-type": "application/json" },
  });
  let out: { ok: boolean; data?: T; error?: string };
  try { out = JSON.parse(ex.responseBody); } catch { throw new ApiError(ex.responseStatusCode || 500, "Réponse serveur invalide"); }
  if (!out.ok) throw new ApiError(ex.responseStatusCode, out.error ?? "Erreur");
  return out.data as T;
}
export const isNetworkError = (e: unknown) => !(e instanceof ApiError);
