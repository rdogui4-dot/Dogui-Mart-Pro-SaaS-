import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";

const T = "tenantrep01";
let st: MemoryStore; let A = "", B = "", mgrA = "", cashA = "";
const call = (user: string, action: string, payload: unknown, shop = "", tenant = T) => handle(st, user, { action, tenantId: tenant, shopId: shop, payload }, { admins: ["root"] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const ymd = (n: number) => day(n).slice(0, 10);
const vatOf = (total: number) => total - Math.round(total / 1.18);

async function product(shop: string, mgr: string, name: string, barcode: string | undefined, cost: number, stock: number, minStock = 0) {
  const p = await ok(call(mgr, "entity.save", { table: "products", data: { name, price: 1000, cost, barcode, minStock } }, shop));
  await ok(call(mgr, "stock.adjust", { productId: p.id, counted: stock }, shop)); return p.id as string;
}
const sell = (user: string, shop: string, id: string, productId: string, qty: number, daysAgo: number, method = "cash", extra: object = {}) =>
  ok(call(user, "checkout", { clientId: id, soldAt: day(daysAgo), lines: [{ productId, qty }], payments: [{ method, amount: qty * 1000 }], ...extra }, shop));

beforeEach(async () => {
  st = new MemoryStore();
  await st.grant(T, "own", ["owner"], []); await st.grant("othertenant", "ownerX", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }))).shopId;
  const mk = async (u: string, role: string, shops: string[]) => (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: shops }))).userId as string;
  mgrA = await mk("mgr.a", "manager", [A]); cashA = await mk("cash.a", "cashier", [A]);
  const mgrB = await mk("mgr.b", "manager", [B]);
  // Boutique A : Riz (coût 600, stock 100 → 5 vendus) ; Boutique B : même riz (même code-barres), coût 700
  const rizA = await product(A, mgrA, "Riz 1kg", "6001", 600, 100, 5); const rizB = await product(B, mgrB, "Riz parfumé", "6001", 700, 40, 5);
  await sell(mgrA, A, "saleA-0000-0001", rizA, 2, 1); await sell(mgrA, A, "saleA-0000-0002", rizA, 3, 2, "card"); await sell(mgrB, B, "saleB-0000-0001", rizB, 1, 1, "card");
});
const report = (user: string, from = ymd(7), to = ymd(0)) => call(user, "report.consolidated", { from, to });

describe("accès", () => {
  it("caissier refusé ; gérant limité à ses boutiques ; propriétaire : toutes ; autre commerce : refusé", async () => {
    expect((await report(cashA)).status).toBe(403);
    expect((await ok(report(mgrA))).shops.map((s: any) => s.name)).toEqual(["Dakar"]);
    expect((await ok(report("own"))).shops.map((s: any) => s.name).sort()).toEqual(["Dakar", "Thiès"]);
    expect((await handle(st, "ownerX", { action: "report.consolidated", tenantId: T, payload: { from: ymd(7), to: ymd(0) } })).status).toBe(403);
  });
  it("un gérant désactivé est refusé (plus aucun accès)", async () => {
    await ok(call("own", "staff.update", { userId: mgrA, active: false }));
    const r: any = await report(mgrA); expect(r.status).toBe(403); expect(r.body.error).toMatch(/non attribué/);
  });
  it("reste consultable quand l'abonnement est expiré (écritures refusées)", async () => {
    st.tables.get("subscriptions")!.set(T, { $id: T, tenantId: T, plan: "business", period: "month", status: "paid", renewsAt: day(30) });
    expect((await report("own")).status).toBe(200);
    expect((await call("own", "entity.save", { table: "customers", data: { name: "C" } }, A)).status).toBe(402);
  });
  it("valide la période", async () => {
    for (const p of [{ from: ymd(0), to: ymd(3) }, { from: "x", to: "y" }, { from: ymd(200), to: ymd(0) }, {}]) expect((await call("own", "report.consolidated", p)).status).toBe(400);
  });
});

