import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { argon2id } from "hash-wasm";
import { randomBytes } from "node:crypto";
import { MemoryStore } from "../../dmp-api/src/memory-store";
import { SqliteStore } from "../../dmp-api/src/sqlite-store";
import { handle } from "../../dmp-api/src/main";
import { createLocalServer } from "./server";
import { initialDownload, syncUsers, type CloudApi } from "./sync";

const T = "tenantacct0001", T2 = "tenantacct0002";
const saved = { ...MemoryStore.defaults }; beforeAll(() => { MemoryStore.defaults = {}; }); afterAll(() => { MemoryStore.defaults = saved; });
/** Empreinte au format d'Appwrite (Argon2id, mêmes paramètres : 7 Mio, 5 passes, 1 fil, 64 octets). */
const appwriteHash = (pw: string) => argon2id({ password: pw, salt: randomBytes(16), parallelism: 1, iterations: 5, memorySize: 7168, hashLength: 64, outputType: "encoded" });
class Cloud extends MemoryStore {
  override async create(t: string, id: string, tenant: string, d: Record<string, unknown>) { const now = new Date().toISOString(); return super.create(t, id, tenant, { $createdAt: now, $updatedAt: now, ...d }); }
  override async update(t: string, id: string, d: Record<string, unknown>) { await super.update(t, id, { ...d, $updatedAt: new Date(Date.now() + 1).toISOString() }); }
}
let cloud: Cloud; let local: SqliteStore; let shop = ""; let ownerId = "own"; let awa = { userId: "", email: "" };
const call = (st: MemoryStore | SqliteStore, user: string, action: string, payload: unknown, shopId = "", tenant = T) => handle(st, user, { action, tenantId: tenant, shopId, payload }, { admins: [] });
const ok = async (r: ReturnType<typeof call>) => { const x = await r; if (x.status !== 200) throw new Error(JSON.stringify(x.body)); return (x.body as { data: any }).data; };
const cloudApi = (user = "own", tenant = T): CloudApi => ({
  ids: async (table) => { const r = await call(cloud, user, "sync.ids", { table }, "", tenant); if (r.status !== 200) throw new Error((r.body as { error: string }).error); return (r.body as { data: any }).data; },
  fileUp: async (f) => { const r = await call(cloud, user, "sync.fileUp", f, "", tenant); if (r.status !== 200) throw Object.assign(new Error((r.body as { error: string }).error), { status: r.status }); return (r.body as { data: any }).data; },
  fileDown: async (fileId) => { const r = await call(cloud, user, "sync.fileDown", { fileId }, "", tenant); if (r.status === 404) return null; if (r.status !== 200) throw Object.assign(new Error((r.body as { error: string }).error), { status: r.status }); return (r.body as { data: any }).data; },
  fileDelete: async (fileId) => { const r = await call(cloud, user, "sync.fileDelete", { fileId }, "", tenant); if (r.status !== 200) throw Object.assign(new Error((r.body as { error: string }).error), { status: r.status }); },
  userPush: async (users) => { const r = await call(cloud, user, "sync.userPush", { users }, "", tenant); if (r.status !== 200) throw new Error((r.body as { error: string }).error); return (r.body as { data: { results: any[] } }).data.results; },
  users: async () => { const r = await call(cloud, user, "sync.users", {}, "", tenant); if (r.status !== 200) throw new Error((r.body as { error: string }).error); return (r.body as { data: { users: any[] } }).data.users; },
  push: async () => [], pull: async (table, since, limit) => { const r = await call(cloud, user, "sync.pull", { table, since, limit }, "", tenant); if (r.status !== 200) throw new Error((r.body as { error: string }).error); return (r.body as { data: any }).data; },
});

