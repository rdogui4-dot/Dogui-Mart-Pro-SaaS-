import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { stockFor } from "./checkout";

const T = "tenantprc001";
let st: MemoryStore; let A = "", B = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown, shop = A, tenant = T) => handle(st, user, { action, tenantId: tenant, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); return x.body.error as string; };
const setPlan = (plan: string) => { const row = st.rows("subscriptions").find((r) => r.$id === T); const data = { tenantId: T, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", T, T, data); };
let n = 0; const cid = () => `vente-prc-${String(++n).padStart(6, "0")}`;
const sell = (lines: object[], amount: number, extra: object = {}, shop = A) => call("own", "checkout", { clientId: cid(), lines, payments: [{ method: "cash", amount }], ...extra }, shop);
const lastSale = () => st.rows("sales").at(-1)!;
const lastLine = (i = 0) => JSON.parse(String(lastSale().lines))[i];
const day = (d: number) => new Date(Date.now() + d * 864e5).toISOString();
const rule = (productId: string, r: object, shop = A) => call("own", "price.rule.save", { productId, ...r }, shop);
let pid = "", cust = "";

beforeEach(async () => {
  st = new MemoryStore(); n = 0;
  await st.grant(T, "own", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId;
  for (const [u, role] of [["cais", "cashier"], ["mag", "stockkeeper"], ["ger", "manager"]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: [A] }, ""))).userId;
  setPlan("pro");
  pid = (await ok(call("own", "article.save", { data: { name: "Riz 1kg", price: 1000, cost: 700, sku: "RIZ", barcode: "RIZ0" }, initialQty: 500 }))).id;
  cust = (await ok(call("own", "entity.save", { table: "customers", data: { name: "Grossiste Awa" } }))).id;
});

describe("création et validation des tarifs", () => {
  it("enregistre un prix par quantité, journalisé, avec alerte si inférieur au coût", async () => {
    const r = await ok(rule(pid, { kind: "quantity", price: 900, minQty: 10, label: "Lot de 10" }));
    expect(r.belowCost).toBe(false);
    expect(st.rows("article_price_rules")[0]).toMatchObject({ productId: pid, variantId: "", kind: "quantity", price: 900, minQty: 10, label: "Lot de 10", active: true, tenantId: T, shopId: A });
    expect(st.rows("audit_log").some((l) => l.action === "price.rule.create")).toBe(true);
    expect((await ok(rule(pid, { kind: "quantity", price: 600, minQty: 100 }))).belowCost).toBe(true); // 600 < coût 700 : signalé, pas bloqué
  });
  it("refuse les tarifs incohérents", async () => {
    for (const bad of [{ kind: "x", price: 1 }, { kind: "quantity", price: 900 }, { kind: "category", price: 900 }, { kind: "promo", price: 900 }, { kind: "quantity", price: -5, minQty: 2 }, { kind: "quantity", price: 9.5, minQty: 2 }, { kind: "promo", price: 1, startsAt: day(2), endsAt: day(1) }, { kind: "quantity", price: 1, minQty: 2, startsAt: day(1) }])
      await err(rule(pid, bad), 400); expect(st.rows("article_price_rules")).toHaveLength(0);
  });
  it("l'unité d'un tarif doit être un conditionnement actif de l'article", async () => {
    await err(rule(pid, { kind: "quantity", price: 1, minQty: 1, unit: "carton" }), 400, "non définie");
    await ok(call("own", "article.units.save", { productId: pid, units: [{ unit: "carton", factor: 12 }] })); await ok(rule(pid, { kind: "quantity", price: 11000, minQty: 1, unit: "carton" }));
    await ok(call("own", "article.units.save", { productId: pid, units: [] })); await err(rule(pid, { kind: "quantity", price: 1, minQty: 1, unit: "carton" }), 400);
  });
  it("article décliné : le tarif vise une variante ; article simple : jamais de variante", async () => {
    const tee = (await ok(call("own", "article.save", { data: { name: "Tee", price: 5000, sku: "T", barcode: "T0" } }))).id; const m = (await ok(call("own", "variant.save", { productId: tee, attributes: [{ name: "Taille", value: "M" }], price: 5500, initialQty: 9 }))).id;
    await err(rule(tee, { kind: "quantity", price: 5000, minQty: 3 }), 400, "variante"); await ok(rule(tee, { kind: "quantity", price: 5000, minQty: 3, variantId: m }));
    await err(rule(pid, { kind: "quantity", price: 900, minQty: 3, variantId: m }), 400, "pas de variantes");
    const other = (await ok(call("own", "article.save", { data: { name: "Autre", price: 1, sku: "O", barcode: "O0" } }))).id; await ok(call("own", "variant.save", { productId: other, attributes: [{ name: "Taille", value: "S" }] }));
    await err(rule(other, { kind: "quantity", price: 1, minQty: 3, variantId: m }), 400, "variante"); // variante d'un autre article
  });
  it("modification, suppression, idempotence et plafond de tarifs", async () => {
    const a = await ok(rule(pid, { kind: "quantity", price: 900, minQty: 10, requestId: "req-rule-000001" })); expect((await ok(rule(pid, { kind: "quantity", price: 900, minQty: 10, requestId: "req-rule-000001" }))).duplicate).toBe(true);
    expect(st.rows("article_price_rules")).toHaveLength(1);
    await ok(rule(pid, { id: a.id, kind: "quantity", price: 850, minQty: 20 })); expect(st.rows("article_price_rules")[0]).toMatchObject({ price: 850, minQty: 20 });
    await err(rule(pid, { id: a.id, kind: "quantity", price: 1, minQty: 1 }, B), 404); // autre boutique
    await ok(call("own", "price.rule.delete", { id: a.id })); expect(st.rows("article_price_rules")).toHaveLength(0);
    for (let i = 0; i < 50; i++) await ok(rule(pid, { kind: "quantity", price: 900 - i, minQty: i + 2 })); await err(rule(pid, { kind: "quantity", price: 1, minQty: 99 }), 409, "50 tarifs");
  });
  it("une promotion modifiée en tarif permanent perd ses dates", async () => {
    const a = await ok(rule(pid, { kind: "promo", price: 800, startsAt: day(-1), endsAt: day(1) })); await ok(rule(pid, { id: a.id, kind: "quantity", price: 800, minQty: 5 }));
    expect(st.rows("article_price_rules")[0]!.startsAt ?? null).toBeNull(); expect(st.rows("article_price_rules")[0]!.endsAt ?? null).toBeNull();
  });
});

describe("cas limites", () => {
  it("modifier le tarif d'un autre article de la même boutique est refusé", async () => {
    const r = await ok(rule(pid, { kind: "quantity", price: 900, minQty: 10 })); const other = (await ok(call("own", "article.save", { data: { name: "Autre", price: 500, sku: "O", barcode: "O0" } }))).id;
    await err(rule(other, { id: r.id, kind: "quantity", price: 1, minQty: 2 }), 403); expect(st.rows("article_price_rules")[0]!.price).toBe(900);
  });
  it("dates au format Appwrite (+00:00) : la promotion s'applique bien dans sa période", async () => {
    const f = (d: number) => new Date(Date.now() + d * 864e5).toISOString().replace("Z", "+00:00");
    await st.create("article_price_rules", "rule-appwrite-fmt", T, { tenantId: T, shopId: A, productId: pid, variantId: "", kind: "promo", price: 700, unit: "", minQty: 0, customerCategory: "", startsAt: f(-1), endsAt: f(1), priority: 0, active: true, label: "" });
    await ok(sell([{ productId: pid, qty: 1 }], 700)); expect(lastLine()).toMatchObject({ priceSource: "promo", priceRuleId: "rule-appwrite-fmt" });
    await st.create("article_price_rules", "rule-appwrite-old", T, { tenantId: T, shopId: A, productId: pid, variantId: "", kind: "promo", price: 1, unit: "", minQty: 0, customerCategory: "", startsAt: f(-5), endsAt: f(-4), priority: 50, active: true, label: "" });
    await ok(sell([{ productId: pid, qty: 1 }], 700)); expect(lastLine().priceRuleId).toBe("rule-appwrite-fmt"); // la promo terminée est ignorée
  });
  it("reprise d'une vente interrompue : prix évalué à la date d'origine de la vente, pas à l'heure de la reprise", async () => {
    await ok(rule(pid, { kind: "promo", price: 700, startsAt: day(-3), endsAt: day(-1) })); // promo terminée aujourd'hui
    await st.create("sales", "vente-reprise-promo", T, { tenantId: T, shopId: A, number: "V-X", total: 700, vat: 0, status: "posted", clientId: "vente-reprise-promo", soldAt: day(-2), lines: "[]", payments: "[]", cashierId: "own" });
    const r = await ok(call("own", "checkout", { clientId: "vente-reprise-promo", lines: [{ productId: pid, qty: 1 }], payments: [{ method: "cash", amount: 700 }] })); expect(r.duplicate).toBe(false);
  });
});

describe("application en caisse : prix figé dans la ligne", () => {
  it("palier de quantité : appliqué dès le seuil, source et règle enregistrées", async () => {
    const r = await ok(rule(pid, { kind: "quantity", price: 900, minQty: 10 }));
    await ok(sell([{ productId: pid, qty: 9 }], 9000)); expect(lastSale().total).toBe(9000); expect(lastLine().priceSource).toBeUndefined();
    await ok(sell([{ productId: pid, qty: 10 }], 9000)); expect(lastSale().total).toBe(9000);
    expect(lastLine()).toMatchObject({ qty: 10, unitPrice: 900, amount: 9000, priceSource: "quantity", priceRuleId: r.id, basePrice: 1000 });
  });
  it("catégorie de clients : prix de gros seulement pour un client de cette catégorie", async () => {
    await ok(rule(pid, { kind: "category", price: 850, customerCategory: "wholesale" }));
    await ok(sell([{ productId: pid, qty: 2 }], 2000, { customerId: cust })); expect(lastSale().total).toBe(2000); // client sans catégorie : détail
    await ok(call("own", "entity.save", { table: "customers", id: cust, data: { category: "wholesale" } }));
    await ok(sell([{ productId: pid, qty: 2 }], 1700, { customerId: cust })); expect(lastSale().total).toBe(1700); expect(lastLine()).toMatchObject({ priceSource: "category", unitPrice: 850 });
    await ok(sell([{ productId: pid, qty: 2 }], 2000)); expect(lastSale().total).toBe(2000); // comptoir : détail
  });
  it("promotion : valable dans sa période, évaluée à la date de la vente (vente hors ligne comprise)", async () => {
    await ok(rule(pid, { kind: "promo", price: 700, startsAt: day(-3), endsAt: day(-1) })); // terminée
    await ok(sell([{ productId: pid, qty: 1 }], 1000)); expect(lastSale().total).toBe(1000);
    await ok(sell([{ productId: pid, qty: 1 }], 700, { soldAt: day(-2) })); expect(lastSale().total).toBe(700); expect(lastLine().priceSource).toBe("promo"); // vente saisie hors ligne pendant la promo
    await ok(rule(pid, { kind: "promo", price: 600, startsAt: day(-1), endsAt: day(1) })); await ok(sell([{ productId: pid, qty: 1 }], 600)); expect(lastLine()).toMatchObject({ priceSource: "promo", unitPrice: 600 });
  });
  it("priorité : la promotion en cours l'emporte sur le prix de gros et sur le palier", async () => {
    await ok(call("own", "entity.save", { table: "customers", id: cust, data: { category: "wholesale" } }));
    await ok(rule(pid, { kind: "quantity", price: 800, minQty: 5 })); await ok(rule(pid, { kind: "category", price: 750, customerCategory: "wholesale" }));
    await ok(sell([{ productId: pid, qty: 5 }], 3750, { customerId: cust })); expect(lastLine().priceSource).toBe("category");
    await ok(rule(pid, { kind: "promo", price: 900, startsAt: day(-1), endsAt: day(1) })); await ok(sell([{ productId: pid, qty: 5 }], 4500, { customerId: cust })); expect(lastLine()).toMatchObject({ priceSource: "promo", amount: 4500 });
    await ok(rule(pid, { kind: "promo", price: 880, startsAt: day(-1), endsAt: day(1), priority: 5 })); await ok(sell([{ productId: pid, qty: 5 }], 4400, { customerId: cust })); expect(lastLine().unitPrice).toBe(880);
  });
  it("carton : prix propre au carton ; sans règle, prix de base × coefficient", async () => {
    await ok(call("own", "article.units.save", { productId: pid, units: [{ unit: "carton", factor: 12 }] }));
    await ok(sell([{ productId: pid, qty: 1, unit: "carton" }], 12000)); expect(lastLine()).toMatchObject({ qty: 12, unit: "carton", amount: 12000 }); expect(lastLine().priceSource).toBeUndefined();
    await ok(rule(pid, { kind: "quantity", price: 11000, minQty: 1, unit: "carton" })); await ok(rule(pid, { kind: "quantity", price: 10000, minQty: 5, unit: "carton" }));
    await ok(sell([{ productId: pid, qty: 2, unit: "carton" }], 22000)); expect(lastSale().total).toBe(22000); expect(lastLine()).toMatchObject({ qty: 24, amount: 22000, priceSource: "quantity" });
    await ok(sell([{ productId: pid, qty: 5, unit: "carton" }], 50000)); expect(lastSale().total).toBe(50000);
    await ok(sell([{ productId: pid, qty: 12 }], 12000)); expect(lastSale().total).toBe(12000); // à la pièce : la règle carton ne s'applique pas
    expect(await stockFor(st, pid)).toBe(500 - 12 - 24 - 60 - 12);
    expect(st.rows("stock_moves").find((m) => m.unit === "carton" && m.unitQty === 5)).toMatchObject({ qty: 60 });
  });
  it("variante : tarif propre à la variante", async () => {
    const tee = (await ok(call("own", "article.save", { data: { name: "Tee", price: 5000, sku: "T", barcode: "T0" } }))).id;
    const m = (await ok(call("own", "variant.save", { productId: tee, attributes: [{ name: "Taille", value: "M" }], price: 5500, cost: 3000, initialQty: 20 }))).id; const l = (await ok(call("own", "variant.save", { productId: tee, attributes: [{ name: "Taille", value: "L" }], price: 6000, initialQty: 20 }))).id;
    await ok(rule(tee, { kind: "quantity", price: 5000, minQty: 3, variantId: m }));
    await ok(sell([{ productId: tee, variantId: m, qty: 3 }], 15000)); expect(lastLine()).toMatchObject({ variantId: m, amount: 15000, priceSource: "quantity", basePrice: 5500 });
    await ok(sell([{ productId: tee, variantId: l, qty: 3 }], 18000)); expect(lastSale().total).toBe(18000); expect(lastLine().priceSource).toBeUndefined(); // la règle de M n'affecte pas L
  });
  it("quantité décimale au kilo : palier et arrondi exacts", async () => {
    const kg = (await ok(call("own", "article.save", { data: { name: "Riz vrac", price: 1500, unit: "kg", qtyScale: 3, sku: "RV", barcode: "RV0" }, initialQty: 100 }))).id;
    await ok(rule(kg, { kind: "quantity", price: 1400, minQty: "5" })); await ok(sell([{ productId: kg, qty: "4.999" }], 7499)); expect(lastSale().total).toBe(7499); // 4,999 × 1500 = 7498,5 → 7499
    await ok(sell([{ productId: kg, qty: "5" }], 7000)); expect(lastSale().total).toBe(7000); expect(lastLine()).toMatchObject({ qty: 5, unitPrice: 1400 });
  });
  it("remise manuelle (gérant) appliquée sur le prix de la règle", async () => {
    await ok(rule(pid, { kind: "quantity", price: 900, minQty: 10 }));
    await err(call(U.cais!, "checkout", { clientId: cid(), lines: [{ productId: pid, qty: 10, discountPct: 10 }], payments: [{ method: "cash", amount: 8100 }] }), 403);
    await ok(call(U.ger!, "checkout", { clientId: cid(), lines: [{ productId: pid, qty: 10, discountPct: 10 }], payments: [{ method: "cash", amount: 8100 }] })); expect(lastSale().total).toBe(8100);
  });
  it("une modification ultérieure des règles ou du prix ne réécrit jamais une vente passée ; la reprise garde le prix d'origine", async () => {
    const r = await ok(rule(pid, { kind: "quantity", price: 900, minQty: 10 })); await ok(sell([{ productId: pid, qty: 10 }], 9000)); const before = JSON.parse(JSON.stringify(lastSale()));
    await ok(rule(pid, { id: r.id, kind: "quantity", price: 500, minQty: 10 })); await ok(call("own", "article.save", { id: pid, data: { price: 2000 } })); await ok(call("own", "price.rule.delete", { id: r.id }));
    expect(st.rows("sales").at(0)).toEqual(before); expect(JSON.parse(String(before.lines))[0]).toMatchObject({ amount: 9000, priceRuleId: r.id });
  });
  it("rapports et facture : le chiffre d'affaires suit le total de la vente, marge sur le coût figé", async () => {
    await ok(rule(pid, { kind: "quantity", price: 850, minQty: 10 })); await ok(sell([{ productId: pid, qty: 10 }], 8500));
    const d = new Date().toISOString().slice(0, 10); const rep = await ok(call("own", "report.consolidated", { from: d, to: d }));
    expect(rep.totals.revenueTtc).toBe(8500); expect(rep.topProducts[0]).toMatchObject({ qty: 10, revenueTtc: 8500 });
    const inv = await ok(call("own", "invoice.customer.fromSale", { invoiceId: "facture-prc-00001", saleId: lastSale().$id })); expect(st.rows("invoices").find((i) => i.$id === inv.id)!.total).toBe(8500);
    expect(JSON.parse(String(st.rows("invoices").find((i) => i.$id === inv.id)!.lines))[0]).toMatchObject({ amount: 8500, qty: 10 });
  });
});

describe("droits de formule, rôles, isolation", () => {
  it("Business : aucun tarif créé, modifié ni supprimé (402) ; les anciens tarifs ne s'appliquent plus ; les données restent", async () => {
    const r = await ok(rule(pid, { kind: "quantity", price: 900, minQty: 10 })); await ok(call("own", "entity.save", { table: "customers", id: cust, data: { category: "wholesale" } })); await ok(rule(pid, { kind: "category", price: 800, customerCategory: "wholesale" }));
    setPlan("business");
    await err(rule(pid, { kind: "quantity", price: 1, minQty: 2 }), 402, "Pro"); await err(rule(pid, { id: r.id, kind: "quantity", price: 1, minQty: 2 }), 402); await err(call("own", "price.rule.delete", { id: r.id }), 402);
    await ok(sell([{ productId: pid, qty: 10 }], 10000, { customerId: cust })); expect(lastSale().total).toBe(10000); expect(lastLine().priceSource).toBeUndefined(); // prix de base
    expect(st.rows("article_price_rules")).toHaveLength(2);
    await err(call("own", "entity.save", { table: "customers", id: cust, data: { category: "reseller" } }), 402); await ok(call("own", "entity.save", { table: "customers", id: cust, data: { category: "" } })); // on peut retirer une catégorie
    setPlan("pro"); await ok(sell([{ productId: pid, qty: 10 }], 9000)); expect(lastSale().total).toBe(9000); // retour en Pro : les tarifs sont de nouveau là
  });
  it("catégorie de client : valeur contrôlée, gérant ou propriétaire seulement", async () => {
    await err(call("own", "entity.save", { table: "customers", id: cust, data: { category: "vip" } }), 400); await err(call(U.cais!, "entity.save", { table: "customers", id: cust, data: { category: "wholesale" } }), 403);
    await ok(call(U.ger!, "entity.save", { table: "customers", id: cust, data: { category: "reseller" } })); expect(st.rows("customers")[0]!.category).toBe("reseller");
  });
  it("magasinier : peut gérer les tarifs de son module Stock ; caissier : non", async () => {
    await ok(call(U.mag!, "price.rule.save", { productId: pid, kind: "quantity", price: 900, minQty: 10 })); await err(call(U.cais!, "price.rule.save", { productId: pid, kind: "quantity", price: 900, minQty: 10 }), 403);
    const id = st.rows("article_price_rules")[0]!.$id; await err(call(U.cais!, "price.rule.delete", { id }), 403);
  });
  it("isolation entre entreprises et boutiques ; lecture comme les articles", async () => {
    const r = await ok(rule(pid, { kind: "quantity", price: 900, minQty: 10 }));
    await st.grant("tenantprcX", "intruder", ["owner"], []); const xs = (await ok(handle(st, "intruder", { action: "shop.create", tenantId: "tenantprcX", shopId: "", payload: { name: "X" } }))).shopId;
    Object.assign(st.rows("subscriptions").find((x) => x.$id === "tenantprcX")!, { plan: "pro", period: "month", status: "paid", renewsAt: new Date(Date.now() + 864e6).toISOString() });
    const x = (a: string, p: object) => handle(st, "intruder", { action: a, tenantId: "tenantprcX", shopId: xs, payload: p });
    await err(x("price.rule.save", { productId: pid, kind: "quantity", price: 1, minQty: 2 }), 404); await err(x("price.rule.save", { id: r.id, productId: pid, kind: "quantity", price: 1, minQty: 2 }), 404); await err(x("price.rule.delete", { id: r.id }), 404);
    await err(rule(pid, { kind: "quantity", price: 1, minQty: 2 }, B), 404);
    expect(st.readableBy(U.cais!, "article_price_rules").map((q) => q.$id)).toContain(r.id); expect(st.readableBy("intruder", "article_price_rules")).toHaveLength(0);
  });
});
