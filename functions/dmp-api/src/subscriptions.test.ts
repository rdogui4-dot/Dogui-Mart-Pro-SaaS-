import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";

const T = "t1", S = "s1";
let st: MemoryStore;
const env = { admins: ["root"] };
const call = (user: string, action: string, payload: unknown = {}, tenant = T, shop = S) => handle(st, user, { action, tenantId: tenant, shopId: shop, payload }, env);
const plat = (action: string, payload: unknown = {}, user = "root") => handle(st, user, { action, payload }, env);
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const setSub = (tenantId: string, plan: string, period: string, renewsAt: string, status = "paid") => {
  if (!st.tables.has("subscriptions")) st.tables.set("subscriptions", new Map());
  st.tables.get("subscriptions")!.set(tenantId, { $id: tenantId, tenantId, plan, period, status, renewsAt });
};
const TPL = { waveTemplate: "https://pay.example.com/w?amount={amount}&ref={ref}", orangeTemplate: "https://pay.example.com/o?amount={amount}&ref={ref}" };

beforeEach(async () => {
  st = new MemoryStore();
  await st.addShop(T, S, "Chez Awa"); await st.addShop("t2", "s2", "Chez Bob");
  await st.grant(T, "own", ["owner"], []); await st.grant(T, "mgr", ["manager"], [S]); await st.grant("t2", "own2", ["owner"], []); await st.grant("t2", "x", ["owner"], []);
  await st.grant(T, "root", ["owner"], []); // l'administrateur de la plateforme possède aussi un commerce
  await st.create("products", "p1", T, { tenantId: T, shopId: S, name: "Riz", price: 1000 });
});

describe("essai gratuit", () => {
  it("démarre à tenant.init, 14 jours, formule Business ; ensuite l'état est lisible", async () => {
    await ok(call("own", "tenant.init", { name: "X" }, T, ""));
    const d = await ok(call("own", "subscription.get"));
    expect(d.entitlement).toMatchObject({ state: "active", trial: true, daysLeft: 14 });
    expect(d.entitlement.plan.id).toBe("business");
    expect(d.usage).toMatchObject({ shops: 1, users: 2, products: 1 }); // une boutique, propriétaire + gérant, un produit
    expect(d.plans).toHaveLength(3);
  });
  it("l'essai expiré verrouille les écritures mais pas la lecture ni le paiement", async () => {
    await ok(call("own", "subscription.get"));
    setSub(T, "business", "day", days(-1), "trial");
    expect((await call("mgr", "entity.save", { table: "products", data: { name: "N", price: 1 } })).status).toBe(402);
    expect((await call("own", "payments.settings.get")).status).toBe(200);
    expect((await call("own", "subscription.get")).status).toBe(200);
  });
});

describe("verrou et délai de grâce", () => {
  const write = () => call("mgr", "entity.save", { table: "customers", data: { name: "C" } });
  it("mensuel : encore permis pendant la grâce, bloqué ensuite", async () => {
    setSub(T, "business", "month", days(-2)); expect((await write()).status).toBe(200);
    setSub(T, "business", "month", days(-4)); expect((await write()).status).toBe(402);
  });
  it("jour : aucune grâce", async () => {
    setSub(T, "starter", "day", new Date(Date.now() - 60_000).toISOString()); expect((await write()).status).toBe(402);
  });
  it("le message demande de renouveler", async () => {
    setSub(T, "business", "month", days(-10));
    expect(((await write()).body as any).error).toMatch(/Abonnement expiré/);
  });
});

