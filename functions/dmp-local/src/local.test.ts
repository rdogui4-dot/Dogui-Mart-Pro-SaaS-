import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Query } from "appwrite";
import { MemoryStore } from "../../dmp-api/src/memory-store";
import { SqliteStore, hashPassword, verifyPassword } from "../../dmp-api/src/sqlite-store";
import { handle } from "../../dmp-api/src/main";
import { stockFor } from "../../dmp-api/src/checkout";
import { queryRows } from "./query";
import { createLocalServer } from "./server";

const T = "tenantlocal001";
const setPro = async (st: MemoryStore | SqliteStore, tenant: string) => { const d = { tenantId: tenant, plan: "pro", period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (!(await st.create("subscriptions", tenant, tenant, d))) await st.update("subscriptions", tenant, d); };
const savedDefaults = { ...MemoryStore.defaults }; beforeAll(() => { MemoryStore.defaults = {}; }); afterAll(() => { MemoryStore.defaults = savedDefaults; });
class DatedStore extends MemoryStore { override async create(t: string, id: string, tenant: string, d: Record<string, unknown>) { return super.create(t, id, tenant, { $createdAt: new Date().toISOString(), ...d }); } } // comme Appwrite : chaque ligne porte sa date de création
const strip = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (k, x) => (k === "$createdAt" || k === "$updatedAt" || k === "verifyCode" || k === "activity" ? undefined : k === "entryRef" ? "<ref>" : typeof x === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(x) ? "<date>" : x)));

