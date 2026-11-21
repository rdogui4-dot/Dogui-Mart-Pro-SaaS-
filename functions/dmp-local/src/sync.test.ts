import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "../../dmp-api/src/memory-store";
import { SqliteStore } from "../../dmp-api/src/sqlite-store";
import { handle } from "../../dmp-api/src/main";
import { stockFor } from "../../dmp-api/src/checkout";
import { PUSHED_TABLES } from "../../../src/domain/sync-tables";
import type { PushRow } from "../../dmp-api/src/sync";
import { initialDownload, pullTable, pushPending, syncOnce, type CloudApi } from "./sync";

const T = "tenantsync0001", T2 = "tenantsync0002";
const saved = { ...MemoryStore.defaults }; beforeAll(() => { MemoryStore.defaults = {}; }); afterAll(() => { MemoryStore.defaults = saved; });
/** Le cloud simulé : le stockage de référence avec les dates de modification d'Appwrite. */
/** Horloge simulée strictement croissante (deux mises à jour dans la même milliseconde n'auraient sinon qu'une date : Appwrite ne le fait pas). */
let lastStamp = 0; const nextStamp = (): string => { lastStamp = Math.max(Date.now() + 1, lastStamp + 1); return new Date(lastStamp).toISOString(); };
class Cloud extends MemoryStore {
  override async create(t: string, id: string, tenant: string, d: Record<string, unknown>) { const now = new Date().toISOString(); return super.create(t, id, tenant, { $createdAt: now, $updatedAt: now, ...d }); }
  override async update(t: string, id: string, d: Record<string, unknown>) { await super.update(t, id, { ...d, $updatedAt: nextStamp() }); }
}
const pro = (st: { create: MemoryStore["create"]; update: MemoryStore["update"] }, tenant: string) => { const d = { tenantId: tenant, plan: "pro", period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; return st.create("subscriptions", tenant, tenant, d).then((ok) => (ok ? undefined : st.update("subscriptions", tenant, d))); };

let cloud: Cloud; let local: SqliteStore; let shop = ""; let eau = "";
const call = (st: MemoryStore | SqliteStore, user: string, action: string, payload: unknown, shopId = "", tenant = T) => handle(st, user, { action, tenantId: tenant, shopId, payload }, { admins: [] });
const ok = async (r: ReturnType<typeof call>) => { const x = await r; if (x.status !== 200) throw new Error(JSON.stringify(x.body)); return (x.body as { data: any }).data; };
/** Le poste parle au cloud comme en production : actions sync.* avec la session du propriétaire. */
const api = (user = "own", tenant = T, onPush?: (rows: PushRow[]) => void): CloudApi => ({
  ids: async (table) => { const r = await call(cloud, user, "sync.ids", { table }, "", tenant); if (r.status !== 200) throw new Error((r.body as { error: string }).error); return (r.body as { data: any }).data; },
  fileUp: async (f) => { const r = await call(cloud, user, "sync.fileUp", f, "", tenant); if (r.status !== 200) throw Object.assign(new Error((r.body as { error: string }).error), { status: r.status }); return (r.body as { data: any }).data; },
  fileDown: async (fileId) => { const r = await call(cloud, user, "sync.fileDown", { fileId }, "", tenant); if (r.status === 404) return null; if (r.status !== 200) throw Object.assign(new Error((r.body as { error: string }).error), { status: r.status }); return (r.body as { data: any }).data; },
  fileDelete: async (fileId) => { const r = await call(cloud, user, "sync.fileDelete", { fileId }, "", tenant); if (r.status !== 200) throw Object.assign(new Error((r.body as { error: string }).error), { status: r.status }); },
  userPush: async (users) => { const r = await call(cloud, user, "sync.userPush", { users }, "", tenant); if (r.status !== 200) throw new Error((r.body as { error: string }).error); return (r.body as { data: { results: any[] } }).data.results; },
  users: async () => { const r = await call(cloud, user, "sync.users", {}, "", tenant); if (r.status !== 200) throw new Error((r.body as { error: string }).error); return (r.body as { data: { users: any[] } }).data.users; },
  push: async (rows) => { onPush?.(rows); const r = await call(cloud, user, "sync.push", { rows }, "", tenant); if (r.status !== 200) throw new Error((r.body as { error: string }).error); return (r.body as { data: { results: any[] } }).data.results; },
  pull: async (table, since, limit) => { const r = await call(cloud, user, "sync.pull", { table, since, limit }, "", tenant); if (r.status !== 200) throw new Error((r.body as { error: string }).error); return (r.body as { data: any }).data; },
});

beforeEach(async () => {
  cloud = new Cloud(); local = new SqliteStore(); await cloud.grant(T, "own", ["owner"], []); await cloud.grant(T2, "own2", ["owner"], []);
  shop = (await ok(call(cloud, "own", "shop.create", { name: "Dakar" }))).shopId; await cloud.update("shops", shop, { cashRequired: false }); await pro(cloud, T);
  eau = (await ok(call(cloud, "own", "article.save", { data: { name: "Eau", price: 500, cost: 300, sku: "EAU", barcode: "EAU0", category: "Boissons" }, initialQty: 100 }, shop))).id;
  await local.addMember(T, "own", ["owner"], "own"); local.createTeam(T, "Commerce");
});

describe("téléchargement initial : le poste devient une copie exacte du commerce", () => {
  it("mêmes identifiants et données, rien à renvoyer, droits de lecture calculés comme en production", async () => {
    const rep = await initialDownload(local, api(), T); expect(rep.error).toBeUndefined(); expect(rep.pulled).toBeGreaterThan(5);
    expect(await local.get("products", eau)).toMatchObject({ name: "Eau", price: 500, tenantId: T }); expect(await local.get("shops", shop)).toMatchObject({ name: "Dakar" }); expect(await local.get("subscriptions", T)).toMatchObject({ plan: "pro" });
    expect((await local.scan("stock_moves", { tenantId: T })).rows).toHaveLength((await cloud.scan("stock_moves", { tenantId: T })).rows.length); expect(local.outboxCount()).toBe(0);
    expect(local.rolesOf("own")).toContain(`team:${T}/owner`);
  });
  it("le commerce d'un autre propriétaire n'est jamais téléchargé", async () => {
    await call(cloud, "own2", "shop.create", { name: "Autre" }, "", T2); await initialDownload(local, api(), T);
    expect((await local.scan("shops", {})).rows.every((r) => r.tenantId === T)).toBe(true);
  });
});

describe("le poste travaille puis envoie au cloud", () => {
  beforeEach(async () => { await initialDownload(local, api(), T); local.syncOn = true; });
  it("vente et retour sur le poste : journal d'envoi, envoi idempotent, le cloud reçoit les mêmes lignes ; rien de plus au second envoi", async () => {
    const body = { clientId: "vente-sync-0001", lines: [{ productId: eau, qty: 3 }], payments: [{ method: "cash", amount: 1500 }] }; await ok(call(local, "own", "checkout", body, shop));
    expect(local.outboxCount()).toBeGreaterThan(3); const pendingTables = new Set(local.outboxPending(500).map((p) => p.table)); expect([...pendingTables]).toEqual(expect.arrayContaining(["sales", "stock_moves"]));
    const rep = await pushPending(local, api()); expect(rep.error).toBeUndefined(); expect(rep.pushed).toBeGreaterThan(3); expect(local.outboxCount()).toBe(0);
    const sale = (await cloud.scan("sales", { tenantId: T })).rows[0]!; expect(sale).toMatchObject({ number: expect.stringContaining("V-"), total: 1500 }); expect(await stockFor(cloud, eau, 0)).toBe(97);
    const again = await pushPending(local, api()); expect(again.pushed).toBe(0);
    // rejeu complet du même envoi (reprise après coupure) : aucune ligne en double
    const n = (await cloud.scan("stock_moves", { tenantId: T })).rows.length; const rows = local.outboxPending(10).map(() => null); void rows; await call(cloud, "own", "sync.push", { rows: [{ table: "sales", id: sale.$id, op: "upsert", data: { ...sale } }] }, "", T); expect((await cloud.scan("stock_moves", { tenantId: T })).rows.length).toBe(n); expect((await cloud.scan("sales", { tenantId: T })).rows).toHaveLength(1);
    const ret = await ok(call(local, "own", "sales.list", {}, shop)); await ok(call(local, "own", "sale.refund", { returnId: "rt-sync-00001", saleId: ret.sales[0].id, kind: "cancel", reason: "Erreur", refunds: [{ method: "cash", amount: 1500 }] }, shop));
    await pushPending(local, api()); expect((await cloud.scan("sale_returns", { tenantId: T })).rows).toHaveLength(1); expect(await stockFor(cloud, eau, 0)).toBe(100); expect(await stockFor(local, eau, 0)).toBe(100);
  });
  it("le cloud et le poste convergent : toutes les tables locales identiques après envoi", async () => {
    await ok(call(local, "own", "checkout", { clientId: "vente-sync-0002", lines: [{ productId: eau, qty: 5 }], payments: [{ method: "cash", amount: 2500 }] }, shop));
    await ok(call(local, "own", "article.save", { data: { name: "Riz", price: 900, cost: 600, sku: "RIZ", barcode: "RIZ0" }, initialQty: 20 }, shop)); await pushPending(local, api());
    for (const t of PUSHED_TABLES) { const a = (await local.scan(t, { tenantId: T })).rows.map((r) => r.$id).sort(); const b = (await cloud.scan(t, { tenantId: T })).rows.map((r) => r.$id).sort(); expect(a, `table ${t}`).toEqual(b); }
    for (const id of (await local.scan("products", { tenantId: T })).rows.map((r) => r.$id)) { const strip = (r: any) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith("$"))); expect(strip(await cloud.get("products", id)), id).toEqual(strip(await local.get("products", id))); }
  });
  it("coupure réseau en cours d'envoi : rien n'est perdu, la reprise termine ; ligne refusée signalée sans bloquer le reste", async () => {
    for (let i = 1; i <= 4; i++) await ok(call(local, "own", "checkout", { clientId: `vente-sync-1${i}00`, lines: [{ productId: eau, qty: 1 }], payments: [{ method: "cash", amount: 500 }] }, shop));
    const total = local.outboxCount(); let calls = 0; const flaky: CloudApi = { ...api(), push: async (rows) => { if (++calls === 2) throw new Error("réseau coupé"); return api().push(rows); } };
    const r1 = await pushPending(local, flaky, { batch: 5 }); expect(r1.error).toBe("réseau coupé"); expect(r1.pushed).toBe(5); expect(local.outboxCount()).toBe(total - 5);
    const r2 = await pushPending(local, api(), { batch: 5 }); expect(r2.error).toBeUndefined(); expect(local.outboxCount()).toBe(0); expect((await cloud.scan("sales", { tenantId: T })).rows).toHaveLength(4);
    // ligne refusée par le cloud : signalée, retirée de la file, le reste passe
    await local.create("products", "prodbad0001", T, { tenantId: T, shopId: "boutiqueinconnue", name: "Fantôme", price: 1 }); await local.create("products", "prodok00001", T, { tenantId: T, shopId: shop, name: "Bon", price: 1 });
    const r3 = await pushPending(local, api()); expect(r3.rejected).toMatchObject([{ table: "products", id: "prodbad0001", error: expect.stringContaining("Boutique inconnue") }]); expect(r3.pushed).toBe(1); expect(local.outboxCount()).toBe(0); expect(local.conflicts()[0]).toMatchObject({ kind: "rejected_by_cloud", rowId: "prodbad0001" });
  });
  it("une écriture faite pendant l'envoi reste en attente (seule l'ancienne est acquittée)", async () => {
    await ok(call(local, "own", "article.save", { id: eau, data: { price: 550 } }, shop)); const pend = local.outboxPending(10); const p = pend.find((x) => x.id === eau)!;
    await ok(call(local, "own", "article.save", { id: eau, data: { price: 600 } }, shop)); local.outboxAck("products", eau, p.mx, "2026-01-01T00:00:00.000Z"); expect(local.hasPending("products", eau)).toBe(true);
    await pushPending(local, api()); expect((await cloud.get("products", eau))!.price).toBe(600); expect(local.hasPending("products", eau)).toBe(false);
  });
});

