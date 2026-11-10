import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { toCsv } from "../../../src/domain/exports";

class DatedStore extends MemoryStore { override async create(t: string, id: string, tenant: string, d: Record<string, unknown>) { return super.create(t, id, tenant, { $createdAt: new Date().toISOString(), ...d }); } }
const T = "tenantstkp01";
let st: DatedStore; let A = "", B = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}, shop = A, tenant = T) => handle(st, U[user] ?? user, { action, tenantId: tenant, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); return x.body.error as string; };
const setPlan = (plan: string) => { const row = st.rows("subscriptions").find((r) => r.$id === T); const data = { tenantId: T, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", T, T, data); };
const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);
let mvN = 0;
const mv = (productId: string, qty: number, kind = "purchase", days = -1, extra: object = {}, shop = A) => st.create("stock_moves", `mv${++mvN}`, T, { tenantId: T, shopId: shop, productId, qty, kind, userId: "own", refId: kind === "purchase" ? "BC-X" : "", $createdAt: new Date(Date.now() + days * 864e5).toISOString(), ...extra });
/** Une vente par jour de `qty` unités pendant `n` jours (jusqu'à hier). */
const sales = async (productId: string, qty: number, n: number, shop = A, from = 1, extra: object = {}) => { for (let i = from; i < from + n; i++) await mv(productId, qty, "sale", -i + 0.5, extra, shop); };
const find = (r: { items: any[] }, id: string) => r.items.find((x) => x.productId === id);
const snapshotWrites = () => `${st.rows("stock_moves").length}|${st.rows("audit_log").length}|${st.rows("purchase_orders").length}|${st.rows("transfers").length}|${st.rows("products").length}`;

beforeEach(async () => {
  st = new DatedStore(); await st.grant(T, "own", ["owner"], []); mvN = 0;
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId;
  for (const [u, role, shops] of [["cais", "cashier", [A]], ["ger", "manager", [A, B]], ["stk", "stockkeeper", [A, B]], ["gerB", "manager", [B]]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: shops }, ""))).userId;
  const P = (id: string, name: string, cost: number, min: number, extra: object = {}, shop = A) => st.create("products", id, T, { tenantId: T, shopId: shop, name, price: cost * 2, cost, minStock: min, category: "Alimentaire", barcode: `B-${id}`, sku: `SKU-${id}`, ...extra });
  await P("p1", "Riz", 500, 10); await P("p2", "Huile", 1500, 5); await P("p3", "Sucre", 400, 5); await P("p4", "Lait", 800, 3, { category: "Laitier" }); await P("p5", "Thé", 300, 2); await P("p6", "Café", 1000, 5);
  setPlan("pro");
});

describe("abonnement, droits, isolation", () => {
  it("Pro seulement (402) ; caissier refusé (403) ; anomalies et rapports réservés aux gérants ; autre boutique non accessible", async () => {
    setPlan("business"); for (const a of ["stkp.analysis", "stkp.replenish", "stkp.network", "stkp.anomalies", "stkp.products", "stkp.report"]) await err(call("own", a), 402);
    setPlan("pro"); await err(call("cais", "stkp.analysis"), 403); await err(call("stk", "stkp.anomalies"), 403); await err(call("stk", "stkp.report"), 403); await ok(call("stk", "stkp.analysis"));
    await err(call("gerB", "stkp.analysis", { shopId: A }), 403); await err(call("ger", "stkp.analysis", { shopId: "inconnue" }), 404);
  });
  it("Pro → Business → Pro : historiques et mouvements intacts, fonctions Business actives, Pro rétabli sans perte", async () => {
    await mv("p1", 50); await sales("p1", 1, 30); const before = st.rows("stock_moves").length; const a1 = await ok(call("own", "stkp.analysis")); setPlan("business");
    expect(st.rows("stock_moves").length).toBe(before); await ok(call("own", "stk.dashboard")); await err(call("own", "stkp.analysis"), 402); setPlan("pro"); const a2 = await ok(call("own", "stkp.analysis")); expect(find(a2, "p1").sold).toBe(find(a1, "p1").sold);
  });
  it("aucune écriture : analyses, prévisions, simulations, rapports ne modifient ni stock, ni seuils, ni commandes, ni transferts", async () => {
    await mv("p1", 200); await sales("p1", 5, 60); const w = snapshotWrites();
    for (const a of ["stkp.analysis", "stkp.replenish", "stkp.network", "stkp.anomalies", "stkp.products", "stkp.report"]) await ok(call("own", a)); await ok(call("own", "stkp.simulate", { productId: "p1", orderQty: 100 })); expect(snapshotWrites()).toBe(w);
  });
});

