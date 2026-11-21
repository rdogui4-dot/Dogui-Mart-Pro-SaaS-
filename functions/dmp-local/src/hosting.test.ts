import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../../dmp-api/src/memory-store";
import { SqliteStore } from "../../dmp-api/src/sqlite-store";
import { handle } from "../../dmp-api/src/main";
import { stockFor } from "../../dmp-api/src/checkout";
import { CloudError, type CloudClient } from "./cloud";
import { attachToCloud, hostState, releaseToCloud, resumeSync, runSync } from "./hosting";

const T = "tenanthost0001", T2 = "tenanthost0002";
const saved = { ...MemoryStore.defaults }; beforeAll(() => { MemoryStore.defaults = {}; }); afterAll(() => { MemoryStore.defaults = saved; });
class Cloud extends MemoryStore {
  override async create(t: string, id: string, tenant: string, d: Record<string, unknown>) { const now = new Date().toISOString(); return super.create(t, id, tenant, { $createdAt: now, $updatedAt: now, ...d }); }
  override async update(t: string, id: string, d: Record<string, unknown>) { await super.update(t, id, { ...d, $updatedAt: new Date(Date.now() + 1).toISOString() }); }
}
let cloud: Cloud; let shop = ""; let eau = ""; let down = false;
const cl = (st: MemoryStore | SqliteStore, user: string, action: string, payload: unknown, shopId = "", tenant = T, isCloud = false) => handle(st, user, { action, tenantId: tenant, shopId, payload }, { admins: [], cloud: isCloud });
const ok = async (r: ReturnType<typeof cl>) => { const x = await r; if (x.status !== 200) throw new Error(JSON.stringify(x.body)); return (x.body as { data: any }).data; };
/** Le cloud vu depuis le poste (session d'un utilisateur donné), avec la protection d'hébergement du vrai cloud. */
const client = (userId: string, passwords: Record<string, string> = { own: "bon" }): CloudClient => { let user: string | null = null;
  const run = async (action: string, tenant: string, payload: unknown) => { if (down) throw new CloudError(0, "Cloud injoignable", true); if (!user) throw new CloudError(401, "Session cloud absente"); const r = await cl(cloud, user, action, payload, "", tenant, true); if (r.status !== 200) throw new CloudError(r.status, (r.body as any).error); return (r.body as any).data; };
  const c = { login: async (email: string, pw: string) => { if (down) throw new CloudError(0, "Cloud injoignable", true); if (passwords[userId] !== pw) throw new CloudError(401, "Identifiant ou mot de passe incorrect"); user = userId; return { fallbackCookies: "x", email, userId }; }, logout: async () => { user = null; }, verifyOnline: async () => "ok" as const,
    myTeams: async () => [T, T2].filter((t) => cloud.members.has(`${t}:${userId}`)).map((id) => ({ id, name: id === T ? "Ma Boutique" : "Autre" })), ownerOf: async (id: string) => (cloud.members.get(`${id}:${userId}`) ?? []).includes("owner"),
    execute: run, api: (tenant: string) => ({ push: async (rows: any[]) => (await run("sync.push", tenant, { rows })).results, pull: (t: string, s: string, l: number) => run("sync.pull", tenant, { table: t, since: s, limit: l }), users: async () => (await run("sync.users", tenant, {})).users }), hasSession: () => !!user, session: () => null };
  return c as unknown as CloudClient; };