beforeEach(async () => {
  cloud = new Cloud(); local = new SqliteStore(); await cloud.grant(T, ownerId, ["owner"], []); await cloud.grant(T2, "own2", ["owner"], []);
  await cloud.createUser({ userId: ownerId, email: "patron@boutique.sn", password: "MotDePasseProprio1", name: "Patron" }); cloud.hashes.set(ownerId, await appwriteHash("MotDePasseProprio1"));
  shop = (await ok(call(cloud, ownerId, "shop.create", { name: "Dakar" }))).shopId; await cloud.update("shops", shop, { cashRequired: false });
  await cloud.create("subscriptions", T, T, { tenantId: T, plan: "pro", period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }).then((c) => (c ? undefined : cloud.update("subscriptions", T, { plan: "pro", status: "paid", renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() })));
  awa = await ok(call(cloud, ownerId, "staff.create", { name: "Awa", username: "awa", password: "motdepasse1", role: "cashier", shopIds: [shop] }, "")); awa.email = "awa@staff.invalid"; cloud.hashes.set(awa.userId, await appwriteHash("motdepasse1"));
  local.createTeam(T, "Commerce");
});

describe("annuaire du commerce copié sur le poste", () => {
  it("action sync.users : propriétaire seulement, membres de CE commerce seulement, empreinte Argon2 (jamais le mot de passe)", async () => {
    const d = await ok(call(cloud, ownerId, "sync.users", {}, "", T)); expect(d.users.map((u: any) => u.userId).sort()).toEqual([ownerId, awa.userId].sort());
    const a = d.users.find((u: any) => u.userId === awa.userId); expect(a).toMatchObject({ email: "awa@staff.invalid", roles: ["cashier"], active: true }); expect(a.passwordHash).toMatch(/^\$argon2id\$/); expect(JSON.stringify(d)).not.toContain("motdepasse1");
    expect((await call(cloud, awa.userId, "sync.users", {}, "", T)).status).toBe(403); expect((await call(cloud, "own2", "sync.users", {}, "", T)).status).toBe(403);
    expect((await ok(call(cloud, "own2", "sync.users", {}, "", T2))).users.map((u: any) => u.userId)).toEqual(["own2"]);
  });
  it("copie sur le poste : comptes, rôles, étiquettes (droits de lecture) ; connexion hors ligne avec l'empreinte du cloud", async () => {
    const r = await syncUsers(local, cloudApi(), T); expect(r).toMatchObject({ created: 2, updated: 0, removed: 0 });
    expect((await local.verifyLogin("awa@staff.invalid", "motdepasse1"))).toMatchObject({ known: true, active: true }); expect((await local.verifyLogin("awa@staff.invalid", "faux"))).toMatchObject({ known: false });
    expect((await local.verifyLogin("patron@boutique.sn", "MotDePasseProprio1"))).toMatchObject({ known: true }); expect(await local.verifyLogin("inconnu@x.y", "x")).toBeNull();
    expect(await local.membership(T, awa.userId)).toEqual({ roles: ["cashier"] }); expect(local.rolesOf(awa.userId).some((x) => x.startsWith("label:s"))).toBe(true);
    const again = await syncUsers(local, cloudApi(), T); expect(again).toMatchObject({ created: 0, updated: 2 });
  });
  it("mot de passe changé au cloud : l'ancien est refusé et les sessions fermées après la synchronisation ; compte désactivé ou retiré : plus d'accès", async () => {
    await syncUsers(local, cloudApi(), T); const tk = local.openSession(awa.userId, "Chrome", "1.1.1.1"); expect(local.sessionUser(tk)).toBe(awa.userId);
    cloud.hashes.set(awa.userId, await appwriteHash("nouveaumotdepasse")); await syncUsers(local, cloudApi(), T);
    expect(local.sessionUser(tk)).toBeNull(); expect((await local.verifyLogin("awa@staff.invalid", "motdepasse1"))!.known).toBe(false); expect((await local.verifyLogin("awa@staff.invalid", "nouveaumotdepasse"))!.known).toBe(true);
    const t2 = local.openSession(awa.userId); await cloud.setUserActive(awa.userId, false); await syncUsers(local, cloudApi(), T); expect(local.sessionUser(t2)).toBeNull(); expect((await local.verifyLogin("awa@staff.invalid", "nouveaumotdepasse"))).toMatchObject({ active: false });
    await cloud.removeMember(T, awa.userId); const r = await syncUsers(local, cloudApi(), T); expect(r.removed).toBe(1); expect(await local.membership(T, awa.userId)).toBeNull();
  });
  it("un compte créé sur le poste n'est jamais retiré par la synchronisation ; identifiant déjà pris : signalé, pas écrasé", async () => {
    await local.createUser({ userId: "localstaff01", email: "moussa@staff.invalid", password: "motdepasse1", name: "Moussa" }); await local.addMember(T, "localstaff01", ["cashier"], "Moussa");
    await local.createUser({ userId: "localdup0001", email: "awa@staff.invalid", password: "autremotdepasse", name: "Doublon" });
    const r = await syncUsers(local, cloudApi(), T); expect(await local.membership(T, "localstaff01")).toEqual({ roles: ["cashier"] }); expect(r.skipped[0]).toContain("awa@staff.invalid"); expect((await local.verifyLogin("awa@staff.invalid", "autremotdepasse"))!.known).toBe(true);
  });
  it("empreinte non exposée par le serveur : le compte est copié mais sans mot de passe utilisable (première connexion en ligne requise)", async () => {
    cloud.hashes.delete(awa.userId); await syncUsers(local, cloudApi(), T); expect(local.userHasCredential(awa.userId)).toBe(false); expect((await local.verifyLogin("awa@staff.invalid", "motdepasse1"))!.known).toBe(false);
  });
});

