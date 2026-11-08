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
const PLANS = ["starter", "business", "pro"], PERIODS = ["day", "week", "month", "quarter", "year"];
const LINKS: Record<string, string> = Object.fromEntries(PLANS.flatMap((p) => PERIODS.map((k) => [`${p}:${k}`, `https://selar.co/dmp-${p}-${k}`])));
const TPL = { selarLinks: LINKS };

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

describe("souscription : lien Selar et preuve", () => {
  const req = (over: object = {}, user = "own", id = "request-0001") => call(user, "subscription.checkout", { requestId: id, plan: "starter", period: "week", ...over }, T, "");
  it("refuse tant que la plateforme n'a pas configuré le lien de cette formule et période", async () => {
    expect((await req()).status).toBe(409);
    await ok(plat("platform.settings.save", { selarLinks: { "starter:month": "https://selar.co/dmp-starter-month" } }));
    expect((await req({ period: "week" })).status).toBe(409);
    expect((await req({ period: "month" })).status).toBe(200);
  });
  it("renvoie le lien Selar de la formule et période, avec le prix du catalogue, pour chacune des cinq périodes ; réservé au propriétaire", async () => {
    await ok(plat("platform.settings.save", TPL));
    const expected = { day: 500, week: 2_500, month: 7_500, quarter: 20_000, year: 70_000 } as const;
    for (const [period, price] of Object.entries(expected)) {
      const r = await ok(req({ period }, "own", `req-${period}-0001`));
      expect(r.amount).toBe(price); expect(r.url).toBe(`https://selar.co/dmp-starter-${period}`); expect(r.reference).toMatch(/^ABO-/);
    }
    expect((await req({}, "mgr", "req-mgr-00001")).status).toBe(403);
    expect(st.rows("subscription_payments").every((p) => p.provider === "selar" && p.count === 1)).toBe(true);
  });
  it("ignore toute quantité fournie (un lien Selar = une période) et valide formule et période ; idempotent", async () => {
    await ok(plat("platform.settings.save", TPL));
    expect((await ok(req({ count: 5 }, "own", "req-count-0005"))).amount).toBe(2_500);
    expect((await req({ plan: "gold" })).status).toBe(400);
    expect((await req({ period: "decade" })).status).toBe(400);
    const a = await ok(req()); const b = await ok(req());
    expect(b.duplicate).toBe(true); expect(b.reference).toBe(a.reference); expect(st.rows("subscription_payments").filter((p) => p.$id === "request-0001")).toHaveLength(1);
  });
  it("le lien reste celui de la demande même si l'administrateur le change ensuite", async () => {
    await ok(plat("platform.settings.save", TPL));
    const a = await ok(req());
    await ok(plat("platform.settings.save", { selarLinks: { "starter:week": "https://selar.co/nouveau-lien" } }));
    expect((await ok(req())).url).toBe(a.url);
    expect((await ok(req({}, "own", "request-0002"))).url).toBe("https://selar.co/nouveau-lien");
  });
  it("un autre commerce ne peut pas réutiliser la demande", async () => {
    await ok(plat("platform.settings.save", TPL)); await ok(req());
    expect((await call("own2", "subscription.checkout", { requestId: "request-0001", plan: "starter", period: "week" }, "t2", "")).status).toBe(409);
  });
  it("limite le nombre de demandes en attente", async () => {
    await ok(plat("platform.settings.save", TPL));
    for (let i = 0; i < 10; i++) await ok(req({}, "own", `request-spam-${i}`));
    expect((await req({}, "own", "request-spam-99")).status).toBe(429);
  });
  const proofOf = (user: string, tenant: string, id: string, txRef: string, payerEmail = "awa@exemple.sn") => call(user, "subscription.submitProof", { paymentId: id, txRef, payerEmail }, tenant, "");
  it("preuve : référence Selar et e-mail requis ; la référence est unique sur toute la plateforme", async () => {
    await ok(plat("platform.settings.save", TPL));
    const a = await ok(req({}, "own", "request-0001"));
    const b = await ok(call("own2", "subscription.checkout", { requestId: "request-0002", plan: "starter", period: "day" }, "t2", ""));
    expect((await proofOf("own", T, a.id, "ab")).status).toBe(400);
    expect((await proofOf("own", T, a.id, "TX123456", "pas-un-email")).status).toBe(400);
    expect((await proofOf("own", T, a.id, "TX123456", "")).status).toBe(400);
    expect((await proofOf("mgr", T, a.id, "TX123456")).status).toBe(403);
    expect((await proofOf("own2", "t2", a.id, "TX123456")).status).toBe(403);
    expect((await proofOf("own", T, a.id, "tx123456")).status).toBe(200);
    expect((await proofOf("own", T, a.id, "TX123456")).status).toBe(200);
    expect(st.rows("subscription_payments").find((p) => p.$id === a.id)).toMatchObject({ status: "pending_review", txRef: "TX123456", payerEmail: "awa@exemple.sn" });
    expect((await proofOf("own2", "t2", b.id, "TX123456")).status).toBe(409);
  });
  it("le commerçant ne voit que ses demandes ; le lien seulement tant qu'il faut payer ; les employés aucune", async () => {
    await ok(plat("platform.settings.save", TPL));
    const a = await ok(req());
    const own = await ok(call("own", "subscription.get"));
    expect(own.payments).toHaveLength(1); expect(own.payments[0].url).toBe("https://selar.co/dmp-starter-week");
    await ok(proofOf("own", T, a.id, "TX123456"));
    expect((await ok(call("own", "subscription.get"))).payments[0].url).toBeUndefined();
    expect((await ok(call("mgr", "subscription.get"))).payments).toEqual([]);
    expect((await ok(call("own2", "subscription.get", {}, "t2", "s2"))).payments).toEqual([]);
  });
  it("subscription.get n'expose que les couples disponibles, jamais les adresses des liens", async () => {
    await ok(plat("platform.settings.save", { selarLinks: { "pro:year": "https://selar.co/secret-looking-slug" } }));
    const d = await ok(call("mgr", "subscription.get"));
    expect(d.available).toEqual({ "pro:year": true });
    expect(JSON.stringify(d)).not.toContain("secret-looking-slug");
  });
});

