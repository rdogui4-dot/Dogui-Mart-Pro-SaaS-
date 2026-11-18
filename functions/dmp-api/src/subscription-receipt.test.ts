import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";

const T = "t1", S = "s1";
let st: MemoryStore;
const env = { admins: ["root"] };
const call = (user: string, action: string, payload: unknown = {}, tenant = T, shop = S) => handle(st, user, { action, tenantId: tenant, shopId: shop, payload }, env);
const plat = (action: string, payload: unknown = {}) => handle(st, "root", { action, payload }, env);
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };

beforeEach(async () => {
  st = new MemoryStore();
  await st.addShop(T, S, "Chez Awa"); await st.addShop("t2", "s2", "Chez Bob");
  await st.grant(T, "own", ["owner"], []); await st.grant(T, "mgr", ["manager"], [S]); await st.grant("t2", "own2", ["owner"], []);
  await ok(plat("platform.settings.save", { selarLinks: { starter: "https://selar.com/98c371k399" } }));
});

describe("reçu de paiement d'abonnement", () => {
  it("disponible seulement pour un paiement Selar validé, au propriétaire du commerce, avec les données réelles", async () => {
    await ok(call("own", "shop.save", { name: "Chez Awa", companyName: "Awa SARL", legal: "NINEA 123", address: "Rue 10", city: "Dakar", phone: "771234567" }));
    const a = await ok(call("own", "subscription.checkout", { requestId: "request-r001", plan: "starter", period: "month" }, T, ""));
    expect((await call("own", "subscription.receipt", { paymentId: a.id }, T, "")).status).toBe(409); // à payer
    await ok(call("own", "subscription.submitProof", { paymentId: a.id, txRef: "SEL-778899", payerEmail: "awa@exemple.sn" }, T, ""));
    expect((await call("own", "subscription.receipt", { paymentId: a.id }, T, "")).status).toBe(409); // en attente
    await ok(plat("platform.payment.review", { paymentId: a.id, approve: true }));
    const r = await ok(call("own", "subscription.receipt", { paymentId: a.id }, T, ""));
    expect(r).toMatchObject({ reference: a.reference, txRef: "SEL-778899", payerEmail: "awa@exemple.sn", plan: "starter", planName: "Starter", period: "month", count: 1, amount: 7_500 });
    expect(r.customer).toMatchObject({ name: "Chez Awa", companyName: "Awa SARL", legal: "NINEA 123", address: "Rue 10, Dakar", phone: "771234567" });
    expect(new Date(r.endsAt).getTime()).toBeGreaterThan(new Date(r.startsAt).getTime());
    expect((await call("mgr", "subscription.receipt", { paymentId: a.id })).status).toBe(403);
    expect((await call("own2", "subscription.receipt", { paymentId: a.id }, "t2", "")).status).toBe(403);
    expect((await call("own", "subscription.receipt", { paymentId: "inconnu" }, T, "")).status).toBe(404);
  });
  it("aucun reçu pour une attribution manuelle ni pour un paiement refusé", async () => {
    await ok(plat("platform.subscription.grant", { grantId: "grant-0001", tenantId: T, plan: "starter", period: "month", count: 1 }));
    expect((await call("own", "subscription.receipt", { paymentId: "grant-0001" }, T, "")).status).toBe(409);
    const a = await ok(call("own", "subscription.checkout", { requestId: "request-r002", plan: "starter", period: "week" }, T, ""));
    await ok(plat("platform.payment.review", { paymentId: a.id, approve: false, note: "introuvable" }));
    expect((await call("own", "subscription.receipt", { paymentId: a.id }, T, "")).status).toBe(409);
  });
  it("reste accessible quand l'abonnement est échu (consultation)", async () => {
    const a = await ok(call("own", "subscription.checkout", { requestId: "request-r003", plan: "starter", period: "day" }, T, ""));
    await ok(call("own", "subscription.submitProof", { paymentId: a.id, txRef: "SEL-000111", payerEmail: "awa@exemple.sn" }, T, ""));
    await ok(plat("platform.payment.review", { paymentId: a.id, approve: true }));
    st.tables.get("subscriptions")!.set(T, { $id: T, tenantId: T, plan: "starter", period: "day", status: "paid", renewsAt: new Date(Date.now() - 30 * 864e5).toISOString() });
    expect((await call("own", "subscription.receipt", { paymentId: a.id }, T, "")).status).toBe(200);
  });
});
