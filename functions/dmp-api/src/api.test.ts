import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";

const T = "tenant1", S = "shop1";
let st: MemoryStore;
const call = (user: string | undefined, action: string, payload: unknown, tenant = T) => handle(st, user, { action, tenantId: tenant, shopId: S, payload });
const seed = async () => {
  st = new MemoryStore();
  await st.addShop(T, S); await st.grant(T, "owner1", ["owner"], []); await st.grant(T, "cash1", ["cashier"], [S]); await st.grant("other", "evil", ["owner"], []);
  await st.create("products", "p1", T, { tenantId: T, shopId: S, name: "Riz", price: 1000, minStock: 1 });
  await st.create("stock_moves", "m0", T, { tenantId: T, shopId: S, productId: "p1", qty: 10, kind: "purchase" });
  await st.create("customers", "c1", T, { tenantId: T, shopId: S, name: "Awa", creditLimit: 5000, creditBalance: 0, points: 0, annualSpend: 0 });
};
beforeEach(seed);

describe("authentification & isolation", () => {
  it("refuse sans utilisateur et hors tenant", async () => {
    expect((await call(undefined, "checkout", {})).status).toBe(401);
    expect((await call("evil", "checkout", {})).status).toBe(403);
    expect((await call("cash1", "nimporte", {})).status).toBe(400);
  });
  it("un caissier ne peut pas créer de produit ni changer un plafond de crédit", async () => {
    expect((await call("cash1", "entity.save", { table: "products", data: { name: "X", price: 1 } })).status).toBe(403);
    expect((await call("cash1", "entity.save", { table: "customers", id: "c1", data: { creditLimit: 99999 } })).status).toBe(403);
  });
  it("les champs serveur (points, crédit) ne sont pas modifiables par le client", async () => {
    const r: any = await call("owner1", "entity.save", { table: "customers", id: "c1", data: { name: "Awa B", points: 9999, creditBalance: -5 } });
    expect(r.status).toBe(200);
    expect(st.rows("customers")[0]).toMatchObject({ name: "Awa B", points: 0, creditBalance: 0 });
  });
});

describe("checkout", () => {
  const sale = (extra: object = {}) => ({ clientId: "client-uuid-0001", lines: [{ productId: "p1", qty: 2 }], payments: [{ method: "cash", amount: 5000 }], ...extra });
  it("utilise le prix de la base, décrémente le stock, écrit la compta équilibrée", async () => {
    const r: any = await call("cash1", "checkout", sale({ lines: [{ productId: "p1", qty: 2, price: 1 }] }));
    expect(r.body.data).toMatchObject({ total: 2000, change: 3000 });
    const j = st.rows("journal_entries");
    expect(j.reduce((a, e) => a + e.debit, 0)).toBe(j.reduce((a, e) => a + e.credit, 0));
    expect(st.rows("stock_moves").filter((m) => m.kind === "sale")).toHaveLength(1);
  });
  it("est idempotent", async () => {
    await call("cash1", "checkout", sale());
    const r: any = await call("cash1", "checkout", sale());
    expect(r.body.data.duplicate).toBe(true);
    expect(st.rows("sales")).toHaveLength(1);
    expect(st.rows("stock_moves").filter((m) => m.kind === "sale")).toHaveLength(1);
  });
  it("refuse un stock insuffisant et une remise de caissier", async () => {
    expect((await call("cash1", "checkout", sale({ lines: [{ productId: "p1", qty: 50 }], payments: [{ method: "cash", amount: 99999 }] }))).status).toBe(409);
    expect((await call("cash1", "checkout", sale({ lines: [{ productId: "p1", qty: 1, discountPct: 50 }] }))).status).toBe(403);
  });
  it("applique le crédit client, le plafond et les points", async () => {
    const ok: any = await call("cash1", "checkout", sale({ customerId: "c1", payments: [{ method: "credit", amount: 2000 }] }));
    expect(ok.status).toBe(200);
    expect(st.rows("customers")[0]).toMatchObject({ creditBalance: 2000, annualSpend: 2000, points: 20 });
    const over: any = await call("cash1", "checkout", sale({ clientId: "client-uuid-0002", customerId: "c1", lines: [{ productId: "p1", qty: 4 }], payments: [{ method: "credit", amount: 4000 }] }));
    expect(over.status).toBe(409);
  });
  it("refuse un produit d'un autre commerce", async () => {
    await st.create("products", "px", "other", { tenantId: "other", shopId: S, name: "Z", price: 1 });
    expect((await call("cash1", "checkout", sale({ lines: [{ productId: "px", qty: 1 }] }))).status).toBe(404);
  });
});

