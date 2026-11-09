import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { stockFor } from "./checkout";

const T = "tenantbnd001";
let st: MemoryStore; let A = "", B = "";
const call = (user: string, action: string, payload: unknown, shop = A) => handle(st, user, { action, tenantId: T, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); return x.body.error as string; };
const setPlan = (plan: string) => { const row = st.rows("subscriptions").find((r) => r.$id === T); const data = { tenantId: T, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", T, T, data); };
let n = 0; const id8 = (p: string) => `${p}-${String(++n).padStart(8, "0")}`;
const sell = (lines: object[], amount: number) => call("own", "checkout", { clientId: id8("vente"), lines, payments: [{ method: "cash", amount }] });
const lastLine = (i = 0) => JSON.parse(String(st.rows("sales").at(-1)!.lines))[i];
const mk = async (name: string, price: number, cost: number, qty = 0, extra: object = {}) => (await ok(call("own", "article.save", { data: { name, price, cost, ...extra }, ...(qty ? { initialQty: qty } : {}) }))).id as string;
let jus = "", pain = "", pack = "";
const comps = (bundleId: string, components: object[]) => call("own", "bundle.components", { bundleId, components });

beforeEach(async () => {
  st = new MemoryStore(); n = 0; await st.grant(T, "own", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId;
  setPlan("pro"); jus = await mk("Jus", 500, 300, 20); pain = await mk("Pain", 200, 100, 10);
  pack = await mk("Pack petit-déj", 1000, 0, 0, { kind: "bundle" }); await ok(comps(pack, [{ productId: jus, qty: 2 }, { productId: pain, qty: 1 }]));
});

describe("création et composition", () => {
  it("un bundle n'a pas de stock propre, sa composition est enregistrée et son coût indicatif calculé", async () => {
    expect(st.rows("products").find((p) => p.$id === pack)).toMatchObject({ kind: "bundle", cost: 700 });
    expect(st.rows("article_components")).toHaveLength(2); expect(await stockFor(st, pack, 0)).toBe(0);
    await err(call("own", "article.save", { data: { name: "B2", price: 1, kind: "bundle", sku: "B2", barcode: "B20" }, initialQty: 3 }), 400, "stock propre");
    await err(call("own", "article.save", { data: { name: "B3", price: 1, kind: "bundle", tracking: "lot", sku: "B3", barcode: "B30" } }), 400, "stock propre");
    await err(call("own", "article.save", { data: { name: "B4", price: 1, kind: "bidule" } }), 400, "Type");
    await err(call("own", "article.save", { id: pack, data: { kind: "simple" } }), 409, "ne peut pas changer");
  });
  it("remplace la composition ; refuse bundle imbriqué, article suivi, décliné, archivé, doublon, soi-même", async () => {
    await ok(comps(pack, [{ productId: pain, qty: 3 }])); expect(st.rows("article_components")).toHaveLength(1); expect(st.rows("products").find((p) => p.$id === pack)!.cost).toBe(300);
    const other = await mk("Pack 2", 1, 0, 0, { kind: "bundle" }); await err(comps(pack, [{ productId: other, qty: 1 }]), 409, "bundle");
    const lotArt = await mk("Yaourt", 500, 300, 0, { tracking: "lot" }); await err(comps(pack, [{ productId: lotArt, qty: 1 }]), 409, "lot");
    const dec = await mk("Riz", 700, 500, 0, { unit: "kg", qtyScale: 2 }); await err(comps(pack, [{ productId: dec, qty: 1 }]), 409, "décimales");
    await err(comps(pack, [{ productId: pack, qty: 1 }]), 400, "lui-même"); await err(comps(pack, [{ productId: pain, qty: 1 }, { productId: pain, qty: 2 }]), 400, "double"); await err(comps(pack, []), 400, "au moins un");
    await ok(call("own", "article.archive", { id: pain, archived: true })); await err(comps(pack, [{ productId: pain, qty: 1 }]), 409, "archivé");
    await err(comps(jus, [{ productId: pain, qty: 1 }]), 409, "pas un bundle"); await err(comps(pack, [{ productId: "inconnu", qty: 1 }]), 404);
  });
  it("Business : création, composition et vente refusées (402) ; données conservées", async () => {
    await ok(sell([{ productId: pack, qty: 1 }], 1000)); setPlan("business");
    await err(call("own", "article.save", { data: { name: "B5", price: 1, kind: "bundle", sku: "B5", barcode: "B50" } }), 402); await err(comps(pack, [{ productId: pain, qty: 1 }]), 402);
    await err(sell([{ productId: pack, qty: 1 }], 1000), 402, "Pro"); expect(st.rows("article_components")).toHaveLength(2);
    await ok(sell([{ productId: jus, qty: 1 }], 500)); // les articles simples se vendent toujours
  });
  it("rôles : seul un utilisateur avec accès au module stock compose un bundle", async () => {
    const cais = (await ok(call("own", "staff.create", { name: "c", username: "cais", password: "motdepasse1", role: "cashier", shopIds: [A] }, ""))).userId;
    await err(call(cais, "bundle.components", { bundleId: pack, components: [{ productId: pain, qty: 1 }] }), 403);
  });
});

describe("vente d'un bundle", () => {
  it("sort chaque composant du stock (un mouvement par composant), fige composition et coût", async () => {
    await ok(sell([{ productId: pack, qty: 3 }], 3000));
    expect(await stockFor(st, jus, 0)).toBe(14); expect(await stockFor(st, pain, 0)).toBe(7); expect(await stockFor(st, pack, 0)).toBe(0);
    const l = lastLine(); expect(l).toMatchObject({ productId: pack, qty: 3, unitPrice: 1000, amount: 3000, unitCost: 700 }); expect(l.components).toEqual([{ productId: jus, name: "Jus", qty: 2, unitCost: 300 }, { productId: pain, name: "Pain", qty: 1, unitCost: 100 }].sort((a, b) => a.productId.localeCompare(b.productId)));
    expect(st.rows("stock_moves").filter((m) => m.kind === "sale")).toHaveLength(2);
    await ok(comps(pack, [{ productId: pain, qty: 5 }])); expect(lastLine().components).toHaveLength(2); // l'historique ne bouge pas
  });
  it("stock insuffisant : refus sans écriture, composant limitant nommé ; cumul avec une ligne simple du même composant", async () => {
    await err(sell([{ productId: pack, qty: 11 }], 11000), 409, "composant"); expect(st.rows("sales")).toHaveLength(0); expect(await stockFor(st, pain, 0)).toBe(10);
    await err(sell([{ productId: pack, qty: 6 }, { productId: pain, qty: 5 }], 9999), 409, "Stock insuffisant"); // 6 + 5 pains > 10
    await err(sell([{ productId: pain, qty: 5 }, { productId: pack, qty: 6 }], 9999), 409, "Stock insuffisant"); expect(st.rows("sales")).toHaveLength(0);
    await ok(sell([{ productId: pack, qty: 5 }, { productId: pain, qty: 5 }], 5000 + 1000)); expect(await stockFor(st, pain, 0)).toBe(0); expect(await stockFor(st, jus, 0)).toBe(10);
  });
  it("rejouable : même identifiant de vente = aucun double mouvement", async () => {
    const body = { clientId: "vente-rejeu-0001", lines: [{ productId: pack, qty: 2 }], payments: [{ method: "cash", amount: 2000 }] };
    await ok(call("own", "checkout", body)); await ok(call("own", "checkout", body)); expect(await stockFor(st, jus, 0)).toBe(16); expect(st.rows("sales")).toHaveLength(1);
  });
  it("bundle sans composants, composant archivé après coup, variante/unité demandée : refus clairs", async () => {
    const vide = await mk("Vide", 100, 0, 0, { kind: "bundle" }); await err(sell([{ productId: vide, qty: 1 }], 100), 409, "sans composants");
    await err(sell([{ productId: pack, qty: 1, unit: "carton" }], 1000), 400, "à la pièce"); await err(sell([{ productId: pack, qty: 1, variantId: "x" }], 1000), 400, "variantes");
    await ok(call("own", "article.archive", { id: jus, archived: true })); await err(sell([{ productId: pack, qty: 1 }], 1000), 409, "composant");
  });
  it("remise : manager requis ; le prix de vente propre au bundle fait foi", async () => {
    const cais = (await ok(call("own", "staff.create", { name: "c", username: "cais", password: "motdepasse1", role: "cashier", shopIds: [A] }, ""))).userId;
    await err(call(cais, "checkout", { clientId: id8("vente"), lines: [{ productId: pack, qty: 1, discountPct: 10 }], payments: [{ method: "cash", amount: 900 }] }), 403);
    await ok(call("own", "checkout", { clientId: id8("vente"), lines: [{ productId: pack, qty: 1, discountPct: 10 }], payments: [{ method: "cash", amount: 900 }] })); expect(st.rows("sales").at(-1)!.total).toBe(900);
  });
});

describe("garde-fous", () => {
  it("un bundle ne se compte pas, ne se commande pas, ne se transfère pas, n'a ni variantes ni conditionnements", async () => {
    await err(call("own", "stock.adjust", { productId: pack, counted: 5 }), 409, "bundle");
    const sup = (await ok(call("own", "entity.save", { table: "suppliers", data: { name: "F" } }))).id;
    await err(call("own", "po.create", { clientId: id8("cmd"), supplierId: sup, lines: [{ productId: pack, qty: 1, unitCost: 1 }] }), 409, "bundle");
    await err(call("own", "stock.transfer", { transferId: id8("trf"), toShopId: B, lines: [{ productId: pack, qty: 1 }] }), 409, "bundle");
    await err(call("own", "variant.save", { productId: pack, attributes: [{ name: "Taille", value: "S" }] }), 409, "bundle"); await err(call("own", "article.units.save", { productId: pack, units: [{ unit: "carton", factor: 6 }] }), 409, "bundle");
  });
  it("suppression : un composant utilisé et un bundle déjà vendu sont protégés ; un bundle neuf se supprime avec sa composition", async () => {
    await err(call("own", "article.delete", { id: pain }), 409, "compose un bundle");
    const neuf = await mk("Neuf", 100, 0, 0, { kind: "bundle" }); await ok(comps(neuf, [{ productId: jus, qty: 1 }])); await ok(call("own", "article.delete", { id: neuf })); expect(st.rows("article_components").filter((r) => r.bundleId === neuf)).toHaveLength(0);
    await ok(sell([{ productId: pack, qty: 1 }], 1000)); await err(call("own", "article.delete", { id: pack }), 409, "déjà été vendu");
  });
  it("isolation : composants d'une autre boutique refusés", async () => {
    const autre = (await ok(call("own", "article.save", { data: { name: "Ailleurs", price: 1, cost: 1, sku: "AIL", barcode: "AIL0" } }, ))).id;
    const inB = (await ok(call("own", "article.save", { data: { name: "Chez B", price: 1, sku: "CB", barcode: "CB0" } }, B))).id; void autre;
    await err(comps(pack, [{ productId: inB, qty: 1 }]), 404);
  });
});
