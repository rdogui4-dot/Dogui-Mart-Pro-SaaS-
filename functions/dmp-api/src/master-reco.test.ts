import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";

class DatedStore extends MemoryStore { override async create(t: string, id: string, tenant: string, d: Record<string, unknown>) { return super.create(t, id, tenant, { $createdAt: new Date().toISOString(), ...d }); } }
const T = "tenantrc0001", T2 = "tenantrc0002";
let st: DatedStore; let A = "", B = "", A2 = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}, shop = "", tenant = T) => handle(st, U[user] ?? user, { action, tenantId: tenant, shopId: shop, payload }, { admins: ["admin1"] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); };
const setPlan = (tenant: string, plan = "business") => { const row = st.rows("subscriptions").find((r) => r.$id === tenant); const data = { tenantId: tenant, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", tenant, tenant, data); };
const lic = async (tenant = T, user = "own", shop = A) => { await st.update("shops", shop, { phone: tenant === T ? "0701020304" : "0799887766" }); await ok(call(user, "md.trial.start", {}, "", tenant)); };
let n = 0; const mk = async (name: string, qty: number, shop = A, tenant = T, user = "own") => (await ok(call(user, "article.save", { data: { name, price: 500, cost: 300 }, initialQty: qty }, shop, tenant))).id as string;
const empty = async (name: string, shop = A) => { const id = await mk(name, 5, shop); await ok(call("own", "stk.correct", { productId: id, delta: -5, reason: "casse", requestKey: `k${++n}-${name}`.padEnd(12, "x") }, shop)); return id; };
const gen = (user = "own", p: unknown = {}, tenant = T) => ok(call(user, "md.reco.generate", p, "", tenant));
const list = async (user = "own", p: unknown = {}, tenant = T) => await ok(call(user, "md.reco.list", p, "", tenant));
const closedSession = (id: string, shop: string, variance: number, tenant = T) => st.create("cash_sessions", id, tenant, { tenantId: tenant, shopId: shop, userId: "x", status: "closed", openedAt: new Date().toISOString(), closedAt: new Date().toISOString(), openingFloat: 0, countedCash: 0, theoreticalCash: 0, variance });

beforeEach(async () => {
  st = new DatedStore(); n = 0; await st.grant(T, "own", ["owner"], []); await st.grant(T2, "own2", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }))).shopId; A2 = (await ok(call("own2", "shop.create", { name: "Autre" }, "", T2))).shopId;
  for (const [u, role, shops] of [["cais", "cashier", [A]], ["ger", "manager", [A]], ["gerB", "manager", [B]]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: shops }))).userId;
  setPlan(T); setPlan(T2);
});

