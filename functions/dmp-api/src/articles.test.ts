import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { stockFor } from "./checkout";
import { needFeature } from "./articles";
import { FEATURES, type FeatureKey } from "../../../src/domain/features";

const T = "tenantart001", T2 = "tenantart002";
let st: MemoryStore; let A = "", B = "", A2 = "";
const call = (user: string, action: string, payload: unknown, shop = A, tenant = T) => handle(st, user, { action, tenantId: tenant, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const setPlan = (tenant: string, plan: string) => { const row = st.rows("subscriptions").find((r) => r.$id === tenant); const data = { tenantId: tenant, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", tenant, tenant, data); };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]).toString("base64");
const save = (user: string, data: object, extra: object = {}, shop = A) => call(user, "article.save", { data, ...extra }, shop);
const riz = { name: "Riz parfumé 5kg", sku: "RIZ-5", barcode: "6001234567890", category: "Épicerie", price: 4500, cost: 3800, minStock: 5, unit: "sac", description: "Sac de 5 kg" };

beforeEach(async () => {
  st = new MemoryStore();
  await st.grant(T, "own", ["owner"], []); await st.grant(T2, "own2", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId;
  A2 = (await ok(call("own2", "shop.create", { name: "Autre" }, "", T2))).shopId;
  const mk = async (u: string, role: string, extra: object = {}) => (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: [A], ...extra }, ""))).userId;
  (globalThis as any).U = { cais: await mk("cais", "cashier"), mag: await mk("mag", "stockkeeper"), ger: await mk("ger", "manager") };
  setPlan(T, "business"); setPlan(T2, "business");
});
const U = () => (globalThis as any).U as Record<string, string>;

describe("création", () => {
  it("enregistre tous les champs, le stock initial (mouvement), l'historique de prix et le journal", async () => {
    const { id } = await ok(save("own", riz, { initialQty: 24 }));
    const row = st.rows("products").find((p) => p.$id === id)!;
    expect(row).toMatchObject({ ...riz, archived: false, tenantId: T, shopId: A });
    expect(await stockFor(st, id)).toBe(24);
    expect(st.rows("stock_moves").find((m) => m.productId === id)).toMatchObject({ kind: "adjust", refId: "stock-initial", qty: 24 });
    expect(st.rows("price_history").filter((h) => h.productId === id)).toHaveLength(1);
    expect(st.rows("audit_log").some((l) => l.action === "article.create")).toBe(true);
  });
  it("valide côté serveur : désignation, montants entiers positifs, unité", async () => {
    for (const bad of [{ price: 10 }, { name: "A", price: 10.5 }, { name: "A", price: -1 }, { name: "A", unit: "tonne" }, { name: "A", cost: 1e12 }]) expect((await save("own", bad)).status, JSON.stringify(bad)).toBe(400);
    expect(st.rows("products")).toHaveLength(0);
  });
  it("refuse une référence ou un code-barres déjà utilisé dans la boutique, mais pas dans une autre", async () => {
    await ok(save("own", riz));
    const r1: any = await save("own", { ...riz, barcode: "999" }); expect(r1.status).toBe(409); expect(r1.body.error).toContain("Référence");
    const r2: any = await save("own", { ...riz, sku: "AUTRE" }); expect(r2.status).toBe(409); expect(r2.body.error).toContain("Code-barres");
    await ok(save("own", riz, {}, B));
  });
  it("un renvoi avec la même demande ne crée jamais de doublon", async () => {
    const a = await ok(save("own", riz, { requestId: "req-abc-123456", initialQty: 3 }));
    const b = await ok(save("own", riz, { requestId: "req-abc-123456", initialQty: 3 }));
    expect(b).toMatchObject({ id: a.id, duplicate: true }); expect(st.rows("products")).toHaveLength(1); expect(await stockFor(st, a.id)).toBe(3);
  });
  it("reprise après coupure : le stock initial et l'historique manquants sont recréés, sans doublon", async () => {
    const a = await ok(save("own", riz, { requestId: "req-crash-000001", initialQty: 7 }));
    // simule une coupure juste après la création de la fiche
    await st.remove("stock_moves", `${a.id}_init`); await st.remove("price_history", `${a.id}_p0`);
    expect(await stockFor(st, a.id)).toBe(0);
    await ok(save("own", riz, { requestId: "req-crash-000001", initialQty: 7 }));
    await ok(save("own", riz, { requestId: "req-crash-000001", initialQty: 7 }));
    expect(await stockFor(st, a.id)).toBe(7); expect(st.rows("price_history")).toHaveLength(1); expect(st.rows("products")).toHaveLength(1);
    expect(st.rows("audit_log").filter((l) => l.action === "article.create")).toHaveLength(1);
  });
  it("fournisseur principal : doit exister dans la boutique", async () => {
    const { id: sup } = await ok(call("own", "entity.save", { table: "suppliers", data: { name: "Grossiste" } }));
    expect((await save("own", { ...riz, supplierId: "inconnu" })).status).toBe(400);
    const { id: supB } = await ok(call("own", "entity.save", { table: "suppliers", data: { name: "Autre boutique" } }, B));
    expect((await save("own", { ...riz, supplierId: supB })).status).toBe(400);
    expect(await ok(save("own", { ...riz, supplierId: sup }))).toHaveProperty("id");
  });
  it("le client ne peut pas fixer imageFileId ni les champs serveur", async () => {
    const { id } = await ok(save("own", { ...riz, imageFileId: "pirate", tenantId: "autre", shopId: "autre" }));
    expect(st.rows("products").find((p) => p.$id === id)).toMatchObject({ tenantId: T, shopId: A }); expect(st.rows("products")[0]!.imageFileId).toBeUndefined();
  });
});

describe("formules (droits d'abonnement ≠ rôles)", () => {
  it("Starter : fiche simple autorisée, fiche enrichie refusée (402), même pour le propriétaire", async () => {
    setPlan(T, "starter");
    const simple = { table: "products", data: { name: "Sucre", price: 700, cost: 600, sku: "S1", minStock: 2 } };
    const { id: sid } = await ok(call("own", "entity.save", simple));
    expect((await save("own", { name: "Huile", price: 1500 })).status).toBe(402); // article.save : Business uniquement
    const r: any = await call("own", "entity.save", { table: "products", data: { name: "Huile", price: 1500, description: "1 L" } });
    expect(r.status).toBe(402); expect(r.body.error).toContain("Business");
    expect((await call("own", "entity.save", { table: "products", data: { name: "Lait", price: 500, unit: "l" } })).status).toBe(402);
    for (const [a, p] of [["article.archive", { id: sid, archived: true }], ["article.delete", { id: sid }]] as const) expect((await call("own", a, p)).status, a).toBe(402);
    // la fiche simple ne produit ni historique de prix ni journal d'article
    await ok(call("own", "entity.save", { table: "products", id: sid, data: { price: 900 } }));
    expect(st.rows("price_history")).toHaveLength(0); expect(st.rows("audit_log").filter((l) => String(l.action).startsWith("article."))).toHaveLength(0);
    expect((await call("own", "article.image", { id: st.rows("products")[0]!.$id, data: JPEG })).status).toBe(402);
  });
  it("Business et Pro : fiche complète", async () => { for (const p of ["business", "pro"]) { setPlan(T, p); await ok(save("own", { ...riz, sku: `R-${p}`, barcode: `B-${p}` })); } });
  it("compte à vie : tout est ouvert", async () => {
    await ok(call("own", "tenant.init", { name: "x" }, ""));
    const row = st.rows("subscriptions").find((r) => r.$id === T)!; Object.assign(row, { plan: "pro", status: "lifetime", renewsAt: "9999-12-31T00:00:00.000Z" });
    await ok(save("own", riz));
  });
  it("la fiche simple en Starter passe aussi par le chemin entity.save historique (écran Stock)", async () => {
    setPlan(T, "starter");
    const { id } = await ok(call("own", "entity.save", { table: "products", data: { name: "Pain", price: 150, cost: 100, minStock: 5, archived: false } }));
    expect(st.rows("products").find((p) => p.$id === id)).toMatchObject({ name: "Pain", archived: false });
  });
});

describe("droits par formule : tous les paliers", () => {
  const keys = Object.keys(FEATURES) as FeatureKey[]; const ctx = () => ({ userId: "own", tenantId: T, shopId: A, roles: ["owner"] });
  const allowedKeys = async () => { const out: string[] = []; for (const k of keys) { try { await needFeature(st, ctx(), k); out.push(k); } catch { /* verrouillé */ } } return out; };
  it("Starter : rien ; Business : Articles seulement ; Pro : tout", async () => {
    setPlan(T, "starter"); expect(await allowedKeys()).toEqual([]);
    setPlan(T, "business"); expect(await allowedKeys()).toEqual(["promotions", "smartPos", "expenses", "businessDashboard", "articles"]);
    setPlan(T, "pro"); expect(await allowedKeys()).toEqual(keys);
  });
  it("accès à vie (compte plateforme) : toutes les fonctions, présentes et futures", async () => {
    Object.assign(st.rows("subscriptions").find((r) => r.$id === T)!, { plan: "pro", status: "lifetime", renewsAt: "9999-12-31T23:59:59.000Z" });
    expect(await allowedKeys()).toEqual(keys);
  });
  it("retour de Pro à Business : les données avancées restent, l'usage se referme", async () => {
    setPlan(T, "pro"); const { id } = await ok(save("own", riz, { initialQty: 4 }));
    setPlan(T, "business"); expect((await allowedKeys())).toEqual(["promotions", "smartPos", "expenses", "businessDashboard", "articles"]);
    expect(st.rows("products").find((p) => p.$id === id)).toBeTruthy(); expect(await stockFor(st, id)).toBe(4);
  });
});

describe("prix et historique", () => {
  it("chaque changement de prix est historisé (ancien → nouveau) et le journal le mentionne", async () => {
    const { id } = await ok(save("own", riz));
    await ok(call("own", "article.save", { id, data: { price: 5000 } }));
    await ok(call("own", "article.save", { id, data: { cost: 4000 } }));
    await ok(call("own", "article.save", { id, data: { name: "Riz extra" } })); // pas de prix : pas d'historique
    const h = st.rows("price_history").filter((x) => x.productId === id);
    expect(h).toHaveLength(3); // création + 2 changements
    expect(h.find((x) => x.newPrice === 5000)).toMatchObject({ oldPrice: 4500, oldCost: 3800, newCost: 3800 });
    expect(h.find((x) => x.newCost === 4000)).toMatchObject({ oldPrice: 5000, newPrice: 5000, oldCost: 3800 });
    expect(st.rows("audit_log").filter((l) => l.action === "article.price")).toHaveLength(2);
  });
  it("une modification de prix ne change jamais une vente passée (prix figé dans la ligne de vente)", async () => {
    const { id } = await ok(save("own", riz, { initialQty: 10 }));
    await ok(call("own", "checkout", { clientId: "vente-historique-1", lines: [{ productId: id, qty: 2 }], payments: [{ method: "cash", amount: 9000 }] }));
    const before = JSON.parse(JSON.stringify(st.rows("sales")[0]));
    await ok(call("own", "article.save", { id, data: { price: 9999, cost: 1 } }));
    expect(st.rows("sales")[0]).toEqual(before);
    expect(before.total).toBe(9000);
    // et une nouvelle vente applique le nouveau prix
    await ok(call("own", "checkout", { clientId: "vente-nouvelle-2", lines: [{ productId: id, qty: 1 }], payments: [{ method: "cash", amount: 9999 }] }));
    expect(st.rows("sales").find((s) => s.clientId === "vente-nouvelle-2")!.total).toBe(9999);
  });
  it("l'historique d'un article suit ses mouvements : vente → stock diminue, inventaire → écart tracé", async () => {
    const { id } = await ok(save("own", riz, { initialQty: 10 }));
    await ok(call("own", "checkout", { clientId: "vente-mvt-0001", lines: [{ productId: id, qty: 4 }], payments: [{ method: "cash", amount: 18000 }] }));
    expect(await stockFor(st, id)).toBe(6);
    await ok(call("own", "stock.adjust", { productId: id, counted: 5 }));
    expect(await stockFor(st, id)).toBe(5);
    expect(st.rows("stock_moves").filter((m) => m.productId === id).map((m) => m.kind)).toEqual(["adjust", "sale", "adjust"]);
  });
});

describe("archivage et suppression", () => {
  it("archive puis restaure, avec journal", async () => {
    const { id } = await ok(save("own", riz));
    expect(await ok(call("own", "article.archive", { id, archived: true }))).toMatchObject({ archived: true });
    expect(st.rows("products")[0]!.archived).toBe(true);
    await ok(call("own", "article.archive", { id, archived: false })); expect(st.rows("products")[0]!.archived).toBe(false);
    expect(st.rows("audit_log").map((l) => l.action)).toEqual(expect.arrayContaining(["article.archive", "article.restore"]));
  });
  it("supprime un article sans historique (avec son stock initial, ses prix et sa photo)", async () => {
    const { id } = await ok(save("own", riz, { initialQty: 5 }));
    await ok(call("own", "article.image", { id, data: JPEG }));
    await ok(call("own", "article.delete", { id }));
    expect(st.rows("products")).toHaveLength(0); expect(st.rows("stock_moves")).toHaveLength(0); expect(st.rows("price_history")).toHaveLength(0); expect(st.files.size).toBe(0);
  });
  it("refuse de supprimer un article vendu ou commandé : il faut l'archiver", async () => {
    const { id } = await ok(save("own", riz, { initialQty: 5 }));
    await ok(call("own", "checkout", { clientId: "vente-suppr-001", lines: [{ productId: id, qty: 1 }], payments: [{ method: "cash", amount: 4500 }] }));
    const r: any = await call("own", "article.delete", { id }); expect(r.status).toBe(409); expect(r.body.error).toContain("archivez");
    expect(st.rows("products")).toHaveLength(1);
    const { id: id2 } = await ok(save("own", { ...riz, sku: "B", barcode: "B" }));
    await st.create("purchase_orders", "po1", T, { tenantId: T, shopId: A, number: "BC1", supplierId: "s", lines: JSON.stringify([{ productId: id2, qty: 3 }]), status: "ordered" });
    expect((await call("own", "article.delete", { id: id2 })).status).toBe(409);
  });
  it("seuls propriétaire et gérant peuvent supprimer ; un magasinier archive mais ne supprime pas", async () => {
    const { id } = await ok(save("own", riz));
    expect((await call(U().mag!, "article.delete", { id })).status).toBe(403);
    await ok(call(U().mag!, "article.archive", { id, archived: true }));
    await ok(call(U().ger!, "article.delete", { id }));
  });
});

describe("photo", () => {
  it("enregistre la photo, pose les droits de lecture de la boutique et remplace l'ancienne", async () => {
    const { id } = await ok(save("own", riz));
    const a = await ok(call("own", "article.image", { id, data: JPEG }));
    expect(st.rows("products")[0]!.imageFileId).toBe(a.fileId);
    const f = st.files.get(a.fileId)!; expect(f.name).toBe(`${id}.jpg`); expect(f.readRoles).toEqual(expect.arrayContaining([`team:${T}/owner`])); expect(f.readRoles.some((r) => r.startsWith("label:"))).toBe(true);
    const b = await ok(call("own", "article.image", { id, data: JPEG }));
    expect(st.files.has(a.fileId)).toBe(false); expect(st.files.has(b.fileId)).toBe(true);
    await ok(call("own", "article.image", { id, data: null })); expect(st.files.size).toBe(0); expect(st.rows("products")[0]!.imageFileId).toBe("");
  });
  it("refuse les contenus qui ne sont pas des images, trop lourds ou mal encodés", async () => {
    const { id } = await ok(save("own", riz));
    expect((await call("own", "article.image", { id, data: Buffer.from("<script>alert(1)</script>".repeat(10)).toString("base64"), mime: "image/jpeg" })).status).toBe(400);
    expect((await call("own", "article.image", { id, data: "pas du base64 !!" })).status).toBe(400);
    expect((await call("own", "article.image", { id, data: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(460_000)]).toString("base64") })).status).toBe(413);
    expect(st.files.size).toBe(0);
  });
});

