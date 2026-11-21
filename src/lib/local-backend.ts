/** Serveur local de la version Windows vu depuis l'interface : mêmes contrats que le cloud (lignes, actions, temps réel, fichiers) et identité locale.
 *  Activé quand le serveur local sert l'application (marqueur `<meta name="dmp-local">`). Le jeton de session est conservé sur l'appareil. */
import type { Backend, DataRow } from "./backend";
import { setBackend } from "./backend";
import { setIdentity, type AuthUser, type Identity } from "./identity";

const TOKEN_KEY = "dmp.local.token";
const getToken = (): string => { try { return localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; } };
const setToken = (t: string | null) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* navigation privée */ } };
export class LocalError extends Error { constructor(public code: number, message: string) { super(message); } }

export const isLocalMode = (): boolean => typeof document !== "undefined" && !!document.querySelector('meta[name="dmp-local"]');

type SessionInfo = { user: { id: string; name: string; email: string }; teams: { id: string; name: string; roles: string[] }[] };

export type NetworkInfo = { app: string; hostName: string; port: number; https: boolean; urls: string[]; certificate: { fingerprint: string; notAfter: string; hosts: string[] } | null; mdns: boolean };
export type Device = { id: string; userId: string; name: string; roles: string[]; device: string; ip: string; createdAt: string; lastSeen: string; current: boolean; active: boolean };
/** Réseau local du poste principal (propriétaire) : adresses, certificat, appareils connectés. */
export type LocalNetwork = { get(): Promise<{ info: NetworkInfo | null; devices: Device[] }>; revoke(id: string): Promise<void> };
import type { HostStatus } from "@/domain/sync-alert";
export type SyncConflict = { id: number; at: string; table: string; rowId: string; kind: string; local: unknown; cloud: unknown };
/** Liaison du poste avec le cloud : état, synchronisation, reconnexion, retour au cloud, restauration, constats à examiner, rattachement d'un poste vierge. */
export type LocalCloud = {
  availability(): Promise<{ available: boolean; needsSetup: boolean }>;
  status(): Promise<HostStatus>; sync(): Promise<HostStatus & { report: { pushed: number; pulled: number; error?: string; rejected: { table: string; id: string; error: string }[] } }>;
  reconnect(password: string): Promise<HostStatus>; release(): Promise<void>; restore(confirmName: string): Promise<HostStatus>; setAlertHours(h: number): Promise<HostStatus>;
  conflicts(): Promise<SyncConflict[]>; review(id: number | "all"): Promise<HostStatus>;
  attach(p: { email: string; password: string; stationName: string; tenantId?: string }): Promise<{ ok: true } | { ok: false; error: string; choose?: { id: string; name: string }[] }>;
};
let cloudApi: LocalCloud | null = null;
export const localCloud = (): LocalCloud | null => cloudApi;
let networkApi: LocalNetwork | null = null;
export const localNetwork = (): LocalNetwork | null => networkApi;

