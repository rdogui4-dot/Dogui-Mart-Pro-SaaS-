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
    await err(call("own", "article.save", { data: { name: "B2", price: 1, kind: "bundle", sku: "B2", barcode: "B20" }, initialQty: 3 }), 400, "ne se saisit pas");
    await err(call("own", "article.save", { data: { name: "B3", price: 1, kind: "bundle", tracking: "lot", sku: "B3", barcode: "B30" } }), 400, "suivi par lot");
    await err(call("own", "article.save", { data: { name: "B4", price: 1, kind: "bidule" } }), 400, "Type");
    await err(call("own", "article.save", { id: pack, data: { kind: "simple" } }), 409, "ne peut pas changer");
  });
  it("remplace la composition ; refuse bundle imbriqué, archivé, doublon, soi-même, quantités invalides ; accepte tous les types d'articles", async () => {
    await ok(comps(pack, [{ productId: pain, qty: 3 }])); expect(st.rows("article_components")).toHaveLength(1); expect(st.rows("products").find((p) => p.$id === pack)!.cost).toBe(300);
    const other = await mk("Pack 2", 1, 0, 0, { kind: "bundle" }); await err(comps(pack, [{ productId: other, qty: 1 }]), 409, "bundle");
    const lotArt = await mk("Yaourt", 500, 300, 0, { tracking: "lot" }); const serArt = await mk("Tél", 5000, 4000, 0, { tracking: "serial" }); const dec = await mk("Riz", 700, 500, 0, { unit: "kg", qtyScale: 2 });
    await ok(comps(pack, [{ productId: lotArt, qty: 1 }, { productId: serArt, qty: 1 }, { productId: dec, qty: "0,5" }])); expect(st.rows("article_components")).toHaveLength(3); expect(st.rows("article_components").find((r) => r.componentId === dec)!.qty).toBe(50); // 0,5 kg = 50 centièmes
    await err(comps(pack, [{ productId: dec, qty: "0,555" }]), 400, "décimale"); await err(comps(pack, [{ productId: serArt, qty: 0 }]), 400, "invalide");
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
    const l = lastLine(); expect(l).toMatchObject({ productId: pack, qty: 3, unitPrice: 1000, amount: 3000, unitCost: 700 }); expect(l.components).toEqual([{ productId: jus, name: "Jus", qty: 6, perBundle: 2, unitCost: 300 }, { productId: pain, name: "Pain", qty: 3, perBundle: 1, unitCost: 100 }].sort((a, b) => a.productId.localeCompare(b.productId)));
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

describe("kit physique et ordre d'assemblage", () => {
  let kit = "";
  const asm = (qty: unknown, extra: object = {}) => call("own", "kit.assemble", { requestId: id8("asm"), bundleId: kit, qty, ...extra });
  const orders = () => st.rows("assembly_orders");
  beforeEach(async () => { kit = await mk("Kit petit-déj", 1500, 0, 0, { kind: "bundle", bundleMode: "kit" }); await ok(comps(kit, [{ productId: jus, qty: 2 }, { productId: pain, qty: 1 }])); });

  it("création : mode kit mémorisé, pas de stock initial, mode non modifiable, mode réservé aux bundles", async () => {
    expect(st.rows("products").find((p) => p.$id === kit)).toMatchObject({ kind: "bundle", bundleMode: "kit" }); expect(st.rows("products").find((p) => p.$id === pack)).toMatchObject({ bundleMode: "virtual" });
    await err(call("own", "article.save", { data: { name: "K2", price: 1, kind: "bundle", bundleMode: "kit", sku: "K2", barcode: "K20" }, initialQty: 3 }), 400, "ne se saisit pas");
    await err(call("own", "article.save", { id: kit, data: { bundleMode: "virtual" } }), 409, "ne peut pas changer"); await err(call("own", "article.save", { data: { name: "S", price: 1, bundleMode: "kit" } }), 400, "bundles");
    await err(call("own", "article.save", { data: { name: "S", price: 1, kind: "bundle", bundleMode: "xyz" } }), 400, "Mode");
  });
  it("assemblage : composants sortis, kit entré, mouvements tracés, coût moyen pondéré, rejouable", async () => {
    const body = { requestId: "asm-rejeu-0001", bundleId: kit, qty: 3 };
    await ok(call("own", "kit.assemble", body)); expect(await stockFor(st, kit, 0)).toBe(3); expect(await stockFor(st, jus, 0)).toBe(14); expect(await stockFor(st, pain, 0)).toBe(7);
    expect(orders()).toHaveLength(1); expect(orders()[0]).toMatchObject({ type: "assemble", qty: 3, unitCost: 700, status: "done" }); expect(st.rows("products").find((p) => p.$id === kit)!.cost).toBe(700);
    expect(st.rows("stock_moves").filter((m) => String(m.kind).startsWith("assembly"))).toHaveLength(3);
    const again = await ok(call("own", "kit.assemble", body)); expect(again.duplicate).toBe(true); expect(await stockFor(st, kit, 0)).toBe(3); expect(await stockFor(st, jus, 0)).toBe(14);
    await ok(call("own", "article.save", { id: jus, data: { cost: 400 } })); await ok(asm(1)); // coût du lot : 2×400+100 = 900 ; moyenne (3×700 + 1×900)/4 = 750
    expect(st.rows("products").find((p) => p.$id === kit)!.cost).toBe(750); expect(await stockFor(st, kit, 0)).toBe(4);
  });
  it("refus : composants insuffisants (nommé), quantité invalide, kit sans composants, bundle virtuel, kit archivé", async () => {
    await err(asm(11), 409, "Stock insuffisant pour assembler"); expect(orders()).toHaveLength(0); expect(await stockFor(st, pain, 0)).toBe(10);
    for (const bad of [0, -1, 1.5, "x", 10000]) await err(asm(bad), 400, "Quantité");
    await err(call("own", "kit.assemble", { requestId: id8("asm"), bundleId: pack, qty: 1 }), 409, "kit physique"); await err(call("own", "kit.assemble", { requestId: "court", bundleId: kit, qty: 1 }), 400, "requestId");
    const vide = await mk("Kit vide", 1, 0, 0, { kind: "bundle", bundleMode: "kit" }); await err(call("own", "kit.assemble", { requestId: id8("asm"), bundleId: vide, qty: 1 }), 409, "sans composants");
    await ok(call("own", "article.archive", { id: kit, archived: true })); await err(asm(1), 409, "archivé");
  });
  it("vente d'un kit : stock propre (pas de sortie des composants), refus s'il n'est pas assemblé", async () => {
    await err(sell([{ productId: kit, qty: 1 }], 1500), 409, "Stock insuffisant"); await ok(asm(2));
    await ok(sell([{ productId: kit, qty: 2 }], 3000)); expect(await stockFor(st, kit, 0)).toBe(0); expect(await stockFor(st, jus, 0)).toBe(16); expect(lastLine()).toMatchObject({ productId: kit, qty: 2, unitCost: 700 }); expect(lastLine().components).toBeUndefined();
    await err(sell([{ productId: kit, qty: 1 }], 1500), 409, "Stock insuffisant");
  });
  it("démontage : le kit sort, les composants reviennent ; refus si stock du kit insuffisant", async () => {
    await ok(asm(3)); await err(call("own", "kit.assemble", { requestId: id8("dsm"), bundleId: kit, qty: 4, type: "disassemble" }), 409, "insuffisant");
    await ok(call("own", "kit.assemble", { requestId: id8("dsm"), bundleId: kit, qty: 2, type: "disassemble" })); expect(await stockFor(st, kit, 0)).toBe(1); expect(await stockFor(st, jus, 0)).toBe(18); expect(await stockFor(st, pain, 0)).toBe(9);
    expect(orders().map((o) => o.type).sort()).toEqual(["assemble", "disassemble"]); expect(String(orders().find((o) => o.type === "disassemble")!.number)).toMatch(/^DS-/);
  });
  it("reprise après coupure : un ordre « pending » est complété sans doubler les mouvements", async () => {
    const body = { requestId: "asm-coupure-01", bundleId: kit, qty: 2 }; const id = "kasmcoupure01";
    await st.create("assembly_orders", id, T, { tenantId: T, shopId: A, number: "AS-20260101-ASMCOU", bundleId: kit, type: "assemble", qty: 2, unitCost: 700, lines: JSON.stringify([{ productId: jus, name: "Jus", qty: 2, qtyScaled: 2, unitCost: 300 }, { productId: pain, name: "Pain", qty: 1, qtyScaled: 1, unitCost: 100 }]), status: "pending", userId: "own" });
    await st.create("stock_moves", `${id}_c0`, T, { tenantId: T, shopId: A, productId: jus, kind: "assembly_out", qty: 4, refId: "AS-20260101-ASMCOU", userId: "own" }); // coupure après le 1er mouvement
    await ok(call("own", "kit.assemble", body)); expect(await stockFor(st, jus, 0)).toBe(16); expect(await stockFor(st, pain, 0)).toBe(8); expect(await stockFor(st, kit, 0)).toBe(2); expect(orders()[0]!.status).toBe("done");
    await ok(call("own", "kit.assemble", body)); expect(await stockFor(st, kit, 0)).toBe(2);
  });
  it("garde-fous : le kit ne se commande ni ne se transfère ; l'inventaire reste possible ; suppression refusée une fois assemblé ; Business refusé", async () => {
    const sup = (await ok(call("own", "entity.save", { table: "suppliers", data: { name: "F" } }))).id;
    await err(call("own", "po.create", { clientId: id8("cmd"), supplierId: sup, lines: [{ productId: kit, qty: 1, unitCost: 1 }] }), 409, "bundle"); await err(call("own", "stock.transfer", { transferId: id8("trf"), toShopId: B, lines: [{ productId: kit, qty: 1 }] }), 409, "bundle");
    await ok(asm(2)); await ok(call("own", "stock.adjust", { productId: kit, counted: 1 })); expect(await stockFor(st, kit, 0)).toBe(1);
    await err(call("own", "article.delete", { id: kit }), 409, "historique"); expect(st.rows("article_components").filter((c) => c.bundleId === kit)).toHaveLength(2);
    setPlan("business"); await err(asm(1), 402);
  });
});

describe("composants : tous les articles du commerce (variantes, décimaux, lots, séries)", () => {
  const dayStr = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  const stockLot = async (productId: string, lotNo: string) => { const l = st.rows("article_lots").find((x) => x.productId === productId && x.lotNo === lotNo)!; return st.rows("stock_moves").filter((m) => m.lotId === l.$id).reduce((a, m) => a + (["sale", "loss", "transfer_out"].includes(String(m.kind)) ? -1 : 1) * Number(m.qty), 0); };
  it("variante : le composant porte la variante choisie (obligatoire), stock et coût de la variante", async () => {
    const tee = await mk("Tee-shirt", 5000, 3000, 0, { sku: "TEE" }); const vs = (await ok(call("own", "variant.save", { productId: tee, attributes: [{ name: "Taille", value: "M" }], cost: 3500, initialQty: 6 }))).id; await ok(call("own", "variant.save", { productId: tee, attributes: [{ name: "Taille", value: "L" }], cost: 3600, initialQty: 2 }));
    const b = await mk("Pack tee", 9000, 0, 0, { kind: "bundle" });
    await err(comps(b, [{ productId: tee, qty: 1 }]), 400, "variante"); await err(comps(b, [{ productId: jus, variantId: vs, qty: 1 }]), 400, "variantes"); await err(comps(b, [{ productId: tee, variantId: "x", qty: 1 }]), 400, "variante");
    await ok(comps(b, [{ productId: tee, variantId: vs, qty: 2 }, { productId: jus, qty: 1 }])); expect(st.rows("products").find((p) => p.$id === b)!.cost).toBe(2 * 3500 + 300);
    await ok(sell([{ productId: b, qty: 3 }], 27000)); expect(st.rows("stock_moves").filter((m) => m.variantId === vs && m.kind === "sale").reduce((a, m) => a + Number(m.qty), 0)).toBe(6); expect(await stockFor(st, jus, 0)).toBe(17);
    await err(sell([{ productId: b, qty: 1 }], 9000), 409, "Stock insuffisant"); expect(lastLine().components.find((c: any) => c.variantId === vs)).toMatchObject({ qty: 6, perBundle: 2, unitCost: 3500 });
  });
  it("décimal : 0,5 kg par bundle ; disponibilité et sorties en sous-unités exactes", async () => {
    const riz = await mk("Riz", 700, 500, 0, { unit: "kg", qtyScale: 2 }); await ok(call("own", "stock.adjust", { productId: riz, counted: "2,5" }));
    const b = await mk("Pack riz", 600, 0, 0, { kind: "bundle" }); await ok(comps(b, [{ productId: riz, qty: "0,5" }]));
    await ok(sell([{ productId: b, qty: 4 }], 2400)); expect(await stockFor(st, riz)).toBe(0.5); expect(lastLine().components[0]).toMatchObject({ qty: 2, perBundle: 0.5, unitCost: 500 });
    await err(sell([{ productId: b, qty: 2 }], 1200), 409, "Stock insuffisant"); await ok(sell([{ productId: b, qty: 1 }], 600)); expect(await stockFor(st, riz)).toBe(0);
  });
  it("article par lot : prélèvement FEFO par composant, mouvements par lot, lots périmés refusés", async () => {
    const yaourt = await mk("Yaourt", 500, 300, 0, { tracking: "lot" }); await ok(call("own", "lot.receive", { productId: yaourt, lotNo: "A", qty: 3, expiresAt: dayStr(10), unitCost: 200 })); await ok(call("own", "lot.receive", { productId: yaourt, lotNo: "B", qty: 5, expiresAt: dayStr(60) })); await ok(call("own", "lot.receive", { productId: yaourt, lotNo: "OLD", qty: 9, expiresAt: dayStr(-2) }));
    const b = await mk("Pack yaourt", 2000, 0, 0, { kind: "bundle" }); await ok(comps(b, [{ productId: yaourt, qty: 2 }, { productId: pain, qty: 1 }]));
    await ok(sell([{ productId: b, qty: 2 }], 4000)); // 4 yaourts : 3 du lot A (le plus proche) + 1 du lot B ; le lot périmé reste intact
    expect(await stockLot(yaourt, "A")).toBe(0); expect(await stockLot(yaourt, "B")).toBe(4); expect(await stockLot(yaourt, "OLD")).toBe(9); const c = lastLine().components.find((x: any) => x.productId === yaourt); expect(c.lots).toEqual([expect.objectContaining({ lotNo: "A", qty: 3 }), expect.objectContaining({ lotNo: "B", qty: 1 })]);
    await err(sell([{ productId: b, qty: 3 }], 6000), 409, "périmé"); expect(await stockLot(yaourt, "B")).toBe(4); expect(await stockFor(st, pain, 0)).toBe(8);
  });
  it("article par numéro de série : numéros attribués automatiquement, passent « vendu » avec la référence de vente ; cumul avec une ligne simple", async () => {
    const tel = await mk("Téléphone", 50000, 40000, 0, { tracking: "serial" }); await ok(call("own", "serial.add", { productId: tel, serials: "SN001 SN002 SN003", warrantyMonths: 12, unitCost: 41000 }));
    const b = await mk("Pack téléphone", 52000, 0, 0, { kind: "bundle" }); await ok(comps(b, [{ productId: tel, qty: 1 }, { productId: pain, qty: 1 }]));
    await ok(sell([{ productId: b, qty: 2 }], 104000)); const sale = st.rows("sales").at(-1)!; const sold = st.rows("article_serials").filter((r) => r.status === "sold");
    expect(sold.map((r) => r.serial).sort()).toEqual(["SN001", "SN002"]); expect(sold[0]).toMatchObject({ saleRef: sale.number }); expect(sold[0]!.warrantyUntil).toBeTruthy(); expect(await stockFor(st, tel, 0)).toBe(1); expect(lastLine().components.find((x: any) => x.productId === tel)).toMatchObject({ serials: ["SN001", "SN002"], unitCost: 41000 });
    expect(lastLine().unitCost).toBe(41000 + 100);
    await err(sell([{ productId: b, qty: 1 }, { productId: tel, qty: 1 }], 100000), 409, "Stock insuffisant"); expect(st.rows("article_serials").find((r) => r.serial === "SN003")!.status).toBe("available");
    await ok(sell([{ productId: tel, qty: 1 }], 50000)); await err(sell([{ productId: b, qty: 1 }], 52000), 409, "Stock insuffisant");
  });
  it("rejouable : même vente = ni double mouvement ni nouvel échange de numéros/lots", async () => {
    const tel = await mk("Téléphone", 50000, 40000, 0, { tracking: "serial" }); await ok(call("own", "serial.add", { productId: tel, serials: "SN001 SN002" }));
    const b = await mk("Pack tel", 52000, 0, 0, { kind: "bundle" }); await ok(comps(b, [{ productId: tel, qty: 1 }]));
    const body = { clientId: "vente-rejeu-tel01", lines: [{ productId: b, qty: 1 }], payments: [{ method: "cash", amount: 52000 }] };
    await ok(call("own", "checkout", body)); await ok(call("own", "checkout", body)); expect(st.rows("sales")).toHaveLength(1); expect(st.rows("article_serials").filter((r) => r.status === "sold")).toHaveLength(1); expect(await stockFor(st, tel, 0)).toBe(1);
  });
  it("kit physique : variantes et décimaux acceptés, articles suivis refusés avec un message clair", async () => {
    const tee = await mk("Tee", 5000, 3000); const vm = (await ok(call("own", "variant.save", { productId: tee, attributes: [{ name: "Taille", value: "M" }], cost: 3500, initialQty: 6 }))).id; const riz = await mk("Riz", 700, 500, 0, { unit: "kg", qtyScale: 2 }); await ok(call("own", "stock.adjust", { productId: riz, counted: "5" }));
    const kit = await mk("Kit tee+riz", 9000, 0, 0, { kind: "bundle", bundleMode: "kit" }); const lotArt = await mk("Yaourt", 500, 300, 0, { tracking: "lot" });
    await err(comps(kit, [{ productId: lotArt, qty: 1 }]), 409, "bundle virtuel"); await ok(comps(kit, [{ productId: tee, variantId: vm, qty: 1 }, { productId: riz, qty: "0,5" }]));
    await ok(call("own", "kit.assemble", { requestId: id8("asm"), bundleId: kit, qty: 4 })); expect(await stockFor(st, kit, 0)).toBe(4); expect(await stockFor(st, riz)).toBe(3); expect(st.rows("stock_moves").filter((m) => m.variantId === vm && m.kind === "assembly_out").reduce((a, m) => a + Number(m.qty), 0)).toBe(4);
    await err(call("own", "kit.assemble", { requestId: id8("asm"), bundleId: kit, qty: 3 }), 409, "Tee"); // 6 − 4 = 2 tee-shirts M < 3
    expect(st.rows("products").find((p) => p.$id === kit)!.cost).toBe(3500 + 250);
    await ok(call("own", "kit.assemble", { requestId: id8("dsm"), bundleId: kit, qty: 1, type: "disassemble" })); expect(await stockFor(st, riz)).toBe(3.5);
  });
});