describe("SqliteStore : mêmes garanties que le stockage de production", () => {
  let st: SqliteStore; beforeEach(() => { st = new SqliteStore(); });
  it("create idempotent, update fusionné (undefined ignoré), remove, list/scan avec plage et troncature", async () => {
    expect(await st.create("products", "a", T, { tenantId: T, shopId: "s1", n: 1, soldAt: "2026-01-02T00:00:00.000Z" })).toBe(true); expect(await st.create("products", "a", T, { n: 2 })).toBe(false);
    await st.create("products", "b", T, { tenantId: T, shopId: "s2", n: 2, soldAt: "2026-01-05T00:00:00.000Z" }); await st.create("products", "c", T, { tenantId: T, shopId: "s1", n: 3, soldAt: "2026-01-09T00:00:00.000Z", ok: true });
    await st.update("products", "a", { n: 10, extra: "x", gone: undefined }); expect(await st.get("products", "a")).toMatchObject({ $id: "a", n: 10, extra: "x", shopId: "s1" }); await expect(st.update("products", "zz", { n: 1 })).rejects.toThrow("introuvable");
    expect((await st.list("products", { shopId: "s1" })).map((r) => r.$id)).toEqual(["a", "c"]); expect((await st.list("products", { ok: true })).map((r) => r.$id)).toEqual(["c"]); expect((await st.list("products", { tenantId: T }, 2)).length).toBe(2);
    const r = await st.scan("products", { tenantId: T }, { range: { field: "soldAt", from: "2026-01-03T00:00:00.000Z", to: "2026-01-09T00:00:00.000Z" } }); expect(r.rows.map((x) => x.$id)).toEqual(["b"]);
    const tr = await st.scan("products", {}, { maxRows: 2 }); expect(tr.truncated).toBe(true); expect(tr.rows).toHaveLength(2); expect((await st.scan("products", {}, { maxRows: 3 })).truncated).toBe(false);
    await st.remove("products", "a"); expect(await st.get("products", "a")).toBeNull(); await st.remove("products", "a");
  });
  it("batch : tout ou rien (doublon, ligne absente, panne au milieu) ; création + mise à jour dans le même lot", async () => {
    await st.create("products", "a", T, { tenantId: T, shopId: "s1", n: 1 });
    await expect(st.batch([{ kind: "create", table: "products", id: "b", tenantId: T, data: { tenantId: T, shopId: "s1" } }, { kind: "create", table: "products", id: "a", tenantId: T, data: { shopId: "s1" } }])).rejects.toMatchObject({ status: 409 }); expect(await st.get("products", "b")).toBeNull();
    await expect(st.batch([{ kind: "create", table: "products", id: "b", tenantId: T, data: { tenantId: T, shopId: "s1" } }, { kind: "update", table: "products", id: "nope", data: { n: 1 } }])).rejects.toMatchObject({ status: 404 }); expect(await st.get("products", "b")).toBeNull();
    await st.batch([{ kind: "create", table: "products", id: "b", tenantId: T, data: { tenantId: T, shopId: "s1", n: 1 } }, { kind: "update", table: "products", id: "b", data: { n: 2 } }, { kind: "update", table: "products", id: "a", data: { n: 9 } }]); expect(await st.get("products", "b")).toMatchObject({ n: 2 }); expect(await st.get("products", "a")).toMatchObject({ n: 9 });
    const bad = { kind: "create" as const, table: "products", id: "c", tenantId: T, get data(): Record<string, unknown> { throw new Error("panne"); } };
    await expect(st.batch([{ kind: "update", table: "products", id: "a", data: { n: 100 } }, bad])).rejects.toThrow("panne"); expect(await st.get("products", "a")).toMatchObject({ n: 9 }); expect(await st.get("products", "c")).toBeNull();
  });
  it("annuaire : comptes (mot de passe haché), équipes, appartenances, étiquettes, sessions et sécurité", async () => {
    await st.createUser({ userId: "u1", email: "a@x.test", password: "motdepasse1", name: "Aïcha" }); await expect(st.createUser({ userId: "u2", email: "a@x.test", password: "x", name: "B" })).rejects.toMatchObject({ status: 409 });
    expect(st.userByEmail("a@x.test")!.password).not.toContain("motdepasse1"); expect(verifyPassword("motdepasse1", st.userByEmail("a@x.test")!.password)).toBe(true); expect(verifyPassword("faux", hashPassword("motdepasse1"))).toBe(false);
    st.createTeam(T, "Ma boutique"); await st.addMember(T, "u1", ["owner"], "Aïcha"); expect(await st.membership(T, "u1")).toEqual({ roles: ["owner"] }); expect(await st.membership(T, "zz")).toBeNull(); expect(await st.listOwners(T)).toEqual([{ userId: "u1", name: "Aïcha", email: "a@x.test" }]);
    await st.setLabels("u1", ["sboutique1"]); expect(st.rolesOf("u1")).toEqual(["user:u1", "label:sboutique1", `team:${T}`, `team:${T}/owner`]); await st.setMemberRoles(T, "u1", ["manager"]); expect(st.rolesOf("u1")).toContain(`team:${T}/manager`);
    const tok = st.openSession("u1"); expect(st.sessionUser(tok)).toBe("u1"); expect((await st.userSecurity("u1")).sessions24h).toBe(1); await st.setUserActive("u1", false); expect(st.sessionUser(tok)).toBeNull(); await st.setUserActive("u1", true);
    const t2 = st.openSession("u1"); await st.setPassword("u1", "nouveaumotdepasse"); expect(st.sessionUser(t2)).toBeNull(); expect(verifyPassword("nouveaumotdepasse", st.userByEmail("a@x.test")!.password)).toBe(true);
    await st.removeMember(T, "u1"); expect(await st.membership(T, "u1")).toBeNull(); await st.deleteUser("u1"); expect(st.userById("u1")).toBeNull();
  });
  it("fichiers : écriture, relecture, suppression, droits de lecture", async () => {
    await st.putFile("f1", new Uint8Array([1, 2, 3]), "a.png", "image/png", [`team:${T}/owner`]); expect([...(await st.readFile("f1"))!]).toEqual([1, 2, 3]); expect(st.fileMeta("f1")).toMatchObject({ mime: "image/png", readRoles: [`team:${T}/owner`] }); await st.deleteFile("f1"); expect(await st.readFile("f1")).toBeNull();
  });
});

