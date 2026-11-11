import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";

class DatedStore extends MemoryStore { override async create(t: string, id: string, tenant: string, d: Record<string, unknown>) { return super.create(t, id, tenant, { $createdAt: new Date().toISOString(), ...d }); } }
const T = "tenantmr0001", T2 = "tenantmr0002";
let st: DatedStore; let A = "", B = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}, shop = A, tenant = T) => handle(st, U[user] ?? user, { action, tenantId: tenant, shopId: shop, payload }, { admins: ["admin1"] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); };
const setPlan = (plan: string, tenant = T) => { const row = st.rows("subscriptions").find((r) => r.$id === tenant); const data = { tenantId: tenant, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", tenant, tenant, data); };
let n = 0; const id8 = (p: string) => `${p}-${String(++n).padStart(8, "0")}`;
const mk = async (name: string, price: number, cost: number, qty = 0) => (await ok(call("own", "article.save", { data: { name, price, cost }, ...(qty ? { initialQty: qty } : {}) }))).id as string;
const sell = (user: string, lines: object[], payments: object[]) => call(user, "checkout", { clientId: id8("vente"), lines, payments }, A);
const cash = (v: number) => [{ method: "cash", amount: v }];
const lic = async () => { await st.update("shops", A, { phone: "0701020304" }); await ok(call("own", "md.trial.start", {}, "", T)); };
const reports = async (user = "own") => (await ok(call(user, "md.reports", {}))).reports as any[];
let eau = "", cas = "";

beforeEach(async () => {
  st = new DatedStore(); n = 0; await st.grant(T, "own", ["owner"], []); await st.grant(T2, "own2", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId;
  for (const [u, role, shops] of [["cais", "cashier", [A]], ["ger", "manager", [A]], ["gerB", "manager", [B]]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: shops }, ""))).userId;
  setPlan("business"); setPlan("business", T2); eau = await mk("Eau", 500, 300, 100); cas = await mk("Casier", 4000, 2500, 20);
});

describe("MASTER DOGUI — rapport de clôture", () => {
  it("sans licence : la clôture fonctionne, aucun rapport n'est créé (jamais bloquante)", async () => {
    await ok(call("cais", "cash.open", { openingFloat: 10_000 })); await ok(sell("cais", [{ productId: eau, qty: 2 }], cash(1000))); const c = await ok(call("cais", "cash.close", { counted: 11_000 })); expect(c.variance).toBe(0); expect(st.rows("md_reports")).toHaveLength(0);
  });
  it("licence en essai : rapport généré UNE fois après la clôture confirmée, chiffres reproductibles, marge fiable, sources citées", async () => {
    await lic(); await ok(call("cais", "cash.open", { openingFloat: 10_000 })); await ok(sell("cais", [{ productId: eau, qty: 4 }, { productId: cas, qty: 1 }], cash(6000))); const c = await ok(call("cais", "cash.close", { counted: 16_000 }));
    const rows = st.rows("md_reports"); expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ type: "closing", status: "ready", version: 1, sessionId: c.id, trigger: "event" }); const r = await ok(call("ger", "md.report", { id: rows[0]!.$id })); const rep = r.report;
    expect(rep.sections.find((s: any) => s.id === "ventes").items[1]).toMatchObject({ value: 6000 }); expect(rep.sections.find((s: any) => s.id === "caisse").items.map((i: any) => i.value).slice(0, 4)).toEqual([10_000, 16_000, 16_000, 0]); expect(rep.sections.find((s: any) => s.id === "marge")).toMatchObject({ available: true }); expect(rep.sections.find((s: any) => s.id === "marge").items[0].value).toBe(6000 - (4 * 300 + 2500)); expect(rep.sections.every((s: any) => s.source)).toBe(true); expect(rep.alerts[0].text).toContain("équilibrée"); expect(rep.method).toContain("déterministes"); expect(rep.limits.length).toBeGreaterThan(2);
    const again = await ok(call("ger", "md.closing", { sessionId: c.id })); expect(again.created).toBe(false); expect(again.id).toBe(rows[0]!.$id); expect(st.rows("md_reports")).toHaveLength(1);
  });
  it("écart de caisse hors tolérance : alerte critique et recommandation ; coût manquant : marge absente, rapport partiel avec donnée manquante listée", async () => {
    await lic(); const nocost = await mk("Sans coût", 1000, 0, 10); await st.update("shops", A, { varianceTolerance: 100 }); await ok(call("cais", "cash.open", { openingFloat: 0 })); await ok(sell("cais", [{ productId: nocost, qty: 1 }, { productId: eau, qty: 1 }], cash(1500))); const c = await ok(call("cais", "cash.close", { counted: 1000 })); expect(c.variance).toBe(-500);
    const r = await ok(call("own", "md.closing", { sessionId: c.id })); expect(r.status).toBe("partial"); expect(r.report.alerts[0]).toMatchObject({ prio: "critical" }); expect(r.report.recommendations[0]).toMatchObject({ prio: "high", status: "nouvelle" }); expect(r.missing[0]).toMatchObject({ section: "Marge" }); expect(r.report.sections.find((s: any) => s.id === "marge").available).toBe(false);
  });
  it("régénération : nouvelle version, l'ancienne devient « remplacée » et reste consultable ; droits : caissier refusé", async () => {
    await lic(); await ok(call("cais", "cash.open", { openingFloat: 0 })); await ok(sell("cais", [{ productId: eau, qty: 1 }], cash(500))); const c = await ok(call("cais", "cash.close", { counted: 500 })); const first = st.rows("md_reports")[0]!.$id; await err(call("cais", "md.closing", { sessionId: c.id }), 403);
    const v2 = await ok(call("own", "md.closing", { sessionId: c.id, regenerate: true })); expect(v2).toMatchObject({ version: 2, status: "ready" }); expect(v2.id).not.toBe(first); const list = await reports(); expect(list.find((x) => x.id === first)).toMatchObject({ status: "superseded", replacedBy: v2.id }); expect((await ok(call("own", "md.report", { id: first }))).report).toBeTruthy(); expect(st.rows("audit_log").filter((a) => a.action === "master.report.closing")).toHaveLength(2);
  });
  it("échec de génération : la clôture reste valide, rapport « échoué » rejouable", async () => {
    await lic(); await ok(call("cais", "cash.open", { openingFloat: 0 })); await ok(sell("cais", [{ productId: eau, qty: 1 }], cash(500))); const orig = st.scan.bind(st); let fail = true; (st as any).scan = async (t: string, ...a: any[]) => { if (fail && t === "expenses") throw new Error("panne simulée"); return (orig as any)(t, ...a); };
    const c = await ok(call("cais", "cash.close", { counted: 500 })); expect(c.id).toBeTruthy(); expect(st.rows("cash_sessions").find((s) => s.$id === c.id)!.status).toBe("closed"); expect(st.rows("md_reports")[0]).toMatchObject({ status: "failed" }); expect(String(st.rows("md_reports")[0]!.error)).toContain("panne"); fail = false;
    const r = await ok(call("own", "md.closing", { sessionId: c.id })); expect(r.status).toBe("ready"); expect(st.rows("md_reports")).toHaveLength(1);
  });
  it("jamais avant la clôture ; autre boutique/entreprise : introuvable", async () => {
    await lic(); const o = await ok(call("cais", "cash.open", { openingFloat: 0 })); await err(call("own", "md.closing", { sessionId: o.id }), 409, "clôture confirmée"); await ok(call("cais", "cash.close", { counted: 0 })); const sid = st.rows("cash_sessions")[0]!.$id; await err(call("gerB", "md.closing", { sessionId: sid }, B), 404); await err(call("own2", "md.reports", {}, "", T2), 400);
  });
  it("après expiration : consultation conservée, nouvelle génération refusée (402)", async () => {
    await lic(); await ok(call("cais", "cash.open", { openingFloat: 0 })); await ok(sell("cais", [{ productId: eau, qty: 1 }], cash(500))); const c = await ok(call("cais", "cash.close", { counted: 500 })); st.rows("md_licenses")[0]!.trialEndsAt = new Date(Date.now() - 864e5).toISOString();
    expect((await reports()).length).toBe(1); expect((await ok(call("own", "md.report", { id: st.rows("md_reports")[0]!.$id }))).report).toBeTruthy(); await err(call("own", "md.closing", { sessionId: c.id, regenerate: true }), 402, "expirée"); await ok(call("cais", "cash.open", { openingFloat: 0 })); await ok(call("cais", "cash.close", { counted: 0 })); expect(st.rows("md_reports")).toHaveLength(1);
  });
});