describe("quotas de la formule", () => {
  it("boutiques", async () => {
    setSub(T, "starter", "month", days(20));
    const r: any = await call("own", "shop.create", { name: "Deuxième" }, T, "");
    expect(r.status).toBe(402); expect(r.body.error).toMatch(/Starter.*1 boutiques/);
    setSub(T, "business", "month", days(20));
    expect((await call("own", "shop.create", { name: "Deuxième" }, T, "")).status).toBe(200);
  });
  it("utilisateurs (le propriétaire compte) ; un compte désactivé libère une place", async () => {
    setSub(T, "starter", "month", days(20)); // 2 utilisateurs : propriétaire + gérant déjà présents
    const body = { name: "Awa", username: "awa.n", password: "motdepasse1", role: "cashier", shopIds: [S] };
    expect((await call("own", "staff.create", body, T, "")).status).toBe(402);
    await ok(call("own", "staff.update", { userId: "mgr", active: false }, T, ""));
    expect((await call("own", "staff.create", body, T, "")).status).toBe(200);
  });
  it("produits, avec plafond modifiable par la plateforme ; illimité sur Pro", async () => {
    await ok(plat("platform.settings.save", { plans: [{ id: "starter", limits: { maxProducts: 2 } }] }));
    setSub(T, "starter", "month", days(20));
    expect((await call("mgr", "entity.save", { table: "products", data: { name: "B", price: 1 } })).status).toBe(200);
    expect((await call("mgr", "entity.save", { table: "products", data: { name: "C", price: 1 } })).status).toBe(402);
    expect((await call("mgr", "entity.save", { table: "products", id: "p1", data: { price: 5 } })).status).toBe(200); // modifier reste permis
    setSub(T, "pro", "month", days(20));
    expect((await call("mgr", "entity.save", { table: "products", data: { name: "C", price: 1 } })).status).toBe(200);
  });
  it("les produits archivés ne comptent pas", async () => {
    await ok(plat("platform.settings.save", { plans: [{ id: "starter", limits: { maxProducts: 1 } }] }));
    setSub(T, "starter", "month", days(20));
    expect((await call("mgr", "entity.save", { table: "products", data: { name: "B", price: 1 } })).status).toBe(402);
    await ok(call("mgr", "entity.save", { table: "products", id: "p1", data: { archived: true } }));
    expect((await call("mgr", "entity.save", { table: "products", data: { name: "B", price: 1 } })).status).toBe(200);
  });
});

describe("souscription : lien de paiement et preuve", () => {
  const req = (over: object = {}, user = "own", id = "request-0001") => call(user, "subscription.checkout", { requestId: id, plan: "starter", period: "week", count: 2, provider: "wave", ...over }, T, "");
  it("refuse tant que la plateforme n'a pas configuré ses liens", async () => { expect((await req()).status).toBe(409); });
  it("calcule le prix côté serveur pour chaque période, réservé au propriétaire", async () => {
    await ok(plat("platform.settings.save", TPL));
    const expected = { day: 500, week: 2_500, month: 7_500, quarter: 20_000, year: 70_000 } as const;
    for (const [period, price] of Object.entries(expected)) {
      const r = await ok(req({ period, count: 1 }, "own", `req-${period}-0001`));
      expect(r.amount).toBe(price); expect(r.url).toContain(`amount=${price}`); expect(r.reference).toMatch(/^ABO-/);
    }
    expect((await ok(req({ count: 3 }, "own", "req-count-0003"))).amount).toBe(7_500);
    expect((await req({}, "mgr", "req-mgr-00001")).status).toBe(403);
  });
  it("valide formule, période, quantité, opérateur ; idempotent", async () => {
    await ok(plat("platform.settings.save", { waveTemplate: TPL.waveTemplate }));
    expect((await req({ plan: "gold" })).status).toBe(400);
    expect((await req({ period: "decade" })).status).toBe(400);
    expect((await req({ period: "day", count: 32 })).status).toBe(400);
    expect((await req({ count: 0 })).status).toBe(400);
    expect((await req({ provider: "paypal" })).status).toBe(400);
    expect((await req({ provider: "orange" })).status).toBe(409); // Orange non configuré
    const a = await ok(req()); const b = await ok(req());
    expect(b.duplicate).toBe(true); expect(b.reference).toBe(a.reference); expect(st.rows("subscription_payments")).toHaveLength(1);
  });
  it("un autre commerce ne peut pas réutiliser la demande", async () => {
    await ok(plat("platform.settings.save", TPL)); await ok(req());
    expect((await call("own2", "subscription.checkout", { requestId: "request-0001", plan: "starter", period: "week", count: 2, provider: "wave" }, "t2", "")).status).toBe(409);
  });
  it("preuve de paiement : ID requis, unique sur toute la plateforme", async () => {
    await ok(plat("platform.settings.save", TPL));
    const a = await ok(req({}, "own", "request-0001"));
    const b = await ok(call("own2", "subscription.checkout", { requestId: "request-0002", plan: "starter", period: "day", count: 1, provider: "wave" }, "t2", ""));
    const proof = (user: string, tenant: string, id: string, txRef: string) => call(user, "subscription.submitProof", { paymentId: id, txRef }, tenant, "");
    expect((await proof("own", T, a.id, "ab")).status).toBe(400);
    expect((await proof("mgr", T, a.id, "TX123456")).status).toBe(403);
    expect((await proof("own2", "t2", a.id, "TX123456")).status).toBe(403); // pas sa demande
    expect((await proof("own", T, a.id, "tx123456")).status).toBe(200);
    expect((await proof("own", T, a.id, "TX123456")).status).toBe(200); // même preuve : idempotent
    expect((await proof("own2", "t2", b.id, "TX123456")).status).toBe(409); // réutilisation par un autre commerce
  });
  it("le commerçant ne voit que ses demandes, et le lien seulement tant qu'il faut payer ; les employés n'en voient aucune", async () => {
    await ok(plat("platform.settings.save", TPL));
    const a = await ok(req());
    const own = await ok(call("own", "subscription.get"));
    expect(own.payments).toHaveLength(1); expect(own.payments[0].url).toContain("https://");
    await ok(call("own", "subscription.submitProof", { paymentId: a.id, txRef: "TX123456" }, T, ""));
    expect((await ok(call("own", "subscription.get"))).payments[0].url).toBeUndefined();
    expect((await ok(call("mgr", "subscription.get"))).payments).toEqual([]);
    expect((await ok(call("own2", "subscription.get", {}, "t2", "s2"))).payments).toEqual([]);
    expect(JSON.stringify(own)).not.toContain("pay.example.com/w?amount={amount}");
  });
});