describe("moteur de requêtes (contrat Appwrite)", () => {
  let st: SqliteStore; const own = ["team:t/owner"];
  const q = (...x: string[]) => queryRows(st, "products", x, own);
  beforeEach(async () => { st = new SqliteStore(); for (let i = 1; i <= 7; i++) await st.create("products", `p${i}`, "t", { tenantId: "t", shopId: i % 2 ? "s1" : "s2", name: `Article ${i}`, price: i * 100, archived: i === 3, cat: i === 5 ? null : "c" }); await st.create("products", "autre", "t2", { tenantId: "t2", shopId: "s1", name: "Autre", price: 1 }); });
  it("equal, plusieurs valeurs, booléens, null, comparaisons, startsWith, search, or, total, limite par défaut", () => {
    expect(q(Query.equal("shopId", "s1")).rows.map((r) => r.$id)).toEqual(["p1", "p3", "p5", "p7"]); expect(q(Query.equal("shopId", ["s1", "s2"]), Query.limit(100)).total).toBe(7); expect(q(Query.equal("archived", true)).rows.map((r) => r.$id)).toEqual(["p3"]);
    expect(q(Query.isNull("cat")).rows.map((r) => r.$id)).toEqual(["p5"]); expect(q(Query.isNotNull("cat")).total).toBe(6); expect(q(Query.greaterThanEqual("price", 600)).rows.map((r) => r.$id)).toEqual(["p6", "p7"]);
    expect(q(Query.startsWith("name", "Article 1")).total).toBe(1); expect(q(Query.search("name", "ARTICLE 4")).rows.map((r) => r.$id)).toEqual(["p4"]);
    expect(q(Query.or([Query.equal("price", 100), Query.equal("price", 200)])).rows.map((r) => r.$id)).toEqual(["p1", "p2"]); expect(q(Query.equal("shopId", "s1"), Query.limit(2)).total).toBe(4); expect(q().rows.length).toBe(7);
  });
  it("tri et pagination par curseur : pas de doublon ni d'oubli, ordre de création par défaut, tri décroissant", () => {
    const all: string[] = []; let cursor: string | undefined; for (;;) { const r: { $id: string }[] = q(Query.limit(3), ...(cursor ? [Query.cursorAfter(cursor)] : [])).rows; if (!r.length) break; all.push(...r.map((x) => x.$id)); cursor = r.at(-1)!.$id; } expect(all).toEqual(["p1", "p2", "p3", "p4", "p5", "p6", "p7"]);
    const desc: string[] = []; cursor = undefined; for (;;) { const r: { $id: string }[] = q(Query.orderDesc("price"), Query.limit(3), ...(cursor ? [Query.cursorAfter(cursor)] : [])).rows; if (!r.length) break; desc.push(...r.map((x) => x.$id)); cursor = r.at(-1)!.$id; } expect(desc).toEqual(["p7", "p6", "p5", "p4", "p3", "p2", "p1"]);
    expect(q(Query.orderAsc("name"), Query.limit(2)).rows.map((r) => r.$id)).toEqual(["p1", "p2"]); expect(q(Query.orderDesc("$createdAt"), Query.limit(1)).rows[0]!.$id).toBe("p7");
    expect(() => q(Query.cursorAfter("inconnu"))).toThrow(); expect(() => queryRows(st, "products", [JSON.stringify({ method: "bizarre" })], own)).toThrow("non prise en charge");
  });
  it("droits de lecture : seules les lignes dont un rôle de lecture est détenu ; autre commerce invisible", () => {
    expect(queryRows(st, "products", [], ["team:t2/owner"]).rows.map((r) => r.$id)).toEqual(["autre"]); expect(queryRows(st, "products", [], ["team:t3/owner"]).total).toBe(0); expect(queryRows(st, "products", [], ["user:x"]).total).toBe(0);
  });
});