describe("analyse : rotation, couverture, classes, ABC, immobilisation", () => {
  beforeEach(async () => {
    await mv("p1", 100, "purchase", -100); await sales("p1", 2, 60); // 100 − 120 → on part de 300 ci-dessous
    await mv("p1", 300, "purchase", -100); // stock = 280, vente 2/jour → couverture 140 j
    await mv("p2", 10, "purchase", -100); // aucune vente
    await mv("p3", 110, "purchase", -100); await sales("p3", 1, 60); // stock 50, 0,67/jour → 75 j : lent
    await mv("p4", 60, "purchase", -100); await sales("p4", 1, 60); await mv("p4", 30, "purchase", -100); // 30 → 30 j : normal
  });
  it("classe sans vente / surstock / rotation lente / normal et calcule rotation et couverture", async () => {
    const r = await ok(call("own", "stkp.analysis", { days: 90 })); expect(find(r, "p1")).toMatchObject({ cls: "overstock", sold: 120 }); expect(find(r, "p1").coverDays).toBeCloseTo(280 / (120 / 90), 0); expect(find(r, "p2")).toMatchObject({ cls: "dead", sold: 0 }); expect(find(r, "p3").cls).toBe("slow"); expect(find(r, "p4").cls).toBe("normal"); expect(r.summary.classes).toMatchObject({ dead: 1 + 0, overstock: 1, slow: 1 });
    expect(find(r, "p1").rotation).toBeGreaterThan(0); expect(r.summary.deadValue).toBe(10 * 1500); expect(r.summary.excessValue).toBeGreaterThan(0); expect(r.notes.join(" ")).toMatch(/indicateurs de gestion/);
  });
  it("ABC par valeur des ventes, par magasin / catégorie, filtre catégorie", async () => {
    const r = await ok(call("own", "stkp.analysis", { days: 90 })); expect(["A", "B", "C"]).toContain(find(r, "p1").abc); expect(r.summary.abcCount.A + r.summary.abcCount.B + r.summary.abcCount.C).toBe(r.total); expect(r.byShop.map((x: any) => x.name)).toEqual(["Dakar"]); expect(r.byCategory.map((x: any) => x.name).sort()).toEqual(["Alimentaire", "Laitier"]);
    const l = await ok(call("own", "stkp.analysis", { category: "Laitier" })); expect(l.items.map((x: any) => x.productId)).toEqual(["p4"]); const s = await ok(call("own", "stkp.analysis", { abcBy: "stock" })); expect(s.abcBy).toBe("stock");
  });
  it("variation de consommation : hausse détectée (deuxième moitié ≥ 1,5× la première)", async () => {
    await mv("p5", 500, "purchase", -100); await sales("p5", 1, 45, A, 46); await sales("p5", 3, 45, A, 1); const r = await ok(call("own", "stkp.analysis", { days: 90 })); expect(find(r, "p5").change).toMatchObject({ flag: "hausse" });
  });
  it("période bornée (28 à 365 jours) et filtre valide", async () => { const r = await ok(call("own", "stkp.analysis", { days: 3 })); expect(r.period.days).toBe(28); const r2 = await ok(call("own", "stkp.analysis", { days: 9999 })); expect(r2.period.days).toBe(365); });
});