describe("validation par la plateforme", () => {
  const paid = async (period = "month", plan = "business", id = "request-0001", txRef = "TX123456") => {
    await ok(plat("platform.settings.save", TPL));
    const r = await ok(call("own", "subscription.checkout", { requestId: id, plan, period }, T, ""));
    await ok(call("own", "subscription.submitProof", { paymentId: r.id, txRef, payerEmail: "awa@exemple.sn" }, T, ""));
    return r.id as string;
  };
  const review = (id: string, approve = true, user = "root") => plat("platform.payment.review", { paymentId: id, approve, note: "ok" }, user);
  const endsAt = () => st.tables.get("subscriptions")!.get(T)!.renewsAt as string;
  const daysLeft = () => Math.round((new Date(endsAt()).getTime() - Date.now()) / 86_400_000);

  it("réservé à l'administrateur", async () => {
    const id = await paid();
    expect((await review(id, true, "own")).status).toBe(403);
    expect((await plat("platform.payments.list", {}, "own")).status).toBe(403);
    expect((await plat("platform.settings.save", TPL, "own")).status).toBe(403);
    expect((await plat("platform.settings.get", {}, "own")).status).toBe(403);
    expect(((await plat("platform.me", {}, "own")).body as any).data.admin).toBe(false);
    expect(((await plat("platform.me")).body as any).data.admin).toBe(true);
    expect((await handle(st, undefined, { action: "platform.me" }, env)).status).toBe(401);
  });
  it("file d'attente : seules les demandes avec preuve apparaissent, avec l'e-mail et le lien à vérifier", async () => {
    await ok(plat("platform.settings.save", TPL));
    await ok(call("own", "subscription.checkout", { requestId: "request-0009", plan: "starter", period: "day" }, T, ""));
    expect((await ok(plat("platform.payments.list"))).payments).toHaveLength(0);
    const id = await paid();
    const l = (await ok(plat("platform.payments.list"))).payments;
    expect(l).toHaveLength(1); expect(l[0]).toMatchObject({ id, tenantName: "Chez Awa", amount: 15_000, txRef: "TX123456", payerEmail: "awa@exemple.sn", provider: "selar", url: "https://selar.co/dmp-business-month" });
  });
  it("refuse d'approuver sans preuve, approuve une fois, active la formule payée", async () => {
    await ok(plat("platform.settings.save", TPL));
    const raw = await ok(call("own", "subscription.checkout", { requestId: "request-0001", plan: "pro", period: "week" }, T, ""));
    expect((await review(raw.id)).status).toBe(409);
    await ok(call("own", "subscription.submitProof", { paymentId: raw.id, txRef: "TX123456", payerEmail: "awa@exemple.sn" }, T, ""));
    expect((await ok(review(raw.id))).status).toBe("approved");
    const e = (await ok(call("own", "subscription.get"))).entitlement;
    expect(e).toMatchObject({ trial: false, state: "active" }); expect(e.plan.id).toBe("pro"); expect(e.daysLeft).toBe(7);
  });
  it("chaque période achetée donne la bonne durée (1, 7, 30, 90, 365 jours)", async () => {
    for (const [period, days] of [["day", 1], ["week", 7], ["month", 30], ["quarter", 90], ["year", 365]] as const) {
      st.tables.get("subscriptions")?.delete(T);
      await ok(review(await paid(period, "business", `req-${period}-0001`, `TXREF${period.toUpperCase()}`)));
      expect(daysLeft(), period).toBe(days);
    }
  });
  it("même formule encore active : la durée s'ajoute ; autre formule : on repart de maintenant", async () => {
    setSub(T, "business", "month", days(10));
    await ok(review(await paid("month", "business", "request-0001", "TX000001"))); expect(daysLeft()).toBe(40);
    await ok(review(await paid("week", "pro", "request-0002", "TX000002"))); expect(daysLeft()).toBe(7);
    expect(st.tables.get("subscriptions")!.get(T)!.plan).toBe("pro");
  });
  it("approuver deux fois ne prolonge qu'une fois ; une reprise après plantage réapplique les mêmes dates", async () => {
    const id = await paid("month", "business", "request-0001");
    await ok(review(id)); const first = endsAt();
    await ok(review(id)); expect(endsAt()).toBe(first);
    setSub(T, "business", "day", days(-5), "trial");
    await ok(review(id)); expect(endsAt()).toBe(first); expect(st.tables.get("subscriptions")!.get(T)!.status).toBe("paid");
  });
  it("une reprise ne raccourcit jamais un abonnement déjà prolongé par un paiement plus récent", async () => {
    const a = await paid("month", "business", "request-0001", "TX000001"); await ok(review(a));
    const b = await paid("month", "business", "request-0002", "TX000002"); await ok(review(b));
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

describe("attribution manuelle & configuration", () => {
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
  it("liens Selar : validés, fusionnés, supprimables, et signalés si le domaine est inhabituel", async () => {
    const r = await ok(plat("platform.settings.save", { selarLinks: { "starter:month": "https://selar.co/a", "pro:day": "https://boutique.exemple.com/p" } }));
    expect(r.warnings).toHaveLength(1);
    expect((await plat("platform.settings.save", { selarLinks: { "starter:month": "http://selar.co/a" } })).status).toBe(400);
    expect((await plat("platform.settings.save", { selarLinks: { "gold:month": "https://selar.co/a" } })).status).toBe(400);
    await ok(plat("platform.settings.save", { selarLinks: { "starter:week": "https://selar.co/b" } }));
    expect(Object.keys((await ok(plat("platform.settings.get"))).selarLinks).sort()).toEqual(["pro:day", "starter:month", "starter:week"]);
    await ok(plat("platform.settings.save", { selarLinks: { "starter:month": "" } }));
    expect((await ok(plat("platform.settings.get"))).selarLinks["starter:month"]).toBeUndefined();
  });
  it("tarifs modifiables : validés et appliqués aux nouvelles demandes", async () => {
    await ok(plat("platform.settings.save", TPL));
    expect((await plat("platform.settings.save", { plans: [{ id: "starter", prices: { month: -1 } }] })).status).toBe(400);
    expect((await plat("platform.settings.save", { plans: [{ id: "nope" }] })).status).toBe(400);
    await ok(plat("platform.settings.save", { plans: [{ id: "starter", prices: { month: 9_000 } }] }));
    expect((await ok(call("own", "subscription.checkout", { requestId: "request-0001", plan: "starter", period: "month" }, T, ""))).amount).toBe(9_000);
    expect((await ok(plat("platform.settings.get"))).selarLinks["starter:month"]).toBe("https://selar.co/dmp-starter-month"); // les liens survivent à une mise à jour des tarifs
  });
  it("une configuration corrompue ne bloque jamais le commerce", async () => {
    await st.create("platform_settings", "main", "", { plans: "{pas du json", selarLinks: "[corrompu" });
    expect((await call("mgr", "entity.save", { table: "customers", data: { name: "C" } })).status).toBe(200);
    expect((await call("own", "subscription.get")).status).toBe(200);
  });
});

describe("relances d'expiration (plateforme)", () => {
  const list = (within?: number, user = "root") => plat("platform.renewals.list", within ? { withinDays: within } : {}, user);
  beforeEach(async () => { st.ownerNames.set("own", "Awa Ndiaye"); await st.update("shops", S, { phone: "+221 77 123 45 67" }); });

  it("réservé à l'administrateur", async () => {
    expect((await list(undefined, "own")).status).toBe(403);
    expect((await plat("platform.renewals.markReminded", { tenantId: T }, "own")).status).toBe(403);
  });
  it("liste les échéances proches ET dépassées, pas les lointaines ; triées de la plus urgente à la moins urgente", async () => {
    setSub(T, "business", "month", days(2)); setSub("t2", "starter", "month", days(-10)); setSub("t3", "pro", "year", days(200));
    const r = (await ok(list())).renewals;
    expect(r.map((x: any) => x.tenantId)).toEqual(["t2", T]);
    expect(r[0]).toMatchObject({ state: "locked", level: "locked", shopName: "Chez Bob" });
    expect(r[1]).toMatchObject({ state: "expiring", level: "warning", plan: "business", shopName: "Chez Awa", phone: "+221 77 123 45 67", owner: { name: "Awa Ndiaye" } });
  });
  it("la fenêtre est réglable et bornée ; un essai est inclus", async () => {
    setSub(T, "business", "day", days(20), "trial");
    expect((await ok(list())).renewals).toHaveLength(0);
    const r = (await ok(list(30))).renewals; expect(r).toHaveLength(1); expect(r[0]).toMatchObject({ trial: true, state: "active" });
    setSub("t2", "pro", "year", days(500)); expect((await ok(list(9999))).renewals).toHaveLength(1); // plafonné à 90 jours
  });
  it("prépare le message de relance, et signale un paiement déjà en attente de validation", async () => {
    setSub(T, "business", "month", days(2));
    let r = (await ok(list())).renewals[0];
    expect(r.message).toMatch(/^Bonjour Awa Ndiaye,/); expect(r.message).toMatch(/Business, mensuel\) se termine dans 2 jour\(s\)/); expect(r.pendingPayment).toBe(false);
    await ok(plat("platform.settings.save", TPL));
    const pay = await ok(call("own", "subscription.checkout", { requestId: "request-0001", plan: "business", period: "month" }, T, ""));
    await ok(call("own", "subscription.submitProof", { paymentId: pay.id, txRef: "TX123456", payerEmail: "awa@exemple.sn" }, T, ""));
    r = (await ok(list())).renewals[0]; expect(r.pendingPayment).toBe(true);
  });
  it("mémorise la relance envoyée ; commerce inconnu refusé", async () => {
    setSub(T, "business", "month", days(2));
    expect((await ok(list())).renewals[0].remindedAt).toBeNull();
    const m = await ok(plat("platform.renewals.markReminded", { tenantId: T }));
    expect((await ok(list())).renewals[0].remindedAt).toBe(m.remindedAt);
    expect((await plat("platform.renewals.markReminded", { tenantId: "inconnu" })).status).toBe(404);
    expect(st.rows("audit_log").some((a) => a.action === "subscription.reminded")).toBe(true);
  });
  it("un abonnement renouvelé sort de la liste", async () => {
    setSub(T, "business", "month", days(2));
    await ok(plat("platform.subscription.grant", { grantId: "grant-00009", tenantId: T, plan: "business", period: "month", count: 1 }));
    expect((await ok(list())).renewals).toHaveLength(0);
  });
});
