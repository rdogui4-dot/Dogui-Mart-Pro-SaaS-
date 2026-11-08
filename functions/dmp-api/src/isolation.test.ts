import { beforeEach, describe, expect, it } from "vitest";
import { TABLES } from "../../../scripts/schema.mjs";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { POLICY_TABLES, labelsFor, managerLabel, readRoles, staffLabel } from "./permissions";
import { MODULES, modulesFor } from "../../../src/domain/access";

const T = "tenantaaa111";
let st: MemoryStore; let A = "", B = "";
let mgrA = "", cashA = "", mgrB = "", both = "";
const env = { admins: ["root"] };
const call = (user: string, action: string, payload: unknown, shop: string, tenant = T) => handle(st, user, { action, tenantId: tenant, shopId: shop, payload }, env);
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const ids = (user: string, table: string, shopField = "shopId") => st.readableBy(user, table).map((r) => `${r[shopField]}`);
const only = (arr: string[], shop: string) => arr.length > 0 && arr.every((x) => x === shop);

async function seed(shop: string, manager: string, tag: string) {
  const p = await ok(call(manager, "entity.save", { table: "products", data: { name: `Riz ${tag}`, price: 1000 } }, shop));
  await ok(call(manager, "stock.adjust", { productId: p.id, counted: 50 }, shop));
  await ok(call(manager, "entity.save", { table: "customers", data: { name: `Client ${tag}` } }, shop));
  await ok(call(manager, "entity.save", { table: "suppliers", data: { name: `Fournisseur ${tag}` } }, shop));
  await ok(call(manager, "checkout", { clientId: `sale-${tag}-000001`, lines: [{ productId: p.id, qty: 2 }], payments: [{ method: "cash", amount: 2000 }] }, shop));
  const s = await ok(call(manager, "entity.save", { table: "suppliers", data: { name: `F2 ${tag}` } }, shop));
  await ok(call(manager, "po.create", { clientId: `po-client-${tag}-1`, supplierId: s.id, lines: [{ productId: p.id, qty: 1, unitCost: 500 }] }, shop));
  const c = (await st.list("customers", { shopId: shop }, 1))[0]!;
  await ok(call(manager, "invoice.customer.create", { invoiceId: `inv-free-${tag}-001`, customerId: c.$id, lines: [{ description: "Conseil", qty: 1, unitPrice: 1000 }] }, shop));
}

beforeEach(async () => {
  st = new MemoryStore();
  await st.grant(T, "own", ["owner"], []); await st.grant("othertenant", "ownerX", ["owner"], []); await st.grant(T, "root", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, "", T))).shopId;
  B = (await ok(call("own", "shop.create", { name: "Thiès" }, "", T))).shopId;
  const mk = async (username: string, role: string, shopIds: string[]) => (await ok(call("own", "staff.create", { name: username, username, password: "motdepasse1", role, shopIds }, "", T))).userId as string;
  mgrA = await mk("mgr.a", "manager", [A]); cashA = await mk("cash.a", "cashier", [A]); mgrB = await mk("mgr.b", "manager", [B]); both = await mk("both", "manager", [A, B]);
  await seed(A, mgrA, "A"); await seed(B, mgrB, "B");
  await ok(call("own", "payments.settings.save", { waveTemplate: "https://pay.example.com/?a={amount}&r={ref}" }, A));
  await ok(call(cashA, "payment_link.create", { provider: "wave", amount: 1000 }, A));
});

describe("couverture de la politique", () => {
  it("chaque table du schéma a une politique de lecture, et inversement", () => {
    expect([...POLICY_TABLES].sort()).toEqual(Object.keys(TABLES).sort());
  });
  it("refuse une table inconnue au lieu d'ouvrir la lecture", () => { expect(() => readRoles("nouvelle_table", T, {}, "x")).toThrow(/Aucune politique/); });
  it("refuse un identifiant de boutique incompatible avec une étiquette", () => {
    expect(() => staffLabel("a-b")).toThrow(); expect(() => managerLabel("x".repeat(40))).toThrow();
    expect(labelsFor("manager", [...MODULES], ["abc"], true)).toEqual(["sabc", "gabc", "kabc", "uabc", "iabc", "aabc"]); expect(labelsFor("cashier", modulesFor("cashier"), ["abc"], true)).toEqual(["sabc"]); expect(labelsFor("manager", [...MODULES], ["abc"], false)).toEqual([]);
  });
});