describe("tables décidées par le cloud et tables partagées", () => {
  beforeEach(async () => { await initialDownload(local, api(), T); local.syncOn = true; });
  it("l'abonnement change côté cloud : le poste le reçoit ; une modification locale de l'abonnement n'est jamais envoyée", async () => {
    await cloud.update("subscriptions", T, { plan: "business" }); await pullTable(local, api(), T, "subscriptions"); expect(await local.get("subscriptions", T)).toMatchObject({ plan: "business" });
    await local.update("subscriptions", T, { plan: "pro" }); expect(local.hasPending("subscriptions", T)).toBe(false); await pushPending(local, api()); expect((await cloud.get("subscriptions", T))!.plan).toBe("business");
    const r = await call(cloud, "own", "sync.push", { rows: [{ table: "subscriptions", id: T, op: "upsert", data: { plan: "pro" } }] }, "", T); expect((r.body as any).data.results[0]).toMatchObject({ status: "rejected", error: expect.stringContaining("plateforme") });
  });
  it("catalogue modifié des deux côtés : le poste l'emporte, la version écrasée du cloud est gardée pour examen ; modification du cloud seul : reçue", async () => {
    // cloud seul
    await cloud.update("products", eau, { price: 520 }); await pullTable(local, api(), T, "products"); expect((await local.get("products", eau))!.price).toBe(520); expect(local.conflicts()).toHaveLength(0);
    // les deux côtés : le poste a une modification en attente quand le cloud change aussi
    await ok(call(local, "own", "article.save", { id: eau, data: { price: 700 } }, shop)); await cloud.update("products", eau, { price: 530, category: "Eaux" });
    const pr = await pullTable(local, api(), T, "products"); expect(pr.conflicts).toBe(1); expect((await local.get("products", eau))!.price).toBe(700); expect(local.conflicts()[0]).toMatchObject({ kind: "cloud_changed_while_local_pending", rowId: eau });
    const push = await pushPending(local, api()); expect(push.overwrittenOnCloud).toBe(1); expect((await cloud.get("products", eau))!).toMatchObject({ price: 700 }); expect(local.conflicts().some((c) => c.kind === "cloud_version_overwritten" && (c.cloud as any).price === 530)).toBe(true);
    // la modification suivante du poste repart de la nouvelle version (pas de faux conflit)
    await ok(call(local, "own", "article.save", { id: eau, data: { price: 710 } }, shop)); const p2 = await pushPending(local, api()); expect(p2.overwrittenOnCloud).toBe(0); expect((await cloud.get("products", eau))!.price).toBe(710);
  });
  it("tour complet : envoi puis réception, curseurs conservés, dernière synchronisation notée", async () => {
    await ok(call(local, "own", "checkout", { clientId: "vente-sync-2000", lines: [{ productId: eau, qty: 2 }], payments: [{ method: "cash", amount: 1000 }] }, shop)); await cloud.update("subscriptions", T, { plan: "starter" });
    const rep = await syncOnce(local, api(), T); expect(rep.error).toBeUndefined(); expect(rep.pushed).toBeGreaterThan(0); expect((await local.get("subscriptions", T))!.plan).toBe("starter"); expect(local.syncGet("lastSyncOkAt")).toBeTruthy(); expect(local.syncGet("pull:subscriptions")).toBeTruthy();
    const again = await syncOnce(local, api(), T); expect(again.pushed).toBe(0); expect(again.pulled).toBe(0);
  });
});