describe("prévisions et réapprovisionnement", () => {
  it("prévision documentée (méthode, période, confiance, limites), quantité suggérée, jamais de commande créée", async () => {
    await mv("p6", 420, "purchase", -100); await sales("p6", 5, 80); const po = st.rows("purchase_orders").length; const r = await ok(call("own", "stkp.replenish", { cover: 14 })); const x = find(r, "p6");
    expect(x.forecast).toMatchObject({ confidence: "élevée", horizon: 30 }); expect(x.forecast.method).toMatch(/Lissage exponentiel/); expect(x.forecast.daily).toBeGreaterThan(4.5); expect(x.forecast.daily).toBeLessThan(5.5); expect(x.forecast.limits.join(" ")).toMatch(/jamais une certitude/); expect(x.data).toMatch(/jours de ventes/);
    expect(x.lead).toMatchObject({ days: 7 }); expect(x.lead.source).toMatch(/défaut/); expect(x.risk).toBe("high"); expect(x.suggestedQty).toBeGreaterThan(70); expect(x.suggestedMin).toBeGreaterThan(20); expect(x.formula).toMatch(/j de délai/); expect(x.estimatedCost).toBe(x.suggestedQty * 1000); expect(r.notes.join(" ")).toMatch(/aucune commande n'est créée/); expect(st.rows("purchase_orders").length).toBe(po);
  });
  it("historique insuffisant : aucune prévision chiffrée, article listé à part", async () => {
    await mv("p6", 100, "purchase", -100); await sales("p6", 2, 5); const r = await ok(call("own", "stkp.replenish", { all: true })); expect(find(r, "p6")).toBeUndefined(); expect(r.insufficient.count).toBeGreaterThan(0); expect(r.insufficient.names).toContain("Café");
    const sim = await ok(call("own", "stkp.simulate", { productId: "p6" })); expect(sim.assumptions.confidence).toBe("faible"); expect(sim.assumptions.source).toMatch(/historique insuffisant/);
  });
  it("délais : configuré par article–fournisseur, puis observé sur ≥ 2 réceptions réelles", async () => {
    await mv("p6", 100, "purchase", -100); await sales("p6", 5, 80); await st.create("suppliers", "s1", T, { tenantId: T, shopId: A, name: "Grossiste", leadDays: 0 }); await st.create("article_suppliers", "as1", T, { tenantId: T, shopId: A, productId: "p6", supplierId: "s1", price: 900, leadDays: 3 });
    let x = find(await ok(call("own", "stkp.replenish")), "p6"); expect(x.lead).toMatchObject({ days: 3, source: "configuré" }); expect(x.supplier).toBe("Grossiste");
    for (const [i, d] of [[1, 10], [2, 12]] as const) { await st.create("purchase_orders", `po${i}`, T, { tenantId: T, shopId: A, number: `BC-${i}`, supplierId: "s1", status: "received", lines: "[]", $createdAt: new Date(Date.now() - 50 * 864e5).toISOString() }); await st.create("purchase_receipts", `r${i}`, T, { tenantId: T, shopId: A, poId: `po${i}`, supplierId: "s1", number: `BR-${i}`, status: "validated", validatedAt: new Date(Date.now() - (50 - d) * 864e5).toISOString(), lines: "[]" }); }
    x = find(await ok(call("own", "stkp.replenish")), "p6"); expect([11, 12]).toContain(x.lead.days); expect(x.lead.source).toMatch(/observé \(2 réceptions\)/);
  });
  it("tient compte des commandes en cours et des transferts entrants (quantité réduite, risque atténué)", async () => {
    await mv("p6", 430, "purchase", -100); await sales("p6", 5, 80); const a = find(await ok(call("own", "stkp.replenish")), "p6"); await st.create("purchase_orders", "poX", T, { tenantId: T, shopId: A, number: "BC-X1", supplierId: "s1", status: "validated", lines: JSON.stringify([{ productId: "p6", qty: 500, received: 0 }]) });
    const b = find(await ok(call("own", "stkp.replenish", { all: true })), "p6"); expect(b.onOrder).toBe(500); expect(b.suggestedQty).toBe(0); expect(a.suggestedQty).toBeGreaterThan(0); expect(["low", "medium"]).toContain(b.risk);
  });
  it("rupture : article à zéro avec ventes récentes signalé « En rupture » sans attendre la prévision", async () => {
    await mv("p6", 50, "purchase", -100); await sales("p6", 5, 10); const r = await ok(call("own", "stkp.replenish")); expect(find(r, "p6")).toMatchObject({ risk: "out", riskLabel: "En rupture" });
  });
});

describe("simulation", () => {
  it("compare scénarios : sans commande, votre commande, suggérée (+ retard), rupture ; commande suffisante supprime les manques", async () => {
    await mv("p6", 100, "purchase", -100); await sales("p6", 5, 80); await mv("p6", 350, "purchase", -100); await mv("p6", 20, "sale", -0.2); const s = await ok(call("own", "stkp.simulate", { productId: "p6", orderQty: 400, arrivalDays: 3, horizon: 30 }));
    const by = (l: string) => s.scenarios.find((x: any) => x.label.startsWith(l)); expect(by("Sans nouvelle commande").result.lostUnits).toBeGreaterThan(0); expect(by("Votre commande").result.lostUnits).toBeLessThan(by("Sans nouvelle commande").result.lostUnits); expect(by("Rupture immédiate").result.lostUnits).toBeGreaterThan(100); expect(by("Commande suggérée avec 7 jours de retard").result.lostUnits).toBeGreaterThanOrEqual(by("Commande suggérée :").result.lostUnits);
    expect(s.assumptions.lead).toBeTruthy(); expect(s.notes.join(" ")).toMatch(/pas du chiffre d'affaires réalisé/); expect(by("Sans nouvelle commande").result.lostUnitsHigh).toBeGreaterThanOrEqual(by("Sans nouvelle commande").result.lostUnits);
  });
  it("refuse : article sans vente (409), introuvable (404), quantité invalide (400)", async () => {
    await mv("p2", 10); await err(call("own", "stkp.simulate", { productId: "p2" }), 409, "Aucune vente"); await err(call("own", "stkp.simulate", { productId: "zz" }), 404); await mv("p6", 100); await sales("p6", 2, 40); await err(call("own", "stkp.simulate", { productId: "p6", orderQty: "abc" }), 400); await err(call("own", "stkp.simulate", { productId: "p6", orderQty: -5 }), 400);
  });
});

describe("multi-magasins", () => {
  beforeEach(async () => {
    await st.create("products", "p1b", T, { tenantId: T, shopId: B, name: "Riz", price: 1000, cost: 500, minStock: 5, originId: "p1", category: "Alimentaire" });
    await mv("p1", 400, "purchase", -100); await sales("p1", 1, 60); await mv("p1b", 4, "purchase", -100, {}, B); await sales("p1b", 1, 3, B, 1); await mv("p1b", 120, "purchase", -100, {}, B); await sales("p1b", 3, 57, B, 4); await mv("p1b", -1000, "adjust", -99, {}, B); await mv("p1b", 80, "purchase", -0.5, {}, B);
  });
  it("compare les boutiques (stock, couverture), détecte le déséquilibre, suggère un transfert depuis l'excédent — sans rien transférer", async () => {
    const w = snapshotWrites(); const r = await ok(call("ger", "stkp.network")); const x = r.rebalance.find((y: any) => y.name === "Riz"); expect(x).toBeTruthy(); expect(x.positions.map((p: any) => p.shop).sort()).toEqual(["Dakar", "Thiès"]); expect(x.hints[0]).toMatchObject({ from: "Dakar", to: "Thiès" }); expect(x.hints[0].qty).toBeGreaterThan(0); expect(x.productIds[A].productId).toBe("p1"); expect(r.shops).toHaveLength(2); expect(r.shops[0]).toHaveProperty("rotation"); expect(snapshotWrites()).toBe(w);
  });
  it("un gérant limité à Thiès ne voit pas Dakar ; les transferts ouverts et en retard sont listés", async () => {
    const r = await ok(call("gerB", "stkp.network", {}, B)); expect(r.scope).toEqual(["Thiès"]); expect(r.rebalance).toEqual([]);
    const x = await ok(call("ger", "xfer.save", { clientId: rid(), toShopId: B, lines: [{ productId: "p1", qty: 20 }] })); await ok(call("ger", "xfer.ship", { id: x.id })); st.rows("transfers").find((t) => t.$id === x.id)!.shippedAt = new Date(Date.now() - 6 * 864e5).toISOString();
    const n = await ok(call("ger", "stkp.network")); expect(n.openTransfers[0]).toMatchObject({ late: true, inTransit: 20 }); expect(n.shops.find((s: any) => s.shop === "Thiès").inTransitIn).toBe(20); expect(n.shops.find((s: any) => s.shop === "Dakar").inTransitOut).toBe(20);
  });
  it("la marchandise en transit réduit le besoin du magasin destinataire", async () => {
    const before = (await ok(call("ger", "stkp.network"))).rebalance.find((y: any) => y.name === "Riz").hints.reduce((a: number, h: any) => a + h.qty, 0); await st.create("products", "p9", T, { tenantId: T, shopId: A, name: "Autre", price: 1, cost: 1 });
    const x = await ok(call("ger", "xfer.save", { clientId: rid(), toShopId: B, lines: [{ productId: "p1", qty: before }] })); await ok(call("ger", "xfer.ship", { id: x.id })); const after = (await ok(call("ger", "stkp.network"))).rebalance.find((y: any) => y.name === "Riz"); expect(after?.hints.reduce((a: number, h: any) => a + h.qty, 0) ?? 0).toBeLessThan(before);
  });
});

describe("anomalies expliquées", () => {
  it("des ventes répétées du même article (même quantité, même vendeur) ne sont plus signalées ; les lignes d'une même pièce non plus", async () => {
    await mv("p1", 100); for (let i = 0; i < 6; i++) await mv("p1", -1, "sale", -0.01, { refId: `V-${i % 3}`, userId: "stk" });
    const r = await ok(call("ger", "stkp.anomalies")); expect(r.anomalies.filter((a: any) => a.kind === "repeated")).toHaveLength(0);
    for (let i = 0; i < 4; i++) await mv("p1", -2, "adjust", -0.01, { refId: "AJ-1", userId: "stk" }); expect((await ok(call("ger", "stkp.anomalies"))).anomalies.filter((a: any) => a.kind === "repeated")).toHaveLength(0);
  });
  it("mouvements répétés, stock négatif avec preuves, ajustements sans motif, coût manquant — jamais qualifiés de fraude", async () => {
    await mv("p1", 100); for (let i = 0; i < 4; i++) await mv("p1", -2, "adjust", -0.01, { refId: "", userId: "stk" }); await mv("p2", 3, "purchase", -3); await mv("p2", 5, "sale", -1); await mv("p3", 10, "purchase", -3, {}); st.rows("products").find((p) => p.$id === "p3")!.cost = 0; await sales("p3", 1, 3);
    const r = await ok(call("ger", "stkp.anomalies")); const k = (kind: string) => r.anomalies.filter((a: any) => a.kind === kind); expect(k("repeated").length).toBe(1); expect(k("repeated")[0].evidence.length).toBeGreaterThanOrEqual(3); expect(k("negative")[0]).toMatchObject({ priority: "high" }); expect(k("negative")[0].evidence.length).toBeGreaterThan(0); expect(k("negative")[0].title).toMatch(/Huile/); expect(k("unjustified").length).toBe(1); expect(k("no_cost").some((a: any) => /Sucre/.test(a.title))).toBe(true);
    for (const a of r.anomalies) { expect(a.caveat).toMatch(/jamais une qualification de fraude/); expect(a.check.length).toBeGreaterThan(10); expect(a.title.toLowerCase()).not.toMatch(/fraude|vol\b|voleur/); } expect(r.caveat).toBeTruthy();
  });
  it("écarts d'inventaire récurrents (≥ 3 manques sur les 5 derniers comptages), réception différente de la commande, saut de coût", async () => {
    for (let i = 0; i < 4; i++) await st.create("inventory_lines", `il${i}`, T, { tenantId: T, shopId: A, inventoryId: `inv${i}`, productId: "p1", name: "Riz", counted: 5, theoretical: 8, diff: -3, status: "validated", countedAt: new Date(Date.now() - (10 - i) * 864e5).toISOString(), countedBy: "own" });
    await st.create("purchase_receipts", "rx", T, { tenantId: T, shopId: A, poId: "poq", number: "BR-9", status: "validated", validatedAt: new Date().toISOString(), deliveryNote: "BL1", lines: JSON.stringify([{ name: "Riz", ordered: 10, accepted: 6, damaged: 2, refused: 0, missingAfter: 2 }]) });
    await st.create("article_cost_events", "c1", T, { tenantId: T, shopId: A, productId: "p1", kind: "purchase", unitCost: 500, qty: 5, ref: "BC-1" }); await new Promise((r) => setTimeout(r, 5)); await st.create("article_cost_events", "c2", T, { tenantId: T, shopId: A, productId: "p1", kind: "purchase", unitCost: 1500, qty: 5, ref: "BC-2" }); await mv("p1", 10);
    const r = await ok(call("own", "stkp.anomalies")); const kinds = r.anomalies.map((a: any) => a.kind); expect(kinds).toEqual(expect.arrayContaining(["recurring_gap", "receipt_gap", "cost_jump"])); expect(r.anomalies.find((a: any) => a.kind === "recurring_gap").priority).toBe("high");
  });
  it("sorties manuelles inhabituelles d'un utilisateur (hausse nette cette semaine)", async () => {
    await mv("p1", 500); for (let w = 1; w <= 6; w++) await mv("p1", -1, "adjust", -7 * w - 1, { refId: "correction", note: "casse", userId: "stk" }); for (let i = 0; i < 12; i++) await mv("p1", -1, "adjust", -0.2 - i * 0.1, { refId: "correction", note: "x", userId: "stk" });
    const r = await ok(call("own", "stkp.anomalies")); expect(r.anomalies.some((a: any) => a.kind === "unusual_user")).toBe(true);
  });
});

describe("lots, péremption, FEFO et valeur élevée", () => {
  it("lots lus depuis le catalogue : restant par lot, FEFO, périmés, valeur à risque ; pas de seconde gestion", async () => {
    await st.create("products", "pl", T, { tenantId: T, shopId: A, name: "Yaourt", price: 400, cost: 200, tracking: "lot", category: "Laitier" }); const lot = (id: string, no: string, d: number) => st.create("article_lots", id, T, { tenantId: T, shopId: A, productId: "pl", lotNo: no, expiresAt: new Date(Date.now() + d * 864e5).toISOString(), unitCost: 200, status: "active" });
    await lot("l1", "L1", -2); await lot("l2", "L2", 10); await lot("l3", "L3", 200); await mv("pl", 10, "purchase", -20, { lotId: "l1" }); await mv("pl", 20, "purchase", -20, { lotId: "l2" }); await mv("pl", 5, "sale", -1, { lotId: "l2" }); await mv("pl", 50, "purchase", -20, { lotId: "l3" });
    const r = await ok(call("own", "stkp.products", { days: 90 })); expect(r.lots.map((l: any) => l.lotNo)).toEqual(["L1", "L2"]); expect(r.lots[1]).toMatchObject({ remaining: 15, daysLeft: 10, fefoFirst: false }); expect(r.lots[0]).toMatchObject({ status: "Périmé", fefoFirst: true, value: 2000 }); expect(r.expired).toEqual({ count: 1, value: 2000 }); expect(r.soon.count).toBe(1); expect(st.rows("article_lots").length).toBe(3);
  });
  it("produits à forte valeur classés par valeur du stock, avec emplacement et suivi", async () => {
    await mv("p1", 100); await mv("p2", 100); st.rows("products").find((p) => p.$id === "p2")!.location = "Coffre"; const r = await ok(call("own", "stkp.products")); expect(r.highValue[0]).toMatchObject({ name: "Huile", value: 150000, location: "Coffre" }); expect(r.highValue[1].name).toBe("Riz");
  });
});

describe("rapports Pro et exports", () => {
  it("rapport complet : sections, chiffres exacts de valorisation, comparaison de périodes, notes de limites, CSV exportable", async () => {
    await mv("p1", 100, "purchase", -100); await sales("p1", 2, 20); await mv("p1", -3, "loss", -2, { note: "casse", userId: "stk" }); const r = await ok(call("ger", "stkp.report", { days: 30 })); const n = r.export.sections.map((s: any) => s.name);
    expect(n).toEqual(expect.arrayContaining(["Valorisation par magasin et catégorie", "Rotation et couverture", "Prévisions de rupture", "Pertes et écarts d'inventaire (sorties négatives)", "Historique des mouvements", "Performance des approvisionnements"])); expect(n.some((x: string) => x.startsWith("Comparaison"))).toBe(true);
    const val = r.export.sections[0].rows.find((x: any[]) => x[1] === "Alimentaire"); expect(val[4]).toBe((100 - 40 - 3) * 500); const loss = r.export.sections.find((s: any) => s.name.startsWith("Pertes")).rows[0]; expect(loss[4]).toBe(-3); expect(loss[5]).toBe(-1500); expect(loss[7]).toBe("casse");
    expect(r.export.notes.join(" ")).toMatch(/jamais des certitudes/); const csv = toCsv(r.export); expect(csv).toContain("Riz"); expect(r.preview.length).toBe(r.export.sections.length);
  });
  it("sections choisies, section inconnue refusée, comparaison avec la période précédente", async () => {
    await mv("p1", 500, "purchase", -100); await sales("p1", 1, 30, A, 31); await sales("p1", 3, 30, A, 1); const r = await ok(call("own", "stkp.report", { sections: ["compare"], days: 30 })); const rows = r.export.sections[0].rows; expect(rows[0]).toMatchObject({ 0: "Unités vendues (net des retours)", 1: 90, 2: 30, 3: 60, 4: 200 }); await err(call("own", "stkp.report", { sections: ["nimporte"] }), 400);
  });
  it("performance des approvisionnements : délai moyen et taux d'écart par fournisseur", async () => {
    await st.create("suppliers", "s1", T, { tenantId: T, shopId: A, name: "Grossiste" }); await st.create("purchase_orders", "po1", T, { tenantId: T, shopId: A, number: "BC-1", supplierId: "s1", status: "received", lines: "[]", $createdAt: new Date(Date.now() - 10 * 864e5).toISOString() });
    await st.create("purchase_receipts", "r1", T, { tenantId: T, shopId: A, poId: "po1", supplierId: "s1", number: "BR-1", status: "validated", validatedAt: new Date(Date.now() - 5 * 864e5).toISOString(), lines: JSON.stringify([{ ordered: 5, accepted: 4, damaged: 1, refused: 0, missingAfter: 0 }]) });
    const r = await ok(call("own", "stkp.report", { sections: ["supply"], days: 30 })); expect(r.export.sections[0].rows[0]).toEqual(["Grossiste", 1, 1, 5, 1, 100]);
  });
});

describe("concurrence et reprise réseau", () => {
  it("analyses simultanées pendant des corrections et transferts : aucune erreur, résultats cohérents, aucun mouvement perdu", async () => {
    await mv("p1", 300); await sales("p1", 2, 40); const x = await ok(call("ger", "xfer.save", { clientId: rid(), toShopId: B, lines: [{ productId: "p1", qty: 30 }] }));
    const res = await Promise.all([call("own", "stkp.analysis"), call("own", "stkp.replenish"), call("ger", "xfer.ship", { id: x.id }), call("ger", "stk.correct", { productId: "p1", delta: -2, reason: "Casse constatée", requestKey: rid() }), call("own", "stkp.network"), call("own", "stkp.anomalies")]);
    expect(res.map((r: any) => r.status)).toEqual([200, 200, 200, 200, 200, 200]); const a = await ok(call("own", "stkp.analysis")); expect(find(a, "p1").qty).toBe(300 - 80 - 30 - 2);
  });
  it("une relance de la même requête (perte réseau) renvoie le même résultat, sans effet de bord", async () => {
    await mv("p6", 600); await sales("p6", 5, 60); const a = await ok(call("own", "stkp.replenish")); const b = await ok(call("own", "stkp.replenish")); expect(b.items).toEqual(a.items);
  });
});
