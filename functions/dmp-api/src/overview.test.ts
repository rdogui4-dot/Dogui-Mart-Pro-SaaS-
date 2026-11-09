import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";

/** Store de test qui date les lignes à leur création, comme Appwrite ($createdAt). */
class DatedStore extends MemoryStore { override async create(t: string, id: string, tenant: string, d: Record<string, unknown>) { return super.create(t, id, tenant, { $createdAt: new Date().toISOString(), ...d }); } }
const T = "tenantov001", T2 = "tenantov002";
let st: DatedStore; let A = "", B = "", X = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}, shop = A, tenant = T) => handle(st, user, { action, tenantId: tenant, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); };
const setPlan = (plan: string, tenant = T) => { const row = st.rows("subscriptions").find((r) => r.$id === tenant); const data = { tenantId: tenant, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", tenant, tenant, data); };
let n = 0; const id8 = (p: string) => `${p}-${String(++n).padStart(8, "0")}`;
const mk = async (name: string, price: number, cost: number, qty = 0, extra: object = {}, shop = A, tenant = T, user = "own") => (await ok(call(user, "article.save", { data: { name, price, cost, ...extra }, ...(qty ? { initialQty: qty } : {}) }, shop, tenant))).id as string;
const sell = (lines: object[], payments: object[], extra: object = {}, shop = A) => call("own", "checkout", { clientId: id8("vente"), lines, payments, ...extra }, shop);
const dash = (b: object = {}, user = "own", shop = A) => ok(call(user, "dashboard.business", b, shop));
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
let eau = "", jus = "";

beforeEach(async () => {
  st = new DatedStore(); n = 0; await st.grant(T, "own", ["owner"], []); await st.grant(T2, "own2", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId; X = (await ok(call("own2", "shop.create", { name: "Autre commerce" }, "", T2))).shopId;
  for (const [u, role, shops] of [["cais", "cashier", [A]], ["ger", "manager", [A]], ["compta", "accountant", [A, B]]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: shops }, ""))).userId;
  setPlan("business"); setPlan("business", T2);
  eau = await mk("Eau", 500, 300, 100, { category: "Boissons" }); jus = await mk("Jus", 1000, 600, 100, { category: "Boissons" });
});

describe("droits et formule", () => {
  it("Starter : 402 ; caissier : 403 ; gérant, comptable et propriétaire : accès à leurs boutiques seulement", async () => {
    setPlan("starter"); await err(call("own", "dashboard.business"), 402); setPlan("business");
    await err(call(U.cais!, "dashboard.business"), 403); await dash({}, U.ger!); await dash({ shopId: B }, U.compta!, B); await err(call(U.ger!, "dashboard.business", { shopId: B }, B), 403); const g = await dash({ shopId: "all" }, U.ger!); expect(g.scope.shops).toHaveLength(1); expect(g.scope.many).toBe(false); expect((await dash({ shopId: "all" }, U.compta!)).scope.shops).toHaveLength(2);
  });
  it("isolation : les ventes d'un autre commerce n'apparaissent jamais", async () => {
    const o = await mk("Intrus", 1000, 100, 10, {}, X, T2, "own2"); await ok(call("own2", "checkout", { clientId: id8("autre"), lines: [{ productId: o, qty: 5 }], payments: [{ method: "cash", amount: 5000 }] }, X, T2));
    await ok(sell([{ productId: eau, qty: 1 }], [{ method: "cash", amount: 500 }])); const d = await dash({ preset: "today" }); expect(d.kpis.today.revenue).toBe(500); expect((await dash({ shopId: "all", preset: "today" }, "own")).kpis.today.revenue).toBe(500);
    await err(call("own", "dashboard.business", { shopId: X }), 403);
  });
});

describe("chiffre d'affaires, paiements, marge", () => {
  it("jour / mois / période : seules les ventes terminées comptent ; paiements fractionnés comptés une fois ; crédit et monnaie rendue", async () => {
    const c = (await ok(call("own", "entity.save", { table: "customers", data: { name: "Awa", creditLimit: 100000 } }))).id as string;
    await ok(sell([{ productId: eau, qty: 4 }], [{ method: "cash", amount: 1000 }, { method: "card", amount: 1000 }])); // 2 000 en 2 paiements
    await ok(sell([{ productId: jus, qty: 1 }], [{ method: "cash", amount: 5000 }])); // 1 000, 4 000 de monnaie rendue
    await ok(sell([{ productId: jus, qty: 3 }], [{ method: "credit", amount: 3000 }], { customerId: c })); // 3 000 à crédit
    st.rows("sales")[0]!.status = "cancelled"; // une vente annulée (état hypothétique) ne compte pas
    const d = await dash({ preset: "today" }); expect(d.kpis.period).toMatchObject({ count: 2, revenue: 4000, avgBasket: 2000, credit: 3000, encaisse: 1000 });
    expect(d.kpis.today).toMatchObject({ revenue: 4000, count: 2 }); expect(d.kpis.month.revenue).toBe(4000);
    expect(Object.fromEntries(d.charts.byMethod.map((x: any) => [x.method, x.amount]))).toEqual({ cash: 1000, credit: 3000 });
    st.rows("sales")[0]!.status = "paid"; const e = await dash({ preset: "today" }); expect(e.kpis.period.revenue).toBe(6000); expect(Object.fromEntries(e.charts.byMethod.map((x: any) => [x.method, x.amount]))).toEqual({ cash: 2000, card: 1000, credit: 3000 });
    expect(e.kpis.period.encaisse + e.kpis.period.credit).toBe(e.kpis.period.revenue); // aucun double compte
  });
  it("les ventes non finalisées sont exclues et signalées ; elles ne le sont qu'après 10 minutes", async () => {
    await ok(sell([{ productId: eau, qty: 1 }], [{ method: "cash", amount: 500 }])); const sale = st.rows("sales")[0]!;
    await st.create("sales", "stuck0000001", T, { tenantId: T, shopId: A, number: "V-STUCK", total: 9999, vat: 0, status: "posted", soldAt: new Date(Date.now() - 3_600_000).toISOString(), payments: "[]", lines: "[]", clientId: "stuck0000001" });
    await st.create("sales", "fresh0000001", T, { tenantId: T, shopId: A, number: "V-FRESH", total: 7777, vat: 0, status: "pending", soldAt: new Date().toISOString(), payments: "[]", lines: "[]", clientId: "fresh0000001" });
    const d = await dash({ preset: "today" }); expect(d.kpis.period.revenue).toBe(sale.total); expect(d.alerts.find((a: any) => a.type === "stuck")).toMatchObject({ count: 1 });
  });
  it("marge : calculée seulement si TOUTES les lignes ont un coût ; sinon indicative et explicitée ; jamais de marge sans coût", async () => {
    await ok(sell([{ productId: eau, qty: 2 }], [{ method: "cash", amount: 1000 }])); let d = await dash({ preset: "today" }); const vatRate = 18; const ht = Math.round(1000 / (1 + vatRate / 100)); expect(d.kpis.period.margin).toMatchObject({ known: true, amount: ht - 600, linesWithoutCost: 0 });
    const sc = await mk("SansCoût", 1000, 0, 10); await ok(sell([{ productId: sc, qty: 1 }], [{ method: "cash", amount: 1000 }])); d = await dash({ preset: "today" }); expect(d.kpis.period.margin).toMatchObject({ known: false, amount: null, pct: null, linesWithoutCost: 1 });
  });
  it("graphiques : 7 jours, série de la période, top 5, catégories, modes de paiement — issus des ventes enregistrées", async () => {
    const art = []; for (let i = 0; i < 7; i++) art.push(await mk(`Art${i}`, 100 * (i + 1), 10, 100, { category: i < 3 ? "Hygiène" : "" }));
    for (const [i, a] of art.entries()) await ok(sell([{ productId: a, qty: 1 + i }], [{ method: i % 2 ? "card" : "cash", amount: 100 * (i + 1) * (i + 1) }]));
    const d = await dash({ preset: "today" }); expect(d.charts.top).toHaveLength(5); expect(d.charts.top[0].name).toBe("Art6"); expect(d.charts.last7).toHaveLength(7); expect(d.charts.series).toHaveLength(1);
    const cats = Object.fromEntries(d.charts.byCategory.map((x: any) => [x.category, x.revenue])); expect(cats["Hygiène"]).toBe(100 * 1 + 200 * 2 + 300 * 3); expect(cats["Sans catégorie"]).toBe(400 * 4 + 500 * 5 + 600 * 6 + 700 * 7);
    expect(d.charts.last7.at(-1).revenue).toBe(d.kpis.today.revenue); expect(d.charts.byMethod.reduce((a: number, x: any) => a + x.amount, 0)).toBe(d.kpis.period.encaisse);
  });
});

describe("périodes et fuseau horaire de l'entreprise", () => {
  const at = (iso: string) => ok(sell([{ productId: eau, qty: 1 }], [{ method: "cash", amount: 500 }], { soldAt: iso }));
  it("hier / 7 jours / 30 jours / ce mois / mois précédent / personnalisée sont cohérents entre eux", async () => {
    const today = (await dash({ preset: "today" })).today; const d0 = (n: number) => new Date(Date.parse(`${today}T12:00:00Z`) - n * 864e5).toISOString();
    await at(d0(0)); await at(d0(1)); await at(d0(1)); await at(d0(6)); await at(d0(20));
    expect((await dash({ preset: "today" })).kpis.period.count).toBe(1); expect((await dash({ preset: "yesterday" })).kpis.period.count).toBe(2); expect((await dash({ preset: "last7" })).kpis.period.count).toBe(4); expect((await dash({ preset: "last30" })).kpis.period.count).toBe(5);
    const cf = await dash({ preset: "custom", from: d0(6).slice(0, 10), to: d0(1).slice(0, 10) }); expect(cf.kpis.period.count).toBe(3); expect(cf.charts.series).toHaveLength(6);
    const m = await dash({ preset: "month" }); const lm = await dash({ preset: "lastMonth" }); expect(m.kpis.period.count + lm.kpis.period.count).toBeGreaterThanOrEqual(1); expect(m.period.from).toBe(`${today.slice(0, 8)}01`); expect(lm.period.to < m.period.from).toBe(true);
    await err(call("own", "dashboard.business", { preset: "custom", from: "2026-02-01", to: "2026-01-01" }), 400); await err(call("own", "dashboard.business", { preset: "custom", from: "x", to: "y" }), 400); await err(call("own", "dashboard.business", { preset: "custom", from: "2025-01-01", to: "2026-01-01" }), 400, "92");
  });
  it("le jour suit le fuseau de l'entreprise : une vente à 23h30 UTC tombe le lendemain à Lagos (UTC+1), pas à Dakar (UTC)", async () => {
    const now = new Date(); const dayUtc = now.toISOString().slice(0, 10); const t = new Date(Date.parse(`${dayUtc}T23:30:00Z`) - 864e5).toISOString(); // veille 23h30 UTC
    await at(t); const row = () => st.rows("shops").find((s) => s.$id === A.slice(0, 36))!;
    const dakar = await dash({ preset: "custom", from: dayUtc, to: dayUtc }); expect(dakar.kpis.period.count).toBe(0);
    row().promoTz = "Africa/Lagos"; const lagos = await dash({ preset: "custom", from: dayUtc, to: dayUtc }); expect(lagos.tz).toBe("Africa/Lagos"); expect(lagos.kpis.period.count).toBe(1); expect(lagos.charts.series[0].count).toBe(1);
  });
});

describe("stock, achats et alertes (événements réels uniquement)", () => {
  it("aucune alerte sans événement ; ruptures, seuil, sans prix, achats en attente apparaissent avec leurs chiffres", async () => {
    let d = await dash({ preset: "today" }); expect(d.alerts).toEqual([]); expect(d.kpis.stock).toMatchObject({ articles: 2, out: 0, low: 0 }); expect(d.activity.sales).toEqual([]);
    const rare = await mk("Rare", 800, 400, 3, { minStock: 5 }); const zero = await mk("Zéro", 800, 400, 0); await mk("Gratuit", 0, 0, 5);
    st.rows("suppliers").length || await st.create("suppliers", "sup1", T, { tenantId: T, shopId: A, name: "Grossiste" });
    await ok(call("own", "po.create", { clientId: "po-client-0001", supplierId: "sup1", lines: [{ productId: eau, qty: 10, unitCost: 300 }] }));
    d = await dash({ preset: "today" }); const by = Object.fromEntries(d.alerts.map((a: any) => [a.type, a]));
    expect(by.out.count).toBe(1); expect(by.out.detail).toContain("Zéro"); expect(by.low.count).toBe(1); expect(by.low.detail).toContain("Rare"); expect(by.noprice.count).toBe(1); expect(by.noprice.detail).toContain("Gratuit"); expect(by.po.count).toBe(1);
    expect(d.alerts.some((a: any) => a.type === "cancelled" || a.type === "inventory")).toBe(false); expect(zero && rare).toBeTruthy();
    await ok(call("own", "po.receive", { poId: "po-client-0001", receiptId: "rcpt-0001-aaaa", lines: [{ productId: eau, qty: 10 }] })); expect((await dash({ preset: "today" })).alerts.find((a: any) => a.type === "po")).toBeUndefined();
  });
  it("valeur du stock = celle des rapports ; achats = journal comptable de la période ; valeur nulle (jamais fausse) si l'historique est tronqué", async () => {
    await st.create("suppliers", "sup1", T, { tenantId: T, shopId: A, name: "Grossiste" });
    await ok(call("own", "po.create", { clientId: "po-client-0001", supplierId: "sup1", lines: [{ productId: eau, qty: 10, unitCost: 700 }] })); await ok(call("own", "po.receive", { poId: "po-client-0001", receiptId: "rcpt-0001-aaaa", lines: [{ productId: eau, qty: 10 }] })); await ok(call("own", "invoice.supplier.create", { poId: "po-client-0001", invoiceId: "inv-0000-0001" }));
    const d = await dash({ preset: "today" }); const rep = await ok(call("own", "report.consolidated", { from: d.today, to: d.today })); expect(d.kpis.stock.value).toBe(rep.totals.stockValue); expect(d.kpis.stock.value).toBeGreaterThan(0);
    expect(d.kpis.period.purchases).toBeGreaterThan(0); expect((await dash({ preset: "yesterday" })).kpis.period.purchases).toBe(0); expect(d.kpis.stock.methodLabel).toBeTruthy();
  });
  it("activité récente : ventes (avec lignes), achats, mouvements, articles créés, opérations importantes (inventaire, perte, transfert)", async () => {
    await ok(sell([{ productId: eau, qty: 2 }], [{ method: "cash", amount: 1000 }])); await ok(call("own", "stock.adjust", { productId: eau, counted: 90 }));
    const d = await dash({ preset: "today" }); expect(d.activity.sales[0]).toMatchObject({ total: 1000, lines: [{ name: "Eau", qty: 2 }] }); expect(d.activity.moves.length).toBeGreaterThan(0); expect(d.activity.created.map((x: any) => x.name)).toEqual(expect.arrayContaining(["Eau", "Jus"]));
    expect(d.activity.important.find((x: any) => /Inventaire/.test(x.label))).toMatchObject({ name: "Eau", qty: expect.any(Number) });
  });
  it("tous les magasins : consolidation et détail par magasin ; un seul magasin ne propose pas de comparaison", async () => {
    const eb = await mk("Eau", 500, 300, 50, {}, B); await ok(sell([{ productId: eau, qty: 2 }], [{ method: "cash", amount: 1000 }])); await ok(sell([{ productId: eb, qty: 1 }], [{ method: "cash", amount: 500 }], {}, B));
    const all = await dash({ preset: "today", shopId: "all" }); expect(all.kpis.period.revenue).toBe(1500); expect(all.charts.byShop.map((x: any) => x.revenue).sort((a: number, b: number) => a - b)).toEqual([500, 1000]); expect((await dash({ preset: "today", shopId: B }, "own", B)).kpis.period.revenue).toBe(500);
    expect(all.scope.many).toBe(true);
  });
});
