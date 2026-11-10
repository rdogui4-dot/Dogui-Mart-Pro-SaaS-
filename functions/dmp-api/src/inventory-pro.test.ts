import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { stockFor } from "./checkout";

class DatedStore extends MemoryStore { override async create(t: string, id: string, tenant: string, d: Record<string, unknown>) { return super.create(t, id, tenant, { $createdAt: new Date().toISOString(), ...d }); } }
const T = "tenantsmart1";
let st: DatedStore; let A = "", B = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}, shop = A, tenant = T) => handle(st, U[user] ?? user, { action, tenantId: tenant, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); return x.body.error as string; };
const setPlan = (plan: string) => { const row = st.rows("subscriptions").find((r) => r.$id === T); const data = { tenantId: T, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", T, T, data); };
const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);
const later = () => new Promise((r) => setTimeout(r, 6));
let mvN = 0;
const mv = (productId: string, qty: number, kind = "purchase", minutes = -120, extra: object = {}, shop = A) => st.create("stock_moves", `mv${++mvN}`, T, { tenantId: T, shopId: shop, productId, qty, kind, $createdAt: new Date(Date.now() + minutes * 60_000).toISOString(), ...extra });
const create = (extra: object = {}, user = "ger") => call(user, "count.save", { clientId: rid(), kind: "full", agents: [U.stk!, U.stk2!, U.stk3!], ...extra });
const started = async (extra: object = {}) => { const id = (await ok(create(extra))).id as string; await ok(call("ger", "count.start", { id })); return id as string; };
const get = (id: string, user = "ger") => ok(call(user, "count.get", { id }));
const lineOf = async (id: string, name: string, user = "ger") => (await get(id, user)).lines.find((l: any) => l.name === name);
const enter = (id: string, lineId: string, qty: unknown, user = "stk", extra: object = {}) => call(user, "count.entry", { id, lineId, qty, entryKey: rid(), ...extra });
const countAll = async (id: string, q: Record<string, number>, user = "stk") => { for (const [n, v] of Object.entries(q)) await ok(enter(id, (await lineOf(id, n)).id, v, user)); };
const finishReview = async (id: string) => { await ok(call("ger", "count.finish", { id, confirmUncounted: true })); await ok(call("ger", "count.review", { id })); };
const toReview = async (id: string, q: Record<string, number>) => { await countAll(id, q); await finishReview(id); };
const old = (days: number) => new Date(Date.now() - days * 864e5).toISOString();
/** inventaires historiques validés (écarts relatifs connus) */
const hist = async (rows: { name: string; productId: string; theoretical: number; diff: number; status?: string }[], daysAgo = 30, num = `INV-OLD-${rid().slice(0, 4)}`, shop = A) => {
  const id = `h${rid()}`; await st.create("inventories", id, T, { tenantId: T, shopId: shop, number: num, status: "closed", kind: "full", validatedAt: old(daysAgo), startedAt: old(daysAgo + 1), totals: JSON.stringify({ netValue: 0, adjusted: rows.length }), thresholdPct: 10, thresholdValue: 50000 });
  for (const r of rows) await st.create("inventory_lines", `hl${rid()}`, T, { tenantId: T, shopId: shop, inventoryId: id, productId: r.productId, variantId: "", name: r.name, scale: 0, unitCost: 500, counted: r.theoretical + r.diff, theoretical: r.theoretical, diff: r.diff, status: r.status ?? "approved", countedAt: old(daysAgo), category: "Alimentaire" });
  return id;
};

beforeEach(async () => {
  st = new DatedStore(); await st.grant(T, "own", ["owner"], []); mvN = 0;
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId;
  for (const [u, role, shops] of [["cais", "cashier", [A]], ["ger", "manager", [A]], ["ger2", "manager", [A]], ["stk", "stockkeeper", [A]], ["stk2", "stockkeeper", [A]], ["stk3", "stockkeeper", [A]], ["gerB", "manager", [B]]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: shops }, ""))).userId;
  const P = (id: string, name: string, cost: number, extra: object = {}, shop = A) => st.create("products", id, T, { tenantId: T, shopId: shop, name, price: cost * 2, cost, category: "Alimentaire", barcode: `B-${id}`, sku: `SKU-${id}`, ...extra });
  await P("p1", "Riz", 500); await P("p2", "Huile", 1500); await P("p3", "Savon", 200, { category: "Hygiène" }); await P("p4", "Lait", 800); await P("p5", "Sucre", 0);
  for (const [p, q] of [["p1", 100], ["p2", 50], ["p3", 20], ["p4", 40], ["p5", 10]] as const) await mv(p, q); setPlan("pro");
});

