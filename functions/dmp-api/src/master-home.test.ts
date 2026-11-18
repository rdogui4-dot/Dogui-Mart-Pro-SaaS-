import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { healthDims, healthScore, type HealthIn } from "../../../src/domain/master-home";

const T = "tenantmdhome01";
let st: MemoryStore; let A = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}, shop = A) => handle(st, U[user] ?? user, { action, tenantId: T, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); };
const NONE: HealthIn = { revenue: null, prevRevenue: null, articles: null, out: null, low: null, cashBalance: null, payablesSoon: null, expenses: null, prevExpenses: null, netMarginPct: null, prevNetMarginPct: null };

describe("MASTER — santé de l'activité (règles publiées)", () => {
  it("chaque indicateur suit sa règle ; indicateur sans données exclu", () => {
    const d = healthDims({ ...NONE, revenue: 900, prevRevenue: 1000, articles: 20, out: 0, low: 1, cashBalance: 500, payablesSoon: 800, expenses: 130, prevExpenses: 100, netMarginPct: 10, prevNetMarginPct: 14 });
    expect(d.map((x) => x.state)).toEqual(["warn", "ok", "warn", "bad", "bad"]);
    expect(healthDims({ ...NONE, revenue: 980, prevRevenue: 1000 })[0]!.state).toBe("ok"); expect(healthDims({ ...NONE, revenue: 700, prevRevenue: 1000 })[0]!.state).toBe("bad");
    expect(healthDims({ ...NONE, articles: 10, out: 1, low: 0 })[1]!.state).toBe("bad"); expect(healthDims({ ...NONE, cashBalance: -1 })[2]!.state).toBe("bad");
    expect(healthDims({ ...NONE, netMarginPct: 5 })[4]!.state).toBe("ok"); expect(healthDims(NONE).every((x) => x.state === null)).toBe(true);
  });
  it("score : bon 20, à surveiller 10, à traiter 0 ; aucun score sous 3 indicateurs", () => {
    const d = healthDims({ ...NONE, revenue: 1100, prevRevenue: 1000, articles: 10, out: 0, low: 0, cashBalance: 100, payablesSoon: 0 });
    expect(healthScore(d)).toEqual({ score: 100, counted: 3, label: "Très bonne" });
    expect(healthScore(healthDims({ ...NONE, revenue: 850, prevRevenue: 1000, articles: 10, out: 0, low: 0, cashBalance: -5 }))).toEqual({ score: 50, counted: 3, label: "Fragile" });
    expect(healthScore(healthDims({ ...NONE, revenue: 1, prevRevenue: 1, cashBalance: 1 })).score).toBeNull();
  });
});

describe("MASTER — vue d'ensemble (md.home)", () => {
  beforeEach(async () => {
    st = new MemoryStore(); await st.grant(T, "own", ["owner"], []); A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; await st.update("shops", A, { phone: "+225 07 01 02 03 04" });
    for (const [u, role] of [["ger", "manager"], ["cais", "cashier"]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: [A] }, ""))).userId;
  });
  it("sans licence : rien d'analysé ; employé refusé ; avec l'essai : santé, alertes, synthèse, état réel de l'IA", async () => {
    const a = await ok(call("ger", "md.home")); expect(a).toMatchObject({ licensed: false, state: "none" }); expect(a.health).toBeUndefined(); await err(call("cais", "md.home"), 403);
    await ok(call("own", "md.trial.start", {}, ""));
    const now = new Date(); const prevM = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 10)).toISOString(); const curM = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 9)).toISOString();
    const sale = (id: string, total: number, soldAt: string) => st.create("sales", id, T, { tenantId: T, shopId: A, number: id, total, vat: 0, status: "paid", soldAt, lines: JSON.stringify([{ productId: "p1", name: "Riz 25 kg", qty: 1, unitPrice: total, unitCost: total / 2 }]), payments: "[]" });
    await sale("s1", 100_000, prevM); await sale("s2", 120_000, curM);
    const h = await ok(call("ger", "md.home")); expect(h.licensed).toBe(true); expect(h.ai.ai).toBe(false); expect(h.health.dims).toHaveLength(5);
    const sales = h.health.dims.find((d: any) => d.key === "sales"); expect(sales.state).toBe("ok"); expect(sales.text).toContain("+20");
    expect(h.month.revenue).toBe(120_000); expect(h.month.revenueDelta).toBe(20); expect(h.insights.join(" ")).toContain("augmenté de 20 %"); expect(h.insights.join(" ")).toContain("Riz 25 kg");
    expect(Array.isArray(h.alerts)).toBe(true); expect(h.health.method).toContain("20 points"); expect(h.note).toContain("aucune action");
  });
});