describe("permissions et isolation entre entreprises", () => {
  it("un caissier (sans module Stock) ne peut ni créer, ni modifier, ni archiver", async () => {
    const { id } = await ok(save("own", riz));
    for (const [a, p] of [["article.save", { data: riz }], ["article.save", { id, data: { price: 1 } }], ["article.archive", { id, archived: true }], ["article.image", { id, data: JPEG }]] as const) expect((await call(U().cais!, a, p)).status, a).toBe(403);
  });
  it("aucune action sur l'article d'une autre entreprise ni d'une autre boutique", async () => {
    const { id } = await ok(call("own2", "article.save", { data: riz }, A2, T2));
    // même identifiant d'article, mais depuis le commerce T
    for (const [a, p] of [["article.save", { id, data: { price: 1 } }], ["article.archive", { id, archived: true }], ["article.delete", { id }], ["article.image", { id, data: JPEG }]] as const) expect((await call("own", a, p)).status, a).toBe(403);
    // et un utilisateur étranger ne peut pas viser le commerce T
    expect((await call("own2", "article.save", { data: riz }, A, T)).status).toBe(403);
    // article d'une autre boutique du même commerce
    const { id: idB } = await ok(save("own", { ...riz, sku: "Z", barcode: "Z" }, {}, B));
    expect((await call("own", "article.archive", { id: idB, archived: true }, A)).status).toBe(403);
    expect(st.rows("products").find((p) => p.$id === id)!.price).toBe(4500);
  });
  it("lecture : l'historique de prix suit le module Stock de la boutique", async () => {
    const { id } = await ok(save("own", riz));
    const h = st.rows("price_history").find((x) => x.productId === id)!;
    expect(st.readableBy(U().mag!, "price_history").map((r) => r.$id)).toContain(h.$id);
    expect(st.readableBy(U().cais!, "price_history")).toHaveLength(0);
    expect(st.readableBy("own2", "price_history")).toHaveLength(0);
    expect(st.readableBy("own2", "products")).toHaveLength(0);
  });
  it("un abonnement expiré interdit toute écriture d'article", async () => {
    const { id } = await ok(save("own", riz));
    const row = st.rows("subscriptions").find((r) => r.$id === T)!; Object.assign(row, { plan: "starter", period: "day", renewsAt: new Date(Date.now() - 60_000).toISOString() });
    expect((await call("own", "article.archive", { id, archived: true })).status).toBe(402);
    expect((await save("own", { name: "X", price: 1 })).status).toBe(402);
  });
});
