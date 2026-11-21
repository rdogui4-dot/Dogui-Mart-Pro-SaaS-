import type { DirectoryUser } from "../../dmp-api/src/store";
import type { PushResult, PushRow } from "../../dmp-api/src/sync";
import type { CloudApi } from "./sync";

/** Client du cloud (Appwrite) pour le poste local : session du PROPRIÉTAIRE (jamais de clé d'administration), appels de la fonction `dmp-api`, vérification d'un mot de passe en ligne.
 *  Le cookie de session est conservé sous la forme de l'en-tête `X-Fallback-Cookies`, comme le fait le SDK web d'Appwrite. */
export type CloudConfig = { endpoint: string; projectId: string; functionId?: string };
export type CloudSession = { fallbackCookies: string; email: string; userId: string };
type Fetch = typeof fetch;
export class CloudError extends Error { constructor(public status: number, message: string, public network = false) { super(message); } }

export function createCloudClient(cfg: CloudConfig, opts: { fetch?: Fetch; session?: CloudSession | null; onSession?: (s: CloudSession | null) => void } = {}) {
  const f: Fetch = opts.fetch ?? fetch; let session = opts.session ?? null; const base = cfg.endpoint.replace(/\/+$/, ""); const fn = cfg.functionId ?? "dmp-api";
  const headers = (extra: Record<string, string> = {}, withSession = true): Record<string, string> => ({ "content-type": "application/json", "x-appwrite-project": cfg.projectId, ...(withSession && session ? { "x-fallback-cookies": session.fallbackCookies } : {}), ...extra });
  const call = async (method: string, path: string, body?: unknown, withSession = true): Promise<Response> => {
    try { return await f(`${base}${path}`, { method, headers: headers({}, withSession), ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) }); }
    catch (e) { throw new CloudError(0, (e as Error).message || "Cloud injoignable", true); }
  };
  const json = async (r: Response) => { const t = await r.text(); try { return JSON.parse(t) as Record<string, unknown>; } catch { return {} as Record<string, unknown>; } };

  /** Ouvre une session cloud (e-mail et mot de passe du propriétaire). Le mot de passe n'est jamais conservé. */
  async function login(email: string, password: string): Promise<CloudSession> {
    const r = await call("POST", "/account/sessions/email", { email, password }, false);
    if (r.status >= 500) throw new CloudError(r.status, "Service cloud indisponible", true);
    const b = await json(r); if (r.status < 200 || r.status >= 300) throw new CloudError(r.status, String(b.message ?? "Identifiant ou mot de passe incorrect"));
    const fb = r.headers.get("x-fallback-cookies"); if (!fb) throw new CloudError(500, "Le cloud n'a pas renvoyé de session");
    session = { fallbackCookies: fb, email, userId: String(b.userId ?? "") }; opts.onSession?.(session); return session;
  }
  async function logout(): Promise<void> { if (!session) return; try { await call("DELETE", "/account/sessions/current"); } catch { /* session déjà fermée ou cloud injoignable */ } session = null; opts.onSession?.(null); }
  /** Vérifie un identifiant et un mot de passe auprès du cloud sans garder de session (la session ouverte pour la vérification est refermée aussitôt). */
  async function verifyOnline(email: string, password: string): Promise<"ok" | "bad" | "unreachable"> {
    let r: Response; try { r = await call("POST", "/account/sessions/email", { email, password }, false); } catch { return "unreachable"; }
    if (r.status >= 500 || r.status === 429) return "unreachable"; if (r.status < 200 || r.status >= 300) return "bad";
    const fb = r.headers.get("x-fallback-cookies"); if (fb) { try { await f(`${base}/account/sessions/current`, { method: "DELETE", headers: { "content-type": "application/json", "x-appwrite-project": cfg.projectId, "x-fallback-cookies": fb }, signal: AbortSignal.timeout(15_000) }); } catch { /* le nettoyage est facultatif */ } }
    return "ok";
  }
  /** Équipes (commerces) du compte connecté : identifiant, nom, rôles. */
  async function myTeams(): Promise<{ id: string; name: string }[]> {
    const r = await call("GET", "/teams"); const b = await json(r); if (!r.ok) throw new CloudError(r.status, String(b.message ?? "Équipes indisponibles"), r.status >= 500);
    return ((b.teams as { $id: string; name: string }[]) ?? []).map((t) => ({ id: t.$id, name: t.name }));
  }
  async function ownerOf(teamId: string): Promise<boolean> {
    const r = await call("GET", `/teams/${encodeURIComponent(teamId)}/memberships`); const b = await json(r); if (!r.ok) return false;
    return ((b.memberships as { userId: string; roles: string[] }[]) ?? []).some((m) => m.userId === session?.userId && m.roles.includes("owner"));
  }
  /** Exécute une action de la fonction `dmp-api` avec la session du propriétaire. */
  async function execute<T = unknown>(action: string, tenantId: string, payload: unknown = {}, shopId = ""): Promise<T> {
    if (!session) throw new CloudError(401, "Session cloud absente : reconnectez ce poste au cloud");
    const r = await call("POST", `/functions/${encodeURIComponent(fn)}/executions`, { body: JSON.stringify({ action, tenantId, shopId, payload }), async: false, path: "/", method: "POST", headers: { "content-type": "application/json" } });
    const b = await json(r); /* session refusée : elle ne vaut plus rien, le poste le signale au propriétaire */ if (r.status === 401) { session = null; opts.onSession?.(null); throw new CloudError(401, "Session cloud expirée : reconnectez ce poste au cloud"); } if (r.status >= 500) throw new CloudError(r.status, "Service cloud indisponible", true); if (!r.ok) throw new CloudError(r.status, String(b.message ?? "Appel refusé"));
    let out: { ok: boolean; data?: T; error?: string }; try { out = JSON.parse(String(b.responseBody ?? "")); } catch { throw new CloudError(Number(b.responseStatusCode) || 500, "Réponse du cloud illisible"); }
    if (!out.ok) throw new CloudError(Number(b.responseStatusCode) || 400, out.error ?? "Refusé par le cloud"); return out.data as T;
  }
  const api = (tenantId: string): CloudApi => ({
    push: async (rows: PushRow[]) => (await execute<{ results: PushResult[] }>("sync.push", tenantId, { rows })).results,
    pull: (table, since, limit) => execute("sync.pull", tenantId, { table, since, limit }),
    users: async () => (await execute<{ users: DirectoryUser[] }>("sync.users", tenantId, {})).users,
    ids: (table: string) => execute<{ ids: string[]; truncated: boolean }>("sync.ids", tenantId, { table }),
    fileUp: (f: { fileId: string; name: string; data: string; readRoles: string[] }) => execute<{ status: "stored" | "exists" }>("sync.fileUp", tenantId, f),
    fileDown: async (fileId: string) => { try { return await execute<{ name: string; mime: string; data: string; readRoles: string[] }>("sync.fileDown", tenantId, { fileId }); } catch (e) { if (e instanceof CloudError && e.status === 404) return null; throw e; } },
    fileDelete: async (fileId: string) => { await execute("sync.fileDelete", tenantId, { fileId }); },
    userPush: async (users: unknown[]) => (await execute<{ results: { userId: string; status: "created" | "updated" | "refused"; error?: string }[] }>("sync.userPush", tenantId, { users })).results,
  });
  return { login, logout, verifyOnline, myTeams, ownerOf, execute, api, hasSession: () => !!session, session: () => session };
}
export type CloudClient = ReturnType<typeof createCloudClient>;