describe("serveur local : connexion avec empreinte copiée, connexion en ligne mise en cache", () => {
  let srv: ReturnType<typeof createLocalServer>; let base = ""; let online: "ok" | "bad" | "unreachable" = "ok"; let onlineCalls = 0;
  const login = async (email: string, password: string) => { const r = await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }); return { status: r.status, body: await r.json() as any }; };
  beforeEach(async () => { online = "ok"; onlineCalls = 0; srv = createLocalServer({ store: local, verifyOnline: async () => { onlineCalls++; return online; } }); base = `http://127.0.0.1:${(await srv.listen(0, "127.0.0.1")).port}`; });
  it("après la synchronisation, tout le monde se connecte sans internet (aucun appel au cloud) ; mauvais mot de passe refusé", async () => {
    await syncUsers(local, cloudApi(), T); online = "unreachable"; const a = await login("awa@staff.invalid", "motdepasse1"); expect(a.status).toBe(200); expect(a.body.teams[0].roles).toEqual(["cashier"]); expect(onlineCalls).toBe(0);
    const o = await login("patron@boutique.sn", "MotDePasseProprio1"); expect(o.status).toBe(200); expect((await login("awa@staff.invalid", "faux")).status).toBe(401);
    await srv.close();
  });
  it("empreinte absente : première connexion EN LIGNE vérifiée par le cloud, puis connexion hors ligne grâce à l'empreinte gardée", async () => {
    cloud.hashes.delete(awa.userId); await syncUsers(local, cloudApi(), T);
    online = "unreachable"; const off = await login("awa@staff.invalid", "motdepasse1"); expect(off.status).toBe(401); expect(off.body.error).toContain("d'abord se connecter une fois avec internet");
    online = "bad"; expect((await login("awa@staff.invalid", "faux")).status).toBe(401);
    online = "ok"; expect((await login("awa@staff.invalid", "motdepasse1")).status).toBe(200); expect(onlineCalls).toBeGreaterThan(0); expect(local.userHasCredential(awa.userId)).toBe(true);
    online = "unreachable"; const n = onlineCalls; expect((await login("awa@staff.invalid", "motdepasse1")).status).toBe(200); expect(onlineCalls).toBe(n); expect((await login("awa@staff.invalid", "faux")).status).toBe(401);
    await srv.close();
  });
  it("mot de passe changé au cloud avant la prochaine synchronisation : la vérification en ligne l'accepte et met à jour le cache", async () => {
    await syncUsers(local, cloudApi(), T); online = "ok"; const r = await login("awa@staff.invalid", "mot-de-passe-change-au-cloud"); expect(r.status).toBe(200);
    online = "unreachable"; expect((await login("awa@staff.invalid", "mot-de-passe-change-au-cloud")).status).toBe(200); await srv.close();
  });
  it("compte désactivé : refusé même si le cloud répond « ok » ; identifiant inconnu du poste : refusé", async () => {
    await syncUsers(local, cloudApi(), T); await cloud.setUserActive(awa.userId, false); await syncUsers(local, cloudApi(), T); online = "ok";
    expect((await login("awa@staff.invalid", "motdepasse1")).status).toBe(401); expect((await login("autre@personne.sn", "x")).status).toBe(401); expect(onlineCalls).toBe(0); await srv.close();
  });
});

