import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { stockFor } from "./checkout";
import { linkId } from "./costing";

const T = "tenantcst001";
let st: MemoryStore; let A = "", B = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown, shop = A, tenant = T) => handle(st, user, { action, tenantId: tenant, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); return x.body.error as string; };
const setPlan = (plan: string) => { const row = st.rows("subscriptions").find((r) => r.$id === T); const data = { tenantId: T, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", T, T, data); };
let n = 0; const id8 = (p: string) => `${p}-${String(++n).padStart(8, "0")}`;
let pid = "", s1 = "", s2 = "";
const link = (b: object, shop = A) => call("own", "supplier.link.save", { productId: pid, supplierId: s1, price: 1000, ...b }, shop);
const po = async (supplierId: string, lines: object[]) => (await ok(call("own", "po.create", { clientId: id8("cmd"), supplierId, lines }))).id as string;
const receive = (poId: string, lines: object[], extra: object = {}) => call("own", "po.receive", { poId, receiptId: id8("rec"), lines, ...extra });
const cost = (id = pid) => st.rows("products").find((p) => p.$id === id)!.cost;

beforeEach(async () => {
  st = new MemoryStore(); n = 0;
  await st.grant(T, "own", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId;
  for (const [u, role] of [["cais", "cashier"], ["mag", "stockkeeper"], ["ger", "manager"]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: [A] }, ""))).userId;
  setPlan("pro");
  pid = (await ok(call("own", "article.save", { data: { name: "Riz 25kg", price: 15000, cost: 10000, sku: "RIZ", barcode: "RIZ0", category: "Épicerie" }, initialQty: 10 }))).id;
  s1 = (await ok(call("own", "entity.save", { table: "suppliers", data: { name: "Grossiste A" } }))).id; s2 = (await ok(call("own", "entity.save", { table: "suppliers", data: { name: "Grossiste B" } }))).id;
});

describe("fournisseurs d'un article", () => {
  it("associe plusieurs fournisseurs, avec leurs conditions, une fiche unique par fournisseur", async () => {
    const a = await ok(link({ supplierRef: "RZ-25", price: 10000, leadDays: 3, minQty: 5, feePct: 2.5 }));
    expect(a).toEqual({ id: linkId(pid, "", s1), created: true });
    expect(st.rows("article_suppliers")[0]).toMatchObject({ productId: pid, variantId: "", supplierId: s1, supplierRef: "RZ-25", price: 10000, leadDays: 3, minQty: 5, feePct: 2.5, status: "active", lastPrice: 0, tenantId: T, shopId: A });
    await ok(link({ supplierId: s2, price: 9800, leadDays: 7 }));
    const again = await ok(link({ price: 9900, leadDays: 2 })); expect(again.created).toBe(false); // même fournisseur : mise à jour, pas de doublon
    expect(st.rows("article_suppliers")).toHaveLength(2); expect(st.rows("article_suppliers").find((r) => r.supplierId === s1)).toMatchObject({ price: 9900, leadDays: 2, supplierRef: "" });
    expect(st.rows("audit_log").filter((l) => String(l.action).startsWith("supplier.link"))).toHaveLength(3);
  });
  it("valide prix, délai, frais, minimum, statut, fournisseur et article", async () => {
    for (const bad of [{ price: -1 }, { price: 10.5 }, { price: "abc" }, { leadDays: -1 }, { leadDays: 1.5 }, { leadDays: 400 }, { feePct: -1 }, { feePct: 101 }, { feePct: 1.234 }, { minQty: "x" }, { minQty: 1.5 }, { status: "bloqué" }]) await err(link(bad), 400);
    await err(link({ supplierId: "inconnu" }), 404); await err(call("own", "supplier.link.save", { productId: "inconnu", supplierId: s1, price: 1 }), 404);
    await err(link({ supplierId: (await ok(call("own", "entity.save", { table: "suppliers", data: { name: "Autre boutique" } }, B))).id }), 404); // fournisseur d'une autre boutique
    expect(st.rows("article_suppliers")).toHaveLength(0);
  });
  it("article décliné : la fiche vise une variante ; article simple : jamais", async () => {
    const tee = (await ok(call("own", "article.save", { data: { name: "Tee", price: 5000, sku: "T", barcode: "T0" } }))).id; const m = (await ok(call("own", "variant.save", { productId: tee, attributes: [{ name: "Taille", value: "M" }], initialQty: 1 }))).id;
    await err(call("own", "supplier.link.save", { productId: tee, supplierId: s1, price: 1 }), 400, "variante"); await ok(call("own", "supplier.link.save", { productId: tee, variantId: m, supplierId: s1, price: 1 }));
    await err(link({ variantId: m }), 400, "pas de variantes");
  });
  it("la variante d'une fiche doit appartenir à l'article", async () => {
    const t1 = (await ok(call("own", "article.save", { data: { name: "T1", price: 1, sku: "T1", barcode: "T10" } }))).id, t2 = (await ok(call("own", "article.save", { data: { name: "T2", price: 1, sku: "T2", barcode: "T20" } }))).id;
    await ok(call("own", "variant.save", { productId: t1, attributes: [{ name: "Taille", value: "M" }] })); const v2 = (await ok(call("own", "variant.save", { productId: t2, attributes: [{ name: "Taille", value: "M" }] }))).id;
    await err(call("own", "supplier.link.save", { productId: t1, variantId: v2, supplierId: s1, price: 1 }), 400, "variante"); expect(st.rows("article_suppliers")).toHaveLength(0);
  });
  it("suppression, droits de formule, rôles et isolation", async () => {
    const a = await ok(link({})); await ok(call("own", "supplier.link.delete", { id: a.id })); expect(st.rows("article_suppliers")).toHaveLength(0);
    await ok(call(U.mag!, "supplier.link.save", { productId: pid, supplierId: s1, price: 1 })); await err(call(U.cais!, "supplier.link.save", { productId: pid, supplierId: s1, price: 1 }), 403); await err(call(U.cais!, "supplier.link.delete", { id: a.id }), 403);
    setPlan("business"); await err(link({ price: 2 }), 402, "Pro"); await err(call("own", "supplier.link.delete", { id: linkId(pid, "", s1) }), 402); expect(st.rows("article_suppliers")).toHaveLength(1); // conservées
    setPlan("pro"); await err(link({}, B), 404); await st.grant("tenantcstX", "intruder", ["owner"], []); const xs = (await ok(handle(st, "intruder", { action: "shop.create", tenantId: "tenantcstX", shopId: "", payload: { name: "X" } }))).shopId;
    Object.assign(st.rows("subscriptions").find((r) => r.$id === "tenantcstX")!, { plan: "pro", period: "month", status: "paid", renewsAt: new Date(Date.now() + 864e6).toISOString() });
    await err(handle(st, "intruder", { action: "supplier.link.delete", tenantId: "tenantcstX", shopId: xs, payload: { id: linkId(pid, "", s1) } }), 404);
    expect(st.readableBy(U.mag!, "article_suppliers")).toHaveLength(1); expect(st.readableBy(U.cais!, "article_suppliers")).toHaveLength(0); expect(st.readableBy("intruder", "article_suppliers")).toHaveLength(0);
  });
});

describe("réception : coût de revient, frais, méthode de valorisation", () => {
  it("CMUP par défaut : moyenne pondérée du stock et de la réception ; historique du coût écrit", async () => {
    const o = await po(s1, [{ productId: pid, qty: 10, unitCost: 12000 }]); await ok(receive(o, [{ productId: pid, qty: 10 }]));
    expect(cost()).toBe(11000); expect(await stockFor(st, pid)).toBe(20);
    expect(st.rows("article_cost_events")[0]).toMatchObject({ productId: pid, supplierId: s1, kind: "receipt", unitCost: 12000, landedCost: 12000, qty: 10, costBefore: 10000, costAfter: 11000, method: "cmup", ref: String(st.rows("purchase_orders")[0]!.number) });
  });
  it("frais de la réception répartis au prorata de la valeur, somme exacte, intégrés au coût de revient", async () => {
    const b = (await ok(call("own", "article.save", { data: { name: "Huile 20L", price: 30000, cost: 20000, sku: "H", barcode: "H0" }, initialQty: 0 }))).id;
    const o = await po(s1, [{ productId: pid, qty: 10, unitCost: 10000 }, { productId: b, qty: 5, unitCost: 20000 }]); // valeurs 100 000 et 100 000
    await ok(receive(o, [{ productId: pid, qty: 10 }, { productId: b, qty: 5 }], { fees: 10001 })); // 10 001 FCFA de transport : 5001 + 5000 (plus fort reste)
    const ev = st.rows("article_cost_events"); expect(ev.map((e) => e.landedCost).sort()).toEqual([10500, 21000].sort()); // (100000+5001)/10 → 10500 ; (100000+5000)/5 = 21000
    expect(cost(b)).toBe(21000); expect(cost()).toBe(Math.round((10 * 10000 + 10 * 10500) / 20)); // stock initial 10 à 10 000 + 10 reçus à 10 500
  });
  it("répartition inégale : les frais suivent la valeur de chaque ligne", async () => {
    const b = (await ok(call("own", "article.save", { data: { name: "Sucre", price: 1000, cost: 500, sku: "SU", barcode: "SU0" }, initialQty: 0 }))).id;
    const o = await po(s1, [{ productId: pid, qty: 10, unitCost: 10000 }, { productId: b, qty: 100, unitCost: 3000 }]); // valeurs 100 000 et 300 000
    await ok(receive(o, [{ productId: pid, qty: 10 }, { productId: b, qty: 100 }], { fees: 4000 })); // 1 000 + 3 000
    expect(st.rows("article_cost_events").map((e) => [e.productId === pid ? "riz" : "sucre", e.landedCost]).sort()).toEqual([["riz", 10100], ["sucre", 3030]]);
  });
  it("après retour à Business, les frais proportionnels du fournisseur ne s'appliquent plus", async () => {
    await ok(link({ price: 10000, feePct: 5 })); setPlan("business"); const o = await po(s1, [{ productId: pid, qty: 10, unitCost: 10000 }]); await ok(receive(o, [{ productId: pid, qty: 10 }]));
    expect(st.rows("article_cost_events")[0]).toMatchObject({ landedCost: 10000 }); expect(cost()).toBe(10000); expect(st.rows("article_suppliers")[0]).toMatchObject({ feePct: 5, lastPrice: 0 }); // fiche conservée, non modifiée
  });
  it("frais proportionnels du fournisseur (% du prix d'achat) ajoutés au coût", async () => {
    await ok(link({ price: 10000, feePct: 5 })); const o = await po(s1, [{ productId: pid, qty: 10, unitCost: 10000 }]); await ok(receive(o, [{ productId: pid, qty: 10 }]));
    expect(st.rows("article_cost_events")[0]).toMatchObject({ unitCost: 10000, landedCost: 10500 }); expect(cost()).toBe(10250);
  });
  it("méthode « dernier prix d'achat » : le coût devient celui de la dernière réception (frais compris)", async () => {
    await ok(call("own", "shop.save", { costMethod: "last" })); expect(st.rows("shops").find((s) => s.$id === A)!.costMethod).toBe("last");
    const o = await po(s1, [{ productId: pid, qty: 2, unitCost: 13000 }]); await ok(receive(o, [{ productId: pid, qty: 2 }], { fees: 1000 }));
    expect(cost()).toBe(13500); expect(st.rows("article_cost_events")[0]).toMatchObject({ method: "last", costBefore: 10000, costAfter: 13500 });
  });
  it("la méthode est propre à la boutique : l'autre boutique garde la sienne", async () => {
    await ok(call("own", "shop.save", { costMethod: "last" })); const pb = (await ok(call("own", "article.save", { data: { name: "Riz 25kg", price: 15000, cost: 10000, sku: "RIZ", barcode: "RIZ0" }, initialQty: 10 }, B))).id;
    const sb = (await ok(call("own", "entity.save", { table: "suppliers", data: { name: "G" } }, B))).id; const ob = (await ok(call("own", "po.create", { clientId: id8("cmd"), supplierId: sb, lines: [{ productId: pb, qty: 10, unitCost: 12000 }] }, B))).id;
    await ok(call("own", "po.receive", { poId: ob, receiptId: id8("rec"), lines: [{ productId: pb, qty: 10 }] }, B)); expect(cost(pb)).toBe(11000); // CMUP en boutique B
  });
  it("la dernière valeur payée et la date sont retenues sur la fiche fournisseur, qui est créée si besoin (Pro)", async () => {
    const o = await po(s2, [{ productId: pid, qty: 1, unitCost: 9700 }]); await ok(receive(o, [{ productId: pid, qty: 1 }]));
    const l = st.rows("article_suppliers")[0]!; expect(l).toMatchObject({ supplierId: s2, price: 9700, lastPrice: 9700, status: "active" }); expect(l.lastPurchaseAt).toBeTruthy();
    await ok(link({ supplierId: s2, price: 9500, leadDays: 4 })); const o2 = await po(s2, [{ productId: pid, qty: 1, unitCost: 9900 }]); await ok(receive(o2, [{ productId: pid, qty: 1 }]));
    expect(st.rows("article_suppliers")).toHaveLength(1); expect(st.rows("article_suppliers")[0]).toMatchObject({ price: 9500, lastPrice: 9900, leadDays: 4 }); // conditions négociées inchangées, dernier prix mis à jour
  });
  it("une réception rejouée ne double ni l'historique du coût ni le coût ni le stock", async () => {
    const o = await po(s1, [{ productId: pid, qty: 10, unitCost: 12000 }]); const body = { poId: o, receiptId: "reception-rejeu-001", lines: [{ productId: pid, qty: 10 }], fees: 500 };
    await ok(call("own", "po.receive", body)); await ok(call("own", "po.receive", body)); await ok(call("own", "po.receive", body));
    expect(st.rows("article_cost_events")).toHaveLength(1); expect(await stockFor(st, pid)).toBe(20); expect(cost()).toBe(Math.round((10 * 10000 + 10 * 12050) / 20));
  });
  it("article décliné : coût de revient, historique et fiche fournisseur par variante", async () => {
    const tee = (await ok(call("own", "article.save", { data: { name: "Tee", price: 5000, cost: 3000, sku: "T", barcode: "T0" } }))).id;
    const m = (await ok(call("own", "variant.save", { productId: tee, attributes: [{ name: "Taille", value: "M" }], cost: 3000, initialQty: 10 }))).id;
    const o = await po(s1, [{ productId: tee, variantId: m, qty: 10, unitCost: 4000 }]); await ok(receive(o, [{ productId: tee, variantId: m, qty: 10 }], { fees: 1000 }));
    expect(st.rows("article_variants").find((v) => v.$id === m)!.cost).toBe(Math.round((10 * 3000 + 10 * 4100) / 20)); expect(st.rows("products").find((p) => p.$id === tee)!.cost).toBe(3000);
    expect(st.rows("article_cost_events")[0]).toMatchObject({ productId: tee, variantId: m, landedCost: 4100 }); expect(st.rows("article_suppliers")[0]).toMatchObject({ variantId: m, lastPrice: 4000 });
  });
  it("frais invalides refusés ; Business : pas de frais ni de fiche fournisseur, le CMUP et l'historique continuent", async () => {
    const o = await po(s1, [{ productId: pid, qty: 4, unitCost: 12000 }]);
    for (const f of [-1, 1.5, "abc", 1e12]) await err(receive(o, [{ productId: pid, qty: 1 }], { fees: f }), 400); expect(st.rows("article_cost_events")).toHaveLength(0);
    setPlan("business"); await err(receive(o, [{ productId: pid, qty: 1 }], { fees: 500 }), 402, "Pro");
    await ok(receive(o, [{ productId: pid, qty: 2 }])); expect(cost()).toBe(Math.round((10 * 10000 + 2 * 12000) / 12)); expect(st.rows("article_cost_events")).toHaveLength(1); expect(st.rows("article_suppliers")).toHaveLength(0);
  });
});

describe("méthode de valorisation de la boutique", () => {
  it("propriétaire seulement, valeur contrôlée, changement journalisé, réservé à Pro", async () => {
    await err(call("own", "shop.save", { costMethod: "fifo" }), 400); await err(call(U.ger!, "shop.save", { costMethod: "last" }), 403);
    await ok(call("own", "shop.save", { costMethod: "last" })); expect(st.rows("audit_log").find((l) => l.action === "shop.costMethod")!.detail).toBe("cmup → last");
    await ok(call("own", "shop.save", { costMethod: "last" })); expect(st.rows("audit_log").filter((l) => l.action === "shop.costMethod")).toHaveLength(1); // inchangé : rien à journaliser
    setPlan("business"); await err(call("own", "shop.save", { costMethod: "cmup" }), 402, "Pro"); expect(st.rows("shops").find((s) => s.$id === A)!.costMethod).toBe("last"); // une seule méthode : elle ne change pas toute seule
    await ok(call("own", "shop.save", { name: "Dakar Plateau" })); // le reste des réglages reste modifiable
  });
});

describe("rentabilité par article et catégorie", () => {
  const day = new Date().toISOString().slice(0, 10);
  const sell = (lines: object[], amount: number) => call("own", "checkout", { clientId: id8("vente"), lines, payments: [{ method: "cash", amount }] });
  it("marge hors TVA sur le coût figé à la vente, par article et par catégorie", async () => {
    const sav = (await ok(call("own", "article.save", { data: { name: "Savon", price: 500, cost: 300, sku: "S", barcode: "S0", category: "Hygiène" }, initialQty: 50 }))).id;
    await ok(sell([{ productId: pid, qty: 2 }], 30000)); await ok(sell([{ productId: sav, qty: 10 }], 5000));
    await ok(call("own", "article.save", { id: pid, data: { cost: 99999 } })); // un changement de coût ultérieur ne touche pas les marges passées
    const r = await ok(call("own", "article.profitability", { from: day, to: day }));
    const vat = (t: number) => t - Math.round(t / 1.18); const ht = (t: number) => t - vat(t);
    expect(r.items.map((i: any) => i.name)).toEqual(["Riz 25kg", "Savon"]); expect(r.items[0]).toMatchObject({ qty: 2, revenueHt: ht(30000), cogs: 20000, margin: ht(30000) - 20000, costedPct: 100 });
    expect(r.items[1]).toMatchObject({ qty: 10, cogs: 3000 }); expect(r.categories.map((c: any) => c.name).sort()).toEqual(["Hygiène", "Épicerie"]);
    expect(r.categories.find((c: any) => c.name === "Épicerie")).toMatchObject({ margin: r.items[0].margin });
  });
  it("variantes séparées et ventes d'une autre boutique exclues", async () => {
    const tee = (await ok(call("own", "article.save", { data: { name: "Tee", price: 5000, cost: 3000, sku: "T", barcode: "T0" } }))).id;
    const m = (await ok(call("own", "variant.save", { productId: tee, attributes: [{ name: "Taille", value: "M" }], cost: 2000, price: 5500, initialQty: 5 }))).id; const l = (await ok(call("own", "variant.save", { productId: tee, attributes: [{ name: "Taille", value: "L" }], cost: 2500, price: 6000, initialQty: 5 }))).id;
    await ok(sell([{ productId: tee, variantId: m, qty: 1 }, { productId: tee, variantId: l, qty: 1 }], 11500));
    const pb = (await ok(call("own", "article.save", { data: { name: "Autre", price: 100, cost: 50, sku: "O", barcode: "O0" }, initialQty: 5 }, B))).id; await ok(call("own", "checkout", { clientId: id8("vente"), lines: [{ productId: pb, qty: 1 }], payments: [{ method: "cash", amount: 100 }] }, B));
    const r = await ok(call("own", "article.profitability", { from: day, to: day })); expect(r.items.map((i: any) => i.name).sort()).toEqual(["Tee — L", "Tee — M"]);
    expect(r.items.find((i: any) => i.name === "Tee — M")).toMatchObject({ variantId: m, cogs: 2000 }); expect(r.items.some((i: any) => i.name === "Autre")).toBe(false);
  });
  it("période validée, Pro seulement, module Rapports requis", async () => {
    await err(call("own", "article.profitability", { from: "nimporte", to: day }), 400); await err(call("own", "article.profitability", { from: "2020-01-01", to: day }), 400, "trop longue");
    await err(call(U.cais!, "article.profitability", { from: day, to: day }), 403); setPlan("business"); await err(call("own", "article.profitability", { from: day, to: day }), 402, "Pro");
  });
});