describe("paiement par lien / QR", () => {
  const cfg = () => call("owner1", "payments.settings.save", { waveTemplate: "https://pay.example.com/m/X?amount={amount}&ref={ref}", expiryMinutes: 10 });
  it("seul le propriétaire configure, et le modèle est validé", async () => {
    expect((await call("cash1", "payments.settings.save", { waveTemplate: "https://a.com/{amount}" })).status).toBe(403);
    expect((await call("owner1", "payments.settings.save", { waveTemplate: "http://a.com/{amount}" })).status).toBe(500);
  });
  it("lien -> confirmation -> vente ; réutilisation et mauvais montant refusés", async () => {
    await cfg();
    const link: any = (await call("cash1", "payment_link.create", { provider: "wave", amount: 2000 })).body;
    expect(link.data.url).toContain("amount=2000");
    const pay = (amount = 2000, id = "client-uuid-0003") => call("cash1", "checkout", { clientId: id, lines: [{ productId: "p1", qty: 2 }], payments: [{ method: "wave", amount, linkId: link.data.id }] });
    expect((await pay()).status).toBe(402); // non confirmé
    expect((await call("cash1", "payment_link.confirm", { linkId: link.data.id, txRef: "abc" })).status).toBe(400);
    expect((await call("cash1", "payment_link.confirm", { linkId: link.data.id, txRef: "TX123456" })).status).toBe(200);
    expect((await pay(1500)).status).toBe(400);
    expect((await pay()).status).toBe(200);
    expect((await pay(2000, "client-uuid-0004")).status).toBe(409); // lien déjà utilisé
    expect(st.rows("journal_entries").some((e) => e.account === "5722" && e.debit === 2000)).toBe(true);
  });
  it("un même ID de transaction ne sert qu'une fois", async () => {
    await cfg();
    const mk = async () => ((await call("cash1", "payment_link.create", { provider: "wave", amount: 1000 })).body as any).data.id;
    const a = await mk(), b = await mk();
    expect((await call("cash1", "payment_link.confirm", { linkId: a, txRef: "TX999999" })).status).toBe(200);
    expect((await call("cash1", "payment_link.confirm", { linkId: b, txRef: "tx999999" })).status).toBe(409);
  });
  it("lien expiré et opérateur non configuré", async () => {
    await cfg();
    expect((await call("cash1", "payment_link.create", { provider: "orange", amount: 1000 })).status).toBe(409);
    const id = ((await call("cash1", "payment_link.create", { provider: "wave", amount: 1000 })).body as any).data.id;
    await st.update("payment_links", id, { expiresAt: "2020-01-01T00:00:00Z" });
    expect((await call("cash1", "payment_link.confirm", { linkId: id, txRef: "TX555555" })).status).toBe(410);
  });
});

describe("crédit & inventaire", () => {
  it("remboursement plafonné au solde ; inventaire par écart", async () => {
    await st.update("customers", "c1", { creditBalance: 3000 });
    const r: any = await call("cash1", "credit.repay", { customerId: "c1", amount: 9000, method: "cash" });
    expect(r.body.data).toMatchObject({ repaid: 3000, balance: 0 });
    expect((await call("cash1", "stock.adjust", { productId: "p1", counted: 4 })).status).toBe(403);
    expect(((await call("owner1", "stock.adjust", { productId: "p1", counted: 4 })).body as any).data.diff).toBe(-6);
  });
});

describe("réglages de paiement", () => {
  it("un champ absent conserve la valeur existante", async () => {
    await call("owner1", "payments.settings.save", { waveTemplate: "https://a.com/?x={amount}" });
    await call("owner1", "payments.settings.save", { orangeTemplate: "https://b.com/?x={amount}", expiryMinutes: 30 });
    expect(st.rows("payment_settings")[0]).toMatchObject({ waveTemplate: "https://a.com/?x={amount}", orangeTemplate: "https://b.com/?x={amount}", expiryMinutes: 30 });
  });
});