describe("chiffres", () => {
  it("par boutique : ventes, chiffre d'affaires, TVA, marge sur coût figé, encaissements", async () => {
    const r = await ok(report("own")); const a = r.shops.find((s: any) => s.name === "Dakar"), b = r.shops.find((s: any) => s.name === "Thiès");
    expect(a).toMatchObject({ count: 2, revenueTtc: 5000, vat: vatOf(2000) + vatOf(3000), byMethod: { cash: 2000, card: 3000 } });
    expect(a.revenueHt).toBe(5000 - a.vat);
    expect(a.grossMargin).toBe(a.revenueHt - 5 * 600); expect(a.costCoveragePct).toBe(100);
    expect(b).toMatchObject({ count: 1, revenueTtc: 1000, byMethod: { card: 1000 }, grossMargin: 1000 - vatOf(1000) - 700 });
  });
  it("consolidé : somme des boutiques, série quotidienne alignée, produits regroupés par code-barres", async () => {
    const r = await ok(report("own"));
    expect(r.totals).toMatchObject({ count: 3, revenueTtc: 6000, avgBasket: 2000, byMethod: { cash: 2000, card: 4000 } });
    expect(r.totals.grossMargin).toBe(r.shops.reduce((s: number, x: any) => s + x.grossMargin, 0));
    expect(r.daily).toHaveLength(8); expect(r.daily.reduce((s: number, d: any) => s + d.revenueTtc, 0)).toBe(6000);
    expect(r.topProducts).toHaveLength(1); expect(r.topProducts[0]).toMatchObject({ qty: 6, revenueTtc: 6000 }); // les deux « riz » partagent le code-barres 6001
  });
  it("la période filtre : une vente plus ancienne n'est pas comptée", async () => {
    const rizA = (await st.list("products", { shopId: A }, 1))[0]!.$id;
    await sell(mgrA, A, "saleA-0000-0003", rizA, 1, 20);
    expect((await ok(report("own", ymd(7), ymd(0)))).totals.count).toBe(3);
    expect((await ok(report("own", ymd(30), ymd(0)))).totals.count).toBe(4);
  });
  it("marge connue sur une partie seulement : marge globale absente, marge indicative et couverture affichées", async () => {
    const sans = await product(A, mgrA, "Sachet", undefined, 0, 50);
    await sell(mgrA, A, "saleA-0000-0004", sans, 2, 1);
    const a = (await ok(report("own"))).shops.find((s: any) => s.name === "Dakar");
    expect(a.grossMargin).toBeNull(); expect(a.marginPct).toBeNull();
    expect(a.costCoveragePct).toBe(Math.round((5000 / 7000) * 100)); expect(a.indicativeMargin).toBeGreaterThan(0);
  });
  it("créances, dettes et stock valorisé", async () => {
    const c = await ok(call(mgrA, "entity.save", { table: "customers", data: { name: "Awa", creditLimit: 50_000 } }, A));
    const rizA = (await st.list("products", { shopId: A, name: "Riz 1kg" }, 1))[0]!.$id;
    await ok(call(mgrA, "checkout", { clientId: "saleA-credit-01", customerId: c.id, lines: [{ productId: rizA, qty: 4 }], payments: [{ method: "credit", amount: 4000 }] }, A));
    const sup = await ok(call(mgrA, "entity.save", { table: "suppliers", data: { name: "Grossiste" } }, A));
    await ok(call(mgrA, "po.create", { clientId: "po-client-0001", supplierId: sup.id, lines: [{ productId: rizA, qty: 10, unitCost: 500 }] }, A));
    await ok(call(mgrA, "po.receive", { poId: "po-client-0001", receiptId: "rcpt-0001-aaaa", lines: [{ productId: rizA, qty: 10 }] }, A));
    await ok(call(mgrA, "invoice.supplier.create", { poId: "po-client-0001", invoiceId: "inv-sup-00001" }, A));
    const a = (await ok(report("own"))).shops.find((s: any) => s.name === "Dakar");
    expect(a.openCredit).toBe(4000); expect(a.payables).toBe(Math.round(5000 * 1.18));
    // stock du riz : 100 − 5 − 4 + 10 = 101, au coût moyen recalculé à la réception
    const riz = (await st.list("products", { shopId: A, name: "Riz 1kg" }, 1))[0]!;
    expect(a.stockValue).toBe(101 * Number(riz.cost));
  });
  it("ruptures : produits au seuil d'alerte ou en dessous", async () => {
    const low = await product(A, mgrA, "Sucre", "7002", 300, 3, 5);
    expect(low).toBeTruthy();
    expect((await ok(report("own"))).shops.find((s: any) => s.name === "Dakar").stockouts).toBe(1);
  });
  it("historique de stock tronqué : valeur du stock absente (jamais fausse) et la boutique est marquée", async () => {
    const orig = st.scan.bind(st);
    st.scan = async (table, where, opts) => { const r = await orig(table, where, opts); return table === "stock_moves" ? { ...r, truncated: true } : r; };
    const r = await ok(report("own"));
    expect(r.shops[0].stockValue).toBeNull(); expect(r.shops[0].stockouts).toBeNull(); expect(r.shops[0].truncated.stock).toBe(true);
    expect(r.totals.stockValue).toBeNull(); expect(r.totals.revenueTtc).toBe(6000);
  });
  it("ventes tronquées : rapport marqué partiel", async () => {
    const orig = st.scan.bind(st);
    st.scan = async (table, where, opts) => { const r = await orig(table, where, opts); return table === "sales" ? { ...r, truncated: true } : r; };
    expect((await ok(report("own"))).partial).toBe(true);
  });
});

describe("date de vente", () => {
  it("refuse une date dans le futur ou de plus de 45 jours ; accepte une vente hors ligne récente", async () => {
    const rizA = (await st.list("products", { shopId: A }, 1))[0]!.$id;
    const attempt = (id: string, soldAt: string) => call(mgrA, "checkout", { clientId: id, soldAt, lines: [{ productId: rizA, qty: 1 }], payments: [{ method: "cash", amount: 1000 }] }, A);
    expect((await attempt("sale-late-0001", new Date(Date.now() + 3_600_000).toISOString())).status).toBe(400);
    expect((await attempt("sale-late-0002", day(46))).status).toBe(400);
    expect((await attempt("sale-late-0003", "pas une date")).status).toBe(400);
    expect((await attempt("sale-late-0004", day(40))).status).toBe(200);
    expect((await attempt("sale-late-0005", new Date(Date.now() + 60_000).toISOString())).status).toBe(200);
  });
});