/** Rejoue la même suite d'actions métier sur le stockage de référence (mémoire) et sur SQLite : réponses et états finaux doivent être identiques. */
describe("équivalence mémoire / SQLite sur des parcours métier réels", () => {
  const run = async (st: MemoryStore | SqliteStore) => {
    const call = async (user: string, action: string, payload: unknown, shop = "", tenant = T) => handle(st, user, { action, tenantId: tenant, shopId: shop, payload }, { admins: [] });
    const out: unknown[] = []; const rec = async (user: string, action: string, payload: unknown, shop = "") => { const r = await call(user, action, payload, shop); out.push([action, r.status, strip(r.body)]); if (process.env.DBG && r.status !== 200) console.log("REFUS", action, r.status, JSON.stringify(r.body)); return r.body as { data?: any }; };
    if (st instanceof MemoryStore) await st.grant(T, "own", ["owner"], []); else await st.addMember(T, "own", ["owner"], "own");
    const sh = (await rec("own", "shop.create", { name: "Dakar" })).data!.shopId as string; const sh2 = (await rec("own", "shop.create", { name: "Thiès" })).data!.shopId as string; for (const x of [sh, sh2]) await st.update("shops", x, { cashRequired: false });
    await setPro(st, T);
    const eau = (await rec("own", "article.save", { data: { name: "Eau", price: 500, cost: 300, category: "Boissons", sku: "EAU", barcode: "EAU0" }, initialQty: 100 }, sh)).data!.id as string;
    const tel = (await rec("own", "article.save", { data: { name: "Téléphone", price: 50000, cost: 40000, sku: "TEL", barcode: "TEL0", tracking: "serial" } }, sh)).data!.id as string;
    await rec("own", "serial.add", { productId: tel, serials: "SN-A:24 SN-B" }, sh);
    await rec("inconnu", "article.save", { data: { name: "X", price: 1 } }, sh); // refus : pas membre
    await rec("own", "staff.create", { name: "Awa", username: "awa", password: "motdepasse1", role: "cashier", shopIds: [sh] }, "");
    const body = { clientId: "vente-eq-0001", lines: [{ productId: eau, qty: 3 }, { productId: tel, qty: 5 }], payments: [{ method: "cash", amount: 251500 }] }; await rec("own", "checkout", body, sh); await rec("own", "checkout", body, sh);
    await rec("own", "checkout", { clientId: "autre-eq-0002", lines: [{ productId: eau, qty: 500 }], payments: [{ method: "cash", amount: 1 }] }, sh); // refus : stock insuffisant
    const sale = ((await rec("own", "sales.list", {}, sh)).data!.sales as { id: string }[])[0]!;
    await rec("own", "sale.refund", { returnId: "rt-eq-00000001", saleId: sale.id, kind: "cancel", reason: "Erreur", refunds: [{ method: "cash", amount: 251500 }] }, sh);
    await rec("own", "stock.transfer", { transferId: "trf-eq-00000001", toShopId: sh2, lines: [{ productId: eau, qty: 10 }] }, sh);
    await rec("own", "dashboard.business", { preset: "last30" }, sh); await rec("own", "dashboard.profit", { preset: "last30" }, sh);
    const snap: Record<string, unknown> = {}; for (const t of ["products", "stock_moves", "sales", "sale_returns", "article_serials", "journal_entries", "audit_log", "staff", "transfers"]) snap[t] = strip((await st.scan(t, {}, { maxRows: 100_000 })).rows.map((r) => ({ ...r })));
    // identifiants aléatoires : remplacés par leur ordre d'apparition pour comparer la structure
    const ids = new Map<string, string>(); const canon = (v: unknown) => JSON.parse(JSON.stringify(v).replace(/[0-9a-f]{30}|[0-9a-f]{20}/g, (m) => { if (!ids.has(m)) ids.set(m, `<id${ids.size + 1}>`); return ids.get(m)!; }));
    const cOut = canon(out); const cSnap = canon(snap) as Record<string, unknown>;
    return { out: cOut as unknown[], snap: cSnap, stock: await stockFor(st, eau, 0) };
  };
  it("mêmes réponses (succès et refus) et mêmes données finales", async () => {
    const a = await run(new DatedStore()); const b = await run(new SqliteStore());
    expect(b.out).toEqual(a.out); expect(b.stock).toBe(a.stock);
    for (const t of Object.keys(a.snap)) expect(b.snap[t], `table ${t}`).toEqual(a.snap[t]);
    expect((a.out as unknown[][]).some((x) => x[1] === 409)).toBe(true); expect((a.out as unknown[][]).some((x) => x[1] === 403)).toBe(true);
  });
});