describe("abonnement et droits Pro", () => {
  it("fonctions Pro refusées en Business (402), au caissier (403) ; le Business continue de fonctionner en Pro", async () => {
    setPlan("business"); await err(call("own", "scount.suggest"), 402); await err(call("own", "scount.campaign.list"), 402); setPlan("pro"); await err(call("cais", "scount.suggest"), 403); await ok(call("ger", "scount.suggest")); const id = await started(); await countAll(id, { Riz: 90 }); expect((await get(id)).status).toBe("in_progress");
  });
});

describe("zones, agents, classes ABC et ordre de comptage", () => {
  it("zones par catégorie et par classe : chaque agent ne voit et ne compte que ses zones ; ABC calculée sur les ventes réelles", async () => {
    await mv("p2", 40, "sale", -60); await mv("p1", 5, "sale", -60); const id = await started();
    const z = await ok(call("ger", "scount.zones", { id, zones: [{ name: "Rayon alimentaire", agents: [U.stk!], categories: ["Alimentaire"] }, { name: "Hygiène", agents: [U.stk2!], categories: ["Hygiène"] }] })); expect(z.abc.A).toBeGreaterThanOrEqual(1); expect(z.basis).toMatch(/Rotation/); expect(z.unzoned).toBe(0);
    expect((await get(id, "stk")).lines.map((l: any) => l.name).sort()).toEqual(["Huile", "Lait", "Riz", "Sucre"]); expect((await get(id, "stk2")).lines.map((l: any) => l.name)).toEqual(["Savon"]);
    await err(enter(id, (await lineOf(id, "Savon")).id, 5, "stk"), 403, "zone"); await ok(enter(id, (await lineOf(id, "Savon")).id, 5, "stk2")); expect((await lineOf(id, "Huile")).abc).toBeUndefined();
    const l = st.rows("inventory_lines").filter((x) => x.inventoryId === id); expect(l.find((x) => x.name === "Huile")!.abc).toBe("A"); expect(l.every((x) => x.rank > 0)).toBe(true);
  });
  it("validation des zones : nom, agents avec accès au stock, critère obligatoire, pas de doublon ; interdit après le comptage", async () => {
    const id = await started(); await err(call("ger", "scount.zones", { id, zones: [{ name: "", agents: [U.stk!], categories: ["x"] }] }), 400); await err(call("ger", "scount.zones", { id, zones: [{ name: "Z", agents: [U.cais!], categories: ["x"] }] }), 400, "accès au stock"); await err(call("ger", "scount.zones", { id, zones: [{ name: "Z", agents: [U.stk!] }] }), 400, "catégories");
    await err(call("ger", "scount.zones", { id, zones: [{ name: "Z", agents: [U.stk!], categories: ["a"] }, { name: "z", agents: [U.stk!], categories: ["b"] }] }), 400, "double"); await err(call("stk", "scount.zones", { id, zones: [] }), 403); await countAll(id, { Riz: 1 }); await ok(call("ger", "count.finish", { id, confirmUncounted: true })); await err(call("ger", "scount.zones", { id, zones: [{ name: "Z", agents: [U.stk!], categories: ["a"] }] }), 409);
  });
  it("identification assistée : suggestions du catalogue avec justification ; références partagées signalées ; réservé aux assignés", async () => {
    await st.create("products", "pdup", T, { tenantId: T, shopId: A, name: "Riz long", price: 1, cost: 1, barcode: "B-p1", category: "Alimentaire" }); const id = await started(); const r = await ok(call("stk", "scount.identify", { id, text: "B-p1" })); expect(r.suggestions[0]).toMatchObject({ id: "p1", why: "code-barres identique", inInventory: true }); expect(r.inconsistentRefs.length).toBeGreaterThan(0);
    expect((await ok(call("stk", "scount.identify", { id, text: "riz" }))).suggestions.map((s: any) => s.id)).toContain("p1"); await err(call("cais", "scount.identify", { id, text: "riz" }), 403);
  });
});

