import { autoPreorder, preorderTargets } from "./preorder";
import { ACTIONS, LOCK_EXEMPT, TENANT_LEVEL } from "./handlers";
import { assertWritable } from "./subscriptions";
import { appwriteStore } from "./appwrite-store";
import { HttpError, roleOf, type Ctx, type Store, type StatusProbe } from "./store";
import { MODULES, READ_ONLY_ROLES, modulesFor, type StaffRole } from "../../../src/domain/access";
import { PUBLIC_ACTIONS } from "./invites";
import { READ_ACTIONS, READ_ONLY_MESSAGE } from "./viewer";
import { hostedMessage, isHostAllowed, parseHost } from "./hosting";
import { cleanTarget, newRequestId, recordSecurityEvent, type SecurityEventInput } from "./security-log";
import { SUCCESS_ACTIONS, isEventKind, type EventKind } from "../../../src/domain/security-events";

type Req = { method: string; headers: Record<string, string>; bodyJson?: any };
type Res = { json(body: unknown, status?: number): unknown };

/** Point d'entrée testable : authentifie l'appelant (membre confirmé du tenant) puis route l'action. */
export async function handle(store: Store, userId: string | undefined, body: any, env: { admins?: string[]; /** vrai dans le cloud : un commerce hébergé par un poste n'y accepte plus d'écritures d'exploitation */ cloud?: boolean; /** mesures de la machine hôte (poste Windows) pour le Centre de sécurité */ probe?: StatusProbe } = {}): Promise<{ status: number; body: unknown }> {
  // Contexte du journal de sécurité (renseigné au fil de l'authentification) : permet de classer un refus (appelant sans identité, étranger au commerce, membre sans droit).
  const sec = { requestId: newRequestId(), source: (env.cloud ? "cloud" : "poste") as "cloud" | "poste", tenantId: "", member: false, role: "", action: "" };
  const log = (e: Omit<SecurityEventInput, "source" | "requestId">) => recordSecurityEvent(store, { ...e, source: sec.source, requestId: sec.requestId });
  try {
    const { action, tenantId, shopId, payload } = body ?? {};
    sec.action = typeof action === "string" ? action : ""; sec.tenantId = typeof tenantId === "string" ? tenantId : "";
    // Actions publiques (acceptation d'une invitation) : aucune appartenance, la preuve est le jeton à usage unique.
    if (typeof action === "string" && PUBLIC_ACTIONS.has(action) && Object.hasOwn(ACTIONS, action)) {
      const pub = (ACTIONS as Record<string, (s: Store, c: Ctx, p: any) => Promise<unknown>>)[action]!;
      return { status: 200, body: { ok: true, data: await pub(store, { userId: userId ?? "", tenantId: "", shopId: "", roles: [], admin: false }, payload ?? {}) } };
    }
    if (!userId) throw new HttpError(401, "Connexion requise");
    // Seules les actions déclarées existent : « constructor », « toString », « __proto__ »… viendraient du prototype de l'objet et exposeraient l'état interne du serveur.
    if (typeof action !== "string" || !Object.hasOwn(ACTIONS, action)) throw new HttpError(400, "Action inconnue");
    const fn = (ACTIONS as Record<string, (s: Store, c: Ctx, p: any) => Promise<unknown>>)[action]!;
    const admin = !!env.admins?.includes(userId);
    if (typeof action === "string" && action.startsWith("platform.")) { // administration de la plateforme : aucune appartenance à un commerce
      const out = await fn(store, { userId, tenantId: "", shopId: "", roles: [], admin }, payload ?? {});
      if (isEventKind(action) && (SUCCESS_ACTIONS as readonly string[]).includes(action)) await log({ tenantId: "", kind: action, outcome: "accepted", actorId: userId, actorRole: "platform", target: cleanTarget("tenant", (payload as { tenantId?: unknown } | undefined)?.tenantId ?? "-") });
      return { status: 200, body: { ok: true, data: out } };
    }
    const tenantLevel = TENANT_LEVEL.has(action);
    if (typeof tenantId !== "string" || !tenantId || (!tenantLevel && (typeof shopId !== "string" || !shopId))) throw new HttpError(400, "tenantId et shopId requis");
    const m = await store.membership(tenantId, userId);
    if (!m) throw new HttpError(403, "Vous n'appartenez pas à ce commerce");
    const ctx: Ctx = { userId, tenantId, shopId: tenantLevel ? "" : shopId, roles: m.roles, admin, probe: env.probe, source: sec.source };
    sec.member = true; sec.role = roleOf(m.roles);
    // Accès : le propriétaire a tout ; un employé actif a les modules de sa fiche (préréglage de son rôle ou liste personnalisée), sinon rien.
    let ids: string[] = [];
    if (roleOf(m.roles) === "owner") ctx.modules = [...MODULES];
    else {
      const staff = await store.get("staff", userId);
      const active = !!staff && staff.tenantId === tenantId && staff.active !== false;
      ids = active ? (() => { try { const v = JSON.parse(String(staff!.shopIds || "[]")); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } })() : []; // fiche illisible : aucune boutique plutôt qu'une erreur 500
      ctx.modules = active ? modulesFor(staff!.role ?? m.roles[0], staff!.access) : [];
      // Consultant : refus par défaut de toute action qui n'est pas de la consultation (le rôle de la fiche ET celui du commerce sont vérifiés).
      const role = String(staff?.role ?? m.roles[0] ?? "");
      if ((READ_ONLY_ROLES.includes(role as StaffRole) || m.roles.some((r) => READ_ONLY_ROLES.includes(r as StaffRole))) && !READ_ACTIONS.has(action)) throw new HttpError(403, READ_ONLY_MESSAGE);
    }
    if (!tenantLevel) {
      // La boutique doit exister dans CE commerce, et l'employé doit y être affecté (le propriétaire a accès à toutes).
      const shop = await store.get("shops", shopId);
      if (!shop || shop.tenantId !== tenantId) throw new HttpError(404, "Boutique introuvable");
      if (roleOf(m.roles) === "owner") ctx.shopIds = "all";
      else { if (!ids.includes(shopId)) throw new HttpError(403, "Vous n'êtes pas affecté à cette boutique"); ctx.shopIds = ids; }
    }
    if (env.cloud && !READ_ACTIONS.has(action) && !isHostAllowed(action)) { const h = parseHost((await store.get("subscriptions", tenantId))?.hostedBy); if (h) throw new HttpError(409, hostedMessage(h)); } // commerce hébergé par un poste : le cloud reste en lecture
    if (!LOCK_EXEMPT.has(action)) await assertWritable(store, tenantId); // abonnement expiré (hors délai de grâce) : plus aucune écriture ; l'interface suspend l'accès
    const data = await fn(store, ctx, payload ?? {});
    if (isEventKind(action) && (SUCCESS_ACTIONS as readonly string[]).includes(action)) await log({ tenantId, kind: action, outcome: "accepted", actorId: userId, actorRole: sec.role, target: cleanTarget("action", action) });
    // précommande automatique après une sortie de stock : ne fait jamais échouer l'opération d'origine
    try { const t = await preorderTargets(store, ctx, action, (payload ?? {}) as Record<string, unknown>, data); if (t) await autoPreorder(store, ctx, t); } catch (e) { console.error("précommande automatique", e); }
    return { status: 200, body: { ok: true, data } };
  } catch (e) {
    if (e instanceof HttpError) { await logDenied(e, sec, userId, log); return { status: e.status, body: { ok: false, error: e.message } }; }
    console.error(e);
    return { status: 500, body: { ok: false, error: "Erreur interne" } };
  }
}