describe("MASTER DOGUI — briefing d'ouverture", () => {
  it("licence requise ; jamais de briefing si une session est ouverte (même celle d'un autre vendeur) ; jamais d'ouverture automatique", async () => {
    expect((await ok(call("own", "md.opening", {}))).skipped).toBe("license"); await lic(); await ok(call("cais", "cash.open", { openingFloat: 0 })); const o = await ok(call("own", "md.opening", {})); expect(o).toMatchObject({ skipped: "session_open" }); expect(st.rows("md_reports")).toHaveLength(0); expect(st.rows("cash_sessions").filter((s) => s.status === "open")).toHaveLength(1);
    await ok(call("cais", "cash.close", { counted: 0 })); const ok2 = await ok(call("own", "md.opening", {})); expect(ok2.skipped).toBeNull(); expect(ok2.report.type).toBe("opening");
  });
  it("sans session ouverte : briefing généré une fois par date commerciale (idempotent), sections avec sources, alertes de stock, données manquantes listées", async () => {
    await lic(); await ok(call("own", "stock.adjust", { productId: eau, counted: 0 })); const b = await ok(call("own", "md.opening", {})); expect(b.skipped).toBeNull(); const rep = b.report; expect(rep.sections.map((s: any) => s.id)).toEqual(["periode", "marge", "stock", "achats", "tresorerie", "crm"]); expect(rep.sections.every((s: any) => s.source)).toBe(true); expect(rep.alerts.some((a: any) => a.prio === "critical" && /rupture/.test(a.text))).toBe(true); expect(rep.recommendations.some((x: any) => /Réapprovisionner/.test(x.text))).toBe(true);
    const again = await ok(call("ger", "md.opening", {})); expect(again.created).toBe(false); expect(again.id).toBe(b.id); expect(st.rows("md_reports")).toHaveLength(1); expect(b.status).toBe("partial"); expect(b.missing.map((m: any) => m.section)).toEqual(expect.arrayContaining(["Marge brute estimée (hier)"]));
  });
  it("modules non souscrits : sections indisponibles signalées (Starter), jamais simulées ; chiffres d'hier cohérents avec les ventes", async () => {
    await lic(); setPlan("starter"); const b = await ok(call("own", "md.opening", {})); expect(b.report.sections.find((s: any) => s.id === "achats").available).toBe(false); expect(b.report.sections.find((s: any) => s.id === "crm").available).toBe(false); expect(b.missing.some((m: any) => m.section === "Achats")).toBe(true);
    const y = new Date(Date.now() - 864e5).toISOString(); setPlan("business"); await st.create("sales", "sy1", T, { tenantId: T, shopId: A, number: "V-1", total: 4500, status: "paid", cashierId: "x", payments: JSON.stringify([{ method: "mobile", amount: 4500 }]), lines: JSON.stringify([{ productId: eau, qty: 9, amount: 4500 }]), soldAt: y, clientId: "c1" }); const r = await ok(call("own", "md.opening", { regenerate: true })); const p = r.report.sections.find((s: any) => s.id === "periode"); expect(p.items[0].value).toBe(1); expect(p.items[1].value).toBe(4500); expect(p.items.some((i: any) => i.label.includes("Mobile money") && i.value === 4500)).toBe(true); expect(r.version).toBe(2);
    expect(r.report.sections.find((s: any) => s.id === "marge").items[0].value).toBe(4500 - 9 * 300);
  });
  it("droits : caissier refusé ; isolation entre boutiques et entreprises", async () => { await lic(); await err(call("cais", "md.opening", {}), 403); await ok(call("own", "md.opening", {})); expect(await reports("ger")).toHaveLength(1); await err(call("gerB", "md.reports", {}, A), 403); expect((await ok(call("gerB", "md.reports", {}, B))).reports).toEqual([]); });
});
