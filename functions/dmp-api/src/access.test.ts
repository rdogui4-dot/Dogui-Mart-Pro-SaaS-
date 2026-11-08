import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { MODULES, ROLE_PRESETS, type Module } from "../../../src/domain/access";

const T = "tenantacc001";
let st: MemoryStore; let A = "", B = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown, shop = A, tenant = T) => handle(st, user, { action, tenantId: tenant, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** Sondes : une action par module, avec une charge volontairement invalide quand c'est possible.
 *  Refusé = 403 ; autorisé = tout autre statut (le contrôle d'accès passe avant la validation métier). */
const PROBES: Record<Module, (u: string) => Promise<any>> = {
  pos: (u) => call(u, "payments.settings.get", {}),
  customers: (u) => call(u, "entity.save", { table: "customers", data: { name: "Client test" } }),
  stock: (u) => call(u, "stock.adjust", { productId: "inconnu", counted: 1 }),
  purchases: (u) => call(u, "entity.save", { table: "suppliers", data: { name: "Fournisseur test" } }),
  invoices: (u) => call(u, "invoice.customer.create", { invoiceId: "inv-probe-0001", customerId: "inconnu", lines: [] }),
  accounting: (u) => call(u, "invoice.supplier.pay", { invoiceId: "inconnue", paymentId: "pay-probe-0001", amount: 1, method: "cash" }),
  reports: (u) => call(u, "report.consolidated", { from: day(3), to: day(0) }),
};
const allowed = async (u: string, m: Module) => (await PROBES[m](u)).status !== 403;
const modulesOf = async (u: string) => { const out: Module[] = []; for (const m of MODULES) if (await allowed(u, m)) out.push(m); return out; };

beforeEach(async () => {
  st = new MemoryStore();
  await st.grant(T, "own", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId;
  const mk = async (username: string, role: string, extra: object = {}) => (U[username] = (await ok(call("own", "staff.create", { name: username, username, password: "motdepasse1", role, shopIds: [A], ...extra }, ""))).userId);
  await mk("gerant", "manager"); await mk("caissier", "cashier"); await mk("magasinier", "stockkeeper"); await mk("comptable", "accountant");
  await mk("caissier.stock", "cashier", { access: ["pos", "customers", "stock"] });
});

describe("matrice rôle × module", () => {
  it("chaque rôle accède exactement aux modules de son préréglage, et à rien d'autre", async () => {
    for (const [username, role] of [["gerant", "manager"], ["caissier", "cashier"], ["magasinier", "stockkeeper"], ["comptable", "accountant"]] as const)
      expect(await modulesOf(U[username]!), username).toEqual(ROLE_PRESETS[role].modules);
  });
  it("le propriétaire (gérant principal) accède à tout, sans fiche employé", async () => {
    expect(await modulesOf("own")).toEqual([...MODULES]);
    expect(st.rows("staff").some((s) => s.userId === "own")).toBe(false);
  });
  it("accès personnalisés : exactement les modules accordés", async () => {
    expect(await modulesOf(U["caissier.stock"]!)).toEqual(["pos", "customers", "stock"]);
  });
  it("le message de refus nomme le module manquant", async () => {
    const r: any = await PROBES.stock(U["caissier"]!);
    expect(r.status).toBe(403); expect(r.body.error).toBe("Accès « Stock » non attribué à votre compte");
  });
});

describe("droits propres au gérant et au propriétaire", () => {
  it("remises et plafond de crédit : réservés au rôle gérant, même avec les modules (un caissier aux accès élargis ne peut pas)", async () => {
    const p = await ok(call("own", "entity.save", { table: "products", data: { name: "Riz", price: 1000 } }));
    await ok(call("own", "stock.adjust", { productId: p.id, counted: 10 }));
    const sale = (u: string, id: string) => call(u, "checkout", { clientId: id, lines: [{ productId: p.id, qty: 1, discountPct: 10 }], payments: [{ method: "cash", amount: 1000 }] });
    expect((await sale(U["caissier.stock"]!, "sale-disc-0001")).status).toBe(403);
    expect((await sale(U["gerant"]!, "sale-disc-0002")).status).toBe(200);
    expect((await call(U["caissier"]!, "entity.save", { table: "customers", data: { name: "X", creditLimit: 99999 } })).status).toBe(403);
    expect((await call(U["gerant"]!, "entity.save", { table: "customers", data: { name: "X", creditLimit: 99999 } })).status).toBe(200);
  });
  it("équipe, boutiques, abonnement et réglages de paiement : propriétaire seulement, même pour un gérant", async () => {
    const g = U["gerant"]!;
    expect((await call(g, "staff.create", { name: "Z", username: "zed.zed", password: "motdepasse1", role: "cashier", shopIds: [A] }, "")).status).toBe(403);
    expect((await call(g, "staff.update", { userId: U["caissier"], role: "manager" }, "")).status).toBe(403);
    expect((await call(g, "shop.create", { name: "Pirate" }, "")).status).toBe(403);
    expect((await call(g, "payments.settings.save", { expiryMinutes: 5 })).status).toBe(403);
    expect((await call(g, "subscription.checkout", { requestId: "request-0001", plan: "starter", period: "day" }, "")).status).toBe(403);
  });
  it("le propriétaire ne figure pas parmi les employés : il ne peut être ni modifié ni désactivé par cette voie", async () => {
    expect((await call("own", "staff.update", { userId: "own", active: false }, "")).status).toBe(404);
  });
});

describe("création et modification des comptes", () => {
  const create = (over: object = {}) => call("own", "staff.create", { name: "Nouveau", username: "nouveau.u", password: "motdepasse1", role: "cashier", shopIds: [A], ...over }, "");
  it("rôle et accès validés", async () => {
    expect((await create({ role: "owner" })).status).toBe(400);
    expect((await create({ role: "superadmin" })).status).toBe(400);
    expect((await create({ access: [] })).status).toBe(400);
    expect((await create({ access: ["stock", "root"] })).status).toBe(400);
    expect((await create({ access: "stock" })).status).toBe(400);
  });
  it("sans accès fournis : préréglage du rôle ; les accès sont enregistrés sur la fiche et le rôle sur l'appartenance", async () => {
    const r = await ok(create({ role: "accountant" }));
    expect(JSON.parse(st.rows("staff").find((s) => s.userId === r.userId)!.access)).toEqual(ROLE_PRESETS.accountant.modules);
    expect(st.members.get(`${T}:${r.userId}`)).toEqual(["accountant"]);
  });
  it("on peut nommer plusieurs gérants, qui ont tous les accès de gestion", async () => {
    const g2 = await ok(create({ role: "manager", username: "gerant.deux" }));
    expect(await modulesOf(g2.userId)).toEqual([...MODULES]);
  });
  it("changer de rôle remet les accès au préréglage du nouveau rôle ; fournir des accès les remplace", async () => {
    const id = U["caissier.stock"]!;
    await ok(call("own", "staff.update", { userId: id, role: "stockkeeper" }, ""));
    expect(await modulesOf(id)).toEqual(ROLE_PRESETS.stockkeeper.modules);
    await ok(call("own", "staff.update", { userId: id, access: ["reports"] }, ""));
    expect(await modulesOf(id)).toEqual(["reports"]);
  });
  it("les accès personnalisés survivent à un changement de boutiques ou à une désactivation/réactivation", async () => {
    const id = U["caissier.stock"]!;
    await ok(call("own", "staff.update", { userId: id, shopIds: [A, B] }, ""));
    expect(await modulesOf(id)).toEqual(["pos", "customers", "stock"]);
    await ok(call("own", "staff.update", { userId: id, active: false }, "")); expect(await modulesOf(id)).toEqual([]);
    await ok(call("own", "staff.update", { userId: id, active: true }, "")); expect(await modulesOf(id)).toEqual(["pos", "customers", "stock"]);
  });
  it("un accès retiré prend effet immédiatement", async () => {
    const id = U["gerant"]!; expect(await allowed(id, "accounting")).toBe(true);
    await ok(call("own", "staff.update", { userId: id, access: ["pos", "customers", "stock", "purchases", "invoices", "reports"] }, ""));
    expect(await allowed(id, "accounting")).toBe(false); expect(await allowed(id, "stock")).toBe(true);
  });
  it("un compte désactivé n'a plus aucun accès", async () => {
    await ok(call("own", "staff.update", { userId: U["gerant"], active: false }, ""));
    expect(await modulesOf(U["gerant"]!)).toEqual([]);
  });
});

describe("droits de lecture par module", () => {
  const seeAll = (u: string, table: string) => st.readableBy(u, table).length;
  beforeEach(async () => {
    const p = await ok(call("own", "entity.save", { table: "products", data: { name: "Riz", price: 1000, cost: 600 } }));
    await ok(call("own", "stock.adjust", { productId: p.id, counted: 20 }));
    const s = await ok(call("own", "entity.save", { table: "suppliers", data: { name: "Grossiste" } }));
    await ok(call("own", "po.create", { clientId: "po-client-0001", supplierId: s.id, lines: [{ productId: p.id, qty: 2, unitCost: 500 }] }));
    const c = await ok(call("own", "entity.save", { table: "customers", data: { name: "Awa" } }));
    await ok(call("own", "invoice.customer.create", { invoiceId: "inv-free-0001", customerId: c.id, lines: [{ description: "Conseil", qty: 1, unitPrice: 1000 }] }));
    await ok(call("own", "stock.transfer", { transferId: "transfer-0001", toShopId: B, lines: [{ productId: p.id, qty: 1 }] }));
  });
  it("tous les employés lisent produits, stock et clients de leur boutique", () => {
    for (const u of ["gerant", "caissier", "magasinier", "comptable"]) for (const t of ["products", "stock_moves", "customers"]) expect(seeAll(U[u]!, t), `${u} ${t}`).toBeGreaterThan(0);
  });
  it("fournisseurs et commandes : modules Achats seulement", () => {
    for (const t of ["suppliers", "purchase_orders"]) { expect(seeAll(U["gerant"]!, t)).toBeGreaterThan(0); expect(seeAll(U["magasinier"]!, t)).toBeGreaterThan(0); expect(seeAll(U["caissier"]!, t)).toBe(0); expect(seeAll(U["comptable"]!, t)).toBe(0); }
  });
  it("factures : Factures ou Comptabilité ; journal : Comptabilité seulement", () => {
    expect(seeAll(U["comptable"]!, "invoices")).toBeGreaterThan(0); expect(seeAll(U["gerant"]!, "invoices")).toBeGreaterThan(0);
    expect(seeAll(U["magasinier"]!, "invoices")).toBe(0); expect(seeAll(U["caissier"]!, "invoices")).toBe(0);
    expect(seeAll(U["comptable"]!, "journal_entries")).toBeGreaterThan(0); expect(seeAll(U["gerant"]!, "journal_entries")).toBeGreaterThan(0);
    expect(seeAll(U["magasinier"]!, "journal_entries")).toBe(0); expect(seeAll(U["caissier"]!, "journal_entries")).toBe(0);
  });
  it("transferts : module Stock ; journal d'audit : gérants", () => {
    expect(seeAll(U["magasinier"]!, "transfers")).toBeGreaterThan(0); expect(seeAll(U["gerant"]!, "transfers")).toBeGreaterThan(0); expect(seeAll(U["caissier.stock"]!, "transfers")).toBeGreaterThan(0);
    expect(seeAll(U["caissier"]!, "transfers")).toBe(0); expect(seeAll(U["comptable"]!, "transfers")).toBe(0);
    expect(seeAll(U["gerant"]!, "audit_log")).toBeGreaterThan(0); for (const u of ["caissier", "magasinier", "comptable"]) expect(seeAll(U[u]!, "audit_log")).toBe(0);
  });
  it("un accès accordé ou retiré change aussitôt ce que le compte peut lire", async () => {
    const id = U["caissier"]!; expect(seeAll(id, "suppliers")).toBe(0);
    await ok(call("own", "staff.update", { userId: id, access: ["pos", "customers", "purchases"] }, ""));
    expect(seeAll(id, "suppliers")).toBeGreaterThan(0); expect(seeAll(id, "journal_entries")).toBe(0);
    await ok(call("own", "staff.update", { userId: id, access: ["pos"] }, ""));
    expect(seeAll(id, "suppliers")).toBe(0);
  });
  it("le propriétaire lit tout", () => { for (const t of ["products", "suppliers", "purchase_orders", "invoices", "journal_entries", "transfers", "audit_log"]) expect(seeAll("own", t), t).toBeGreaterThan(0); });
});