/** Refus d'accès → événement de sécurité. Un étranger au commerce ou un appelant sans identité n'écrit JAMAIS dans le journal du commerce visé (sinon n'importe qui pourrait le polluer) : son refus va au journal de la plateforme, regroupé. */
async function logDenied(e: HttpError, sec: { tenantId: string; member: boolean; role: string; action: string }, userId: string | undefined, log: (e: Omit<SecurityEventInput, "source" | "requestId">) => Promise<unknown>) {
  const act = cleanTarget("action", sec.action);
  if (e.status === 401) return void await log({ tenantId: "", kind: "access.denied.unauthenticated", outcome: "denied", target: act, throttleKey: "-" });
  if (e.status !== 403 && !(e.status === 404 && sec.member && e.message === "Boutique introuvable")) return;
  if (!userId) return;
  if (sec.action.startsWith("platform.")) return void await log({ tenantId: "", kind: "access.denied.platform", outcome: "denied", actorId: userId, target: act, throttleKey: userId });
  if (!sec.member) return void await log({ tenantId: "", kind: "access.denied.not_member", outcome: "denied", actorId: userId, target: `${cleanTarget("tenant", sec.tenantId)} ${act}`.slice(0, 80), throttleKey: `${userId}|${sec.tenantId}` });
  const kind: EventKind = e.status === 404 || /affecté à cette boutique/.test(e.message) ? "access.denied.shop" : e.message === READ_ONLY_MESSAGE ? "access.denied.readonly" : "access.denied.forbidden";
  await log({ tenantId: sec.tenantId, kind, outcome: "denied", actorId: userId, actorRole: sec.role, target: act, throttleKey: `${userId}|${sec.action}` });
}

// Appwrite exécute cette fonction ; l'identité vient de l'en-tête posé par la plateforme (non falsifiable par le client).
export default async ({ req, res }: { req: Req; res: Res }) => {
  const key = req.headers["x-appwrite-key"];
  const store = appwriteStore(process.env.APPWRITE_FUNCTION_API_ENDPOINT!, process.env.APPWRITE_FUNCTION_PROJECT_ID!, key!, process.env.DATABASE_ID || "dmp");
  const admins = (process.env.PLATFORM_ADMINS || "").split(",").map((x) => x.trim()).filter(Boolean);
  const r = await handle(store, req.headers["x-appwrite-user-id"] || undefined, req.bodyJson, { admins, cloud: true });
  return res.json(r.body, r.status);
};
