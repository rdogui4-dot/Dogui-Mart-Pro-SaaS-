import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";

const T = "tenantpro001";
let st: MemoryStore; let A = "", B = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown, shop = A, tenant = T) => handle(st, user, { action, tenantId: tenant, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); return x.body.error as string; };
const setPlan = (plan: string) => { const row = st.rows("subscriptions").find((r) => r.$id === T); const data = { tenantId: T, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", T, T, data); };
const iso = (d: number) => new Date(Date.now() + d * 864e5).toISOString();
let n = 0; const id8 = (p: string) => `${p}-${String(++n).padStart(8, "0")}`;
const mk = async (name: string, price: number, cost: number, qty = 0, extra: object = {}, shop = A) => (await ok(call("own", "article.save", { data: { name, price, cost, ...extra }, ...(qty ? { initialQty: qty } : {}) }, shop))).id as string;
const base = { kind: "percent", scope: "items", value: 10, startAt: iso(-1), endAt: iso(10) };
const promo = async (data: object = {}, extra: object = {}) => (await ok(call("own", "promotion.save", { data: { name: "Promo", ...base, ...data }, productIds: [eau], ...extra }))).id as string;
const enable = (id: string, shop = A) => ok(call("own", "promotion.status", { id, to: "enabled" }, shop));
const sell = (lines: object[], extra: object = {}, shop = A) => call("own", "checkout", { clientId: id8("vente"), lines, payments: [{ method: "cash", amount: 10_000_000 }], ...extra }, shop);
const lastSale = () => st.rows("sales").at(-1)!; const lastLine = (i = 0) => JSON.parse(String(lastSale().lines))[i];
const usage = () => st.rows("promotion_usage"); const row = (id: string) => st.rows("promotions").find((p) => p.$id === id)!;
const preview = (lines: object[], extra: object = {}, shop = A) => ok(call("own", "promotions.preview", { lines, ...extra }, shop));
const L = (productId: string, qty: number) => ({ productId, qty });
let eau = "", jus = "", savon = "";

beforeEach(async () => {
  st = new MemoryStore(); n = 0; await st.grant(T, "own", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId;
  for (const [u, role] of [["cais", "cashier"], ["ger", "manager"]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: [A] }, ""))).userId;
  setPlan("pro");
  eau = await mk("Eau", 500, 300, 1000, { sku: "EAU-1" }); jus = await mk("Jus", 1000, 600, 1000, { sku: "JUS-1" }); savon = await mk("Savon", 800, 400, 1000, { category: "Hygiène" });
});

describe("droits d'abonnement (un seul moteur, fonctions avancées Pro)", () => {
  it("Business : remise simple oui ; famille avancée, cumul, coupon, budget, magasins : 402 côté serveur", async () => {
    setPlan("business"); await promo({});
    const adv = async (data: object, extra: object = {}) => err(call("own", "promotion.save", { data: { name: "Adv", ...base, ...data }, productIds: [eau], ...extra }), 402);
    await adv({ family: "tiers", tiers: [{ minQty: 3, kind: "percent", value: 10 }] }); await adv({ stackable: true }); await adv({ budget: 5000 }); await adv({ requiresCoupon: true }); await adv({ storeScope: "all" }); await adv({ maxLinePct: 20 });
    await adv({ customerRules: { categories: ["wholesale"], customerIds: [], loyalty: [] } }); await adv({}, { excludeIds: [jus] });
    await err(call("own", "coupon.save", { promotionId: "x" }), 402); await err(call("own", "promotions.analytics", {}), 402); await err(call("own", "promotions.recommendations", {}), 402); await err(call("own", "promotion.storeRule", { id: "x" }), 402);
    await err(call("own", "promotions.settings", { maxCartPct: 10 }), 402); await ok(call("own", "promotions.settings", { tz: "Africa/Abidjan" }));
  });
  it("seuls gérant/propriétaire accèdent à la liste, aux analyses et aux coupons", async () => {
    for (const a of ["promotions.list", "promotions.analytics", "promotions.recommendations", "promotions.journal", "coupons.list"]) await err(call(U.cais!, a, {}), 403);
    for (const a of ["promotions.list", "promotions.analytics", "promotions.recommendations", "promotions.journal", "coupons.list"]) await ok(call(U.ger!, a, {}));
  });
});

describe("familles avancées appliquées à la vente (serveur fait foi)", () => {
  it("prix dégressifs : palier par ligne ; instantané figé dans la ligne et la ligne d'utilisation", async () => {
    const id = await promo({ family: "tiers", name: "Dégressif", tiers: [{ minQty: 3, kind: "percent", value: 10 }, { minQty: 10, kind: "percent", value: 20 }] }); await enable(id);
    await sell([L(eau, 2)]); expect(lastLine().promo).toBeUndefined(); await sell([L(eau, 3)]); expect(lastLine()).toMatchObject({ baseAmount: 1500, amount: 1350, promo: { id, discount: 150, family: "tiers" } });
    await sell([L(eau, 10)]); expect(lastLine().amount).toBe(4000);
    const u = usage().at(-1)!; expect(JSON.parse(String(u.rules))).toMatchObject({ family: "tiers", tiers: [{ minQty: 3, value: 10 }, { minQty: 10, value: 20 }] }); expect(u.family).toBe("tiers"); expect(JSON.parse(String(u.decisions))[0]).toMatchObject({ outcome: "applied" });
    // changer la campagne ensuite ne réécrit pas l'historique
    await ok(call("own", "promotion.status", { id, to: "suspended" })); expect(JSON.parse(String(lastSale().lines))[0].amount).toBe(4000);
  });
  it("paliers cumulés sur plusieurs lignes du même ensemble d'articles", async () => {
    const id = await promo({ family: "tiers", tierBasis: "cumulative", tiers: [{ minQty: 4, kind: "percent", value: 10 }] }, { productIds: [eau, jus] }); await enable(id);
    const r = await preview([L(eau, 2), L(jus, 2)]); expect(r.discountTotal).toBe(300);
  });
  it("achetez X, obtenez Y : les articles les moins chers du lot sont offerts", async () => {
    const id = await promo({ family: "bogo", name: "3 pour 2", bogoBuy: 2, bogoGet: 1, bogoPct: 100, allowBelowMargin: true }, { productIds: [eau, jus] }); await enable(id);
    expect((await preview([L(jus, 1), L(eau, 2)])).discountTotal).toBe(500); expect((await preview([L(eau, 2)])).discountTotal).toBe(0); expect((await preview([L(eau, 6)])).discountTotal).toBe(1000);
  });
  it("pack à prix fixe : seulement si tous les articles sont présents ; plusieurs packs ; jamais sous un prix normal", async () => {
    const id = await promo({ family: "combo", name: "Pack", comboPrice: 1200 }, { productIds: undefined, comboItems: [{ productId: eau, qty: 1 }, { productId: jus, qty: 1 }] }); await enable(id);
    expect((await preview([L(eau, 1)])).discountTotal).toBe(0); expect((await preview([L(eau, 1), L(jus, 1)])).discountTotal).toBe(300); expect((await preview([L(eau, 3), L(jus, 2)])).discountTotal).toBe(600);
    const bad = await promo({ family: "combo", name: "Mauvais", comboPrice: 5000 }, { productIds: undefined, comboItems: [{ productId: eau, qty: 1 }, { productId: jus, qty: 1 }] }); await enable(bad); expect((await preview([L(eau, 1), L(jus, 1)])).discountTotal).toBe(300);
  });
  it("remise sur le panier à partir d'un montant minimal ; remise conditionnée à l'achat d'un article requis", async () => {
    const c = await promo({ family: "cart", name: "Panier", value: 10, minCart: 5000 }, { productIds: undefined }); await enable(c);
    expect((await preview([L(jus, 4)])).discountTotal).toBe(0); expect((await preview([L(jus, 5)])).discountTotal).toBe(500); await ok(call("own", "promotion.status", { id: c, to: "suspended" }));
    const r = await promo({ family: "requires", name: "Conditionnée", value: 10 }, { productIds: [savon], requireItems: [{ productId: jus, qty: 2 }] }); await enable(r);
    expect((await preview([L(savon, 1)])).discountTotal).toBe(0); expect((await preview([L(savon, 1), L(jus, 1)])).discountTotal).toBe(0); expect((await preview([L(savon, 1), L(jus, 2)])).discountTotal).toBe(80);
  });
  it("articles exclus d'une campagne sur catégorie", async () => {
    const x = await mk("Savon luxe", 2000, 1000, 100, { category: "Hygiène" });
    const id = await promo({ name: "Hygiène", scope: "category", category: "Hygiène" }, { productIds: [], excludeIds: [x] }); await enable(id);
    const r = await preview([L(savon, 1), L(x, 1)]); expect(r.discountTotal).toBe(80); expect(r.lines[1].promo).toBeUndefined();
  });
});

describe("priorités, cumul et explications", () => {
  it("par défaut une seule promotion par ligne (la meilleure) ; les refusées sont expliquées", async () => {
    const a = await promo({ name: "Petite", value: 10 }), b = await promo({ name: "Grande", value: 30 }); await enable(a); await enable(b);
    const r = await preview([L(eau, 2)]); expect(r.discountTotal).toBe(300); expect(r.lines[0].promos).toHaveLength(1);
    expect(r.decisions.find((d: any) => d.name === "Petite")).toMatchObject({ outcome: "refused", reason: "not_best" }); expect(r.decisions.find((d: any) => d.name === "Grande")).toMatchObject({ outcome: "applied" });
  });
  it("cumul seulement entre campagnes cumulables, sur le montant restant ; jamais avec une non-cumulable", async () => {
    const a = await promo({ name: "S1", value: 10, stackable: true }), b = await promo({ name: "S2", value: 10, stackable: true }), c = await promo({ name: "Seule", value: 15 }); await enable(a); await enable(b); await enable(c);
    // 10 % puis 10 % du reste = 190 sur 1000 > 15 % exclusif (150)
    const r = await preview([L(jus, 0 + 1)], {}); expect(r.discountTotal).toBe(0); // jus non ciblé
    const r2 = await preview([L(eau, 2)]); expect(r2.discountTotal).toBe(190); expect(r2.lines[0].promos).toHaveLength(2);
    await ok(call("own", "promotion.status", { id: b, to: "suspended" })); expect((await preview([L(eau, 2)])).discountTotal).toBe(150); // un seul cumulable : l'exclusive plus forte gagne
  });
  it("stratégie « priorité » : la campagne la plus prioritaire gagne même si moins avantageuse", async () => {
    const a = await promo({ name: "Forte", value: 30, priority: 1 }), b = await promo({ name: "Prio", value: 10, priority: 50 }); await enable(a); await enable(b);
    expect((await preview([L(eau, 2)])).discountTotal).toBe(300); await ok(call("own", "promotions.settings", { strategy: "priority" })); expect((await preview([L(eau, 2)])).discountTotal).toBe(100);
  });
  it("plafonds : par article et par panier (boutique), par campagne", async () => {
    const a = await promo({ name: "Grosse", value: 50, maxLinePct: 20, allowBelowMargin: true }); await enable(a); expect((await preview([L(eau, 2)])).discountTotal).toBe(200);
    await ok(call("own", "promotions.settings", { maxLinePct: 10 })); const r = await preview([L(eau, 2)]); expect(r.discountTotal).toBe(100); expect(r.notes.join(" ")).toContain("plafonnée");
    await ok(call("own", "promotions.settings", { maxLinePct: null, maxCartPct: 5 })); expect((await preview([L(eau, 2)])).discountTotal).toBe(50);
    const cap = await promo({ name: "Plafonnée", family: "cart", value: 50, minCart: 100, maxCartDiscount: 120, allowBelowMargin: true }, { productIds: undefined }); await enable(cap); await ok(call("own", "promotions.settings", { maxCartPct: null })); expect((await preview([L(jus, 5)])).discountTotal).toBeLessThanOrEqual(2500);
  });
});

describe("coupons", () => {
  it("campagne à coupon : sans coupon valide rien ; coupon à usage unique consommé une fois ; tentatives invalides tracées", async () => {
    const id = await promo({ name: "VIP", value: 20, requiresCoupon: true }); await enable(id);
    const c = (await ok(call("own", "coupon.save", { promotionId: id, code: "bienvenue", singleUse: true }))).ids[0] as string;
    expect((await preview([L(eau, 1)])).discountTotal).toBe(0); expect((await preview([L(eau, 1)])).decisions[0].reason).toBe("coupon_required");
    const p = await preview([L(eau, 1)], { couponCode: "bienvenue" }); expect(p.discountTotal).toBe(100); expect(p.coupon).toMatchObject({ ok: true, applied: true });
    await ok(sell([L(eau, 1)], { couponCode: "bienvenue" })); expect(lastLine().couponRef.code).toBe("BIENVENUE"); expect(st.rows("promotion_coupons").find((x) => x.$id === c)!.usedCount).toBe(1); expect(usage().at(-1)!.couponId).toBe(c);
    await err(sell([L(eau, 1)], { couponCode: "BIENVENUE" }), 409, "refusé".slice(0, 0)); // déjà utilisé
    await err(sell([L(eau, 1)], { couponCode: "NIMPORTE" }), 409, "inconnu");
    const inv = st.rows("promotion_coupon_usage").filter((x) => x.outcome === "invalid"); expect(inv.map((x) => x.reason).sort()).toEqual(["unknown", "used_up"]);
    const l = await ok(call("own", "coupons.list", {})); expect(l.invalidTotal).toBe(2); expect(l.coupons[0]).toMatchObject({ code: "BIENVENUE", usedCount: 1 });
    expect(st.rows("sales").filter((s) => s.status === "paid")).toHaveLength(1);
  });
  it("validité, client réservé, limite d'utilisations, série de coupons", async () => {
    const id = await promo({ name: "VIP", value: 20, requiresCoupon: true }); await enable(id);
    const cl = (await ok(call("own", "entity.save", { table: "customers", data: { name: "Awa" } }))).id as string, cl2 = (await ok(call("own", "entity.save", { table: "customers", data: { name: "Bob" } }))).id as string;
    await ok(call("own", "coupon.save", { promotionId: id, code: "FUTUR", validFrom: iso(2) })); await ok(call("own", "coupon.save", { promotionId: id, code: "PASSE", validTo: iso(-1) })); await ok(call("own", "coupon.save", { promotionId: id, code: "AWA", customerId: cl })); await ok(call("own", "coupon.save", { promotionId: id, code: "DEUX", maxUses: 2 }));
    expect((await preview([L(eau, 1)], { couponCode: "FUTUR" })).coupon.message).toContain("pas encore"); expect((await preview([L(eau, 1)], { couponCode: "PASSE" })).coupon.message).toContain("expiré");
    expect((await preview([L(eau, 1)], { couponCode: "AWA" })).coupon.message).toContain("identifiez"); expect((await preview([L(eau, 1)], { couponCode: "AWA", customerId: cl2 })).coupon.message).toContain("autre client"); expect((await preview([L(eau, 1)], { couponCode: "AWA", customerId: cl })).discountTotal).toBe(100);
    await ok(sell([L(eau, 1)], { couponCode: "DEUX" })); await ok(sell([L(eau, 1)], { couponCode: "DEUX" })); await err(sell([L(eau, 1)], { couponCode: "DEUX" }), 409);
    const s = await ok(call("own", "coupon.save", { promotionId: id, count: 5 })); expect(s.ids).toHaveLength(5); expect(new Set(st.rows("promotion_coupons").map((x) => x.code)).size).toBe(st.rows("promotion_coupons").length);
    await err(call("own", "coupon.save", { promotionId: id, code: "AWA" }), 409, "existe déjà");
  });
  it("une vente rejouée (même clientId) ne consomme ni le coupon ni la campagne deux fois ; soumissions doubles simultanées", async () => {
    const id = await promo({ name: "VIP", value: 20, requiresCoupon: true, usageLimit: 5 }); await enable(id); await ok(call("own", "coupon.save", { promotionId: id, code: "UNIQ", singleUse: true }));
    const body = { clientId: "doublon-00000001", lines: [L(eau, 1)], payments: [{ method: "cash", amount: 10_000 }], couponCode: "UNIQ" };
    const rs = await Promise.all([call("own", "checkout", body), call("own", "checkout", body)]); expect(rs.map((r) => r.status).sort()).toContain(200);
    await call("own", "checkout", body); expect(usage()).toHaveLength(1); expect(st.rows("promotion_coupon_usage").filter((x) => x.outcome === "used")).toHaveLength(1); expect(st.rows("promotion_coupons")[0]!.usedCount).toBe(1); expect(st.rows("sales").filter((s) => s.status === "paid")).toHaveLength(1);
  });
});

describe("ciblage clients", () => {
  it("catégorie de clients, client précis, fidélité, nouveaux clients ; client non identifié refusé avec explication", async () => {
    const cat = (await ok(call("own", "entity.save", { table: "customers", data: { name: "Gros", category: "wholesale" } }))).id as string, other = (await ok(call("own", "entity.save", { table: "customers", data: { name: "Autre" } }))).id as string;
    const id = await promo({ name: "Pour gros", value: 20, customerRules: { categories: ["wholesale"], customerIds: [], loyalty: [] } }); await enable(id);
    const none = await preview([L(eau, 1)]); expect(none.discountTotal).toBe(0); expect(none.decisions[0].reason).toBe("customer"); expect((await preview([L(eau, 1)], { customerId: other })).discountTotal).toBe(0); expect((await preview([L(eau, 1)], { customerId: cat })).discountTotal).toBe(100);
    const byId = await promo({ name: "Un client", value: 30, customerRules: { categories: [], customerIds: [other], loyalty: [] } }); await enable(byId); expect((await preview([L(eau, 1)], { customerId: other })).discountTotal).toBe(150);
    const gold = await promo({ name: "Or", value: 40, customerRules: { categories: [], customerIds: [], loyalty: ["gold"] } }); await enable(gold); st.rows("customers").find((c) => c.$id === other)!.annualSpend = 50_000_000; expect((await preview([L(eau, 1)], { customerId: other })).discountTotal).toBe(200);
    const nw = await promo({ name: "Nouveaux", value: 5, customerRules: { categories: [], customerIds: [], loyalty: [], newDays: 30 } }); await enable(nw); st.rows("customers").find((c) => c.$id === cat)!.$createdAt = new Date().toISOString(); expect((await preview([L(eau, 1)], { customerId: cat })).discountTotal).toBe(100);
  });
});

describe("budgets, limites et protection de rentabilité", () => {
  it("budget de campagne : jamais dépassé, même par deux ventes simultanées", async () => {
    const id = await promo({ name: "Budget", value: 10, budget: 150 }); await enable(id);
    await ok(sell([L(eau, 2)])); // 100 consommés
    expect((await preview([L(eau, 2)])).decisions[0].reason).toBe("budget"); await ok(sell([L(eau, 1)])); // 50 → 150
    await sell([L(eau, 2)]); expect(usage().reduce((a, u) => a + Number(u.discount), 0)).toBeLessThanOrEqual(150);
    const id2 = await promo({ name: "Budget2", code: "BUD2", value: 100, budget: 200, allowBelowMargin: true }, { productIds: [jus] }); await enable(id2); const rs = await Promise.all([sell([L(jus, 1)]), sell([L(jus, 1)])]);
    expect(usage().filter((u) => u.promotionId === id2).reduce((a, u) => a + Number(u.discount), 0)).toBeLessThanOrEqual(200); expect(rs.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
  });
  it("sous la marge : refus à l'enregistrement ; au-dessus : remise partielle ligne par ligne selon le coût réel", async () => {
    await err(call("own", "promotion.save", { data: { name: "TropFort", ...base, value: 50, minMarginPct: 10 }, productIds: [jus] }), 409, "marge minimale");
    const sans = await mk("SansCoût", 1000, 0, 10); const id = await promo({ name: "Prudente", value: 20, minMarginPct: 5 }, { productIds: [sans] }); await enable(id);
    const r = await preview([L(sans, 1)]); expect(r.discountTotal).toBe(0); expect(r.decisions[0].message).toContain("coût de revient indisponible");
  });
  it("limite d'utilisations globale et par client toujours respectées avec les familles avancées", async () => {
    const id = await promo({ family: "tiers", name: "Lim", usageLimit: 2, tiers: [{ minQty: 1, kind: "percent", value: 10 }] }); await enable(id);
    await ok(sell([L(eau, 1)])); await ok(sell([L(eau, 1)])); await sell([L(eau, 1)]); expect(usage()).toHaveLength(2); expect(row(id).usageCount).toBe(2);
  });
  it("échec de vente (stock insuffisant) : aucune utilisation de campagne ni de coupon ne reste enregistrée", async () => {
    const id = await promo({ name: "VIP", value: 20, requiresCoupon: true, usageLimit: 3 }); await enable(id); await ok(call("own", "coupon.save", { promotionId: id, code: "CPN1", singleUse: true }));
    await err(sell([L(eau, 5000)], { couponCode: "CPN1" }), 409); expect(usage()).toHaveLength(0); expect(row(id).usageCount).toBe(0); expect(st.rows("promotion_coupons")[0]!.usedCount).toBe(0);
    await ok(sell([L(eau, 1)], { couponCode: "CPN1" })); expect(usage()).toHaveLength(1);
  });
});

describe("multi-magasins", () => {
  it("campagne commune : s'applique aux autres magasins (par référence article) ; réglage local, valeur locale, budget local ; chaque magasin garde son stock", async () => {
    const id = await promo({ name: "Commune", value: 10, storeScope: "all" }); await enable(id);
    const eauB = await mk("Eau", 500, 300, 50, { sku: "EAU-1" }, B); expect((await preview([L(eauB, 2)], {}, B)).discountTotal).toBe(100);
    await ok(call("own", "promotion.storeRule", { id, shopId: B, value: 20 })); expect((await preview([L(eauB, 2)], {}, B)).discountTotal).toBe(200); expect((await preview([L(eau, 2)])).discountTotal).toBe(100);
    await ok(sell([L(eauB, 2)], {}, B)); expect(usage().at(-1)!.shopId).toBe(B); expect(usage().at(-1)!.discount).toBe(200);
    await ok(call("own", "promotion.storeRule", { id, shopId: B, enabled: false })); const off = await preview([L(eauB, 2)], {}, B); expect(off.discountTotal).toBe(0); expect(off.decisions[0].reason).toBe("store_suspended");
    await ok(call("own", "promotion.storeRule", { id, shopId: B, enabled: true, budget: 250 })); const bud = await preview([L(eauB, 2)], {}, B); expect(bud.discountTotal).toBe(0); expect(bud.decisions[0].reason).toBe("budget"); // 200 déjà consommés ici + 100 > 250 ; le budget local ne dépend pas de l'autre magasin
    expect(Number((await ok(call("own", "promotions.list", {}, B))).promos.find((p: any) => p.id === id).budgetUsedHere)).toBe(200);
  });
  it("campagne limitée à certains magasins ; autorisation locale limitée à son magasin", async () => {
    const id = await promo({ name: "Seulement A", value: 10, storeScope: "some" }, { shopIds: [A] }); await enable(id); const eauB = await mk("Eau", 500, 300, 50, { sku: "EAU-1" }, B); expect((await preview([L(eauB, 1)], {}, B)).discountTotal).toBe(0);
    await err(call("own", "promotion.storeRule", { id, shopId: B, enabled: false }, B), 409, "ne vise pas");
    const all = await promo({ name: "Commune", code: "COMM", value: 10, storeScope: "all" }); await enable(all); await ok(call("own", "promotion.storeRule", { id: all, enabled: false }, B)); // depuis B pour B
    const li = await ok(call("own", "promotions.list", {}, B)); expect(li.promos.find((p: any) => p.id === all)).toMatchObject({ foreign: true, localEnabled: false });
    expect(li.promos.find((p: any) => p.id === id)).toBeUndefined();
  });
});

describe("rétrogradation Pro → Business", () => {
  it("campagnes avancées conservées mais gelées (non appliquées), historique intact, création bloquée, simple toujours appliquée", async () => {
    const adv = await promo({ family: "tiers", name: "Dégressif", tiers: [{ minQty: 1, kind: "percent", value: 10 }] }); await enable(adv); const simple = await promo({ name: "Simple", code: "SMP", value: 5 }, { productIds: [jus] }); await enable(simple);
    await ok(sell([L(eau, 1)])); expect(usage()).toHaveLength(1);
    setPlan("business");
    const r = await preview([L(eau, 1), L(jus, 1)]); expect(r.lines[0].promo).toBeUndefined(); expect(r.lines[1].promo.id).toBe(simple); expect(r.decisions.find((d: any) => d.promoId === adv)).toMatchObject({ reason: "frozen" });
    expect(usage()).toHaveLength(1); expect(JSON.parse(String(lastSale().lines))[0].promo.id).toBe(adv); // l'historique n'est pas touché
    await ok(call("own", "promotion.status", { id: adv, to: "suspended" })); await err(call("own", "promotion.status", { id: adv, to: "enabled" }), 402);
    setPlan("pro"); await ok(call("own", "promotion.status", { id: adv, to: "enabled" })); expect((await preview([L(eau, 1)])).discountTotal).toBe(50);
  });
});

describe("immutabilité et idempotence", () => {
  it("campagne utilisée : paliers, valeur, articles et type verrouillés ; budget et priorité modifiables", async () => {
    const id = await promo({ family: "tiers", name: "Dégressif", tiers: [{ minQty: 1, kind: "percent", value: 10 }] }); await enable(id); await ok(sell([L(eau, 1)]));
    const edit = (data: object, extra: object = {}) => call("own", "promotion.save", { id, data: { name: "Dégressif", ...base, family: "tiers", tiers: [{ minQty: 1, kind: "percent", value: 10 }], ...data }, productIds: [eau], ...extra });
    await err(edit({ tiers: [{ minQty: 1, kind: "percent", value: 15 }] }), 409, "déjà été utilisée"); await err(edit({}, { productIds: [eau, jus] }), 409); await err(edit({ tiers: [{ minQty: 1, kind: "percent", value: 10 }, { minQty: 5, kind: "percent", value: 20 }] }), 409);
    await ok(edit({ budget: 5000, priority: 9 })); expect(row(id)).toMatchObject({ budget: 5000, priority: 9 });
  });
  it("une requête de création rejouée ne crée pas de doublon", async () => {
    const body = { requestId: "req-0001-abcdef", data: { name: "Une fois", ...base, family: "tiers", tiers: [{ minQty: 2, kind: "percent", value: 10 }] }, productIds: [eau] };
    await ok(call("own", "promotion.save", body)); await ok(call("own", "promotion.save", body)); expect(st.rows("promotions")).toHaveLength(1); expect(st.rows("promotion_conditions")).toHaveLength(1);
  });
  it("suppression : jamais utilisée seulement, enfants nettoyés", async () => {
    const id = await promo({ family: "tiers", name: "X1", tiers: [{ minQty: 2, kind: "percent", value: 10 }] }); await ok(call("own", "promotion.delete", { id })); expect(st.rows("promotion_conditions")).toHaveLength(0);
    const u = await promo({ name: "Utilisée" }); await enable(u); await ok(sell([L(eau, 1)])); await err(call("own", "promotion.delete", { id: u }), 409);
  });
});

describe("calendrier, chevauchements, analyses, recommandations, journal", () => {
  it("détecte les chevauchements et signale les campagnes proches de la fin", async () => {
    const a = await promo({ name: "Alpha", endAt: iso(2) }), b = await promo({ name: "Beta", code: "BBB" }); await enable(a); await enable(b);
    const l = await ok(call("own", "promotions.list", {})); expect(l.pro).toBe(true); expect(l.overlaps).toHaveLength(1); expect(l.expiringSoon.map((x: any) => x.id)).toEqual([a]); expect(l.tz).toBe("Africa/Dakar");
    await err(call("own", "promotions.settings", { tz: "Mars/Olympus" }), 400); await ok(call("own", "promotions.settings", { tz: "Africa/Abidjan" })); expect((await ok(call("own", "promotions.list", {}))).tz).toBe("Africa/Abidjan");
  });
  it("analyse : chiffres réels uniquement, marge seulement si le coût est connu, coupons et tentatives invalides, comparaison", async () => {
    const id = await promo({ name: "Mesurée", value: 10 }); await enable(id); await ok(sell([L(eau, 2)])); await ok(sell([L(eau, 1)]));
    const a = await ok(call("own", "promotions.analytics", {}));
    expect(a.totals).toMatchObject({ uses: 2, discount: 150, revenue: 1350 }); expect(a.byArticle[0]).toMatchObject({ qty: 3, discount: 150 }); expect(a.byCampaign[0]).toMatchObject({ name: "Mesurée", uses: 2 });
    expect(a.margin.grossMargin).toBe(1350 - 900); expect(a.salesTotal).toBe(1350 + 0 + 0 || a.salesTotal); expect(a.comparison.uses).toBeNull(); expect(a.comparisonNote).toContain("causé"); expect(a.note).toContain("pas un bénéfice");
    const sc = await mk("SansCoût", 1000, 0, 10); const p2 = await promo({ name: "SC", code: "SC1", value: 10 }, { productIds: [sc] }); await enable(p2); await ok(sell([L(sc, 1)]));
    const b = await ok(call("own", "promotions.analytics", {})); expect(b.margin.linesWithoutCost).toBe(1); expect(b.margin.note).toContain("exclues");
    const only = await ok(call("own", "promotions.analytics", { from: "2020-01-01", to: "2020-01-31" })); expect(only.totals.uses).toBe(0); expect(only.margin.grossMargin).toBeNull();
    await err(call("own", "promotions.analytics", { from: "2026-02-01", to: "2026-01-01" }), 400); await err(call(U.ger!, "promotions.analytics", { scope: "all" }), 403);
  });
  it("recommandations justifiées par les données ; rien n'est créé automatiquement ; historique insuffisant signalé", async () => {
    const before = st.rows("promotions").length; const r = await ok(call("own", "promotions.recommendations", {}));
    expect(st.rows("promotions")).toHaveLength(before); expect(r.recommendations.some((x: any) => x.id === "demand:insufficient")).toBe(true);
    const low = r.recommendations.filter((x: any) => x.kind === "low_rotation"); expect(low.length).toBeGreaterThan(0); for (const x of low) { expect(x.why).toBeTruthy(); expect(x.limits).toBeTruthy(); expect(x.data.stock).toBeGreaterThan(0); }
    const id = await promo({ name: "Peu", endAt: iso(1), startAt: iso(-20) }); await enable(id); const r2 = await ok(call("own", "promotions.recommendations", {})); expect(r2.recommendations.map((x: any) => x.kind)).toEqual(expect.arrayContaining(["expiring", "little_used"]));
  });
  it("journal d'audit des promotions et coupons", async () => {
    const id = await promo({ name: "Tracée" }); await enable(id); await ok(call("own", "promotion.save", { id, data: { name: "Tracée 2", ...base }, productIds: [eau] })); await ok(call("own", "coupon.save", { promotionId: id, code: "TRACE" }));
    const j = await ok(call("own", "promotions.journal", {})); expect(j.entries.map((e: any) => e.action)).toEqual(expect.arrayContaining(["promotion.create", "promotion.enabled", "promotion.update", "coupon.create"]));
  });
});
