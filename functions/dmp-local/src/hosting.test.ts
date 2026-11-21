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
/** Horloge simulée strictement croissante (deux mises à jour dans la même milliseconde n'auraient sinon qu'une date : Appwrite ne le fait pas). */
let lastStamp = 0; const nextStamp = (): string => { lastStamp = Math.max(Date.now() + 1, lastStamp + 1); return new Date(lastStamp).toISOString(); };
class Cloud extends MemoryStore {
  override async create(t: string, id: string, tenant: string, d: Record<string, unknown>) { const now = new Date().toISOString(); return super.create(t, id, tenant, { $createdAt: now, $updatedAt: now, ...d }); }
  override async update(t: string, id: string, d: Record<string, unknown>) { await super.update(t, id, { ...d, $updatedAt: nextStamp() }); }
}
let cloud: Cloud; let shop = ""; let eau = ""; let down = false;
const cl = (st: MemoryStore | SqliteStore, user: string, action: string, payload: unknown, shopId = "", tenant = T, isCloud = false) => handle(st, user, { action, tenantId: tenant, shopId, payload }, { admins: [], cloud: isCloud });
const ok = async (r: ReturnType<typeof cl>) => { const x = await r; if (x.status !== 200) throw new Error(JSON.stringify(x.body)); return (x.body as { data: any }).data; };
/** Le cloud vu depuis le poste (session d'un utilisateur donné), avec la protection d'hébergement du vrai cloud. */
const client = (userId: string, passwords: Record<string, string> = { own: "bon" }): CloudClient => { let user: string | null = null;
  const run = async (action: string, tenant: string, payload: unknown) => { if (down) throw new CloudError(0, "Cloud injoignable", true); if (!user) throw new CloudError(401, "Session cloud absente"); const r = await cl(cloud, user, action, payload, "", tenant, true); if (r.status !== 200) throw new CloudError(r.status, (r.body as any).error); return (r.body as any).data; };
  const c = { login: async (email: string, pw: string) => { if (down) throw new CloudError(0, "Cloud injoignable", true); if (passwords[userId] !== pw) throw new CloudError(401, "Identifiant ou mot de passe incorrect"); user = userId; return { fallbackCookies: "x", email, userId }; }, logout: async () => { user = null; }, verifyOnline: async () => "ok" as const,
    myTeams: async () => [T, T2].filter((t) => cloud.members.has(`${t}:${userId}`)).map((id) => ({ id, name: id === T ? "Ma Boutique" : "Autre" })), ownerOf: async (id: string) => (cloud.members.get(`${id}:${userId}`) ?? []).includes("owner"),
    execute: run, api: (tenant: string) => ({ push: async (rows: any[]) => (await run("sync.push", tenant, { rows })).results, pull: (t: string, s: string, l: number) => run("sync.pull", tenant, { table: t, since: s, limit: l }), users: async () => (await run("sync.users", tenant, {})).users, ids: (table: string) => run("sync.ids", tenant, { table }), fileUp: (f: any) => run("sync.fileUp", tenant, f), fileDown: async (fileId: string) => { try { return await run("sync.fileDown", tenant, { fileId }); } catch (e) { if ((e as CloudError).status === 404) return null; throw e; } }, fileDelete: async (fileId: string) => { await run("sync.fileDelete", tenant, { fileId }); }, userPush: async (users: any[]) => (await run("sync.userPush", tenant, { users })).results }), hasSession: () => !!user, session: () => null };
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
    const c = client("own"); await c.login("a@x.sn", "bon"); expect((await runSync(local, c, { force: true })).error).toBeUndefined(); expect((await cloud.scan("sales", { tenantId: T })).rows).toHaveLength(1);
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
    const c = client("own"); await c.login("a@x.sn", "bon"); down = true; const r1 = await runSync(local, c, { force: true }); expect(r1.error).toBeTruthy(); expect(hostState(local).pending).toBeGreaterThan(2); expect(hostState(local).lastError).toBeTruthy();
    down = false; const r2 = await runSync(local, c, { force: true }); expect(r2.error).toBeUndefined(); expect(hostState(local)).toMatchObject({ pending: 0, lastError: undefined }); expect(hostState(local).lastSyncOkAt).toBeTruthy();
    expect((await cloud.scan("sales", { tenantId: T })).rows).toHaveLength(1); expect(await stockFor(cloud, eau, 0)).toBe(46);
    const noSession = await runSync(local, client("own"), { force: true }); expect(noSession.error).toContain("Session cloud absente"); expect((await runSync(new SqliteStore(), c, { force: true })).skipped).toBe(true);
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

describe("fichiers (photos, logos, pièces)", () => {
  const jpeg = (n = 300, tag = 1) => { const b = new Uint8Array(n); b.set([0xff, 0xd8, 0xff, 0xe0], 0); b[10] = tag; return b; };
  const ownerRole = `team:${T}/owner`;
  it("rattachement : la photo d'un article du cloud est copiée sur le poste avec ses droits ; envoi d'un fichier du poste ; suppression ; refus (format, autre commerce, taille)", async () => {
    await cloud.putFile("photo-eau-001", jpeg(), "eau.jpg", "image/jpeg", [ownerRole, `label:s${shop}`]); await cloud.update("products", eau, { imageFileId: "photo-eau-001" });
    const local = new SqliteStore(); expect((await attachToCloud(local, client("own"), { email: "a@x.sn", password: "bon", stationName: "Caisse", tenantId: T })).ok).toBe(true);
    expect(local.fileMeta("photo-eau-001")).toMatchObject({ name: "eau.jpg", mime: "image/jpeg", readRoles: [ownerRole, `label:s${shop}`] }); expect(local.filesPending()).toHaveLength(0); // reçu du cloud : rien à renvoyer
    const c = client("own"); await c.login("a@x.sn", "bon");
    await local.putFile("logo-poste-0001", jpeg(500, 2), "logo.jpg", "image/jpeg", [ownerRole, `label:s${shop}`]); expect(local.filesPending()).toHaveLength(1);
    await local.putFile("mauvais-format-01", new Uint8Array(400).fill(7), "x.bin", "application/octet-stream", [ownerRole]);
    await local.putFile("autre-commerce-01", jpeg(300, 3), "z.jpg", "image/jpeg", [`team:${T2}/owner`]);
    await local.putFile("trop-gros-000001", (() => { const b = jpeg(5 * 1024 * 1024 + 10, 4); return b; })(), "big.jpg", "image/jpeg", [ownerRole]);
    const r = await runSync(local, c, { force: true }); expect(r.error).toBeUndefined(); expect(r.rejected.map((x) => x.id).sort()).toEqual(["autre-commerce-01", "mauvais-format-01", "trop-gros-000001"]);
    expect(await cloud.fileInfo("logo-poste-0001")).toMatchObject({ mime: "image/jpeg", readRoles: [ownerRole, `label:s${shop}`] }); expect(await cloud.fileInfo("mauvais-format-01")).toBeNull(); expect(await cloud.fileInfo("autre-commerce-01")).toBeNull(); expect(local.filesPending()).toHaveLength(0);
    expect((await runSync(local, c, { force: true })).rejected).toEqual([]); // rien n'est renvoyé une fois signalé
    await local.deleteFile("logo-poste-0001"); expect(local.filesDeleted()).toEqual(["logo-poste-0001"]); expect((await runSync(local, c, { force: true })).error).toBeUndefined(); expect(await cloud.fileInfo("logo-poste-0001")).toBeNull(); expect(local.filesDeleted()).toEqual([]);
    // coupure : le fichier reste en attente puis part
    await local.putFile("coupure-0000001", jpeg(300, 5), "c.jpg", "image/jpeg", [ownerRole]); down = true; expect((await runSync(local, c, { force: true })).error).toBeTruthy(); expect(local.filesPending()).toHaveLength(1); down = false; expect((await runSync(local, c, { force: true })).error).toBeUndefined(); expect(await cloud.fileInfo("coupure-0000001")).not.toBeNull();
  });
  it("le cloud refuse de livrer ou d'effacer le fichier d'un autre commerce, et de modifier un fichier existant", async () => {
    await cloud.putFile("fichier-autre-01", jpeg(), "a.jpg", "image/jpeg", [`team:${T2}/owner`]);
    const call2 = (action: string, payload: unknown) => cl(cloud, "own", action, payload, "", T, true);
    expect((await call2("sync.fileDown", { fileId: "fichier-autre-01" })).status).toBe(404); expect((await call2("sync.fileDelete", { fileId: "fichier-autre-01" })).status).toBe(403);
    expect((await call2("sync.fileUp", { fileId: "fichier-autre-01", name: "a", data: Buffer.from(jpeg()).toString("base64"), readRoles: [ownerRole] })).status).toBe(403);
    expect((await cl(cloud, "empl", "sync.fileDown", { fileId: "x" }, "", T, true)).status).toBe(403);
    await cloud.putFile("fichier-mien-0001", jpeg(), "m.jpg", "image/jpeg", [ownerRole]); const again = await ok(call2("sync.fileUp", { fileId: "fichier-mien-0001", name: "m", data: Buffer.from(jpeg(300, 9)).toString("base64"), readRoles: [ownerRole] })); expect(again.status).toBe("exists"); expect([...(await cloud.readFile("fichier-mien-0001"))!.slice(10, 11)]).toEqual([1]);
  });
});

describe("suppressions côté cloud et reprise après échecs", () => {
  let local: SqliteStore;
  beforeEach(async () => { local = new SqliteStore(); expect((await attachToCloud(local, client("own"), { email: "a@x.sn", password: "bon", stationName: "Caisse", tenantId: T })).ok).toBe(true); });
  it("une ligne partagée supprimée au cloud disparaît du poste (version gardée au journal) ; garde-fou si trop de lignes manquent", async () => {
    const c = client("own"); await c.login("a@x.sn", "bon");
    const extra: string[] = []; for (let i = 0; i < 6; i++) extra.push((await ok(cl(cloud, "own", "article.save", { data: { name: `A${i}`, price: 100, cost: 50, sku: `S${i}`, barcode: `B${i}` } }, shop))).id);
    expect((await runSync(local, c, { force: true })).error).toBeUndefined(); expect(await local.get("products", extra[0]!)).toBeTruthy();
    await cloud.remove("products", extra[0]!); local.syncSet("reconciledAt", null); const r = await runSync(local, c, { force: true }); expect(r.error).toBeUndefined();
    expect(await local.get("products", extra[0]!)).toBeFalsy(); expect(await local.get("products", eau)).toBeTruthy(); expect(local.conflicts().some((x: any) => x.reason === "deleted_on_cloud" || x.kind === "deleted_on_cloud" || JSON.stringify(x).includes("deleted_on_cloud"))).toBe(true);
    for (const id of extra.slice(1, 6)) await cloud.remove("products", id); local.syncSet("reconciledAt", null); expect((await runSync(local, c, { force: true })).error).toBeUndefined(); // 5 manquent sur 6 : suspect
    expect(await local.get("products", extra[1]!)).toBeTruthy(); expect(JSON.stringify(local.conflicts())).toContain("cloud_deletions_suspicious");
  });
  it("une ligne en attente d'envoi n'est jamais supprimée par la réconciliation", async () => {
    const c = client("own"); await c.login("a@x.sn", "bon"); await ok(cl(local, "own", "article.save", { id: eau, data: { price: 777 } }, shop)); await cloud.remove("products", eau); local.syncSet("reconciledAt", null);
    const { reconcileDeletions } = await import("./sync"); const r = await reconcileDeletions(local, c.api(T)); expect(r.removed).toBe(0); expect(await local.get("products", eau)).toBeTruthy();
  });
  it("après des échecs, les essais automatiques attendent (délai croissant) ; « Synchroniser maintenant » passe outre ; un succès remet à zéro", async () => {
    const { backoffMs } = await import("./hosting"); expect([1, 2, 3, 4, 5, 9].map(backoffMs)).toEqual([60_000, 120_000, 240_000, 480_000, 900_000, 900_000]);
    const c = client("own"); await c.login("a@x.sn", "bon"); down = true;
    expect((await runSync(local, c)).error).toBeTruthy(); expect(hostState(local)).toMatchObject({ failures: 1, nextTryAt: expect.any(String) }); expect((await runSync(local, c)).waiting).toBe(true); // encore dans le délai : aucun appel
    expect((await runSync(local, c, { force: true })).error).toBeTruthy(); expect(hostState(local).failures).toBe(2);
    down = false; expect((await runSync(local, c)).waiting).toBe(true); expect((await runSync(local, c, { force: true })).error).toBeUndefined(); expect(hostState(local)).toMatchObject({ failures: 0, nextTryAt: undefined, lastError: undefined });
  });
});

describe("reconnexion, restauration, robustesse (lot 4d)", () => {
  let local: SqliteStore;
  beforeEach(async () => { local = new SqliteStore(); expect((await attachToCloud(local, client("own"), { email: "a@x.sn", password: "bon", stationName: "Caisse", tenantId: T })).ok).toBe(true); });
  const sale = (id: string, q = 1) => ok(cl(local, "own", "checkout", { clientId: id, lines: [{ productId: eau, qty: q }], payments: [{ method: "cash", amount: 500 * q }] }, shop));
  it("reconnexion : refusée avec un mauvais mot de passe, acceptée avec le bon ; le mot de passe n'est pas conservé", async () => {
    const { reconnectCloud } = await import("./hosting"); const c = client("own");
    expect(await reconnectCloud(local, c, "faux")).toMatchObject({ ok: false, error: "Identifiant ou mot de passe incorrect" }); expect(await reconnectCloud(local, c, "bon")).toEqual({ ok: true }); expect(c.hasSession()).toBe(true);
    expect(JSON.stringify(local.db.prepare("SELECT * FROM sync_state").all())).not.toContain("bon\"");
  });
  it("restauration : refusée sans confirmation exacte ou avec des envois en attente ; sinon copie de sécurité puis téléchargement complet (les ventes déjà envoyées reviennent du cloud)", async () => {
    const { restoreFromCloud } = await import("./hosting"); const dir = mkdtempSync(join(tmpdir(), "dmp-restore-")); const c = client("own"); await c.login("a@x.sn", "bon");
    try {
      await sale("vente-resto-001", 2); expect(await restoreFromCloud(local, c, { backupDir: dir, confirmName: "Caisse" })).toMatchObject({ ok: false, error: expect.stringContaining("pas encore envoyés") });
      expect((await runSync(local, c, { force: true })).error).toBeUndefined();
      expect(await restoreFromCloud(local, c, { backupDir: dir, confirmName: "autre" })).toMatchObject({ ok: false, error: expect.stringContaining("nom de ce poste") });
      local.db.exec("DELETE FROM rows WHERE tbl = 'sales'"); expect((await local.scan("sales", { tenantId: T })).rows).toHaveLength(0); // poste abîmé
      const r = await restoreFromCloud(local, c, { backupDir: dir, confirmName: "Caisse" }); expect(r.ok).toBe(true); if (r.ok) expect(require("node:fs").existsSync(r.backup)).toBe(true);
      expect((await local.scan("sales", { tenantId: T })).rows).toHaveLength(1); expect(await local.get("products", eau)).toBeTruthy(); expect(hostState(local)).toMatchObject({ pending: 0, hosted: true }); expect(local.syncOn).toBe(true);
      await sale("vente-resto-002"); expect(hostState(local).pending).toBeGreaterThan(0); // la journalisation a repris
      down = true; expect(await restoreFromCloud(local, c, { backupDir: dir, confirmName: "Caisse" })).toMatchObject({ ok: false }); down = false;
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("envoi en double (même lot rejoué) : aucune vente dupliquée au cloud ; coupure réseau en pleine remontée : reprise sans perte ni doublon", async () => {
    await sale("vente-dbl-0001", 1); await sale("vente-dbl-0002", 2); await sale("vente-dbl-0003", 3);
    let calls = 0; const c = client("own"); await c.login("a@x.sn", "bon"); const real = c.api; (c as any).api = (t: string) => { const a = real(t); return { ...a, push: async (rows: any[]) => { calls++; const r = await a.push(rows); if (calls === 1) { const half = rows.slice(0, Math.ceil(rows.length / 2)); await a.push(half); /* rejeu du début du lot */ throw new CloudError(0, "Coupure réseau", true); } return r; } }; };
    const r1 = await runSync(local, c, { force: true }); expect(r1.error).toBeTruthy(); expect(hostState(local).pending).toBeGreaterThan(0);
    const r2 = await runSync(local, c, { force: true }); expect(r2.error).toBeUndefined(); expect(hostState(local).pending).toBe(0);
    expect((await cloud.scan("sales", { tenantId: T })).rows).toHaveLength(3); expect(await stockFor(cloud, eau, 0)).toBe(50 - 6);
  });
  it("horloge du poste très décalée (3 jours en arrière) : la synchronisation converge quand même (aucune dépendance à l'horloge)", async () => {
    const { vi } = await import("vitest"); const c = client("own"); await c.login("a@x.sn", "bon"); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() - 3 * 864e5);
    try { await sale("vente-clock-001", 2); const r = await runSync(local, c, { force: true }); expect(r.error).toBeUndefined(); } finally { vi.useRealTimers(); }
    expect((await cloud.scan("sales", { tenantId: T })).rows).toHaveLength(1); expect(hostState(local).pending).toBe(0);
    await cloud.update("products", eau, { price: 640 }); local.syncSet("reconciledAt", null); expect((await runSync(local, c, { force: true })).error).toBeUndefined(); expect((await local.get("products", eau))!.price).toBe(640);
  });
});

describe("routes lot 4d", () => {
  it("disponibilité publique, seuil d'alerte, constats à examiner : réservés au propriétaire", async () => {
    const { startLocalServer } = await import("./main"); const dir = mkdtempSync(join(tmpdir(), "dmp-4d-"));
    const b = await startLocalServer({ dataDir: dir, port: 0, host: "127.0.0.1", cloud: { config: { endpoint: "https://cloud.invalid/v1", projectId: "p" }, fetch: (async () => { throw new TypeError("x"); }) as typeof fetch } });
    const url = (p: string) => `http://127.0.0.1:${b.port}${p}`; const J = { "content-type": "application/json" };
    try {
      expect(await (await fetch(url("/v1/cloud/availability"))).json()).toEqual({ available: true, needsSetup: true });
      const reg = await (await fetch(url("/v1/auth/register"), { method: "POST", headers: J, body: JSON.stringify({ email: "o@x.sn", password: "Abcdefg1!xyz", name: "O" }) })).json(); const uid = String(b.store.db.prepare("SELECT id FROM users WHERE email = 'o@x.sn'").get()!.id);
      b.store.createTeam("team4d00000001", "Boutique"); await b.store.addMember("team4d00000001", uid, ["owner"], "O"); const H = { ...J, authorization: `Bearer ${reg.token}` };
      expect((await (await fetch(url("/v1/cloud/settings"), { method: "POST", headers: H, body: JSON.stringify({ alertHours: 12 }) })).json())).toMatchObject({ ok: true, alertHours: 12 });
      expect((await fetch(url("/v1/cloud/settings"), { method: "POST", headers: H, body: JSON.stringify({ alertHours: 0 }) })).status).toBe(400);
      b.store.addConflict("products", "p1", "deleted_on_cloud", { name: "Eau" }, null); const l = await (await fetch(url("/v1/cloud/conflicts"), { headers: H })).json(); expect(l.conflicts).toHaveLength(1);
      expect((await (await fetch(url("/v1/cloud/conflicts/review"), { method: "POST", headers: H, body: JSON.stringify({ id: l.conflicts[0].id }) })).json()).conflicts).toBe(0); expect((await (await fetch(url("/v1/cloud/conflicts"), { headers: H })).json()).conflicts).toHaveLength(0);
      expect((await fetch(url("/v1/cloud/restore"), { method: "POST", headers: H, body: JSON.stringify({ confirmName: "x" }) })).status).toBe(409);
      expect((await fetch(url("/v1/cloud/reconnect"), { method: "POST", headers: H, body: JSON.stringify({ password: "x" }) })).status).toBe(400);
    } finally { await b.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