describe("validation par la plateforme", () => {
  const paid = async (period = "month", count = 1, plan = "business", id = "request-0001", txRef = "TX123456") => {
    await ok(plat("platform.settings.save", TPL));
    const r = await ok(call("own", "subscription.checkout", { requestId: id, plan, period, count, provider: "wave" }, T, ""));
    await ok(call("own", "subscription.submitProof", { paymentId: r.id, txRef }, T, ""));
    return r.id as string;
  };
  const review = (id: string, approve = true, user = "root") => plat("platform.payment.review", { paymentId: id, approve, note: "ok" }, user);
  const endsAt = () => st.tables.get("subscriptions")!.get(T)!.renewsAt as string;

  it("réservé à l'administrateur", async () => {
    const id = await paid();
    expect((await review(id, true, "own")).status).toBe(403);
    expect((await plat("platform.payments.list", {}, "own")).status).toBe(403);
    expect((await plat("platform.settings.save", TPL, "own")).status).toBe(403);
    expect(((await plat("platform.me", {}, "own")).body as any).data.admin).toBe(false);
    expect(((await plat("platform.me")).body as any).data.admin).toBe(true);
    expect((await handle(st, undefined, { action: "platform.me" }, env)).status).toBe(401);
  });
  it("file d'attente : seules les demandes avec preuve apparaissent", async () => {
    await ok(plat("platform.settings.save", TPL));
    await ok(call("own", "subscription.checkout", { requestId: "request-0009", plan: "starter", period: "day", count: 1, provider: "wave" }, T, ""));
    expect((await ok(plat("platform.payments.list"))).payments).toHaveLength(0);
    const id = await paid();
    const l = (await ok(plat("platform.payments.list"))).payments;
    expect(l).toHaveLength(1); expect(l[0]).toMatchObject({ id, tenantName: "Chez Awa", amount: 15_000, txRef: "TX123456" });
  });
  it("refuse d'approuver sans preuve, approuve une fois, active la formule payée", async () => {
    await ok(plat("platform.settings.save", TPL));
    const raw = await ok(call("own", "subscription.checkout", { requestId: "request-0001", plan: "pro", period: "week", count: 1, provider: "wave" }, T, ""));
    expect((await review(raw.id)).status).toBe(409);
    await ok(call("own", "subscription.submitProof", { paymentId: raw.id, txRef: "TX123456" }, T, ""));
    const r = await ok(review(raw.id));
    expect(r.status).toBe("approved");
    const e = (await ok(call("own", "subscription.get"))).entitlement;
    expect(e).toMatchObject({ trial: false, state: "active" }); expect(e.plan.id).toBe("pro"); expect(e.daysLeft).toBe(7);
  });
  it("même formule encore active : la durée s'ajoute à l'échéance ; autre formule : on repart de maintenant", async () => {
    setSub(T, "business", "month", days(10));
    await ok(review(await paid("month", 1, "business", "request-0001", "TX000001")));
    expect(Math.round((new Date(endsAt()).getTime() - Date.now()) / 86_400_000)).toBe(40);
    await ok(review(await paid("week", 1, "pro", "request-0002", "TX000002")));
    expect(Math.round((new Date(endsAt()).getTime() - Date.now()) / 86_400_000)).toBe(7);
    expect(st.tables.get("subscriptions")!.get(T)!.plan).toBe("pro");
  });
  it("approuver deux fois ne prolonge qu'une fois ; une reprise après plantage réapplique les mêmes dates", async () => {
    const id = await paid("month", 1, "business", "request-0001");
    await ok(review(id)); const first = endsAt();
    await ok(review(id)); expect(endsAt()).toBe(first);
    // plantage simulé : paiement validé mais abonnement non mis à jour
    setSub(T, "business", "day", days(-5), "trial");
    await ok(review(id)); expect(endsAt()).toBe(first); expect(st.tables.get("subscriptions")!.get(T)!.status).toBe("paid");
  });
  it("une reprise ne raccourcit jamais un abonnement déjà prolongé par un paiement plus récent", async () => {
    const a = await paid("month", 1, "business", "request-0001", "TX000001"); await ok(review(a));
    const b = await paid("month", 1, "business", "request-0002", "TX000002"); await ok(review(b));
    const longest = endsAt(); await ok(review(a)); expect(endsAt()).toBe(longest);
  });
  it("refus : définitif, avec trace, sans toucher à l'abonnement", async () => {
    const id = await paid(); const before = JSON.stringify(st.tables.get("subscriptions")?.get(T) ?? null);
    await ok(review(id, false));
    expect((await review(id, true)).status).toBe(409);
    expect(JSON.stringify(st.tables.get("subscriptions")?.get(T) ?? null)).toBe(before);
    expect(st.rows("audit_log").some((a) => a.action === "subscription.reject")).toBe(true);
  });
  it("un abonnement verrouillé se débloque après validation", async () => {
    setSub(T, "business", "month", days(-10));
    expect((await call("mgr", "entity.save", { table: "customers", data: { name: "C" } })).status).toBe(402);
    await ok(review(await paid()));
    expect((await call("mgr", "entity.save", { table: "customers", data: { name: "C" } })).status).toBe(200);
  });
});