describe("lecture des données d'une boutique", () => {
  const SHOP_TABLES = ["products", "stock_moves", "customers", "sales", "payment_settings", "payment_links"];
  it("un caissier lit sa boutique et jamais l'autre", () => {
    for (const t of SHOP_TABLES) { const r = ids(cashA, t); expect(only(r, A), t).toBe(true); }
    expect(ids(cashA, "products", "name")).toEqual(["Riz A"]);
    expect(ids(cashA, "customers", "name")).toEqual(["Client A"]);
  });
  it("un caissier ne lit ni achats, ni factures, ni compta, ni fournisseurs, ni audit, même chez lui", () => {
    for (const t of ["suppliers", "purchase_orders", "invoices", "journal_entries", "audit_log", "transfers", "subscriptions", "subscription_payments", "platform_settings"]) expect(st.readableBy(cashA, t), t).toEqual([]);
  });
  it("un gérant lit les données sensibles de SA boutique seulement", () => {
    for (const t of ["suppliers", "purchase_orders", "invoices", "journal_entries"]) { expect(only(ids(mgrA, t), A), t).toBe(true); expect(only(ids(mgrB, t), B), t).toBe(true); }
    expect(ids(mgrA, "products", "name")).toEqual(["Riz A"]);
  });
  it("un gérant de deux boutiques lit les deux ; le propriétaire lit tout", () => {
    expect(new Set(ids(both, "invoices"))).toEqual(new Set([A, B]));
    for (const t of ["products", "sales", "invoices", "journal_entries", "suppliers", "purchase_orders"]) expect(new Set(ids("own", t))).toEqual(new Set([A, B]));
  });
  it("un autre commerce ne lit rien du nôtre", () => {
    for (const t of Object.keys(TABLES)) expect(st.readableBy("ownerX", t), t).toEqual([]);
  });
  it("jamais de lecture par la seule appartenance à l'équipe : l'ancien droit « toute l'équipe » n'existe plus", () => {
    for (const [k, perms] of st.perms) expect(perms.every((p) => p !== `team:${T}`), k).toBe(true);
  });
});

describe("fiches boutiques, employés, transferts, abonnement", () => {
  it("un employé ne voit que ses boutiques ; le propriétaire toutes", () => {
    expect(st.readableBy(cashA, "shops").map((s) => s.$id)).toEqual([A]);
    expect(new Set(st.readableBy(both, "shops").map((s) => s.$id))).toEqual(new Set([A, B]));
    expect(new Set(st.readableBy("own", "shops").map((s) => s.$id))).toEqual(new Set([A, B]));
  });
  it("un employé ne voit que sa propre fiche ; le propriétaire toutes", () => {
    expect(st.readableBy(cashA, "staff").map((s) => s.userId)).toEqual([cashA]);
    expect(st.readableBy("own", "staff")).toHaveLength(4);
  });
  it("un transfert est visible des gérants des deux boutiques, pas des autres", async () => {
    await ok(call(both, "stock.transfer", { transferId: "transfer-0001", toShopId: B, lines: [{ productId: (await st.list("products", { shopId: A }, 1))[0]!.$id, qty: 3 }] }, A));
    expect(st.readableBy(mgrA, "transfers")).toHaveLength(1); expect(st.readableBy(mgrB, "transfers")).toHaveLength(1); expect(st.readableBy(both, "transfers")).toHaveLength(1);
    expect(st.readableBy(cashA, "transfers")).toEqual([]);
    expect(st.readableBy("ownerX", "transfers")).toEqual([]);
    // les produits et mouvements créés dans la boutique de destination appartiennent à cette boutique
    expect(only(ids(mgrB, "stock_moves"), B)).toBe(true);
  });
  it("l'abonnement et ses paiements ne sont lisibles que du propriétaire ; les réglages de plateforme de personne", async () => {
    await ok(call("own", "subscription.get", {}, A));
    await ok(handle(st, "root", { action: "platform.settings.save", payload: { selarLinks: { pro: "https://selar.com/775984p80m" } } }, env));
    for (const u of [mgrA, cashA, both, mgrB]) { expect(st.readableBy(u, "subscriptions"), u).toEqual([]); expect(st.readableBy(u, "platform_settings")).toEqual([]); }
    expect(st.readableBy("own", "subscriptions")).toHaveLength(1);
    expect(st.readableBy("own", "platform_settings")).toEqual([]);
  });
});

describe("cycle de vie des droits de lecture", () => {
  it("changer de boutique déplace les droits ; désactiver les retire ; réactiver les rend", async () => {
    expect(only(ids(cashA, "products"), A)).toBe(true);
    await ok(call("own", "staff.update", { userId: cashA, shopIds: [B] }, "", T));
    expect(only(ids(cashA, "products"), B)).toBe(true);
    await ok(call("own", "staff.update", { userId: cashA, active: false }, "", T));
    expect(st.labels.get(cashA)).toEqual([]);
    for (const t of Object.keys(TABLES)) expect(st.readableBy(cashA, t).filter((r) => t !== "staff"), t).toEqual([]);
    await ok(call("own", "staff.update", { userId: cashA, active: true }, "", T));
    expect(only(ids(cashA, "products"), B)).toBe(true);
  });
  it("passer caissier → gérant donne l'accès aux données sensibles, et l'inverse le retire", async () => {
    expect(st.readableBy(cashA, "invoices")).toEqual([]);
    await ok(call("own", "staff.update", { userId: cashA, role: "manager" }, "", T));
    expect(only(ids(cashA, "invoices"), A)).toBe(true);
    await ok(call("own", "staff.update", { userId: cashA, role: "cashier" }, "", T));
    expect(st.readableBy(cashA, "invoices")).toEqual([]);
  });
  it("un compte créé reçoit ses étiquettes avant d'exister dans le commerce, et le rollback le supprime", async () => {
    st.failAddMember = true;
    const r: any = await call("own", "staff.create", { name: "Z", username: "zed", password: "motdepasse1", role: "cashier", shopIds: [A] }, "", T);
    expect(r.status).toBe(500);
    expect(st.users.size).toBe(4); // les 4 comptes de départ seulement
  });
});
