import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { stockFor } from "./checkout";

const T = "t1", S = "s1";
let st: MemoryStore;
const call = (user: string, action: string, payload: unknown) => handle(st, user, { action, tenantId: T, shopId: S, payload });
const ok = async (user: string, action: string, payload: unknown) => { const r: any = await call(user, action, payload); expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body.data; };
const balanced = () => { const j = st.rows("journal_entries"); return j.reduce((a, e) => a + e.debit, 0) === j.reduce((a, e) => a + e.credit, 0); };

beforeEach(async () => {
  st = new MemoryStore();
  st.addMember(T, "mgr", ["manager"]); st.addMember(T, "cash", ["cashier"]); st.addMember("t2", "evil", ["owner"]);
  await st.create("suppliers", "sup1", T, { tenantId: T, shopId: S, name: "Grossiste" });
  await st.create("products", "p1", T, { tenantId: T, shopId: S, name: "Riz", price: 1000, cost: 500 });
  await st.create("products", "p2", T, { tenantId: T, shopId: S, name: "Huile", price: 2000, cost: 0 });
  await st.create("stock_moves", "m0", T, { tenantId: T, shopId: S, productId: "p1", qty: 10, kind: "purchase" });
});
const newPo = () => ok("mgr", "po.create", { clientId: "po-client-0001", supplierId: "sup1", lines: [{ productId: "p1", qty: 10, unitCost: 700 }, { productId: "p2", qty: 5, unitCost: 1500 }] });

describe("bon de commande", () => {
  it("réservé aux managers, valide les lignes et est idempotent", async () => {
    expect((await call("cash", "po.create", { clientId: "po-client-0001", supplierId: "sup1", lines: [] })).status).toBe(403);
    expect((await call("mgr", "po.create", { clientId: "po-client-0001", supplierId: "sup1", lines: [{ productId: "p1", qty: 0, unitCost: 1 }] })).status).toBe(400);
    expect((await call("mgr", "po.create", { clientId: "po-client-0001", supplierId: "nope", lines: [{ productId: "p1", qty: 1, unitCost: 1 }] })).status).toBe(404);
    const a = await newPo(); const b = await newPo();
    expect(a.total).toBe(14_500); expect(b.duplicate).toBe(true); expect(st.rows("purchase_orders")).toHaveLength(1);
  });
  it("annulation possible seulement avant réception", async () => {
    await newPo();
    await ok("mgr", "po.receive", { poId: "po-client-0001", receiptId: "rcpt-0001-aaaa", lines: [{ productId: "p1", qty: 1 }] });
    expect((await call("mgr", "po.cancel", { poId: "po-client-0001" })).status).toBe(409);
  });
});

describe("réception", () => {
  it("augmente le stock, calcule le coût moyen pondéré, gère le partiel", async () => {
    await newPo();
    const r1 = await ok("mgr", "po.receive", { poId: "po-client-0001", receiptId: "rcpt-0001-aaaa", lines: [{ productId: "p1", qty: 6 }] });
    expect(r1.status).toBe("partial");
    expect(await stockFor(st, "p1")).toBe(16);
    expect(st.rows("products").find((p) => p.$id === "p1")!.cost).toBe(Math.round((10 * 500 + 6 * 700) / 16));
    await ok("mgr", "po.receive", { poId: "po-client-0001", receiptId: "rcpt-0002-bbbb", lines: [{ productId: "p1", qty: 4 }, { productId: "p2", qty: 5 }] });
    expect(st.rows("purchase_orders")[0]!.status).toBe("received");
    expect(await stockFor(st, "p2")).toBe(5);
  });
  it("refuse de dépasser le restant et un produit hors commande", async () => {
    await newPo();
    expect((await call("mgr", "po.receive", { poId: "po-client-0001", receiptId: "rcpt-0001-aaaa", lines: [{ productId: "p1", qty: 11 }] })).status).toBe(409);
    expect((await call("mgr", "po.receive", { poId: "po-client-0001", receiptId: "rcpt-0001-aaaa", lines: [{ productId: "zz", qty: 1 }] })).status).toBe(409);
    expect(await stockFor(st, "p1")).toBe(10);
  });
  it("rejouer la même réception ne double pas le stock", async () => {
    await newPo();
    const body = { poId: "po-client-0001", receiptId: "rcpt-0001-aaaa", lines: [{ productId: "p1", qty: 5 }] };
    await ok("mgr", "po.receive", body);
    expect((await ok("mgr", "po.receive", body)).duplicate).toBe(true);
    expect(await stockFor(st, "p1")).toBe(15);
  });
  it("reprise après plantage entre la commande et les mouvements : les mouvements sont complétés", async () => {
    await newPo();
    const body = { poId: "po-client-0001", receiptId: "rcpt-0001-aaaa", lines: [{ productId: "p1", qty: 5 }] };
    await ok("mgr", "po.receive", body);
    st.tables.get("stock_moves")!.delete("rcpt-0001-aaaa_m0"); // le plantage a perdu le mouvement
    await ok("mgr", "po.receive", body);
    expect(await stockFor(st, "p1")).toBe(15);
  });
  it("isolation entre commerces", async () => {
    await newPo();
    const r: any = await handle(st, "evil", { action: "po.receive", tenantId: "t2", shopId: S, payload: { poId: "po-client-0001", receiptId: "rcpt-0001-aaaa", lines: [{ productId: "p1", qty: 1 }] } });
    expect(r.status).toBe(403);
  });
});

