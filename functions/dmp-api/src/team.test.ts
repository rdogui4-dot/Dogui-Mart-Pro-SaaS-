import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { stockFor } from "./checkout";

const T = "t1";
let st: MemoryStore;
const call = (user: string, action: string, payload: unknown, shop = "sA", tenant = T) => handle(st, user, { action, tenantId: tenant, shopId: shop, payload });
const ok = async (user: string, action: string, payload: unknown, shop = "sA") => { const r: any = await call(user, action, payload, shop); expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body.data; };

beforeEach(async () => {
  st = new MemoryStore();
  await st.addShop(T, "sA", "Dakar"); await st.addShop(T, "sB", "Thiès");
  await st.grant(T, "own", ["owner"], []); await st.grant(T, "mgrA", ["manager"], ["sA"]); await st.grant(T, "cashA", ["cashier"], ["sA"]); await st.grant(T, "mgrAB", ["manager"], ["sA", "sB"]);
  await st.grant("t2", "evil", ["owner"], []);
  await st.create("products", "p1", T, { tenantId: T, shopId: "sA", name: "Riz", barcode: "6001", price: 1000, cost: 600 });
  await st.create("stock_moves", "m0", T, { tenantId: T, shopId: "sA", productId: "p1", qty: 20, kind: "purchase" });
});

describe("accès par boutique", () => {
  it("un employé n'agit que dans ses boutiques ; le propriétaire partout", async () => {
    expect((await call("cashA", "payments.settings.get", {}, "sB")).status).toBe(403);
    expect((await call("cashA", "payments.settings.get", {}, "sA")).status).toBe(200);
    expect((await call("own", "payments.settings.get", {}, "sB")).status).toBe(200);
  });
  it("boutique inexistante ou d'un autre commerce : refusé", async () => {
    expect((await call("own", "payments.settings.get", {}, "nope")).status).toBe(404);
    await st.addShop("t2", "sX");
    expect((await call("own", "payments.settings.get", {}, "sX")).status).toBe(404);
    expect((await call("evil", "payments.settings.get", {}, "sA", "t2")).status).toBe(404);
  });
  it("un employé désactivé perd l'accès immédiatement", async () => {
    await st.update("staff", "cashA", { active: false });
    expect((await call("cashA", "payments.settings.get", {}, "sA")).status).toBe(403);
  });
});

describe("tenant.init et boutiques", () => {
  it("initialise la première boutique une seule fois", async () => {
    const st2 = new MemoryStore(); await st2.grant("tn", "boss", ["owner"], []);
    const call2 = () => handle(st2, "boss", { action: "tenant.init", tenantId: "tn", payload: { name: "Chez Awa" } });
    const a: any = await call2(); const b: any = await call2();
    expect(a.body.data.created).toBe(true); expect(b.body.data).toMatchObject({ created: false, shopId: a.body.data.shopId });
    expect(st2.rows("shops")).toHaveLength(1);
  });
  it("seul le propriétaire crée une boutique ; TVA validée", async () => {
    expect((await call("mgrAB", "shop.create", { name: "X" })).status).toBe(403);
    expect((await call("own", "shop.create", { name: "X", vatRatePct: 90 })).status).toBe(400);
    const r = await ok("own", "shop.create", { name: "Saint-Louis", city: "Saint-Louis" });
    expect(st.rows("shops").find((s) => s.$id === r.shopId)!.tenantId).toBe(T);
  });
});

