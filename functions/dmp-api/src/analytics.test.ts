import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";

class DatedStore extends MemoryStore { override async create(t: string, id: string, tenant: string, d: Record<string, unknown>) { return super.create(t, id, tenant, { $createdAt: new Date().toISOString(), ...d }); } }
const T = "tenantan001", T2 = "tenantan002";
let st: DatedStore; let A = "", B = "", X = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}, shop = A, tenant = T) => handle(st, user, { action, tenantId: tenant, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); };
const setPlan = (plan: string, tenant = T) => { const row = st.rows("subscriptions").find((r) => r.$id === tenant); const data = { tenantId: tenant, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", tenant, tenant, data); };
let n = 0; const id8 = (p: string) => `${p}-${String(++n).padStart(8, "0")}`;
const mk = async (name: string, price: number, cost: number, qty = 0, extra: object = {}, shop = A) => (await ok(call("own", "article.save", { data: { name, price, cost, ...extra }, ...(qty ? { initialQty: qty } : {}) }, shop))).id as string;
const sell = (lines: object[], payments: object[], extra: object = {}, shop = A, user = "own") => call(user, "checkout", { clientId: id8("vente"), lines, payments, ...extra }, shop);
const pro = (b: object = {}, user = "own", shop = A) => ok(call(user, "dashboard.pro", { preset: "last30", ...b }, shop));
const daysAgo = (d: number, h = 12) => new Date(Date.now() - d * 864e5 + (h - 12) * 36e5).toISOString();
const cash = (v: number) => [{ method: "cash", amount: v }];
let eau = "", jus = "", savon = "";

beforeEach(async () => {
  st = new DatedStore(); n = 0; await st.grant(T, "own", ["owner"], []); await st.grant(T2, "own2", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId; X = (await ok(call("own2", "shop.create", { name: "Autre commerce" }, "", T2))).shopId;
  for (const [u, role, shops] of [["cais", "cashier", [A]], ["ger", "manager", [A]]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: shops }, ""))).userId;
  setPlan("pro"); setPlan("pro", T2);
  eau = await mk("Eau", 500, 300, 500, { category: "Boissons" }); jus = await mk("Jus", 1000, 600, 500, { category: "Boissons" }); savon = await mk("Savon", 800, 400, 500, { category: "Hygiène" });
});

describe("droits d'abonnement et isolation", () => {
  it("Business : 402 sur toutes les fonctions Pro (côté serveur) mais le tableau Business reste ; retour en Business : données conservées", async () => {
    await ok(sell([{ productId: eau, qty: 2 }], cash(1000))); setPlan("business");
    await err(call("own", "dashboard.pro", {}), 402); await err(call("own", "dashboard.report", { kind: "commercial" }), 402); expect((await ok(call("own", "dashboard.business", { preset: "today" }))).kpis.today.revenue).toBe(1000);
    setPlan("pro"); expect((await pro({ preset: "today" })).totals.revenue).toBe(1000);
  });
  it("caissier refusé ; gérant limité à ses boutiques ; autre commerce invisible", async () => {
    await err(call(U.cais!, "dashboard.pro", {}), 403); const g = await pro({ shopId: "all" }, U.ger!); expect(g.scope.shops).toHaveLength(1); await err(call(U.ger!, "dashboard.pro", { shopId: B }, B), 403);
    const o = (await ok(call("own2", "article.save", { data: { name: "Intrus", price: 1000, cost: 100 }, initialQty: 10 }, X, T2))).id; await ok(call("own2", "checkout", { clientId: id8("autre"), lines: [{ productId: o, qty: 5 }], payments: cash(5000) }, X, T2)); await ok(sell([{ productId: eau, qty: 1 }], cash(500)));
    const all = await pro({ shopId: "all", preset: "today" }); expect(all.totals.revenue).toBe(500); await err(call("own", "dashboard.pro", { shopId: X }), 403);
  });
});

describe("vue exécutive : chiffres comptables et non calculables", () => {
  it("CA, encaissé, crédit, coût figé, marge, taux de marge, taux de marque ; cohérent avec le tableau Business ; contrôles internes", async () => {
    const c = (await ok(call("own", "entity.save", { table: "customers", data: { name: "Awa", creditLimit: 100000 } }))).id as string;
    await ok(sell([{ productId: eau, qty: 4 }], [{ method: "cash", amount: 1000 }, { method: "card", amount: 1000 }])); await ok(sell([{ productId: jus, qty: 3 }], [{ method: "credit", amount: 3000 }], { customerId: c }));
    const d = await pro({ preset: "today" }); const t = d.totals; expect(t).toMatchObject({ count: 2, revenue: 5000, encaisse: 2000, credit: 3000 }); expect(t.encaisse + t.credit).toBe(t.revenue);
    const rate = 18; const ht = Math.round(5000 / (1 + rate / 100)); expect(t.cogs).toBe(4 * 300 + 3 * 600); expect(t.margin).toBe(t.revenueHt - t.cogs); expect(t.revenueHt).toBe(ht); expect(t.marginRate).toBe(Math.round(t.margin / ht * 1000) / 10); expect(t.markup).toBe(Math.round(t.margin / t.cogs * 1000) / 10);
    const b = await ok(call("own", "dashboard.business", { preset: "today" })); expect(b.kpis.period.revenue).toBe(t.revenue); expect(b.kpis.period.margin.amount).toBe(t.margin); expect(d.checks).toEqual({ seriesEqualsTotal: true, paymentsEqualRevenue: true });
    expect(d.unavailable.map((x: any) => x.id)).toEqual(["expenses", "operating"]); expect(d.unavailable.every((x: any) => x.reason.length > 20)).toBe(true); expect(d.refunds).toEqual({ amount: 0, count: 0 });
    expect(d.stock.value).toBeGreaterThan(0); expect(d.stock.methodLabel).toBeTruthy(); expect(d.definitions.margin[1]).toContain("PAS un bénéfice");
  });
  it("ventes annulées / non finalisées jamais comptées ; état « non finalisées » les isole", async () => {
    await ok(sell([{ productId: eau, qty: 1 }], cash(500))); await st.create("sales", "stuck0000001", T, { tenantId: T, shopId: A, number: "V-STUCK", total: 9999, vat: 0, status: "posted", soldAt: daysAgo(0), payments: "[]", lines: JSON.stringify([{ productId: eau, name: "Eau", qty: 1, unitPrice: 9999, unitCost: 300 }]), clientId: "stuck0000001" });
    await st.create("sales", "cancel000001", T, { tenantId: T, shopId: A, number: "V-CAN", total: 7777, vat: 0, status: "cancelled", soldAt: daysAgo(0), payments: "[]", lines: "[]", clientId: "cancel000001" });
    expect((await pro({ preset: "today" })).totals.revenue).toBe(500); const open = await pro({ preset: "today", saleState: "open" }); expect(open.totals.revenue).toBe(9999); expect(open.saleState).toBe("open");
  });
  it("comparaison période précédente ; même période l'an dernier : indisponible sans données (jamais de faux pourcentage)", async () => {
    await ok(sell([{ productId: eau, qty: 2 }], cash(1000), { soldAt: daysAgo(1) })); await ok(sell([{ productId: eau, qty: 1 }], cash(500), { soldAt: daysAgo(40) })); await ok(sell([{ productId: eau, qty: 1 }], cash(500), { soldAt: daysAgo(2) }));
    const d = await pro({ preset: "last7", compare: "prev" }); expect(d.totals.revenue).toBe(1500); expect(d.previous.revenue).toBe(0); expect(d.comparison.revenue).toBeNull(); expect(d.comparison.available).toBe(false);
    const wide = await pro({ preset: "last30", compare: "prev" }); expect(wide.previous.revenue).toBe(500); expect(wide.comparison.revenue).toBe(200);
    const y = await pro({ preset: "last30", compare: "yoy" }); expect(y.comparison.available).toBe(false); expect(y.comparisonNote).toBeTruthy(); expect(y.prevPeriod.from.slice(0, 4)).toBe(String(Number(y.period.from.slice(0, 4)) - 1));
  });
});

describe("performance commerciale", () => {
  it("par article, catégorie, vendeur, magasin, paiement, heure ; sommes = total ; filtres cohérents partout", async () => {
    const eb = await mk("Eau", 500, 300, 100, { category: "Boissons" }, B);
    await ok(sell([{ productId: eau, qty: 2 }, { productId: savon, qty: 1 }], cash(1800))); await ok(sell([{ productId: jus, qty: 1 }], [{ method: "card", amount: 1000 }])); await ok(sell([{ productId: eb, qty: 3 }], cash(1500), {}, B));
    const d = await ok(call("own", "dashboard.pro", { space: "sales", preset: "today", shopId: "all" }, A)); const rev = d.totals.revenue; expect(rev).toBe(4300);
    for (const k of ["byCategory", "bySeller", "byShop"]) expect(d[k].reduce((a: number, g: any) => a + g.revenue, 0)).toBe(rev); expect(d.byMethod.reduce((a: number, g: any) => a + g.amount, 0)).toBe(d.totals.encaisse + d.totals.credit); expect(d.byHour.reduce((a: number, h: any) => a + h.revenue, 0)).toBe(rev); expect(d.byShop.map((s: any) => s.name).sort()).toEqual(["Dakar", "Thiès"]);
    expect(d.bySeller[0].name).toBeTruthy(); expect(d.best[0].revenue).toBeGreaterThanOrEqual(d.best.at(-1).revenue); expect(d.basket.count).toBe(3);
    const cat = await ok(call("own", "dashboard.pro", { space: "sales", preset: "today", shopId: "all", filters: { categories: ["Hygiène"] } }, A)); expect(cat.totals.revenue).toBe(800); expect(cat.byArticle.map((x: any) => x.name)).toEqual(["Savon"]);
    const pay = await ok(call("own", "dashboard.pro", { space: "sales", preset: "today", filters: { methods: ["card"] } }, A)); expect(pay.totals.count).toBe(1); const shop = await ok(call("own", "dashboard.pro", { space: "sales", preset: "today", shopId: "all", filters: { shops: [B] } }, A)); expect(shop.totals.revenue).toBe(1500);
  });
  it("évolution jour / semaine / mois / année : même total quelle que soit la granularité", async () => {
    for (const d of [0, 3, 10, 40]) await ok(sell([{ productId: eau, qty: 1 }], cash(500), { soldAt: daysAgo(d) }));
    for (const gran of ["day", "week", "month", "year"]) { const d = await ok(call("own", "dashboard.pro", { space: "sales", preset: "last90", gran }, A)); expect(d.series.reduce((a: number, p: any) => a + p.revenue, 0), gran).toBe(2000); expect(d.gran).toBe(gran); }
  });
});

describe("rentabilité sur coûts historiques", () => {
  it("chaque vente garde SON coût : changer le coût de la fiche ensuite ne réécrit pas l'historique ; vente à perte et faible marge détectées ; coût manquant signalé", async () => {
    await ok(sell([{ productId: jus, qty: 2 }], cash(2000))); // coût 600
    await ok(call("own", "article.save", { id: jus, data: { name: "Jus", price: 1000, cost: 780, category: "Boissons" } })); await ok(sell([{ productId: jus, qty: 1 }], cash(1000))); // coût 780
    const sc = await mk("SansCoût", 1000, 0, 10); await ok(sell([{ productId: sc, qty: 1 }], cash(1000)));
    const d = await ok(call("own", "dashboard.pro", { space: "profit", preset: "today" }, A)); const jusRow = d.byArticle.find((x: any) => x.name === "Jus"); expect(jusRow.cogs).toBe(2 * 600 + 780); expect(jusRow.marginRate).not.toBeNull();
    expect(d.margin.amount).toBeNull(); expect(d.margin.note).toContain("non calculable"); expect(d.missingCost.articles[0]).toMatchObject({ name: "SansCoût" }); expect(d.byArticle.find((x: any) => x.name === "SansCoût").margin).toBeNull();
    await ok(call("own", "article.save", { id: eau, data: { name: "Eau", price: 500, cost: 900, category: "Boissons" } })); await ok(sell([{ productId: eau, qty: 1 }], cash(500)));
    const e = await ok(call("own", "dashboard.pro", { space: "profit", preset: "today" }, A)); expect(e.loss.count).toBe(1); expect(e.loss.lines[0]).toMatchObject({ name: "Eau", cost: 900 }); expect(e.loss.amount).toBeGreaterThan(0);
    const low = e.lowMargin.lines.map((l: any) => l.name); expect(low).toContain("Jus"); expect(e.lowMargin.thresholdPct).toBe(10);
    expect(e.contribution.reduce((a: number, c: any) => a + (c.revenueSharePct ?? 0), 0)).toBeGreaterThan(99); expect(e.evolution.find((x: any) => x.name === "Jus").weeks[0]).toMatchObject({ avgCost: Math.round((2 * 600 + 780) / 3), avgPrice: 1000 });
  });
});

describe("stocks : rotation, couverture, classes, ruptures, péremption, écarts", () => {
  it("valeur = rapports ; articles classés avec méthode ; dormant ; rupture fréquente reconstituée ; couverture", async () => {
    const dorm = await mk("Dormant", 900, 500, 20); const oos = await mk("Rupture", 900, 500, 10); await ok(sell([{ productId: oos, qty: 10 }], cash(9000))); await ok(call("own", "stock.adjust", { productId: oos, counted: 4 })); await ok(sell([{ productId: oos, qty: 4 }], cash(3600)));
    await ok(call("own", "stock.adjust", { productId: oos, counted: 6 })); await ok(sell([{ productId: oos, qty: 6 }], cash(5400)));
    await ok(sell([{ productId: eau, qty: 50 }], cash(25000)));
    const d = await ok(call("own", "dashboard.pro", { space: "stock", preset: "last30" }, A)); const rep = await ok(call("own", "report.consolidated", { from: d.period.to, to: d.period.to })); expect(d.valueTotal).toBe(rep.totals.stockValue);
    expect(d.lists.dormant.map((x: any) => x.name)).toContain("Dormant"); expect(d.lists.out.map((x: any) => x.name)).toContain("Rupture"); expect(d.frequentStockouts.map((x: any) => x.name)).toContain("Rupture"); expect(d.frequentStockouts[0].episodes).toBeGreaterThanOrEqual(2);
    const e = [...d.lists.fast, ...d.lists.slow, ...d.lists.overstock, ...d.lists.dormant, ...d.lists.out].find((x: any) => x.name === "Eau") ?? null; if (e) { expect(e.sold).toBe(50); expect(e.rotation).toBeGreaterThan(0); }
    expect(d.methods.rotation).toContain("stock moyen"); expect(d.methods.classes).toContain("90"); expect(d.counts.products).toBeGreaterThan(3); expect(d.dataUsed.products).toBeGreaterThan(0);
    const th = await ok(call("own", "dashboard.pro", { space: "stock", preset: "last30", thresholds: { slowDays: 7, fastDays: 1, overDays: 14 } }, A)); expect(th.thresholds).toMatchObject({ slowDays: 7, fastDays: 1, overDays: 14 });
  });
  it("lots expirés / proches de l'expiration ; écarts d'inventaire et pertes valorisés ; le stock initial n'est pas un écart", async () => {
    const lait = await mk("Lait", 700, 400, 0); await st.create("article_lots", "lot-exp", T, { tenantId: T, shopId: A, productId: lait, lotNo: "L1", expiresAt: daysAgo(3), unitCost: 400 }); await st.create("article_lots", "lot-soon", T, { tenantId: T, shopId: A, productId: lait, lotNo: "L2", expiresAt: new Date(Date.now() + 10 * 864e5).toISOString(), unitCost: 400 }); await st.create("article_lots", "lot-far", T, { tenantId: T, shopId: A, productId: lait, lotNo: "L3", expiresAt: new Date(Date.now() + 90 * 864e5).toISOString(), unitCost: 400 });
    for (const [i, lot] of ["lot-exp", "lot-soon", "lot-far"].entries()) await st.create("stock_moves", `m-lot-${i}`, T, { tenantId: T, shopId: A, productId: lait, lotId: lot, qty: 10, kind: "purchase", refId: "x" });
    await ok(call("own", "stock.adjust", { productId: eau, counted: 480 })); await st.create("stock_moves", "m-loss", T, { tenantId: T, shopId: A, productId: eau, qty: 5, kind: "loss", refId: "casse" });
    const d = await ok(call("own", "dashboard.pro", { space: "stock", preset: "today" }, A)); expect(d.expiry.expired).toHaveLength(1); expect(d.expiry.expired[0]).toMatchObject({ lotNo: "L1", qty: 10, value: 4000, daysLeft: -3 }); expect(d.expiry.soon.map((x: any) => x.lotNo)).toEqual(["L2"]); expect(d.expiry.soonValue).toBe(4000);
    expect(d.gaps.inventory).toMatchObject({ count: 1, net: -20, value: -6000 }); expect(d.gaps.loss).toMatchObject({ count: 1, value: -1500 }); expect(d.gaps.entries.every((g: any) => g.kind !== "ajustement" || g.qty !== 500)).toBe(true);
  });
});

describe("achats et fournisseurs", () => {
  it("montants, par fournisseur, délais observés, comparaison de prix, variation anormale, réapprovisionnement", async () => {
    await st.create("suppliers", "sup1", T, { tenantId: T, shopId: A, name: "Grossiste" }); await st.create("suppliers", "sup2", T, { tenantId: T, shopId: A, name: "Importateur" });
    const prices = [700, 705, 695, 700, 1200]; for (const [i, p] of prices.entries()) await ok(call("own", "po.create", { clientId: `p${i}abcd-client-0001`, supplierId: i === 3 ? "sup2" : "sup1", lines: [{ productId: eau, qty: 10, unitCost: p }] }));
    const po0 = st.rows("purchase_orders").find((o) => o.number && o.clientId !== undefined) ?? st.rows("purchase_orders")[0]!; st.rows("purchase_orders")[0]!.$createdAt = daysAgo(6); void po0;
    await ok(call("own", "po.receive", { poId: "p0abcd-client-0001", receiptId: "rcpt-0000-aaaa", lines: [{ productId: eau, qty: 10 }] })); await ok(call("own", "invoice.supplier.create", { poId: "p0abcd-client-0001", invoiceId: "inv-0000-0001" }));
    st.rows("stock_moves").filter((m) => m.kind === "purchase" && m.productId === eau)[0]!.$createdAt = daysAgo(3);
    const d = await ok(call("own", "dashboard.pro", { space: "purchases", preset: "last30" }, A)); expect(d.orders).toBe(5); expect(d.orderedTotal).toBe(10 * prices.reduce((a, b) => a + b, 0)); expect(d.invoicedHt).toBeGreaterThan(0);
    expect(d.bySupplier.map((s: any) => s.name)).toEqual(["Grossiste", "Importateur"]); expect(d.mostSolicited[0].name).toBe("Grossiste"); const g = d.bySupplier[0]; expect(g.avgLeadDays).toBeCloseTo(3, 0); expect(g.leadObservations).toBe(1); expect(d.bySupplier[1].avgLeadDays).toBeNull();
    expect(d.anomalies).toHaveLength(1); expect(d.anomalies[0]).toMatchObject({ name: "Eau", price: 1200, baseline: 700 }); expect(d.compare[0].suppliers.map((s: any) => s.name)).toEqual(["Importateur", "Grossiste"]); expect(d.evolution[0]).toMatchObject({ observations: 5, first: 700, last: 1200 });
    expect(d.history).toHaveLength(5); expect(d.history.find((h: any) => h.leadDays !== null).status).toBeDefined(); expect(d.methods.lead).toContain("première réception"); expect(d.reorder.reliability).toBeTruthy();
    const f = await ok(call("own", "dashboard.pro", { space: "purchases", preset: "last30", filters: { suppliers: ["sup2"] } }, A)); expect(f.orders).toBe(1); expect(f.bySupplier).toHaveLength(1);
  });
});

describe("magasins : comparaison, classement, isolation", () => {
  it("chaque magasin avec ses seules données ; classement ; écarts vs moyenne ; vendeurs par magasin", async () => {
    const eb = await mk("Eau", 500, 300, 100, { category: "Boissons" }, B); await ok(sell([{ productId: eau, qty: 6 }], cash(3000))); await ok(sell([{ productId: eb, qty: 2 }], cash(1000), {}, B));
    const d = await ok(call("own", "dashboard.pro", { space: "stores", preset: "today", shopId: "all" }, A)); expect(d.comparable).toBe(true); expect(d.shops.map((s: any) => [s.name, s.rankRevenue, s.revenue])).toEqual([["Dakar", 1, 3000], ["Thiès", 2, 1000]]); expect(d.shops[0].revenueGapPct).toBe(50); expect(d.shops[1].revenueGapPct).toBe(-50); expect(d.shops[0].sellers[0].revenue).toBe(3000); expect(d.shops[0].stockValue).toBeGreaterThan(0);
    const one = await ok(call("own", "dashboard.pro", { space: "stores", preset: "today", shopId: B }, B)); expect(one.shops).toHaveLength(1); expect(one.comparable).toBe(false); expect(one.shops[0].revenue).toBe(1000);
  });
});

describe("prévisions et recommandations", () => {
  it("historique insuffisant : aucune prévision ; avec 6 semaines : chaque recommandation a période, données, méthode, fiabilité et limites ; jamais « certaine »", async () => {
    await ok(sell([{ productId: eau, qty: 1 }], cash(500))); const none = await ok(call("own", "dashboard.pro", { space: "forecast", preset: "last30" }, A)); expect(none.insufficient).toBe(true); expect(none.recommendations).toEqual([]); expect(none.reason).toContain("28");
    const small = await mk("Petit stock", 1000, 400, 45); for (let wk = 0; wk < 6; wk++) for (const off of [1, 4]) { await ok(sell([{ productId: small, qty: 6 - wk }], cash(1000 * (6 - wk)), { soldAt: daysAgo(wk * 7 + off) })); await ok(sell([{ productId: jus, qty: 5 }], cash(5000), { soldAt: daysAgo(wk * 7 + off + 1) })); }
    const d = await ok(call("own", "dashboard.pro", { space: "forecast", preset: "last30" }, A)); expect(d.insufficient).toBe(false); expect(d.recommendations.length).toBeGreaterThan(0);
    for (const r of d.recommendations) { expect(r.period.from).toBeTruthy(); expect(r.method.length).toBeGreaterThan(20); expect(r.limits.length).toBeGreaterThan(10); expect(["insuffisante", "faible", "moyenne", "correcte"]).toContain(r.reliability); expect(Object.keys(r.data).length).toBeGreaterThan(0); }
    const kinds = d.recommendations.map((r: any) => r.kind); expect(kinds).toContain("potential"); expect(d.recommendations.find((r: any) => r.kind === "potential").subject).toBe("Petit stock"); expect(d.disclaimer).toContain("pas des certitudes"); expect(d.recommendations.every((r: any) => !/\bcertain(e|s)?\b/i.test(`${r.title} ${r.why ?? ""}`))).toBe(true);
    expect(kinds.some((k: string) => ["stockout", "reorder"].includes(k))).toBe(true); expect(d.recommendations.every((r: any) => r.reliability !== undefined)).toBe(true);
  });
  it("baisse inhabituelle de marge : détectée seulement avec coûts connus et assez de ventes", async () => {
    for (let i = 0; i < 12; i++) await ok(sell([{ productId: jus, qty: 1 }], cash(1000), { soldAt: daysAgo(8 + i * 2) })); await ok(call("own", "article.save", { id: jus, data: { name: "Jus", price: 1000, cost: 900, category: "Boissons" } }));
    for (let i = 0; i < 4; i++) await ok(sell([{ productId: jus, qty: 1 }], cash(1000), { soldAt: daysAgo(i) }));
    const d = await ok(call("own", "dashboard.pro", { space: "forecast", preset: "last30" }, A)); const m = d.recommendations.find((r: any) => r.kind === "margin_drop"); expect(m).toBeTruthy(); expect(m.data.recentRatePct).toBeLessThan(m.data.priorRatePct);
  });
});

describe("rapports et exports (données)", () => {
  it("huit rapports respectent période, magasin et filtres ; mêmes chiffres que les écrans ; type inconnu refusé", async () => {
    await st.create("suppliers", "sup1", T, { tenantId: T, shopId: A, name: "Grossiste" }); await ok(call("own", "po.create", { clientId: "po-client-0001", supplierId: "sup1", lines: [{ productId: eau, qty: 10, unitCost: 300 }] }));
    await ok(sell([{ productId: eau, qty: 2 }, { productId: savon, qty: 1 }], cash(1800))); await ok(call("own", "stock.adjust", { productId: eau, counted: 450 }));
    const screen = await pro({ preset: "today" });
    for (const kind of ["commercial", "profit", "stock", "inventory", "purchases", "suppliers", "store", "seller"]) { const r = await ok(call("own", "dashboard.report", { kind, preset: "today" }, A)); expect(r.kind).toBe(kind); expect(r.title).toBeTruthy(); expect(r.sections.length).toBeGreaterThan(0); expect(r.scope).toEqual(["Dakar"]); expect(r.period.from).toBe(screen.period.from); for (const s of r.sections) for (const row of s.rows) expect(row).toHaveLength(s.columns.length); }
    const com = await ok(call("own", "dashboard.report", { kind: "commercial", preset: "today" }, A)); expect(com.sections[0].rows.find((x: any) => x[0].startsWith("Chiffre"))[1]).toBe(screen.totals.revenue);
    const f = await ok(call("own", "dashboard.report", { kind: "commercial", preset: "today", filters: { categories: ["Hygiène"] } }, A)); expect(f.sections[0].rows[0][1]).toBe(800); expect(f.filters).toEqual({ categories: ["Hygiène"] });
    await err(call("own", "dashboard.report", { kind: "inconnu" }), 400); await err(call(U.cais!, "dashboard.report", { kind: "commercial" }), 403);
  });
});