describe("sécurité côté cloud : propriétaire seulement, commerce de l'appelant seulement", () => {
  const push = (user: string, rows: PushRow[], tenant = T) => call(cloud, user, "sync.push", { rows }, "", tenant);
  it("un employé ne peut ni envoyer ni recevoir ; un inconnu non plus", async () => {
    const c = await ok(call(cloud, "own", "staff.create", { name: "Awa", username: "awa", password: "motdepasse1", role: "cashier", shopIds: [shop] }, "")); const rows: PushRow[] = [{ table: "products", id: "x1", op: "upsert", data: { shopId: shop, name: "X", price: 1 } }];
    expect((await push(c.userId, rows)).status).toBe(403); expect((await push("inconnu", rows)).status).toBe(403); expect((await call(cloud, c.userId, "sync.pull", { table: "products" }, "", T)).status).toBe(403);
  });
  it("jamais d'écrasement d'une ligne d'un autre commerce ; commerce forcé ; boutique d'un autre commerce refusée ; limites de taille", async () => {
    const shop2 = (await ok(call(cloud, "own2", "shop.create", { name: "Autre" }, "", T2))).shopId; const own2Id = (await ok(call(cloud, "own2", "article.save", { data: { name: "Secret", price: 5, sku: "S", barcode: "S0" } }, shop2, T2))).id;
    const r = await push("own", [{ table: "products", id: own2Id, op: "upsert", data: { shopId: shop, name: "Piraté", price: 1 } }, { table: "products", id: "prodmine001", op: "upsert", data: { tenantId: T2, shopId: shop2, name: "Intrus", price: 1 } }, { table: "products", id: "prodmine002", op: "upsert", data: { tenantId: T2, shopId: shop, name: "Forcé", price: 1 } }, { table: "products", id: "bad id!", op: "upsert", data: {} }, { table: "nexistepas", id: "z1", op: "upsert", data: {} }, { table: "products", id: "prodbig0001", op: "upsert", data: { shopId: shop, blob: "x".repeat(70_000) } }]);
    const res = (r.body as any).data.results; expect(res[0]).toMatchObject({ status: "rejected", error: expect.stringContaining("autre commerce") }); expect(res[1]).toMatchObject({ status: "rejected", error: expect.stringContaining("Boutique inconnue") }); expect(res[2].status).toBe("applied"); expect(res[3].status).toBe("rejected"); expect(res[4].status).toBe("rejected"); expect(res[5]).toMatchObject({ status: "rejected", error: expect.stringContaining("volumineuse") });
    expect(await cloud.get("products", own2Id)).toMatchObject({ name: "Secret", tenantId: T2 }); expect(await cloud.get("products", "prodmine002")).toMatchObject({ tenantId: T, name: "Forcé" }); expect(await cloud.get("products", "prodmine001")).toBeNull();
    expect((await push("own", Array.from({ length: 201 }, (_, i) => ({ table: "products", id: `p${i}`, op: "upsert" as const, data: {} })))).status).toBe(400);
    const pull = await call(cloud, "own", "sync.pull", { table: "products", since: "" }, "", T); expect((pull.body as any).data.rows.every((x: any) => x.data.tenantId === T)).toBe(true); expect((await call(cloud, "own", "sync.pull", { table: "inconnue" }, "", T)).status).toBe(400);
  });
  it("suppression côté poste propagée ; ligne d'un autre commerce non supprimable", async () => {
    await local.addMember(T, "own", ["owner"], "own"); await initialDownload(local, api(), T); local.syncOn = true; await local.create("products", "supprme0001", T, { tenantId: T, shopId: shop, name: "Temp", price: 1 }); await pushPending(local, api()); expect(await cloud.get("products", "supprme0001")).not.toBeNull();
    await local.remove("products", "supprme0001"); await pushPending(local, api()); expect(await cloud.get("products", "supprme0001")).toBeNull();
    const shop2 = (await ok(call(cloud, "own2", "shop.create", { name: "Autre" }, "", T2))).shopId; const sid = (await ok(call(cloud, "own2", "article.save", { data: { name: "Secret", price: 5, sku: "S", barcode: "S0" } }, shop2, T2))).id;
    const r = await push("own", [{ table: "products", id: sid, op: "remove" }]); expect((r.body as any).data.results[0].status).toBe("rejected"); expect(await cloud.get("products", sid)).not.toBeNull();
  });
});