describe("employés", () => {
  const base = { name: "Awa Ndiaye", username: "awa.ndiaye", password: "motdepasse1", role: "cashier", shopIds: ["sA"] };
  it("crée le compte, l'appartenance et la fiche ; l'employé peut ensuite vendre dans sa boutique seulement", async () => {
    const r = await ok("own", "staff.create", base);
    expect(r.login).toBe("awa.ndiaye");
    expect([...st.users.values()][0]).toMatchObject({ email: "awa.ndiaye@staff.invalid", active: true });
    expect(JSON.stringify(st.rows("staff")[st.rows("staff").length - 1])).not.toContain("motdepasse1");
    expect((await call(r.userId, "payments.settings.get", {}, "sA")).status).toBe(200);
    expect((await call(r.userId, "payments.settings.get", {}, "sB")).status).toBe(403);
    expect((await call(r.userId, "staff.create", base)).status).toBe(403);
  });
  it("valide identifiant, mot de passe, rôle, boutiques et unicité", async () => {
    expect((await call("mgrA", "staff.create", base)).status).toBe(403);
    expect((await call("own", "staff.create", { ...base, password: "court" })).status).toBe(400);
    expect((await call("own", "staff.create", { ...base, username: "A B" })).status).toBe(400);
    expect((await call("own", "staff.create", { ...base, role: "owner" })).status).toBe(400);
    expect((await call("own", "staff.create", { ...base, shopIds: [] })).status).toBe(400);
    expect((await call("own", "staff.create", { ...base, shopIds: ["inconnue"] })).status).toBe(404);
    expect((await call("own", "staff.create", { ...base, email: "x@staff.invalid" })).status).toBe(400);
    await ok("own", "staff.create", base);
    expect((await call("own", "staff.create", base)).status).toBe(409);
  });
  it("rollback complet si l'ajout au commerce échoue", async () => {
    st.failAddMember = true;
    expect((await call("own", "staff.create", base)).status).toBe(500);
    expect(st.users.size).toBe(0);
  });
  it("rôle, boutiques et désactivation", async () => {
    const { userId } = await ok("own", "staff.create", base);
    await ok("own", "staff.update", { userId, role: "manager", shopIds: ["sA", "sB"] });
    expect(st.members.get(`${T}:${userId}`)).toEqual(["manager"]);
    expect((await call(userId, "payments.settings.get", {}, "sB")).status).toBe(200);
    await ok("own", "staff.update", { userId, active: false });
    expect(st.users.get(userId)!.active).toBe(false);
    expect((await call(userId, "payments.settings.get", {}, "sA")).status).toBe(403);
  });
  it("réinitialise le mot de passe, sans toucher aux employés d'un autre commerce", async () => {
    const { userId } = await ok("own", "staff.create", base);
    await ok("own", "staff.resetPassword", { userId, password: "nouveau-mdp-1" });
    expect(st.users.get(userId)!.password).toBe("nouveau-mdp-1");
    expect((await call("own", "staff.resetPassword", { userId, password: "court" })).status).toBe(400);
    expect((await call("evil", "staff.resetPassword", { userId, password: "piratage-123" }, "", "t2")).status).toBe(404);
    expect((await call("evil", "staff.update", { userId, active: false }, "", "t2")).status).toBe(404);
  });
});

describe("transfert entre boutiques", () => {
  const tr = (user: string, lines: unknown, id = "transfer-0001", to = "sB") => call(user, "stock.transfer", { transferId: id, toShopId: to, lines });
  it("déplace le stock, crée le produit de destination et le retrouve ensuite", async () => {
    await ok("mgrAB", "stock.transfer", { transferId: "transfer-0001", toShopId: "sB", lines: [{ productId: "p1", qty: 5 }] });
    expect(await stockFor(st, "p1")).toBe(15);
    const dest = st.rows("products").find((p) => p.shopId === "sB")!;
    expect(dest).toMatchObject({ name: "Riz", barcode: "6001", price: 1000, originId: "p1" });
    expect(await stockFor(st, dest.$id)).toBe(5);
    await ok("mgrAB", "stock.transfer", { transferId: "transfer-0002", toShopId: "sB", lines: [{ productId: "p1", qty: 3 }] });
    expect(st.rows("products").filter((p) => p.shopId === "sB")).toHaveLength(1);
    expect(await stockFor(st, dest.$id)).toBe(8);
  });
  it("idempotent, y compris après plantage en cours de route", async () => {
    const body = { transferId: "transfer-0001", toShopId: "sB", lines: [{ productId: "p1", qty: 5 }] };
    await ok("mgrAB", "stock.transfer", body);
    expect((await ok("mgrAB", "stock.transfer", body)).duplicate).toBe(true);
    expect(await stockFor(st, "p1")).toBe(15);
    // plantage : mouvements écrits mais pas la fiche de transfert
    st.tables.get("transfers")!.clear(); st.tables.get("stock_moves")!.delete("transfer-0001_i0");
    await ok("mgrAB", "stock.transfer", body);
    const dest = st.rows("products").find((p) => p.shopId === "sB")!;
    expect(await stockFor(st, "p1")).toBe(15); expect(await stockFor(st, dest.$id)).toBe(5);
    expect(st.rows("products").filter((p) => p.shopId === "sB")).toHaveLength(1);
  });
  it("droits et validations", async () => {
    expect((await tr("mgrA", [{ productId: "p1", qty: 1 }])).status).toBe(403); // pas d'accès à la destination
    expect((await tr("cashA", [{ productId: "p1", qty: 1 }])).status).toBe(403);
    expect((await tr("mgrAB", [{ productId: "p1", qty: 99 }])).status).toBe(409);
    expect((await tr("mgrAB", [{ productId: "p1", qty: 1 }], "transfer-0003", "sA")).status).toBe(400);
    expect((await tr("mgrAB", [{ productId: "p1", qty: 0 }])).status).toBe(400);
    expect((await tr("mgrAB", [{ productId: "p1", qty: 1 }], "transfer-0004", "ailleurs")).status).toBe(403);
    expect(await stockFor(st, "p1")).toBe(20);
  });
});