describe("serveur local : session, droits, lectures, fichiers, temps réel, application web", () => {
  let st: SqliteStore; let srv: ReturnType<typeof createLocalServer>; let base = ""; let dir = "";
  const j = async (path: string, init: RequestInit & { token?: string } = {}) => { const r = await fetch(base + path, { ...init, headers: { "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...(init.headers ?? {}) } }); const text = await r.text(); let body: any = null; try { body = JSON.parse(text); } catch { body = text; } return { status: r.status, body, headers: r.headers }; };
  const exec = (token: string | undefined, action: string, payload: unknown, tenantId = "", shopId = "") => j("/v1/execute", { method: "POST", token, body: JSON.stringify({ action, tenantId, shopId, payload }) });
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "dmp-web-")); mkdirSync(join(dir, "assets")); writeFileSync(join(dir, "index.html"), "<!doctype html><html><head><title>DMP</title></head><body>app</body></html>"); writeFileSync(join(dir, "assets", "index-AbCdEf12.js"), "console.log(1)"); writeFileSync(join(dir, "secret.txt"), "ok");
    st = new SqliteStore(); srv = createLocalServer({ store: st, webRoot: dir }); const { port } = await srv.listen(0, "127.0.0.1"); base = `http://127.0.0.1:${port}`;
  });
  afterAll(async () => { await srv.close(); rmSync(dir, { recursive: true, force: true }); });
  it("premier démarrage : création locale de l'entreprise et du propriétaire, une seule fois ; connexion, session, déconnexion", async () => {
    expect((await j("/v1/setup")).body).toEqual({ needsSetup: true });
    expect((await j("/v1/auth/register", { method: "POST", body: JSON.stringify({ email: "a@b", password: "court" }) })).status).toBe(400);
    const reg = await j("/v1/auth/register", { method: "POST", body: JSON.stringify({ email: "patron@boutique.local", password: "motdepasse1", name: "Patron" }) }); expect(reg.status).toBe(200); expect(reg.body.teams).toEqual([]);
    expect((await j("/v1/auth/team", { method: "POST", body: JSON.stringify({ name: " " }), token: reg.body.token })).status).toBe(400); expect((await j("/v1/auth/team", { method: "POST", body: JSON.stringify({ name: "Ma Boutique" }) })).status).toBe(401);
    const team = await j("/v1/auth/team", { method: "POST", body: JSON.stringify({ name: "Ma Boutique" }), token: reg.body.token }); expect(team.status).toBe(200); expect(team.body.teams[0]).toMatchObject({ name: "Ma Boutique", roles: ["owner"] });
    expect((await j("/v1/auth/team", { method: "POST", body: JSON.stringify({ name: "Autre" }), token: reg.body.token })).status).toBe(403);
    expect((await j("/v1/setup")).body).toEqual({ needsSetup: false }); expect((await j("/v1/auth/register", { method: "POST", body: JSON.stringify({ email: "x@y.z", password: "motdepasse1" }) })).status).toBe(403);
    expect((await j("/v1/auth/login", { method: "POST", body: JSON.stringify({ email: "patron@boutique.local", password: "faux" }) })).status).toBe(401);
    const login = await j("/v1/auth/login", { method: "POST", body: JSON.stringify({ email: "patron@boutique.local", password: "motdepasse1" }) }); expect(login.status).toBe(200);
    expect((await j("/v1/auth/session", { token: login.body.token })).body.user.email).toBe("patron@boutique.local"); expect((await j("/v1/auth/session")).status).toBe(401);
    await j("/v1/auth/logout", { method: "POST", token: login.body.token }); expect((await j("/v1/auth/session", { token: login.body.token })).status).toBe(401);
  });
  it("actions métier, lectures filtrées par droits (propriétaire, caissier), fichiers et temps réel", async () => {
    const uid = st.userByEmail("patron@boutique.local")!.id; const own = st.openSession(uid); const T1 = st.teamsOf(uid)[0]!.id;
    expect((await exec(undefined, "article.save", { data: { name: "X", price: 1 } }, T1, "s")).status).toBe(401);
    const shop = (await exec(own, "shop.create", { name: "Dakar" }, T1, "")).body.data.shopId as string; await setPro(st, T1); await st.update("shops", shop, { cashRequired: false });
    const art = await exec(own, "article.save", { data: { name: "Eau", price: 500, cost: 300, sku: "EAU", barcode: "EAU0" }, initialQty: 20 }, T1, shop); expect(art.status).toBe(200);
    const cais = (await exec(own, "staff.create", { name: "Awa", username: "awa", password: "motdepasse1", role: "cashier", shopIds: [shop] }, T1, "")).body.data; const cl = await j("/v1/auth/login", { method: "POST", body: JSON.stringify({ email: st.userById(cais.userId)!.email, password: "motdepasse1" }) }); expect(cl.status).toBe(200);
    const prods = (token: string) => j(`/v1/rows/products?q=${encodeURIComponent(JSON.stringify([Query.equal("shopId", shop), Query.limit(50)]))}`, { token }); expect((await prods(own)).body.total).toBe(1); expect((await prods(cl.body.token)).body.rows[0].name).toBe("Eau");
    const audit = (token: string) => j(`/v1/rows/audit_log?q=${encodeURIComponent(JSON.stringify([Query.limit(5)]))}`, { token }); expect((await audit(own)).body.total).toBeGreaterThan(0); expect((await audit(cl.body.token)).body.total).toBe(0);
    expect((await j(`/v1/rows/products/${art.body.data.id}`, { token: own })).body.name).toBe("Eau"); expect((await j("/v1/rows/products/inexistant", { token: own })).status).toBe(404); expect((await j("/v1/rows/products")).status).toBe(401);
    expect((await exec(cl.body.token, "article.save", { data: { name: "Hack", price: 1 } }, T1, shop)).status).toBe(403);
    await st.putFile("img1", new Uint8Array([9, 8, 7]), "a.png", "image/png", [`label:s${shop}`]); const f = await fetch(`${base}/v1/files/img1`, { headers: { authorization: `Bearer ${cl.body.token}` } }); expect(f.status).toBe(200); expect([...new Uint8Array(await f.arrayBuffer())]).toEqual([9, 8, 7]);
    expect((await fetch(`${base}/v1/files/img1`)).status).toBe(401); await st.putFile("img2", new Uint8Array([1]), "b.png", "image/png", ["team:autre/owner"]); expect((await fetch(`${base}/v1/files/img2`, { headers: { authorization: `Bearer ${own}` } })).status).toBe(404);
    const ev = await fetch(`${base}/v1/events?token=${own}`); const reader = ev.body!.getReader(); await reader.read(); await exec(own, "checkout", { clientId: "vente-loc-0001", lines: [{ productId: art.body.data.id, qty: 1 }], payments: [{ method: "cash", amount: 500 }] }, T1, shop);
    const chunk = new TextDecoder().decode((await reader.read()).value); expect(chunk).toContain("data:"); await reader.cancel();
  });
  it("application web : index avec marqueur local, fichiers statiques, repli SPA, aucun accès hors du dossier", async () => {
    const idx = await fetch(base + "/"); expect(await idx.text()).toContain('<meta name="dmp-local" content="1" />'); expect(await (await fetch(base + "/caisse")).text()).toContain("dmp-local");
    const js = await fetch(base + "/assets/index-AbCdEf12.js"); expect(js.headers.get("cache-control")).toContain("immutable"); expect(await js.text()).toBe("console.log(1)"); expect((await fetch(base + "/nexiste.js")).status).toBe(404);
    expect(await (await fetch(base + "/%2e%2e/%2e%2e/etc/passwd")).text()).not.toContain("root:"); expect(await (await fetch(base + "/secret.txt")).text()).toBe("ok");
  });
});

