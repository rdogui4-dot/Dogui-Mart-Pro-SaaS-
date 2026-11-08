import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { stockFor, stockScaled } from "./checkout";

const T = "tenantpkg001";
let st: MemoryStore; let A = "", B = "";
const call = (user: string, action: string, payload: unknown, shop = A) => handle(st, user, { action, tenantId: T, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); return x.body.error as string; };
const setPlan = (plan: string) => { const row = st.rows("subscriptions").find((r) => r.$id === T); const data = { tenantId: T, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", T, T, data); };
let n = 0; const cid = () => `vente-pkg-${String(++n).padStart(6, "0")}`;
const sell = (lines: object[], amount: number, shop = A) => call("own", "checkout", { clientId: cid(), lines, payments: [{ method: "cash", amount }] }, shop);
const save = (data: object, extra: object = {}, shop = A) => call("own", "article.save", { data, ...extra }, shop);
const RIZ = { name: "Riz en vrac", price: 1500, cost: 1000, unit: "kg", qtyScale: 3, sku: "RIZ", barcode: "RIZ1" };
const SODA = { name: "Soda 33cl", price: 400, cost: 300, unit: "piece", qtyScale: 0, sku: "SODA", barcode: "SODA1" };

beforeEach(async () => {
  st = new MemoryStore(); n = 0;
  await st.grant(T, "own", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId;
  setPlan("pro");
});

describe("quantités décimales (kg, litre) en sous-unités", () => {
  it("crée un article au kilo, stocke en grammes entiers et relit en kilos", async () => {
    const { id } = await ok(save(RIZ, { initialQty: "12.5" }));
    expect(st.rows("products").find((p) => p.$id === id)).toMatchObject({ unit: "kg", qtyScale: 3 });
    expect(await stockScaled(st, id)).toBe(12500); expect(await stockFor(st, id)).toBe(12.5);
    expect(st.rows("stock_moves")[0]).toMatchObject({ qty: 12500, kind: "adjust", refId: "stock-initial" });
  });
  it("vend 1,5 kg : prix exact, stock en grammes, ligne de vente en kilos", async () => {
    const { id } = await ok(save(RIZ, { initialQty: 10 }));
    await ok(sell([{ productId: id, qty: "1.5" }], 2250));
    expect(await stockFor(st, id)).toBe(8.5); expect(await stockScaled(st, id)).toBe(8500);
    const sale = st.rows("sales")[0]!; expect(sale.total).toBe(2250);
    expect(JSON.parse(String(sale.lines))[0]).toMatchObject({ qty: 1.5, unitPrice: 1500, unitCost: 1000 });
    expect(st.rows("stock_moves").find((m) => m.kind === "sale")!.qty).toBe(1500);
  });
  it("arrondit au franc sans dérive (0,333 kg × 500 = 166,5 → 167)", async () => {
    const { id } = await ok(save({ ...RIZ, price: 500 }, { initialQty: 5 }));
    await ok(sell([{ productId: id, qty: "0.333" }], 167)); expect(st.rows("sales")[0]!.total).toBe(167);
  });
  it("1000 ventes de 1 g laissent exactement 0 écart (aucune dérive de virgule flottante)", async () => {
    const { id } = await ok(save({ ...RIZ, price: 1000 }, { initialQty: "1" }));
    for (let i = 0; i < 10; i++) await ok(sell([{ productId: id, qty: "0.1" }], 100));
    expect(await stockScaled(st, id)).toBe(0); expect(await stockFor(st, id)).toBe(0);
    await err(sell([{ productId: id, qty: "0.001" }], 1), 409, "Stock insuffisant");
  });
  it("refuse trop de décimales, une quantité nulle et la décimale sur un article entier", async () => {
    const { id } = await ok(save(RIZ, { initialQty: 10 })); const { id: sid } = await ok(save(SODA, { initialQty: 10 }));
    await err(sell([{ productId: id, qty: "1.2345" }], 1), 400); await err(sell([{ productId: id, qty: "0" }], 1), 400);
    await err(sell([{ productId: sid, qty: "1.5" }], 600), 400, "unité entière"); await err(sell([{ productId: sid, qty: "abc" }], 1), 400);
    expect(await stockFor(st, id)).toBe(10); expect(st.rows("sales")).toHaveLength(0);
  });
  it("une reprise de la même vente ne retire pas deux fois le stock", async () => {
    const { id } = await ok(save(RIZ, { initialQty: 10 })); const clientId = "vente-reprise-dec-1";
    const body = { clientId, lines: [{ productId: id, qty: "2.25" }], payments: [{ method: "cash", amount: 3375 }] };
    await ok(call("own", "checkout", body)); const again = await ok(call("own", "checkout", body)); expect(again.duplicate).toBe(true);
    expect(await stockFor(st, id)).toBe(7.75);
  });
  it("inventaire décimal : l'écart est un mouvement en sous-unités", async () => {
    const { id } = await ok(save(RIZ, { initialQty: 10 }));
    const r = await ok(call("own", "stock.adjust", { productId: id, counted: "9.75" })); expect(r.diff).toBe(-0.25);
    expect(await stockFor(st, id)).toBe(9.75); expect(st.rows("stock_moves").at(-1)).toMatchObject({ qty: -250, kind: "adjust", refId: "inventaire" });
    await err(call("own", "stock.adjust", { productId: id, counted: "9.7551" }), 400); await ok(call("own", "stock.adjust", { productId: id, counted: "0" })); expect(await stockFor(st, id)).toBe(0);
  });
  it("la précision ne change que sans mouvement de stock, et seulement en Pro", async () => {
    const { id } = await ok(save({ ...SODA, sku: "S2", barcode: "S2" }));
    await ok(call("own", "article.save", { id, data: { qtyScale: 2 } }));
    expect(st.rows("products").find((p) => p.$id === id)!.qtyScale).toBe(2);
    await ok(call("own", "stock.adjust", { productId: id, counted: "5" }));
    await err(call("own", "article.save", { id, data: { qtyScale: 0 } }), 409, "mouvements");
    setPlan("business"); const { id: id2 } = await ok(save({ ...SODA, sku: "S3", barcode: "S3" }));
    await err(call("own", "article.save", { id: id2, data: { qtyScale: 1 } }), 402, "Pro"); await err(save({ ...RIZ, sku: "R9", barcode: "R9" }), 402, "Pro");
  });
  it("achats : commande et réception décimales, coût moyen pondéré, stock en sous-unités", async () => {
    const { id } = await ok(save(RIZ, { initialQty: 10 })); const { id: sup } = await ok(call("own", "entity.save", { table: "suppliers", data: { name: "Grossiste" } }));
    const po = await ok(call("own", "po.create", { clientId: "commande-dec-0001", supplierId: sup, lines: [{ productId: id, qty: "2.5", unitCost: 1200 }] }));
    await err(call("own", "po.create", { clientId: "commande-dec-0002", supplierId: sup, lines: [{ productId: id, qty: "2.5555", unitCost: 1200 }] }), 400);
    await ok(call("own", "po.receive", { poId: po.id, receiptId: "reception-dec-001", lines: [{ productId: id, qty: "1.5" }] }));
    await ok(call("own", "po.receive", { poId: po.id, receiptId: "reception-dec-002", lines: [{ productId: id, qty: "1" }] }));
    expect(await stockFor(st, id)).toBe(12.5); expect(await stockScaled(st, id)).toBe(12500);
    expect(st.rows("purchase_orders")[0]).toMatchObject({ status: "received", total: 3000 });
    expect(st.rows("products").find((p) => p.$id === id)!.cost).toBe(1040); // (10×1000 + 2,5×1200) / 12,5
    await err(call("own", "po.receive", { poId: po.id, receiptId: "reception-dec-003", lines: [{ productId: id, qty: "0.001" }] }), 409);
  });
  it("transfert décimal : sorties et entrées en sous-unités, même précision dans la boutique cible", async () => {
    const { id } = await ok(save(RIZ, { initialQty: 10 }));
    await ok(call("own", "stock.transfer", { transferId: "transfert-dec-0001", toShopId: B, lines: [{ productId: id, qty: "2.75" }] }));
    expect(await stockFor(st, id)).toBe(7.25);
    const target = st.rows("products").find((p) => p.shopId === B)!; expect(target).toMatchObject({ qtyScale: 3, unit: "kg" });
    expect(await stockFor(st, target.$id)).toBe(2.75);
    await err(call("own", "stock.transfer", { transferId: "transfert-dec-0002", toShopId: B, lines: [{ productId: id, qty: "0.0001" }] }), 400);
  });
  it("rapport : le stock valorisé tient compte de l'échelle", async () => {
    await ok(save(RIZ, { initialQty: "2.5" })); const day = new Date().toISOString().slice(0, 10);
    const r = await ok(call("own", "report.consolidated", { from: day, to: day }));
    expect(r.totals.stockValue).toBe(2500); // 2,5 kg × 1000 FCFA
  });
});

describe("conditionnements (carton, paquet…)", () => {
  const units = (productId: string, list: object[], shop = A) => call("own", "article.units.save", { productId, units: list }, shop);
  it("définit les unités, valide les coefficients et refuse l'unité de base", async () => {
    const { id } = await ok(save(SODA, { initialQty: 100 }));
    await ok(units(id, [{ unit: "carton", factor: 12 }, { unit: "paquet", factor: 6 }]));
    expect(st.rows("article_units").map((u) => [u.unit, u.factor, u.active]).sort()).toEqual([["carton", 12, true], ["paquet", 6, true]]);
    for (const bad of [[{ unit: "piece", factor: 1 }], [{ unit: "carton", factor: 0 }], [{ unit: "carton", factor: 1.5 }], [{ unit: "carton", factor: 12 }, { unit: "carton", factor: 6 }], [{ unit: "tonne", factor: 5 }], [{ unit: "carton", factor: 9_999_999 }]]) await err(units(id, bad), 400);
    expect(st.rows("article_units").filter((u) => u.active)).toHaveLength(2);
  });
  it("vend 2 cartons : 24 pièces retirées du stock, unité tracée sur la ligne et sur le mouvement", async () => {
    const { id } = await ok(save(SODA, { initialQty: 100 })); await ok(units(id, [{ unit: "carton", factor: 12 }]));
    await ok(sell([{ productId: id, qty: 2, unit: "carton" }], 9600));
    expect(await stockFor(st, id)).toBe(76);
    expect(st.rows("sales")[0]!.total).toBe(9600);
    expect(JSON.parse(String(st.rows("sales")[0]!.lines))[0]).toMatchObject({ qty: 24, unitPrice: 400, unit: "carton", unitQty: 2, factor: 12 });
    expect(st.rows("stock_moves").find((m) => m.kind === "sale")).toMatchObject({ qty: 24, unit: "carton", unitQty: 2 });
  });
  it("mélange pièces et cartons du même article : cumul pour le contrôle de stock", async () => {
    const { id } = await ok(save(SODA, { initialQty: 30 })); await ok(units(id, [{ unit: "carton", factor: 12 }]));
    await err(sell([{ productId: id, qty: 2, unit: "carton" }, { productId: id, qty: 7 }], 100000), 409, "Stock insuffisant"); // 24 + 7 > 30
    await ok(sell([{ productId: id, qty: 2, unit: "carton" }, { productId: id, qty: 6 }], 12000)); expect(await stockFor(st, id)).toBe(0);
    await ok(call("own", "stock.adjust", { productId: id, counted: 5 }));
    await err(sell([{ productId: id, qty: 1 }, { productId: id, qty: 1 }], 800), 400, "double");
  });
  it("conditionnement fractionnaire sur un article au kilo : sac de 25 kg, demi-sac = 12,5 kg", async () => {
    const { id } = await ok(save(RIZ, { initialQty: 100 })); await ok(units(id, [{ unit: "sac", factor: 25 }]));
    await ok(sell([{ productId: id, qty: "0.5", unit: "sac" }], 18750)); expect(await stockFor(st, id)).toBe(87.5);
    await err(sell([{ productId: id, qty: "0.0001", unit: "sac" }], 1), 400);
    await err(units(id, [{ unit: "sac", factor: "0.0001" }]), 400);
  });
  it("une unité non définie, retirée ou d'un autre article est refusée", async () => {
    const { id } = await ok(save(SODA, { initialQty: 100 })); const { id: other } = await ok(save({ ...SODA, name: "Autre", sku: "O", barcode: "O" }, { initialQty: 100 }));
    await err(sell([{ productId: id, qty: 1, unit: "carton" }], 4800), 400, "non définie");
    await ok(units(id, [{ unit: "carton", factor: 12 }])); await err(sell([{ productId: other, qty: 1, unit: "carton" }], 4800), 400, "non définie");
    await ok(units(id, [])); expect(st.rows("article_units")[0]!.active).toBe(false); // désactivée, pas supprimée
    await err(sell([{ productId: id, qty: 1, unit: "carton" }], 4800), 400, "non définie");
    expect(await stockFor(st, id)).toBe(100);
  });
  it("une vente passée garde son unité et sa conversion quand le coefficient change", async () => {
    const { id } = await ok(save(SODA, { initialQty: 100 })); await ok(units(id, [{ unit: "carton", factor: 12 }]));
    await ok(sell([{ productId: id, qty: 1, unit: "carton" }], 4800)); const before = JSON.parse(JSON.stringify(st.rows("sales")[0]));
    await ok(units(id, [{ unit: "carton", factor: 24 }])); expect(st.rows("sales")[0]).toEqual(before);
    await ok(sell([{ productId: id, qty: 1, unit: "carton" }], 9600)); expect(await stockFor(st, id)).toBe(100 - 12 - 24);
  });
});

describe("droits de formule et retour en arrière", () => {
  it("Business : ni conditionnements ni quantités décimales ; la vente à l'unité de base continue", async () => {
    setPlan("business"); const { id } = await ok(save({ ...SODA, sku: "B1", barcode: "B1" }, { initialQty: 10 }));
    await err(call("own", "article.units.save", { productId: id, units: [{ unit: "carton", factor: 12 }] }), 402, "Pro");
    await ok(sell([{ productId: id, qty: 2 }], 800));
  });
  it("Pro → Business : données conservées, conversions refusées, vente en unité de base et en kilos toujours possibles, lecture intacte", async () => {
    const { id } = await ok(save(SODA, { initialQty: 100 })); const { id: kg } = await ok(save(RIZ, { initialQty: 10 }));
    await ok(call("own", "article.units.save", { productId: id, units: [{ unit: "carton", factor: 12 }] }));
    setPlan("business");
    await err(sell([{ productId: id, qty: 1, unit: "carton" }], 4800), 402, "Pro");
    await err(call("own", "article.units.save", { productId: id, units: [] }), 402);
    await ok(sell([{ productId: id, qty: 12 }], 4800)); await ok(sell([{ productId: kg, qty: "1.5" }], 2250)); // le commerce continue de vendre
    expect(st.rows("article_units")).toHaveLength(1); expect(await stockFor(st, kg)).toBe(8.5);
    setPlan("pro"); await ok(sell([{ productId: id, qty: 1, unit: "carton" }], 4800)); // retour en Pro : tout est là
  });
  it("isolation : les conditionnements d'un autre commerce ne sont ni modifiables ni utilisables", async () => {
    const { id } = await ok(save(SODA, { initialQty: 10 }));
    await st.grant("tenantother1", "intruder", ["owner"], []); const shopX = (await ok(handle(st, "intruder", { action: "shop.create", tenantId: "tenantother1", shopId: "", payload: { name: "X" } }))).shopId;
    await err(handle(st, "intruder", { action: "article.units.save", tenantId: "tenantother1", shopId: shopX, payload: { productId: id, units: [] } }), 402); // essai Business seulement : pas de Pro chez lui
    Object.assign(st.rows("subscriptions").find((r) => r.$id === "tenantother1")!, { plan: "pro", period: "month", status: "paid", renewsAt: new Date(Date.now() + 864e6).toISOString() });
    await err(handle(st, "intruder", { action: "article.units.save", tenantId: "tenantother1", shopId: shopX, payload: { productId: id, units: [{ unit: "carton", factor: 12 }] } }), 404);
    expect(st.rows("article_units")).toHaveLength(0);
  });
});