export function createLocal(base = ""): { backend: Partial<Backend>; identity: Identity; network: LocalNetwork; cloud: LocalCloud; setup: () => Promise<{ needsSetup: boolean }> } {
  const req = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const token = getToken(); let r: Response;
    try { r = await fetch(`${base}${path}`, { ...init, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } }); }
    catch { throw new Error("Serveur local injoignable"); } // panne réseau : l'interface garde la session en cache
    return r;
  };
  const json = async <T>(r: Response): Promise<T> => { const t = await r.text(); let b: { ok?: boolean; error?: string } & Record<string, unknown> = {}; try { b = JSON.parse(t); } catch { /* corps non JSON */ } if (!r.ok) throw new LocalError(r.status, String(b.error ?? `Erreur ${r.status}`)); return b as unknown as T; };
  let cached: SessionInfo | null = null;
  const session = async (): Promise<SessionInfo> => { if (cached) return cached; const s = await json<SessionInfo>(await req("/v1/auth/session")); cached = s; return s; };

  const identity: Identity = {
    local: true,
    me: async (): Promise<AuthUser> => { const { user } = await session(); return { $id: user.id, name: user.name, email: user.email, emailVerification: true }; },
    teams: async () => (await session()).teams.map((t) => ({ $id: t.id, name: t.name })),
    memberships: async (teamId) => { const s = await session(); return s.teams.filter((t) => t.id === teamId).map((t) => ({ userId: s.user.id, roles: t.roles })); },
    login: async (email, password) => { cached = null; const r = await json<{ token: string }>(await req("/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) })); setToken(r.token); },
    signup: async (email, password, name) => { cached = null; const r = await json<{ token: string }>(await req("/v1/auth/register", { method: "POST", body: JSON.stringify({ email, password, name }) })); setToken(r.token); },
    logout: async () => { try { await req("/v1/auth/logout", { method: "POST" }); } finally { setToken(null); cached = null; } },
    createTeam: async (name) => { const r = await json<{ teamId: string }>(await req("/v1/auth/team", { method: "POST", body: JSON.stringify({ name }) })); cached = null; return r.teamId; },
  };

  const backend: Partial<Backend> = {
    data: {
      listRows: async (table, queries) => { const r = await json<{ rows: DataRow[]; total: number }>(await req(`/v1/rows/${table}?q=${encodeURIComponent(JSON.stringify(queries))}`)); return r; },
      getRow: async (table, id) => json<DataRow>(await req(`/v1/rows/${table}/${encodeURIComponent(id)}`)),
    },
    transport: { execute: async (body) => { const r = await req("/v1/execute", { method: "POST", body }); return { status: r.status, body: await r.text() }; } },
    realtime: {
      subscribe: (channels, onChange) => {
        const tables = new Set(channels.map((c) => /\.tables\.([A-Za-z0-9_]+)\./.exec(c)?.[1]).filter((x): x is string => !!x)); const token = getToken(); if (!token || typeof EventSource === "undefined") return () => undefined;
        const es = new EventSource(`${base}/v1/events?token=${encodeURIComponent(token)}`); es.onmessage = (m) => { try { if (tables.has(JSON.parse(m.data).table)) onChange(); } catch { /* message illisible */ } };
        return () => es.close();
      },
    },
    files: { fetch: (fileId) => req(`/v1/files/${encodeURIComponent(fileId)}`, { headers: {} }) },
  };
  const network: LocalNetwork = { get: async () => json(await req("/v1/network")), revoke: async (id) => { await json(await req("/v1/network/revoke", { method: "POST", body: JSON.stringify({ id }) })); } };
  const raw = async (path: string, body?: unknown) => { const r = await req(path, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }); const t = await r.text(); let b: any = {}; try { b = JSON.parse(t); } catch { /* corps non JSON */ } return { status: r.status, ok: r.ok, b }; };
  const must = async <T>(path: string, body?: unknown): Promise<T> => { const r = await raw(path, body); if (!r.ok) throw new LocalError(r.status, String(r.b?.error ?? "Opération impossible")); return r.b as T; };
  const cloud: LocalCloud = {
    availability: () => must("/v1/cloud/availability"), status: () => must("/v1/cloud/status"), sync: () => must("/v1/cloud/sync", {}), reconnect: (password) => must("/v1/cloud/reconnect", { password }),
    release: async () => { await must("/v1/cloud/release", {}); }, restore: (confirmName) => must("/v1/cloud/restore", { confirmName }), setAlertHours: (alertHours) => must("/v1/cloud/settings", { alertHours }),
    conflicts: async () => (await must<{ conflicts: SyncConflict[] }>("/v1/cloud/conflicts")).conflicts, review: (id) => must("/v1/cloud/conflicts/review", id === "all" ? { all: true } : { id }),
    attach: async (p) => { const r = await raw("/v1/cloud/attach", p); return r.ok ? { ok: true } : { ok: false, error: String(r.b?.error ?? "Rattachement impossible"), choose: r.b?.choose }; },
  };
  return { backend, identity, network, cloud, setup: async () => json<{ needsSetup: boolean }>(await req("/v1/setup")) };
}

/** À appeler au démarrage : si le serveur local sert l'application, remplace le cloud par lui. */
export function installLocalIfServed(): boolean {
  if (!isLocalMode()) return false; const l = createLocal(""); setBackend(l.backend); setIdentity(l.identity); networkApi = l.network; cloudApi = l.cloud; return true;
}