describe("facture fournisseur & règlement", () => {
  const receiveAll = async () => { await newPo(); await ok("mgr", "po.receive", { poId: "po-client-0001", receiptId: "rcpt-0001-aaaa", lines: [{ productId: "p1", qty: 10 }, { productId: "p2", qty: 5 }] }); };
  it("refuse de facturer ce qui n'est pas reçu", async () => {
    await newPo();
    expect((await call("mgr", "invoice.supplier.create", { poId: "po-client-0001", invoiceId: "inv-0000-0001" })).status).toBe(409);
  });
  it("facture les quantités reçues, TVA incluse, écritures équilibrées, sans double facturation", async () => {
    await receiveAll();
    const inv = await ok("mgr", "invoice.supplier.create", { poId: "po-client-0001", invoiceId: "inv-0000-0001", supplierRef: "F-889" });
    expect(inv.total).toBe(Math.round(14_500 * 1.18)); expect(balanced()).toBe(true);
    expect((await call("mgr", "invoice.supplier.create", { poId: "po-client-0001", invoiceId: "inv-0000-0002" })).status).toBe(409);
    const again = await ok("mgr", "invoice.supplier.create", { poId: "po-client-0001", invoiceId: "inv-0000-0001" });
    expect(again.duplicate).toBe(true); expect(st.rows("invoices")).toHaveLength(1);
    expect(st.rows("journal_entries").filter((e) => e.account === "401")).toHaveLength(1);
  });
  it("règlement partiel puis solde, plafonné, idempotent, écritures équilibrées", async () => {
    await receiveAll();
    const inv = await ok("mgr", "invoice.supplier.create", { poId: "po-client-0001", invoiceId: "inv-0000-0001" });
    const pay = (id: string, amount: number) => call("mgr", "invoice.supplier.pay", { invoiceId: "inv-0000-0001", paymentId: id, amount, method: "cash" });
    expect(((await pay("pay-0001-aaaa", 5000)).body as any).data).toMatchObject({ paid: 5000, status: "partial" });
    expect(((await pay("pay-0001-aaaa", 5000)).body as any).data.duplicate).toBe(true);
    expect(st.rows("invoices")[0]!.paid).toBe(5000);
    expect(((await pay("pay-0002-bbbb", 999_999)).body as any).data).toMatchObject({ paid: inv.total, due: 0, status: "paid" });
    expect((await pay("pay-0003-cccc", 100)).status).toBe(409);
    expect(balanced()).toBe(true);
    expect((await call("cash", "invoice.supplier.pay", { invoiceId: "inv-0000-0001", paymentId: "pay-0009-zzzz", amount: 1, method: "cash" })).status).toBe(403);
  });
  it("facturation partielle en deux temps", async () => {
    await newPo();
    await ok("mgr", "po.receive", { poId: "po-client-0001", receiptId: "rcpt-0001-aaaa", lines: [{ productId: "p1", qty: 4 }] });
    const a = await ok("mgr", "invoice.supplier.create", { poId: "po-client-0001", invoiceId: "inv-0000-0001" });
    expect(a.total).toBe(Math.round(4 * 700 * 1.18));
    await ok("mgr", "po.receive", { poId: "po-client-0001", receiptId: "rcpt-0002-bbbb", lines: [{ productId: "p1", qty: 6 }, { productId: "p2", qty: 5 }] });
    const b = await ok("mgr", "invoice.supplier.create", { poId: "po-client-0001", invoiceId: "inv-0000-0002" });
    expect(b.total).toBe(Math.round((6 * 700 + 5 * 1500) * 1.18));
  });
});