beforeEach(async () => {
  down = false; cloud = new Cloud(); await cloud.grant(T, "own", ["owner"], []); await cloud.grant(T2, "own", ["owner"], []); await cloud.grant(T, "empl", ["cashier"], []);
  shop = (await ok(cl(cloud, "own", "shop.create", { name: "Dakar" }))).shopId; await cloud.update("shops", shop, { cashRequired: false });
  const sub = { tenantId: T, plan: "pro", period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (!(await cloud.create("subscriptions", T, T, sub))) await cloud.update("subscriptions", T, sub);
  eau = (await ok(cl(cloud, "own", "article.save", { data: { name: "Eau", price: 500, cost: 300, sku: "EAU", barcode: "EAU0" }, initialQty: 50 }, shop))).id;
});

describe("rattachement d'un poste au cloud", () => {
  it("le poste télécharge le commerce, en devient l'hébergeur ; le cloud passe en lecture ; les ventes du poste remontent", async () => {
    const local = new SqliteStore(); const prog: string[] = []; const r = await attachToCloud(local, client("own"), { email: "patron@x.sn", password: "bon", stationName: "Caisse principale", tenantId: T }, (t) => { if (t) prog.push(t); });
    expect(r).toMatchObject({ ok: true, tenantId: T }); expect(prog.length).toBeGreaterThan(50); expect(await local.get("products", eau)).toMatchObject({ name: "Eau" }); expect(hostState(local)).toMatchObject({ hosted: true, tenantId: T, stationName: "Caisse principale", pending: 0 }); expect(local.syncOn).toBe(true);
    // le cloud refuse maintenant les écritures d'exploitation, mais reste lisible et ouvert à l'abonnement et à la synchronisation
    const refused = await cl(cloud, "own", "checkout", { clientId: "vente-cloud-001", lines: [{ productId: eau, qty: 1 }], payments: [{ method: "cash", amount: 500 }] }, shop, T, true); expect(refused.status).toBe(409); expect((refused.body as any).error).toContain("hébergé par le poste « Caisse principale »");
    expect((await cl(cloud, "own", "article.save", { id: eau, data: { price: 600 } }, shop, T, true)).status).toBe(409);
    expect((await cl(cloud, "own", "dashboard.business", { preset: "last30" }, shop, T, true)).status).toBe(200); expect((await cl(cloud, "own", "subscription.get", {}, "", T, true)).status).toBe(200); expect((await cl(cloud, "own", "host.status", {}, "", T, true)).status).toBe(200);
    // le poste vend (les employés se connectent grâce à l'annuaire copié), puis synchronise
    const v = await cl(local, "own", "checkout", { clientId: "vente-poste-001", lines: [{ productId: eau, qty: 4 }], payments: [{ method: "cash", amount: 2000 }] }, shop, T); expect(v.status).toBe(200);
    const c = client("own"); await c.login("a@x.sn", "bon"); expect((await runSync(local, c)).error).toBeUndefined(); expect((await cloud.scan("sales", { tenantId: T })).rows).toHaveLength(1);
  });
  it("refus : compte non propriétaire, mot de passe faux, plusieurs commerces (choix), poste déjà occupé par un autre commerce, déjà hébergé ailleurs, cloud injoignable", async () => {
    expect(await attachToCloud(new SqliteStore(), client("empl", { empl: "x" }), { email: "e@x.sn", password: "x", stationName: "P" })).toMatchObject({ ok: false, error: expect.stringContaining("propriétaire d'aucun commerce") });
    expect(await attachToCloud(new SqliteStore(), client("own"), { email: "a@x.sn", password: "faux", stationName: "P" })).toMatchObject({ ok: false, error: "Identifiant ou mot de passe incorrect" });
    const multi = await attachToCloud(new SqliteStore(), client("own"), { email: "a@x.sn", password: "bon", stationName: "P" }); expect(multi).toMatchObject({ ok: false, choose: [{ id: T }, { id: T2 }] });
    const occ = new SqliteStore(); occ.createTeam("autrecommerce01", "Autre"); expect(await attachToCloud(occ, client("own"), { email: "a@x.sn", password: "bon", stationName: "P", tenantId: T })).toMatchObject({ ok: false, error: "Ce poste contient déjà un autre commerce" });
    expect(await attachToCloud(new SqliteStore(), client("own"), { email: "a@x.sn", password: "bon", stationName: " " })).toMatchObject({ ok: false });
    expect((await attachToCloud(new SqliteStore(), client("own"), { email: "a@x.sn", password: "bon", stationName: "Caisse A", tenantId: T })).ok).toBe(true);
    expect(await attachToCloud(new SqliteStore(), client("own"), { email: "a@x.sn", password: "bon", stationName: "Caisse B", tenantId: T })).toMatchObject({ ok: false, error: expect.stringContaining("déjà hébergé par le poste « Caisse A »") });
    down = true; expect(await attachToCloud(new SqliteStore(), client("own"), { email: "a@x.sn", password: "bon", stationName: "P" })).toMatchObject({ ok: false, error: "Cloud injoignable" });
  });
});

describe("synchronisation courante et retour au cloud", () => {
  let local: SqliteStore;
  beforeEach(async () => { local = new SqliteStore(); const r = await attachToCloud(local, client("own"), { email: "a@x.sn", password: "bon", stationName: "Caisse", tenantId: T }); expect(r.ok).toBe(true); });
  it("une vente du poste remonte au cloud (miroir) ; coupure réseau : tout reste en attente puis repart ; session absente signalée", async () => {
    await ok(cl(local, "own", "checkout", { clientId: "vente-poste-100", lines: [{ productId: eau, qty: 4 }], payments: [{ method: "cash", amount: 2000 }] }, shop)); expect(hostState(local).pending).toBeGreaterThan(2);
    const c = client("own"); await c.login("a@x.sn", "bon"); down = true; const r1 = await runSync(local, c); expect(r1.error).toBeTruthy(); expect(hostState(local).pending).toBeGreaterThan(2); expect(hostState(local).lastError).toBeTruthy();
    down = false; const r2 = await runSync(local, c); expect(r2.error).toBeUndefined(); expect(hostState(local)).toMatchObject({ pending: 0, lastError: undefined }); expect(hostState(local).lastSyncOkAt).toBeTruthy();
    expect((await cloud.scan("sales", { tenantId: T })).rows).toHaveLength(1); expect(await stockFor(cloud, eau, 0)).toBe(46);
    const noSession = await runSync(local, client("own")); expect(noSession.error).toContain("Session cloud absente"); expect((await runSync(new SqliteStore(), c)).skipped).toBe(true);
  });
  it("retour au cloud : refusé tant que des envois échouent ; sinon le cloud reprend l'écriture et le poste cesse de journaliser", async () => {
    await ok(cl(local, "own", "checkout", { clientId: "vente-poste-200", lines: [{ productId: eau, qty: 2 }], payments: [{ method: "cash", amount: 1000 }] }, shop)); const c = client("own"); await c.login("a@x.sn", "bon");
    down = true; expect(await releaseToCloud(local, c)).toMatchObject({ ok: false, error: expect.stringContaining("rien n'est rendu au cloud") }); expect(hostState(local).hosted).toBe(true);
    down = false; expect(await releaseToCloud(local, c)).toEqual({ ok: true }); expect((await cloud.scan("sales", { tenantId: T })).rows).toHaveLength(1); expect(hostState(local).hosted).toBe(false); expect(local.syncOn).toBe(false);
    expect((await cl(cloud, "own", "article.save", { id: eau, data: { price: 650 } }, shop, T, true)).status).toBe(200);
    expect(JSON.stringify((await cloud.scan("audit_log", { tenantId: T, shopId: "commerce" })).rows)).toContain("host.release");
  });
  it("redémarrage du poste : la synchronisation reprend (état conservé dans la base)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dmp-host-")); try {
      const a = new SqliteStore({ path: join(dir, "p.sqlite") }); expect((await attachToCloud(a, client("own"), { email: "a@x.sn", password: "bon", stationName: "Caisse", tenantId: T })).ok).toBe(true); a.close();
      const b = new SqliteStore({ path: join(dir, "p.sqlite") }); expect(b.syncOn).toBe(false); resumeSync(b); expect(b.syncOn).toBe(true); expect(hostState(b)).toMatchObject({ hosted: true, tenantId: T }); await ok(cl(b, "own", "article.save", { id: eau, data: { price: 700 } }, shop)); expect(hostState(b).pending).toBeGreaterThan(0); b.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("cloud : reprise de l'hébergement par le propriétaire", () => {
  it("claim rejouable pour le même poste, remplacement explicite, release forcé tracé ; employé refusé", async () => {
    expect((await cl(cloud, "empl", "host.claim", { name: "X" }, "", T, true)).status).toBe(403);
    const a = await ok(cl(cloud, "own", "host.claim", { name: "Caisse A" }, "", T, true)); const again = await ok(cl(cloud, "own", "host.claim", { name: "Caisse A" }, "", T, true)); expect(again.host.since).toBe(a.host.since);
    expect((await cl(cloud, "own", "host.claim", { name: "Caisse B" }, "", T, true)).status).toBe(409); expect((await cl(cloud, "own", "host.claim", { name: "Caisse B", force: true }, "", T, true)).status).toBe(200);
    expect((await ok(cl(cloud, "own", "host.status", {}, "", T, true))).host.name).toBe("Caisse B"); await ok(cl(cloud, "own", "host.release", { force: true }, "", T, true)); expect((await ok(cl(cloud, "own", "host.status", {}, "", T, true))).host).toBeNull();
    expect((await cl(cloud, "own", "article.save", { id: eau, data: { price: 650 } }, shop, T, true)).status).toBe(200); expect(JSON.stringify((await cloud.scan("audit_log", { tenantId: T, shopId: "commerce" })).rows)).toContain("reprise forcée");
  });
});

describe("routes /v1/cloud", () => {
  it("sans liaison : 404 ; avec liaison : rattachement refusé proprement si le cloud est injoignable, état et retour réservés au propriétaire", async () => {
    const { startLocalServer } = await import("./main");
    const dir = mkdtempSync(join(tmpdir(), "dmp-routes-")); const down: typeof fetch = async () => { throw new TypeError("fetch failed"); };
    const a = await startLocalServer({ dataDir: dir, port: 0, host: "127.0.0.1" }); const post = (srv: typeof a, path: string, body: unknown, tk?: string) => fetch(`http://127.0.0.1:${srv.port}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(tk ? { authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) });
    try {
      expect((await post(a, "/v1/cloud/attach", { email: "a@x.sn", password: "x", stationName: "P" })).status).toBe(404);
    } finally { await a.close(); }
    const b = await startLocalServer({ dataDir: dir, port: 0, host: "127.0.0.1", cloud: { config: { endpoint: "https://cloud.invalid/v1", projectId: "p", functionId: "f" }, fetch: down } });
    try {
      const r = await post(b, "/v1/cloud/attach", { email: "a@x.sn", password: "x", stationName: "P" }); expect(r.status).toBe(400); expect((await r.json()).ok).toBe(false);
      const reg = await (await post(b, "/v1/auth/register", { email: "o@x.sn", password: "Abcdefg1!xyz", name: "O" })).json(); expect((await fetch(`http://127.0.0.1:${b.port}/v1/cloud/status`, { headers: { authorization: `Bearer ${reg.token}` } })).status).toBe(403); // pas encore propriétaire
      b.store.createTeam("teamroutes0001", "Boutique"); await b.store.addMember("teamroutes0001", String(reg.userId ?? b.store.db.prepare("SELECT id FROM users WHERE email = ?").get("o@x.sn")?.id), ["owner"], "O");
      const st = await (await fetch(`http://127.0.0.1:${b.port}/v1/cloud/status`, { headers: { authorization: `Bearer ${reg.token}` } })).json(); expect(st).toMatchObject({ ok: true, hosted: false, pending: 0 });
      expect((await post(b, "/v1/cloud/release", {}, reg.token)).status).toBe(409);
      expect((await (await post(b, "/v1/cloud/attach", { email: "a@x.sn", password: "x", stationName: "P" })).json()).error).toContain("déjà configuré");
    } finally { await b.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