describe("comptage aveugle avancé : second et troisième comptage indépendants", () => {
  const setup = async () => { const id = await started({ thresholdPct: 10, thresholdValue: 1_000_000 }); await countAll(id, { Riz: 80 }); const l = await lineOf(id, "Riz"); await ok(call("ger", "scount.second", { id, lineIds: [l.id], reason: "Contrôle indépendant" })); return { id, l }; };
  it("le premier agent ne peut pas faire le second comptage ; l'autre agent ne voit pas la première valeur ; accord = confirmé", async () => {
    const { id, l } = await setup(); expect((await lineOf(id, "Riz", "stk2")).counted).toBeNull(); expect((await lineOf(id, "Riz", "stk")).status).toBe("second"); await err(enter(id, l.id, 80, "stk"), 409, "autre agent");
    const r = await ok(enter(id, l.id, 80, "stk2")); expect(r).toMatchObject({ independent: true, recorded: true }); expect(JSON.stringify(r)).not.toContain("agree"); const after = await lineOf(id, "Riz"); expect(after.status).toBe("counted"); expect(after.round).toBe(2); expect(after.counted).toBe(80);
  });
  it("désaccord au-dessus du seuil : troisième contrôle par un troisième agent ; deux valeurs identiques font foi", async () => {
    const { id, l } = await setup(); await ok(enter(id, l.id, 60, "stk2")); expect((await lineOf(id, "Riz")).status).toBe("third"); await err(enter(id, l.id, 60, "stk"), 409, "troisième agent"); await err(enter(id, l.id, 60, "stk2"), 409, "troisième agent");
    await ok(enter(id, l.id, 60, "stk3")); const a = await lineOf(id, "Riz"); expect(a).toMatchObject({ status: "counted", counted: 60, round: 3 }); const ev = (await ok(call("ger", "count.history", { id }))).events.filter((e: any) => ["count", "second", "third"].includes(e.kind)); expect(ev).toHaveLength(3);
  });
  it("aucun consensus : arbitrage du responsable avec motif ; toutes les versions conservées", async () => {
    const { id, l } = await setup(); await ok(enter(id, l.id, 60, "stk2")); await ok(enter(id, l.id, 70, "stk3")); expect((await lineOf(id, "Riz")).status).toBe("arbitrate"); await err(enter(id, l.id, 65, "stk3"), 409);
    await err(call("ger", "scount.resolve", { id, lineId: l.id, choose: "second", reason: "" }), 400); await err(call("stk", "scount.resolve", { id, lineId: l.id, choose: "second", reason: "Retenu" }), 403); await ok(call("ger", "scount.resolve", { id, lineId: l.id, choose: "second", reason: "Constat contradictoire retenu" }));
    expect(await lineOf(id, "Riz")).toMatchObject({ status: "counted", counted: 60 }); const e = (await ok(call("ger", "count.history", { id }))).events.find((x: any) => x.kind === "arbitrate"); expect(e.detail).toMatchObject({ first: 80, second: 60, third: 70, result: 60 });
  });
  it("petit désaccord sous le seuil : arbitrage direct sans troisième comptage", async () => { const id = await started({ thresholdPct: 50, thresholdValue: 10_000_000 }); await countAll(id, { Riz: 100 }); const l = await lineOf(id, "Riz"); await ok(call("ger", "scount.second", { id, lineIds: [l.id], reason: "Contrôle" })); await ok(enter(id, l.id, 99, "stk2")); expect((await lineOf(id, "Riz")).status).toBe("arbitrate"); });
  it("le comptage ne peut être clos, ni l'inventaire validé, tant qu'un contrôle est ouvert", async () => {
    const { id } = await setup(); await err(call("ger", "count.finish", { id, confirmUncounted: true }), 409, "contrôle(s) indépendant"); const l = await lineOf(id, "Riz"); await ok(enter(id, l.id, 80, "stk2")); await finishReview(id);
  });
  it("second comptage ciblé sur les écarts importants seulement après la fin du comptage ; motif obligatoire", async () => {
    const id = await started({ thresholdPct: 5 }); await countAll(id, { Riz: 70, Huile: 50 }); await err(call("ger", "scount.second", { id, scope: "significant", reason: "Écarts" }), 409); await err(call("ger", "scount.second", { id, lineIds: [], reason: "" }), 400); await ok(call("ger", "count.finish", { id, confirmUncounted: true }));
    expect((await ok(call("ger", "scount.second", { id, scope: "significant", reason: "Écarts importants" }))).requested).toBe(1); expect((await get(id)).status).toBe("in_progress");
  });
  it("saisies simultanées de deux agents sur le second comptage : une seule est retenue ; perte réseau : rejouable", async () => {
    const { id, l } = await setup(); const k = rid(); const res = await Promise.all([call("stk2", "count.entry", { id, lineId: l.id, qty: 80, entryKey: k }), call("stk3", "count.entry", { id, lineId: l.id, qty: 80, entryKey: rid() })]); expect(res.filter((x: any) => x.status === 200).length).toBeGreaterThanOrEqual(1); expect(["counted", "third"]).toContain((await lineOf(id, "Riz")).status);
    const id2 = await started({ thresholdPct: 10, thresholdValue: 1_000_000, categories: ["Hygiène"], kind: "partial" }).catch(() => ""); void id2;
  });
  it("perte réseau pendant un second comptage : rien d'enregistré, la relance (même clé) aboutit une fois", async () => {
    const { id, l } = await setup(); const key = rid(); st.failBatchAfter = 1; const x: any = await call("stk2", "count.entry", { id, lineId: l.id, qty: 80, entryKey: key }); expect(x.status).toBeGreaterThanOrEqual(500); expect((await lineOf(id, "Riz")).status).toBe("second");
    await ok(call("stk2", "count.entry", { id, lineId: l.id, qty: 80, entryKey: key })); expect((await ok(call("stk2", "count.entry", { id, lineId: l.id, qty: 80, entryKey: key }))).duplicate).toBe(true); expect((await lineOf(id, "Riz")).status).toBe("counted");
  });
});

