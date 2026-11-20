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

const gp = (b: object = {}, user = "own", shop = A) => call(user, "dashboard.profit", { preset: "last30", ...b }, shop);

describe("onglet Bénéfice brut du tableau de bord", () => {
  it("toutes les formules (Starter, Business, Pro) ; propriétaire et gérant seulement", async () => {
    await ok(sell([{ productId: eau, qty: 2 }], cash(1000)));
    for (const plan of ["starter", "business", "pro"]) { setPlan(plan); const d = await ok(gp()); expect(d.totals.profit).toBe(d.totals.revenueHt - 600); expect(d.totals.profit).toBeGreaterThan(0); }
    await ok(gp({}, U.ger!)); await err(gp({}, U.cais!), 403); await err(gp({}, "own2"), 403);
  });
  it("bénéfice brut = CA HT − coût figé ; taux de marge et de marque ; coût figé à la vente (un changement de coût ne modifie pas le passé)", async () => {
    await ok(sell([{ productId: eau, qty: 2 }, { productId: jus, qty: 1 }], cash(2000))); await ok(call("own", "article.save", { id: eau, data: { cost: 450 } }));
    const d = await ok(gp()); expect(d.totals).toMatchObject({ cogs: 1200, complete: true, coveragePct: 100, linesWithoutCost: 0 }); expect(d.totals.profit).toBe(d.totals.revenueHt - 1200); expect(d.totals.revenueHt).toBeGreaterThan(1600); expect(d.totals.revenueHt).toBeLessThan(1800); expect(d.totals.markup).toBeCloseTo(d.totals.profit / 1200 * 100, 0);
    expect(d.best.map((x: any) => x.name).sort()).toEqual(["Eau", "Jus"]); expect(d.byCategory.find((c: any) => c.name === "Boissons")).toBeTruthy(); expect(d.missingCost).toEqual([]);
  });
  it("coût inconnu : jamais de coût inventé — bénéfice « partiel » sur les lignes avec coût, couverture indiquée, articles à renseigner listés", async () => {
    const sans = await mk("Divers", 1000, 0, 50); await ok(sell([{ productId: eau, qty: 2 }, { productId: sans, qty: 1 }], cash(2000)));
    const d = await ok(gp()); expect(d.totals).toMatchObject({ complete: false, profit: null, linesWithoutCost: 1 }); expect(d.totals.partialProfit).toBeGreaterThan(0); expect(d.totals.coveragePct).toBeGreaterThan(0); expect(d.totals.coveragePct).toBeLessThan(100); expect(d.missingCost).toMatchObject([{ name: "Divers", lines: 1 }]);
    expect(d.notes.join(" ")).toMatch(/Coût d'achat inconnu/); expect(d.series.some((p: any) => p.partialProfit > 0)).toBe(true);
  });
  it("comparaison avec la période précédente de même durée ; courbe jour par jour", async () => {
    await ok(sell([{ productId: eau, qty: 2 }], cash(1000)));
    const prev = st.rows("sales").at(-1)!; await ok(sell([{ productId: eau, qty: 1 }], cash(500))); const s2 = st.rows("sales").at(-1)!; s2.soldAt = daysAgo(31); void prev;
    const d = await ok(gp({ preset: "last30" })); expect(d.prevTotals.profit).toBe(d.prevTotals.revenueHt - 300); expect(d.prevTotals.profit).toBeGreaterThan(0); expect(d.deltas.profit).toBeGreaterThan(0); expect(d.deltas.profitIsPartial).toBe(false); expect(d.series.length).toBeGreaterThanOrEqual(30); expect(d.prevSeries.length).toBeGreaterThanOrEqual(30);
  });
  it("plusieurs boutiques : détail par boutique seulement en « toutes » ; boutique non autorisée refusée ; isolation entre commerces", async () => {
    await ok(sell([{ productId: eau, qty: 2 }], cash(1000))); const eB = await mk("EauB", 500, 300, 100, {}, B); await ok(sell([{ productId: eB, qty: 1 }], cash(500), {}, B));
    expect((await ok(gp({}))).byShop).toEqual([]); const all = await ok(gp({ shopId: "all" })); expect(all.byShop).toHaveLength(2); expect(all.totals.profit).toBe(all.totals.revenueHt - 900);
    await err(gp({ shopId: X }), 403);
  });
});
