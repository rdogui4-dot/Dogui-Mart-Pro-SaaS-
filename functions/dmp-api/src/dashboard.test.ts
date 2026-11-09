import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";

const T = "tenantdsh001"; let st: MemoryStore; let A = "", B = "";
const call = (user: string, action: string, payload: unknown, shop = A) => handle(st, user, { action, tenantId: T, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); return x.body.error as string; };
const setPlan = (plan: string) => { const row = st.rows("subscriptions").find((r) => r.$id === T); const data = { tenantId: T, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", T, T, data); };
const dayStr = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
let n = 0; const id8 = (p: string) => `${p}-${String(++n).padStart(8, "0")}`;
const mk = async (name: string, price: number, cost: number, qty = 0, extra: object = {}) => (await ok(call("own", "article.save", { data: { name, price, cost, ...extra }, ...(qty ? { initialQty: qty } : {}) }))).id as string;
const dash = () => ok(call("own", "articles.dashboard", {}));

beforeEach(async () => {
  st = new MemoryStore(); n = 0; await st.grant(T, "own", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId; setPlan("pro");
});

describe("tableau de bord articles (Pro)", () => {
  it("indicateurs réels : valeur du stock, ruptures, stock bas, vente à perte, bundle bloqué", async () => {
    const ok1 = await mk("Eau", 500, 300, 50), low = await mk("Pain", 200, 100, 3, { minStock: 5 }), out = await mk("Jus", 500, 300, 0), loss = await mk("Perte", 100, 150, 10);
    const pack = await mk("Pack", 1000, 0, 0, { kind: "bundle" }); await ok(call("own", "bundle.components", { bundleId: pack, components: [{ productId: out, qty: 1 }] }));
    const d = await dash(); void ok1; void low; void loss;
    expect(d.partial).toBe(false); expect(d.kpis).toMatchObject({ articles: 4, bundles: 1, stockValue: 50 * 300 + 3 * 100 + 0 + 10 * 150, out: 1, low: 1, negativeMargin: 1, bundlesBlocked: 1, expired: 0, expiring: 0 });
    expect(d.alerts.map((a: any) => a.type).sort()).toEqual(["bundle_blocked", "margin_negative", "stock_low", "stock_out"]);
  });
  it("lots périmés et proches de la péremption (seulement avec du stock)", async () => {
    const y = await mk("Yaourt", 500, 300, 0, { tracking: "lot" });
    await ok(call("own", "lot.receive", { productId: y, lotNo: "A", qty: 4, expiresAt: dayStr(-3) })); await ok(call("own", "lot.receive", { productId: y, lotNo: "B", qty: 2, expiresAt: dayStr(10) })); await ok(call("own", "lot.receive", { productId: y, lotNo: "C", qty: 9, expiresAt: dayStr(200) }));
    const d = await dash(); expect(d.kpis).toMatchObject({ expired: 1, expiring: 1 }); expect(d.alerts.find((a: any) => a.type === "lot_expired").detail).toContain("4 en stock");
    expect(d.kpis.stockValue).toBe(15 * 300);
  });
  it("alertes dédupliquées par jour, accusé de lecture conservé, tracé (qui/quand)", async () => {
    await mk("Jus", 500, 300, 0); await dash(); await dash(); expect(st.rows("article_alerts")).toHaveLength(1);
    const a = (await dash()).alerts[0]; expect(a.status).toBe("open");
    expect((await ok(call("own", "alerts.ack", { id: a.id }))).acknowledged).toBe(1); expect((await ok(call("own", "alerts.ack", { id: a.id }))).acknowledged).toBe(0);
    expect((await dash()).alerts[0].status).toBe("read"); expect(st.rows("article_alerts")[0]).toMatchObject({ status: "read", readBy: "own" }); expect(st.rows("article_alerts")).toHaveLength(1);
    await mk("Eau", 500, 300, 0); await dash(); expect((await ok(call("own", "alerts.ack", { all: true }))).acknowledged).toBe(1);
  });
  it("meilleurs articles par chiffre d'affaires et par marge sur la période", async () => {
    const a = await mk("Eau", 500, 300, 50), b = await mk("Jus", 1000, 900, 50);
    await ok(call("own", "checkout", { clientId: id8("vente"), lines: [{ productId: a, qty: 10 }, { productId: b, qty: 6 }], payments: [{ method: "cash", amount: 11000 }] }));
    const d = await dash(); expect(d.top.byRevenue[0].name).toBe("Jus"); expect(d.top.byMargin[0].name).toBe("Eau"); expect(d.top.byRevenue).toHaveLength(2);
  });
  it("Business : refusé (402) ; données d'alertes conservées ; autre boutique isolée ; rôle sans accès stock refusé", async () => {
    await mk("Jus", 500, 300, 0); await dash(); setPlan("business"); await err(call("own", "articles.dashboard", {}), 402); await err(call("own", "alerts.ack", { all: true }), 402); expect(st.rows("article_alerts")).toHaveLength(1);
    setPlan("pro"); const dB = await ok(call("own", "articles.dashboard", {}, B)); expect(dB.alerts).toHaveLength(0); expect(dB.kpis.articles).toBe(0);
    const cais = (await ok(call("own", "staff.create", { name: "c", username: "cais", password: "motdepasse1", role: "cashier", shopIds: [A] }, ""))).userId; await err(call(cais, "articles.dashboard", {}), 403);
    await err(call("own", "alerts.ack", { id: "inconnu" }), 404);
  });
});
