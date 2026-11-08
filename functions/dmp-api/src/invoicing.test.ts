import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";

const T = "t1", S = "s1";
let st: MemoryStore;
const call = (user: string, action: string, payload: unknown) => handle(st, user, { action, tenantId: T, shopId: S, payload });
const ok = async (user: string, action: string, payload: unknown) => { const r: any = await call(user, action, payload); expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body.data; };
const balanced = () => { const j = st.rows("journal_entries"); return j.reduce((a, e) => a + e.debit, 0) === j.reduce((a, e) => a + e.credit, 0); };

beforeEach(async () => {
  st = new MemoryStore();
  st.addMember(T, "own", ["owner"]); st.addMember(T, "mgr", ["manager"]); st.addMember(T, "cash", ["cashier"]); st.addMember("t2", "evil", ["owner"]);
  await st.create("customers", "c1", T, { tenantId: T, shopId: S, name: "Awa", creditLimit: 50_000, creditBalance: 0, points: 0, annualSpend: 0 });
  await st.create("products", "p1", T, { tenantId: T, shopId: S, name: "Riz", price: 1000 });
  await st.create("stock_moves", "m0", T, { tenantId: T, shopId: S, productId: "p1", qty: 50, kind: "purchase" });
});
const sell = (payments: unknown[], extra: object = {}, id = "sale-client-0001") =>
  ok("cash", "checkout", { clientId: id, lines: [{ productId: "p1", qty: 5 }], payments, ...extra });

describe("fiche boutique", () => {
  it("réservée au propriétaire, TVA bornée, mise à jour partielle", async () => {
    expect((await call("mgr", "shop.save", { name: "X" })).status).toBe(403);
    expect((await call("own", "shop.save", { vatRatePct: 80 })).status).toBe(400);
    await ok("own", "shop.save", { name: "Chez Awa", vatRatePct: 10 });
    await ok("own", "shop.save", { phone: "770000000" });
    expect(st.rows("shops")[0]).toMatchObject({ name: "Chez Awa", vatRatePct: 10, phone: "770000000" });
  });
});

describe("facture depuis une vente", () => {
  it("document sans nouvelle écriture comptable, paiements plafonnés au total, unique par vente", async () => {
    await sell([{ method: "cash", amount: 8000 }]);
    const before = st.rows("journal_entries").length;
    const r = await ok("mgr", "invoice.customer.fromSale", { saleId: "sale-client-0001" });
    const inv = st.rows("invoices")[0]!;
    expect(inv).toMatchObject({ kind: "customer", total: 5000, paid: 5000, status: "paid", saleId: "sale-client-0001" });
    expect(JSON.parse(inv.payments)[0].amount).toBe(5000);
    expect(st.rows("journal_entries")).toHaveLength(before);
    expect((await ok("mgr", "invoice.customer.fromSale", { saleId: "sale-client-0001" })).duplicate).toBe(true);
    expect(r.number).toMatch(/^FC-/); expect(st.rows("invoices")).toHaveLength(1);
  });
  it("refuse un caissier et une vente d'un autre commerce", async () => {
    await sell([{ method: "cash", amount: 5000 }]);
    expect((await call("cash", "invoice.customer.fromSale", { saleId: "sale-client-0001" })).status).toBe(403);
    const r: any = await handle(st, "evil", { action: "invoice.customer.fromSale", tenantId: "t2", shopId: S, payload: { saleId: "sale-client-0001" } });
    expect(r.status).toBe(403);
  });
  it("vente à crédit : le règlement de la facture fait baisser le crédit du client, plafonné", async () => {
    await sell([{ method: "cash", amount: 2000 }, { method: "credit", amount: 3000 }], { customerId: "c1" });
    expect(st.rows("customers")[0]!.creditBalance).toBe(3000);
    await ok("mgr", "invoice.customer.fromSale", { saleId: "sale-client-0001" });
    expect(st.rows("invoices")[0]).toMatchObject({ paid: 2000, status: "partial" });
    const pay = (id: string, amount: number) => call("mgr", "invoice.customer.pay", { invoiceId: "ivsale-client-0001", paymentId: id, amount, method: "wave" });
    expect(((await pay("pay-0001-aaaa", 1000)).body as any).data).toMatchObject({ paid: 3000, due: 2000 });
    expect(((await pay("pay-0001-aaaa", 1000)).body as any).data.duplicate).toBe(true);
    expect(st.rows("customers")[0]!.creditBalance).toBe(2000);
    expect(((await pay("pay-0002-bbbb", 99_999)).body as any).data).toMatchObject({ status: "paid", due: 0 });
    expect(st.rows("customers")[0]!.creditBalance).toBe(0);
    expect((await pay("pay-0003-cccc", 10)).status).toBe(409);
    expect(balanced()).toBe(true);
  });
  it("si le client a déjà remboursé son crédit ailleurs, on n'encaisse pas deux fois", async () => {
    await sell([{ method: "credit", amount: 5000 }], { customerId: "c1" });
    await ok("mgr", "invoice.customer.fromSale", { saleId: "sale-client-0001" });
    await ok("mgr", "credit.repay", { customerId: "c1", amount: 5000, method: "cash" });
    const r: any = await call("mgr", "invoice.customer.pay", { invoiceId: "ivsale-client-0001", paymentId: "pay-0001-aaaa", amount: 5000, method: "cash" });
    expect(r.status).toBe(409);
  });
});

describe("facture libre", () => {
  const body = { invoiceId: "free-inv-0001", customerId: "c1", lines: [{ description: "Conseil", qty: 2, unitPrice: 5000 }] };
  it("calcule la TVA, passe 411 / 701 / 4431 et est idempotente", async () => {
    const r = await ok("mgr", "invoice.customer.create", body);
    expect(r.total).toBe(11_800);
    expect(st.rows("invoices")[0]).toMatchObject({ vat: 1800, status: "unpaid", saleId: "" });
    expect(st.rows("journal_entries").find((e) => e.account === "411")!.debit).toBe(11_800);
    expect(balanced()).toBe(true);
    expect((await ok("mgr", "invoice.customer.create", body)).duplicate).toBe(true);
    expect(st.rows("invoices")).toHaveLength(1); expect(st.rows("journal_entries").filter((e) => e.account === "411")).toHaveLength(1);
  });
  it("validations", async () => {
    expect((await call("mgr", "invoice.customer.create", { ...body, lines: [] })).status).toBe(400);
    expect((await call("mgr", "invoice.customer.create", { ...body, lines: [{ description: "", qty: 1, unitPrice: 1 }] })).status).toBe(400);
    expect((await call("mgr", "invoice.customer.create", { ...body, lines: [{ description: "x", qty: 1.5, unitPrice: 1 }] })).status).toBe(400);
    expect((await call("mgr", "invoice.customer.create", { ...body, customerId: "nope" })).status).toBe(404);
    expect((await call("cash", "invoice.customer.create", body)).status).toBe(403);
  });
  it("encaissement partiel puis solde, sans toucher au crédit client", async () => {
    await ok("mgr", "invoice.customer.create", body);
    const pay = (id: string, amount: number) => call("mgr", "invoice.customer.pay", { invoiceId: "free-inv-0001", paymentId: id, amount, method: "cash" });
    expect(((await pay("pay-0001-aaaa", 4000)).body as any).data).toMatchObject({ paid: 4000, status: "partial" });
    expect(((await pay("pay-0002-bbbb", 999_999)).body as any).data).toMatchObject({ paid: 11_800, status: "paid" });
    expect(st.rows("customers")[0]!.creditBalance).toBe(0);
    expect(balanced()).toBe(true);
  });
});