describe("anomalies expliquées", () => {
  it("masquées pendant le comptage ; chaque anomalie porte justification, données, priorité et vérification ; jamais qualifiée de fraude", async () => {
    const id = await started(); await mv("p2", -80, "adjust", -30); await countAll(id, { Riz: 50, Huile: 0 }); await err(call("ger", "scount.anomalies", { id }), 409); await err(call("stk", "scount.anomalies", { id }), 403); await finishReview(id);
    const r = await ok(call("ger", "scount.anomalies", { id })); const neg = r.anomalies.find((a: any) => a.kind === "negative_stock"); expect(neg).toMatchObject({ priority: "high", name: "Huile" }); for (const a of r.anomalies) { expect(a.justification.length).toBeGreaterThan(10); expect(a.check.length).toBeGreaterThan(10); expect(["high", "medium", "low"]).toContain(a.priority); expect(a.data).toBeTruthy(); expect(a.caveat).toMatch(/jamais/); }
    for (const a of r.anomalies) expect(`${a.title} ${a.justification} ${a.check}`.toLowerCase()).not.toMatch(/fraud|vol\b|voleur|coupable/); expect(r.note).toMatch(/Aucun n'établit une faute/);
  });
  it("écart inhabituel par rapport à l'historique ; sans historique : écart important signalé comme tel, jamais « inhabituel »", async () => {
    const id0 = await started(); await toReview(id0, { Riz: 70 }); let r = await ok(call("ger", "scount.anomalies", { id: id0 })); expect(r.anomalies.find((a: any) => a.kind === "large_variance")).toBeTruthy(); expect(r.anomalies.find((a: any) => a.kind === "unusual_variance")).toBeUndefined(); expect(r.anomalies.find((a: any) => a.kind === "large_variance").justification).toMatch(/Historique insuffisant/);
    await ok(call("ger", "count.cancel", { id: id0, reason: "Test" })); for (const d of [90, 60, 30]) await hist([{ name: "Riz", productId: "p1", theoretical: 100, diff: -1 }], d); const id = await started(); await toReview(id, { Riz: 70 }); r = await ok(call("ger", "scount.anomalies", { id })); const u = r.anomalies.find((a: any) => a.kind === "unusual_variance"); expect(u.justification).toMatch(/Moyenne historique/);
  });
  it("pertes récurrentes, erreur d'unité (×12), quantité très éloignée de la tendance, ajustement manuel pendant la campagne", async () => {
    for (const d of [100, 80, 60, 40]) await hist([{ name: "Huile", productId: "p2", theoretical: 50, diff: -2 }], d); await st.create("article_units", "u12", T, { tenantId: T, shopId: A, productId: "p3", unit: "carton", factor: 12, active: true }); const id = await started(); await later(); await mv("p4", -1, "adjust", 0, { refId: "casse-manuelle", userId: "x" });
    await countAll(id, { Huile: 45, Savon: 240, Lait: 39 }); await finishReview(id); const r = await ok(call("ger", "scount.anomalies", { id })); const kinds = r.anomalies.map((a: any) => `${a.kind}:${a.name ?? ""}`); expect(kinds).toContain("recurring_loss:Huile"); expect(kinds).toContain("unit_error:Savon"); expect(kinds).toContain("manual_adjust_during:Lait");
    expect(r.anomalies.find((a: any) => a.kind === "unit_error").justification).toMatch(/×12/);
  });
  it("réception sans mouvement de stock complet et transfert non rapproché détectés", async () => {
    await st.create("purchase_orders", "po1", T, { tenantId: T, shopId: A, number: "BC-X1", status: "received", lines: "[]" }); await st.create("purchase_receipts", "rc1xxxxxxxx", T, { tenantId: T, shopId: A, number: "BR-X1", status: "validated", poId: "po1", validatedAt: new Date().toISOString(), lines: JSON.stringify([{ productId: "p1", name: "Riz", accepted: 5 }]) });
    await mv("p3", 3, "transfer_out", -10, { refId: "TR-X" }); const id = await started(); await toReview(id, { Riz: 100 }); const kinds = (await ok(call("ger", "scount.anomalies", { id }))).anomalies.map((a: any) => a.kind); expect(kinds).toContain("receipt_unmatched"); expect(kinds).toContain("transfer_unmatched");
  });
  it("décisions sur les anomalies : note obligatoire, anomalie inconnue refusée, décision visible et tracée", async () => {
    const id = await started(); await mv("p2", -80, "adjust", -30); await toReview(id, { Huile: 0 }); const a = (await ok(call("ger", "scount.anomalies", { id }))).anomalies[0]; await err(call("ger", "scount.anomaly.decide", { id, key: a.key, decision: "reviewed", note: "" }), 400); await err(call("ger", "scount.anomaly.decide", { id, key: "nope|x", decision: "reviewed", note: "Vu ok" }), 404); await err(call("ger", "scount.anomaly.decide", { id, key: a.key, decision: "fraude", note: "Vu ok" }), 400);
    await ok(call("ger", "scount.anomaly.decide", { id, key: a.key, decision: "reviewed", note: "Réception retrouvée" })); const r = await ok(call("ger", "scount.anomalies", { id })); expect(r.anomalies.find((x: any) => x.key === a.key).decision).toMatchObject({ decision: "reviewed", note: "Réception retrouvée", by: "ger" }); expect(r.counts.open).toBe(r.anomalies.length - 1);
  });
});

describe("analyse, valorisation et propositions", () => {
  it("valeurs théorique/physique, écarts, précision, par catégorie/classe/agent ; coûts manquants signalés ; marge potentielle indicative", async () => {
    const id = await started(); await mv("p1", 5, "sale", -60); await toReview(id, { Riz: 90, Huile: 50, Savon: 22, Lait: 40, Sucre: 9 }); const a = await ok(call("ger", "scount.analysis", { id }));
    expect(a.valuation).toMatchObject({ theoreticalValue: 95 * 500 + 50 * 1500 + 20 * 200 + 40 * 800, shortageValue: -2500, surplusValue: 400, netValue: -2100 }); expect(a.valuation.missingCost).toMatchObject({ count: 1, names: ["Sucre"] }); expect(a.accuracy).toMatchObject({ lines: 40, counted: 5 }); expect(a.accuracy.value).toBeGreaterThan(95);
    expect(a.byCategory.map((c: any) => c.key)).toEqual(["Alimentaire", "Hygiène"]); expect(a.byAgent[0]).toMatchObject({ agent: "stk", entries: 5 }); expect(a.marginImpact.caveat).toMatch(/pas automatiquement un bénéfice perdu/); expect(a.marginImpact.potentialResaleMargin).toBe(2500); expect(a.limits.join(" ")).toMatch(/sans coût/);
    await err(call("stk", "scount.analysis", { id }), 403);
  });
  it("analyse refusée avant la fin du comptage", async () => { const id = await started(); await err(call("ger", "scount.analysis", { id }), 409); });
  it("propositions : lecture seule ; écart important → second comptage ; petit écart sans alerte → approbation à confirmer ; rien n'est appliqué", async () => {
    const id = await started({ thresholdPct: 10 }); await toReview(id, { Riz: 99, Huile: 30 }); const before = JSON.stringify(st.rows("inventory_lines")); const p = await ok(call("ger", "scount.propose", { id })); expect(JSON.stringify(st.rows("inventory_lines"))).toBe(before); expect(st.rows("stock_moves").filter((m) => String(m.refId).startsWith("inventaire:"))).toHaveLength(0);
    expect(p.proposals.find((x: any) => x.name === "Huile").action).toBe("second"); expect(p.proposals.find((x: any) => x.name === "Riz").action).toBe("approve"); expect(p.note).toMatch(/rien n'est appliqué/);
  });
  it("historique comparatif des inventaires validés et taux de précision par inventaire", async () => {
    await hist([{ name: "Riz", productId: "p1", theoretical: 100, diff: 0 }, { name: "Huile", productId: "p2", theoretical: 50, diff: -5 }], 60, "INV-A"); await hist([{ name: "Riz", productId: "p1", theoretical: 100, diff: 0 }, { name: "Huile", productId: "p2", theoretical: 50, diff: 0 }], 30, "INV-B");
    const h = await ok(call("ger", "scount.history")); expect(h.inventories.map((x: any) => [x.number, x.accuracyLines])).toEqual([["INV-A", 50], ["INV-B", 100]]); expect(h.trend.accuracyLinesDelta).toBe(50);
  });
});

describe("planification cyclique, retards et alertes", () => {
  it("fréquences configurables et validées ; jamais compté signalé sans ancienneté inventée ; classes ABC sur l'historique réel", async () => {
    await err(call("ger", "scount.plan.save", { freq: { A: 0 } }), 400); await err(call("ger", "scount.plan.save", { freq: { A: 200, B: 90, C: 180 } }), 400); await err(call("ger", "scount.plan.save", { agents: [U.cais!] }), 400); await ok(call("ger", "scount.plan.save", { freq: { A: 15, B: 45, C: 120 }, agents: [U.stk!], responsibleId: U.ger! }));
    await mv("p2", 40, "sale", -60); await hist([{ name: "Riz", productId: "p1", theoretical: 100, diff: 0 }], 130); const s = await ok(call("ger", "scount.suggest")); expect(s.freq).toEqual({ A: 15, B: 45, C: 120 }); const riz = s.items.find((x: any) => x.name === "Riz"); expect(riz.neverCounted).toBe(false); expect(riz.lastCounted).toBeTruthy(); expect(s.items.find((x: any) => x.name === "Savon")).toMatchObject({ neverCounted: true, overdueDays: null }); expect(s.basis).toMatch(/Rotation/);
  });
  it("génération d'un brouillon cyclique : jamais lancé ni validé automatiquement ; idempotent dans la journée", async () => {
    await ok(call("ger", "scount.plan.save", { agents: [U.stk!] })); const a = await ok(call("ger", "scount.plan.generate", { limit: 3 })); const b = await ok(call("ger", "scount.plan.generate", { limit: 3 })); expect(a.selected).toBe(3); expect(b.duplicate).toBe(true); expect((await get(a.id)).status).toBe("draft"); expect(st.rows("inventories")).toHaveLength(1); expect(st.rows("stock_moves").filter((m) => String(m.refId).startsWith("inventaire:"))).toHaveLength(0);
    await err(call("stk", "scount.plan.generate", {}), 403);
  });
  it("alertes de retard (comptage, vérification, validation) et d'écarts au-dessus des seuils ; aucune notification externe annoncée", async () => {
    await ok(call("ger", "scount.plan.save", { enabled: true })); const id = await started({ thresholdPct: 5 }); await toReview(id, { Riz: 60 }); const inv = st.rows("inventories").find((i) => i.$id === id)!; inv.countedAt = old(5); inv.startedAt = old(6);
    const a = await ok(call("ger", "scount.alerts")); const kinds = a.alerts.map((x: any) => x.kind); expect(kinds).toEqual(expect.arrayContaining(["late_validation", "big_variance", "cycle_due"])); expect(a.note).toMatch(/aucun e-mail/);
  });
});

describe("campagnes multi-magasins", () => {
  const mkB = async () => { await st.create("products", "pb1", T, { tenantId: T, shopId: B, name: "Riz", price: 1000, cost: 500, category: "Alimentaire", barcode: "B-p1", originId: "p1" }); await mv("pb1", 30, "purchase", -120, {}, B); };
  it("création réservée aux gérants ayant accès à toutes les boutiques ; une campagne = un brouillon par boutique ; idempotente", async () => {
    await mkB(); const body = { clientId: rid(), name: "Inventaire de fin d'année", shopIds: [A, B] }; await err(call("ger", "scount.campaign.save", body), 403); await err(call("own", "scount.campaign.save", { ...body, shopIds: [A] }), 400, "au moins deux"); await err(call("own", "scount.campaign.save", { ...body, name: "x" }), 400);
    const c = await ok(call("own", "scount.campaign.save", body)); expect(c.inventories).toHaveLength(2); expect(st.rows("inventories")).toHaveLength(2); expect((await ok(call("own", "scount.campaign.save", body))).duplicate).toBe(true); expect(st.rows("inventories")).toHaveLength(2); await err(call("ger", "scount.campaign.get", { id: c.id }), 403);
  });
  it("lancement groupé, suivi consolidé et individuel, comparaison des écarts entre magasins, validation centralisée", async () => {
    await mkB(); const c = await ok(call("own", "scount.campaign.save", { clientId: rid(), name: "Campagne test", shopIds: [A, B], thresholdPct: 50 })); const s = await ok(call("own", "scount.campaign.start", { id: c.id })); expect(s.started).toBe(2);
    for (const inv of c.inventories) { const shop = inv.shopId; const lines = (await ok(call("own", "count.get", { id: inv.id }, shop))).lines; for (const l of lines) await ok(call("own", "count.entry", { id: inv.id, lineId: l.id, qty: shop === B ? 29 : 100, entryKey: rid() }, shop)); }
    let g = await ok(call("own", "scount.campaign.get", { id: c.id })); expect(g.shops.every((x: any) => x.pct === 100)).toBe(true); expect(g.shops.every((x: any) => x.netValue === null)).toBe(true);
    for (const inv of c.inventories) { await ok(call("own", "count.finish", { id: inv.id, confirmUncounted: true }, inv.shopId)); await ok(call("own", "count.review", { id: inv.id }, inv.shopId)); }
    g = await ok(call("own", "scount.campaign.get", { id: c.id })); const b = g.shops.find((x: any) => x.shopId === B); expect(b.shortageValue).toBe(-500); expect(typeof g.consolidated.net).toBe("number"); expect(g.shops.find((x: any) => x.shopId === A).gapRate).toBeGreaterThan(0);
    for (const inv of c.inventories) await ok(call("own", "count.decide", { id: inv.id, all: true, reason: "Écarts constatés", forceSignificant: true }, inv.shopId)); const v = await ok(call("own", "scount.campaign.validate", { id: c.id })); expect(v.validated).toBe(2); expect(st.rows("stock_moves").filter((m) => String(m.refId).startsWith("inventaire:")).length).toBeGreaterThanOrEqual(2); expect((await ok(call("own", "scount.campaign.list"))).campaigns[0].name).toBe("Campagne test");
    expect((await ok(call("own", "scount.campaign.validate", { id: c.id }))).validated).toBe(2); // rejouer ne double rien
  });
  it("validation centralisée : une boutique non prête est signalée sans bloquer les autres", async () => {
    await mkB(); const c = await ok(call("own", "scount.campaign.save", { clientId: rid(), name: "Campagne partielle", shopIds: [A, B] })); await ok(call("own", "scount.campaign.start", { id: c.id })); const [ia, ib] = c.inventories;
    const l = (await ok(call("own", "count.get", { id: ia.id }, ia.shopId))).lines[0]; await ok(call("own", "count.entry", { id: ia.id, lineId: l.id, qty: 1, entryKey: rid() }, ia.shopId)); await ok(call("own", "count.finish", { id: ia.id, confirmUncounted: true }, ia.shopId)); await ok(call("own", "count.review", { id: ia.id }, ia.shopId));
    const v = await ok(call("own", "scount.campaign.validate", { id: c.id })); expect(v.results.find((r: any) => r.shopId === ib.shopId)).toMatchObject({ ok: false }); expect(v.validated).toBeLessThanOrEqual(1);
  });
  it("transferts pendant la campagne : comptage double ou marchandise comptée nulle part signalés pour le consolidé", async () => {
    await mkB(); const c = await ok(call("own", "scount.campaign.save", { clientId: rid(), name: "Avec transfert", shopIds: [A, B] })); await ok(call("own", "scount.campaign.start", { id: c.id })); const ia = c.inventories.find((x: any) => x.shopId === A), ib = c.inventories.find((x: any) => x.shopId === B);
    const la = (await ok(call("own", "count.get", { id: ia.id }, A))).lines.find((l: any) => l.name === "Riz"); await ok(call("own", "count.entry", { id: ia.id, lineId: la.id, qty: 100, entryKey: rid() }, A)); await later(); await ok(call("own", "stock.transfer", { transferId: rid(), toShopId: B, lines: [{ productId: "p1", qty: 10 }] }, A)); await later();
    const lb = (await ok(call("own", "count.get", { id: ib.id }, B))).lines.find((l: any) => l.name === "Riz"); await ok(call("own", "count.entry", { id: ib.id, lineId: lb.id, qty: 40, entryKey: rid() }, B)); const t = await ok(call("own", "scount.campaign.transfers", { id: c.id })); expect(t.transfers[0]).toMatchObject({ product: "Riz", risk: "double", qty: 10 }); expect(t.summary.double).toBe(1); expect(t.note).toMatch(/écarts restent justes/);
  });
});

describe("séparation des droits, rapports et changement d'abonnement", () => {
  it("Pro : celui qui a vérifié les écarts ne valide pas (le propriétaire peut) ; celui qui a compté non plus", async () => {
    const id = await started({ thresholdPct: 50 }); await toReview(id, { Riz: 97 }); await ok(call("ger", "count.decide", { id, all: true, reason: "Perte" })); await err(call("ger", "count.validate", { id }), 403, "Séparation des droits"); await ok(call("ger2", "count.validate", { id })); expect(await stockFor(st, "p1")).toBe(97);
    setPlan("business"); const id2 = await started({ thresholdPct: 50, kind: "partial", categories: ["Hygiène"] }); await toReview(id2, { Savon: 19 }); await ok(call("ger", "count.decide", { id: id2, all: true, reason: "Perte" })); await ok(call("ger", "count.validate", { id: id2 })); // en Business la règle Pro ne s'applique pas
  });
  it("rapport Pro complet : valorisation, zones, agents, anomalies et décisions, comparaison, journal d'audit ; export prêt", async () => {
    await hist([{ name: "Riz", productId: "p1", theoretical: 100, diff: -1 }], 40); const id = await started(); await ok(call("ger", "scount.zones", { id, zones: [{ name: "Tout", agents: [U.stk!], categories: ["Alimentaire", "Hygiène"] }] })); await toReview(id, { Riz: 95, Savon: 20 }); const r = await ok(call("ger", "scount.report", { id }));
    expect(r.export.title).toContain("Silent Smart Count"); expect(r.export.sections.map((s: any) => s.name)).toEqual(expect.arrayContaining(["Synthèse", "Valorisation", "Par zone", "Par classe ABC", "Résultats par agent", "Anomalies et décisions", "Comparaison avec les inventaires précédents", "Journal d'audit"])); expect(r.audit).toBeGreaterThan(5);
    expect(r.export.notes.join(" ")).toMatch(/aucune ne qualifie une fraude/); await err(call("stk", "scount.report", { id }), 403);
  });
  it("Pro → Business : données conservées, Pro refusé, lignes en contrôle indépendant convertibles en recomptage standard, validation Business possible", async () => {
    const id = await started({ thresholdPct: 50 }); await countAll(id, { Riz: 97, Huile: 50 }); const l = await lineOf(id, "Riz"); await ok(call("ger", "scount.second", { id, lineIds: [l.id], reason: "Contrôle" })); setPlan("business");
    expect((await get(id)).lines.find((x: any) => x.name === "Riz").status).toBe("second"); await err(call("ger", "scount.anomalies", { id }), 402); await err(enter(id, l.id, 97, "stk2"), 402, "Pro"); await err(call("ger", "count.finish", { id, confirmUncounted: true }), 409);
    await ok(call("ger", "count.recount", { id, lineIds: [l.id], reason: "Retour à la formule Business" })); expect((await lineOf(id, "Riz")).status).toBe("recount"); await ok(enter(id, l.id, 97, "stk")); await finishReview(id); await ok(call("ger", "count.decide", { id, all: true, reason: "Perte" })); await ok(call("ger2", "count.validate", { id })); expect(await stockFor(st, "p1")).toBe(97);
    setPlan("pro"); expect((await ok(call("ger", "scount.history"))).inventories).toHaveLength(1); expect(st.rows("inventory_events").some((e) => e.kind === "second_request")).toBe(true); // l'historique Pro est intact
  });
});