describe("MASTER DOGUI — recommandations suivies", () => {
  it("sans licence : génération et décision refusées (402), consultation permise", async () => {
    await err(call("own", "md.reco.generate", {}), 402); const l = await list(); expect(l.recos).toEqual([]); expect(l.canGenerate).toBe(false);
  });
  it("rupture de stock : une recommandation critique, sourcée, idempotente (2e génération = rien de nouveau)", async () => {
    await lic(); await empty("Eau"); const g1 = await gen(); expect(g1.created).toBe(1); const g2 = await gen(); expect(g2.created).toBe(0); expect(g2.existing).toBeGreaterThanOrEqual(1);
    const l = await list(); expect(l.recos).toHaveLength(1); expect(l.recos[0]).toMatchObject({ ruleId: "stock_out", prio: "critical", status: "new", kind: "fact", shopName: "Dakar", metric: { value: 1 } }); expect(l.recos[0].sources[0]).toMatchObject({ module: "Stock" }); expect(st.rows("md_recos")).toHaveLength(1);
  });
  it("règles Pro non disponibles en Business : signalées, jamais inventées ; aucun faux succès", async () => {
    await lic(); await empty("Eau"); const g = await gen(); expect([...new Set(g.unavailable.map((x: any) => x.rule))].sort()).toEqual(["expenses", "promo", "replenish"]);
  });
  it("cycle de vie : transitions valides seulement, baseline à l'acceptation, journal", async () => {
    await lic(); await empty("Eau"); await gen(); const id = (await list()).recos[0].id;
    await err(call("own", "md.reco.decide", { id, to: "done" }), 409); const a = await ok(call("own", "md.reco.decide", { id, to: "accepted", note: "ok" })); expect(a.status).toBe("accepted"); expect(a.followUp.baseline).toMatchObject({ value: 1, label: "Articles en rupture ou négatifs" });
    await ok(call("own", "md.reco.decide", { id, to: "doing" })); await ok(call("own", "md.reco.decide", { id, to: "done" })); await err(call("own", "md.reco.decide", { id, to: "new" }), 409);
    expect(st.rows("audit_log").filter((r) => r.action === "reco.status").map((r) => r.detail)).toEqual(["stock_out new -> accepted", "stock_out accepted -> doing", "stock_out doing -> done"]);
  });
  it("refus : pas re-proposée à l'identique ; nouveaux faits = nouvelle recommandation", async () => {
    await lic(); await empty("Eau"); await gen(); const id = (await list()).recos[0].id; await ok(call("own", "md.reco.decide", { id, to: "refused", note: "non" }));
    await gen(); expect((await list()).recos).toHaveLength(1); expect((await list()).recos[0].status).toBe("refused"); await empty("Lait"); const g = await gen(); expect(g.created).toBe(1); const l = await list(); expect(l.recos).toHaveLength(2); expect(l.recos.filter((r: any) => r.status === "new")).toHaveLength(1);
  });
  it("report : reste reportée jusqu'à l'échéance, puis redevient nouvelle ; durée invalide refusée", async () => {
    await lic(); await empty("Eau"); await gen(); const id = (await list()).recos[0].id; await err(call("own", "md.reco.decide", { id, to: "snoozed", snoozeDays: 0 }), 400); const s = await ok(call("own", "md.reco.decide", { id, to: "snoozed" })); expect(Date.parse(s.snoozeUntil) - Date.now()).toBeGreaterThan(6 * 864e5);
    expect((await list()).recos[0].status).toBe("snoozed"); await st.update("md_recos", id, { snoozeUntil: new Date(Date.now() - 1000).toISOString() }); expect((await list()).recos[0].status).toBe("new");
  });
  it("suivi : mesure relue après l'action, texte factuel sans causalité ; délai de suivi", async () => {
    await lic(); const id0 = await empty("Eau"); await gen(); const id = (await list()).recos[0].id; await ok(call("own", "md.reco.decide", { id, to: "accepted" }));
    await ok(call("own", "stk.correct", { productId: id0, delta: 10, reason: "réception", requestKey: "recep-eau-0001" }, A)); await gen(); const r = (await list()).recos[0]; expect(r.followUp.outcome.value).toBe(0); expect(r.followUp.text).toContain("en baisse de 1"); expect(r.followUp.text).toContain("n'est pas attribuée"); expect(r.followUp.due).toBe(false);
    await st.update("md_recos", id, { acceptedAt: new Date(Date.now() - 15 * 864e5).toISOString() }); expect((await list()).recos[0].followUp.due).toBe(true);
  });
  it("écarts de caisse : données insuffisantes sous le seuil ; alerte au-delà, paramétrable", async () => {
    await lic(); for (let i = 0; i < 3; i++) await closedSession(`cs${i}`, A, 500); const g1 = await gen(); expect(g1.insufficient.some((x: any) => x.rule === "cash_variance")).toBe(true); expect((await list()).recos).toEqual([]);
    for (let i = 3; i < 6; i++) await closedSession(`cs${i}`, A, 0); await ok(call("own", "md.reco.cfg.save", { cfg: { cashVarianceCount: 4 } })); expect((await gen()).created).toBe(0); await ok(call("own", "md.reco.cfg.save", { cfg: { cashVarianceCount: 3 } })); expect((await gen()).created).toBe(1); expect((await list()).recos[0]).toMatchObject({ ruleId: "cash_variance", prio: "high", metric: { value: 3 } });
  });
  it("seuils : propriétaire seul, valeurs bornées", async () => {
    await lic(); await err(call("ger", "md.reco.cfg.save", { cfg: { snoozeDays: 3 } }), 403); await err(call("own", "md.reco.cfg.save", { cfg: { snoozeDays: 0 } }), 400); await err(call("own", "md.reco.cfg.save", { cfg: { creditPct: 150 } }), 400); const r = await ok(call("own", "md.reco.cfg.save", { cfg: { snoozeDays: 3 } })); expect(r.cfg).toMatchObject({ snoozeDays: 3, followDays: 14 }); expect((await list()).cfg.snoozeDays).toBe(3);
  });
  it("encours client au plafond : règle explicite sur le plafond, sans prétendre à un retard", async () => {
    await lic(); await st.create("customers", "c1", T, { tenantId: T, shopId: A, name: "Awa", creditLimit: 1000, creditBalance: 950 }); await st.create("customers", "c2", T, { tenantId: T, shopId: A, name: "Bob", creditLimit: 1000, creditBalance: 100 }); await gen(); const r = (await list()).recos.find((x: any) => x.ruleId === "client_credit"); expect(r.title).toContain("1 client"); expect(r.reason).toContain("Aucune date d'échéance");
  });
  it("commandes en retard : règle sur la livraison prévue dépassée", async () => {
    await lic(); await st.create("purchase_orders", "po1", T, { tenantId: T, shopId: A, number: "CF-1", supplierId: "s1", status: "ordered", total: 1000, deliveryOn: new Date(Date.now() - 5 * 864e5).toISOString() }); await gen(); expect((await list()).recos.find((x: any) => x.ruleId === "po_late")).toMatchObject({ prio: "high" });
  });
  it("droits et périmètre : caissier refusé ; gérant limité à sa boutique (liste, génération, décision) ; propriétaire voit tout", async () => {
    await lic(); await empty("Eau", A); await empty("Sel", B); await gen(); const all = await list(); expect(all.recos).toHaveLength(2); await err(call("cais", "md.reco.list", {}), 403); await err(call("cais", "md.reco.generate", {}), 403);
    const g = await list("ger"); expect(g.recos).toHaveLength(1); expect(g.recos[0].shopName).toBe("Dakar"); const idB = all.recos.find((r: any) => r.shopName === "Thiès").id; await err(call("ger", "md.reco.decide", { id: idB, to: "accepted" }), 403); await err(call("ger", "md.reco.generate", { shopId: B }), 404); await ok(call("gerB", "md.reco.decide", { id: idB, to: "accepted" }));
  });
  it("isolation entre entreprises : listes disjointes, décision d'une autre entreprise introuvable", async () => {
    await lic(); await lic(T2, "own2", A2); await empty("Eau"); await ok(call("own2", "article.save", { data: { name: "Riz", price: 1, cost: 1 }, initialQty: 1 }, A2, T2)); await gen(); expect((await list("own2", {}, T2)).recos).toEqual([]); const id = (await list()).recos[0].id; await err(call("own2", "md.reco.decide", { id, to: "accepted" }, "", T2), 404);
  });
  it("profil : les priorités du profil réordonnent sans créer ni supprimer", async () => {
    await lic(); await empty("Eau"); await st.create("purchase_orders", "po1", T, { tenantId: T, shopId: A, number: "CF-1", supplierId: "s1", status: "ordered", total: 1, deliveryOn: new Date(Date.now() - 864e5).toISOString() }); await st.create("customers", "c1", T, { tenantId: T, shopId: A, name: "Awa", creditLimit: 1000, creditBalance: 990 });
    await gen(); const base = (await list()).recos.map((r: any) => r.ruleId); expect(base).toEqual(["stock_out", "po_late", "client_credit"]); await ok(call("own", "md.profile.set", { key: "priorities", value: ["tresorerie"] })); const after = await list(); expect(after.recos.map((r: any) => r.ruleId)).toEqual(["stock_out", "po_late", "client_credit"]); expect(after.recos).toHaveLength(3); expect(after.order).toContain("profil");
  });
  it("recommandations des rapports : suivies par le même moteur (règle « report »), une seule fois", async () => {
    await lic(); await st.update("shops", A, { varianceTolerance: 100 }); const nocost = await mk("X", 5); await ok(call("cais", "cash.open", { openingFloat: 0 }, A)); await ok(call("cais", "checkout", { clientId: "vente-00000001", lines: [{ productId: nocost, qty: 1 }], payments: [{ method: "cash", amount: 500 }] }, A)); await ok(call("cais", "cash.close", { counted: 100 }, A));
    const rows = st.rows("md_recos").filter((r) => r.ruleId === "report"); expect(rows.length).toBeGreaterThan(0); const c = rows.length; const rep = st.rows("md_reports")[0]!; await ok(call("own", "md.closing", { sessionId: rep.sessionId, regenerate: true }, A)); expect(st.rows("md_recos").filter((r) => r.ruleId === "report")).toHaveLength(c);
  });
  it("licence expirée : l'historique reste consultable, plus de génération ni de décision", async () => {
    await lic(); await empty("Eau"); await gen(); const id = (await list()).recos[0].id; const l0 = st.rows("md_licenses")[0]!; await st.update("md_licenses", l0.$id, { status: "expired", trialEndsAt: "2020-01-01T00:00:00.000Z", paidUntil: "2020-01-01T00:00:00.000Z" });
    const l = await list(); expect(l.recos).toHaveLength(1); expect(l.canGenerate).toBe(false); await err(call("own", "md.reco.generate", {}), 402); await err(call("own", "md.reco.decide", { id, to: "accepted" }), 402);
  });
});