describe("attribution manuelle & tarifs", () => {
  const grant = (over: object = {}, user = "root") => plat("platform.subscription.grant", { grantId: "grant-00001", tenantId: T, plan: "pro", period: "year", count: 1, note: "espèces", ...over }, user);
  it("attribue, trace, idempotent, vérifie le commerce", async () => {
    expect((await grant({}, "own")).status).toBe(403);
    expect((await grant({ tenantId: "inconnu" })).status).toBe(404);
    expect((await grant({ period: "decade" })).status).toBe(400);
    const a = await ok(grant()); const b = await ok(grant());
    expect(b.duplicate).toBe(true); expect(b.endsAt).toBe(a.endsAt);
    expect(st.rows("subscription_payments")).toHaveLength(1);
    expect(st.rows("subscription_payments")[0]).toMatchObject({ provider: "manual", status: "approved", amount: 0 });
    expect(st.tables.get("subscriptions")!.get(T)).toMatchObject({ plan: "pro", status: "paid" });
  });
  it("tarifs modifiables : validés, appliqués aux nouvelles demandes, modèles jamais renvoyés", async () => {
    await ok(plat("platform.settings.save", TPL));
    expect((await plat("platform.settings.save", { plans: [{ id: "starter", prices: { month: -1 } }] })).status).toBe(400);
    expect((await plat("platform.settings.save", { plans: [{ id: "nope" }] })).status).toBe(400);
    await ok(plat("platform.settings.save", { plans: [{ id: "starter", prices: { month: 9_000 } }] }));
    const r = await ok(call("own", "subscription.checkout", { requestId: "request-0001", plan: "starter", period: "month", count: 1, provider: "wave" }, T, ""));
    expect(r.amount).toBe(9_000);
    const g = await ok(plat("platform.settings.get"));
    expect(g).toMatchObject({ wave: true, orange: true }); expect(JSON.stringify(g)).not.toContain("pay.example.com");
    expect((await plat("platform.settings.save", { waveTemplate: "http://x.com/{amount}" })).status).toBe(500); // http refusé
  });
  it("une surcharge de tarifs corrompue ne bloque jamais le commerce", async () => {
    await st.create("platform_settings", "main", "", { plans: "{pas du json" });
    expect((await call("mgr", "entity.save", { table: "customers", data: { name: "C" } })).status).toBe(200);
  });
});
