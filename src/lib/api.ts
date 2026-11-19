import { ExecutionMethod, Functions } from "appwrite";
import { client } from "./appwrite";
import type { Session } from "./session";

const fn = new Functions(client);
let planDenied: (() => void) | null = null; let lastDenied = 0;
/** Appelé quand le serveur refuse une fonction « réservée à la formule » : l'abonnement affiché est probablement périmé (rétrogradation, expiration) et doit être relu. */
export const onPlanDenied = (cb: () => void) => { planDenied = cb; };
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

/** Toutes les écritures passent par la fonction serveur `dmp-api` (droits, prix, stock et compta vérifiés côté serveur). */
export async function api<T = unknown>(s: Session, action: string, payload: object = {}): Promise<T> {
  const ex = await fn.createExecution({
    functionId: "dmp-api", body: JSON.stringify({ action, tenantId: s.tenantId, shopId: s.shopId, payload }),
    async: false, xpath: "/", method: ExecutionMethod.POST, headers: { "content-type": "application/json" },
  });
  let out: { ok: boolean; data?: T; error?: string };
  try { out = JSON.parse(ex.responseBody); } catch { throw new ApiError(ex.responseStatusCode || 500, "Réponse serveur invalide"); }
  if (!out.ok) { if (ex.responseStatusCode === 402 && /réservé à la formule/.test(out.error ?? "") && Date.now() - lastDenied > 5000) { lastDenied = Date.now(); planDenied?.(); } throw new ApiError(ex.responseStatusCode, out.error ?? "Erreur"); }
  return out.data as T;
}
export const isNetworkError = (e: unknown) => !(e instanceof ApiError);

/** Appel d'une action publique (acceptation d'une invitation) : sans compte. Si la plateforme exige une session pour exécuter la fonction,
 *  une session anonyme Appwrite est ouverte le temps de l'appel (elle ne donne aucun droit : le serveur n'accepte que les actions publiques). */
export async function publicApi<T = unknown>(action: string, payload: object = {}): Promise<T> {
  const run = async () => {
    const ex = await fn.createExecution({ functionId: "dmp-api", body: JSON.stringify({ action, payload }), async: false, xpath: "/", method: ExecutionMethod.POST, headers: { "content-type": "application/json" } });
    let out: { ok: boolean; data?: T; error?: string };
    try { out = JSON.parse(ex.responseBody); } catch { throw new ApiError(ex.responseStatusCode || 500, "Réponse serveur invalide"); }
    if (!out.ok) throw new ApiError(ex.responseStatusCode, out.error ?? "Erreur");
    return out.data as T;
  };
  try { return await run(); }
  catch (e) {
    if (e instanceof ApiError || !/(401|unauthorized|missing scope|not authorized)/i.test(String((e as Error)?.message) + String((e as { code?: number })?.code ?? ""))) throw e;
    const { account } = await import("./appwrite");
    try { await account.createAnonymousSession(); } catch { throw new ApiError(503, "L'acceptation des invitations n'est pas encore activée sur la plateforme. Demandez à votre responsable de créer votre compte directement."); }
    return run();
  }
}