describe("HTTPS local : certificat généré sur le poste", () => {
  it("certificat autosigné couvrant localhost, dogui.local et les adresses du poste ; réutilisé tant que les adresses ne changent pas ; serveur HTTPS opérationnel", async () => {
    const { ensureCertificate, lanAddresses } = await import("./tls"); const { startLocalServer } = await import("./main"); const { request } = await import("node:https");
    const dir = mkdtempSync(join(tmpdir(), "dmp-tls-")); try {
      const a = ensureCertificate(dir); expect(a.hosts).toEqual(expect.arrayContaining(["localhost", "dogui.local", "127.0.0.1", ...lanAddresses()])); expect(a.cert).toContain("BEGIN CERTIFICATE"); expect(new Date(a.notAfter).getTime() - Date.now()).toBeGreaterThan(700 * 864e5); expect(new Date(a.notAfter).getTime() - Date.now()).toBeLessThan(801 * 864e5);
      const b = ensureCertificate(dir); expect(b.fingerprint).toBe(a.fingerprint); const c = ensureCertificate(dir, ["caisse.exemple.local"]); expect(c.fingerprint).not.toBe(a.fingerprint); expect(c.hosts).toContain("caisse.exemple.local");
      const srv = await startLocalServer({ dataDir: dir, port: 0, host: "127.0.0.1", https: true }); try {
        expect(srv.https).toBe(true); const body = await new Promise<string>((ok, ko) => { const r = request({ host: "localhost", port: srv.port, path: "/v1/setup", ca: srv.certificate!.cert }, (res) => { let t = ""; res.on("data", (d) => (t += d)); res.on("end", () => ok(t)); }); r.on("error", ko); r.end(); });
        expect(JSON.parse(body)).toEqual({ needsSetup: true });
      } finally { await srv.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