describe("comptes créés sur le poste → cloud (sync.userPush)", () => {
  it("un employé créé sur le poste est créé au cloud avec son empreinte (sans mot de passe en clair), puis seul un changement le renvoie ; rôles et étiquettes contrôlés", async () => {
    const { pushUsers } = await import("./sync");
    const local = new SqliteStore(); local.createTeam(T, "Boutique"); await local.addMember(T, "own", ["owner"], "Awa"); local.syncOn = true;
    const r1 = await ok(call(cloud, "own", "shop.create", { name: "Dakar" })); const shop = r1.shopId; local.applyRemote("shops", shop, T, { tenantId: T, name: "Dakar", vatRatePct: 18 }, new Date().toISOString(), new Date().toISOString());
    const c = await ok(call(local, "own", "staff.create", { name: "Moussa", username: "moussa", password: "motdepasse1", role: "cashier", shopIds: [shop] }, shop)); const uid = c.userId;
    const rep = await pushUsers(local, cloudApi(), T); expect(rep).toMatchObject({ sent: 1, refused: [] });
    const cu = (cloud as any).users.get(uid); expect(cu.email).toContain("moussa"); expect(cu.password.startsWith("scrypt$")).toBe(true); expect(cu.password).not.toContain("motdepasse1");
    expect((await cloud.membership(T, uid))?.roles).toEqual(["cashier"]);
    expect((await pushUsers(local, cloudApi(), T)).sent).toBe(0); // rien de changé : rien renvoyé
    await ok(call(local, "own", "staff.update", { userId: uid, active: false }, shop)); expect((await pushUsers(local, cloudApi(), T)).sent).toBe(1); // changement : renvoi (mise à jour)
    // refus côté cloud : propriétaire, étiquette d'une autre boutique, compte invalide, non-propriétaire
    const api = cloudApi();
    expect(await api.userPush([{ userId: "evil0000000000001", email: "e@x.sn", name: "E", active: true, roles: ["owner"], labels: [], hash: "scrypt$a$b" }])).toMatchObject([{ status: "refused" }]);
    expect(await api.userPush([{ userId: "evil0000000000002", email: "f@x.sn", name: "F", active: true, roles: ["cashier"], labels: ["sAutreBoutique"], hash: "scrypt$a$b" }])).toMatchObject([{ status: "refused", error: expect.stringContaining("hors des boutiques") }]);
    expect(await api.userPush([{ userId: "x", email: "pas-un-mail", name: "G", active: true, roles: ["cashier"], labels: [], hash: "scrypt$a$b" }])).toMatchObject([{ status: "refused" }]);
    await expect(cloudApi("empl").userPush([])).rejects.toThrow();
    // même e-mail qu'un compte existant d'un autre identifiant : refusé (409), rien n'est écrasé
    expect(await api.userPush([{ userId: "dup00000000000001", email: cu.email, name: "H", active: true, roles: ["cashier"], labels: [], hash: "scrypt$a$b" }])).toMatchObject([{ status: "refused", error: "Identifiant déjà utilisé" }]);
  });
});
