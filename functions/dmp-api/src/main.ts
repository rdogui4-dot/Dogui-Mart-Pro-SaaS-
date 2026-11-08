import { ACTIONS, TENANT_LEVEL } from "./handlers";
import { appwriteStore } from "./appwrite-store";
import { HttpError, roleOf, type Ctx, type Store } from "./store";

type Req = { method: string; headers: Record<string, string>; bodyJson?: any };
type Res = { json(body: unknown, status?: number): unknown };

/** Point d'entrée testable : authentifie l'appelant (membre confirmé du tenant) puis route l'action. */
export async function handle(store: Store, userId: string | undefined, body: any): Promise<{ status: number; body: unknown }> {
  try {
    if (!userId) throw new HttpError(401, "Connexion requise");
    const { action, tenantId, shopId, payload } = body ?? {};
    const fn = (ACTIONS as Record<string, (s: Store, c: Ctx, p: any) => Promise<unknown>>)[action];
    if (!fn) throw new HttpError(400, "Action inconnue");
    const tenantLevel = TENANT_LEVEL.has(action);
    if (typeof tenantId !== "string" || !tenantId || (!tenantLevel && (typeof shopId !== "string" || !shopId))) throw new HttpError(400, "tenantId et shopId requis");
    const m = await store.membership(tenantId, userId);
    if (!m) throw new HttpError(403, "Vous n'appartenez pas à ce commerce");
    const ctx: Ctx = { userId, tenantId, shopId: tenantLevel ? "" : shopId, roles: m.roles };
    if (!tenantLevel) {
      // La boutique doit exister dans CE commerce, et l'employé doit y être affecté (le propriétaire a accès à toutes).
      const shop = await store.get("shops", shopId);
      if (!shop || shop.tenantId !== tenantId) throw new HttpError(404, "Boutique introuvable");
      if (roleOf(m.roles) === "owner") ctx.shopIds = "all";
      else {
        const staff = await store.get("staff", userId);
        const ids: string[] = staff && staff.tenantId === tenantId && staff.active ? JSON.parse(String(staff.shopIds || "[]")) : [];
        if (!ids.includes(shopId)) throw new HttpError(403, "Vous n'êtes pas affecté à cette boutique");
        ctx.shopIds = ids;
      }
    }
    return { status: 200, body: { ok: true, data: await fn(store, ctx, payload ?? {}) } };
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: { ok: false, error: e.message } };
    console.error(e);
    return { status: 500, body: { ok: false, error: "Erreur interne" } };
  }
}

// Appwrite exécute cette fonction ; l'identité vient de l'en-tête posé par la plateforme (non falsifiable par le client).
export default async ({ req, res }: { req: Req; res: Res }) => {
  const key = req.headers["x-appwrite-key"];
  const store = appwriteStore(process.env.APPWRITE_FUNCTION_API_ENDPOINT!, process.env.APPWRITE_FUNCTION_PROJECT_ID!, key!, process.env.DATABASE_ID || "dmp");
  const r = await handle(store, req.headers["x-appwrite-user-id"] || undefined, req.bodyJson);
  return res.json(r.body, r.status);
};
