import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { stockFor, stockScaledVariant } from "./checkout";

const T = "tenantvar001";
let st: MemoryStore; let A = "", B = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown, shop = A, tenant = T) => handle(st, user, { action, tenantId: tenant, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); return x.body.error as string; };
const setPlan = (plan: string) => { const row = st.rows("subscriptions").find((r) => r.$id === T); const data = { tenantId: T, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", T, T, data); };
let n = 0; const cid = () => `vente-var-${String(++n).padStart(6, "0")}`;
const sell = (lines: object[], amount: number, shop = A) => call("own", "checkout", { clientId: cid(), lines, payments: [{ method: "cash", amount }] }, shop);
const TEE = { name: "Tee-shirt", price: 5000, cost: 3000, sku: "TEE", barcode: "TEE0", minStock: 2 };
const attrs = (taille: string, couleur?: string) => [{ name: "Taille", value: taille }, ...(couleur ? [{ name: "Couleur", value: couleur }] : [])];
const mkProduct = async (data: object = TEE, shop = A) => (await ok(call("own", "article.save", { data }, shop))).id as string;
const mkVariant = async (productId: string, v: object, shop = A) => (await ok(call("own", "variant.save", { productId, ...v }, shop))).id as string;

beforeEach(async () => {
  st = new MemoryStore(); n = 0;
  await st.grant(T, "own", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId;
  for (const [u, role] of [["cais", "cashier"], ["mag", "stockkeeper"], ["ger", "manager"]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: [A] }, ""))).userId;
  setPlan("pro");
});

describe("création et règles d'une variante", () => {
  it("enregistre tous les champs, le stock initial, le prix initial, le drapeau de l'article et le journal", async () => {
    const pid = await mkProduct();
    const vid = await mkVariant(pid, { attributes: attrs("M", "Rouge"), sku: "TEE-M-R", barcode: "TEE-M-R0", price: 5500, cost: 3200, minStock: 3, initialQty: 12 });
    const v = st.rows("article_variants").find((x) => x.$id === vid)!;
    expect(v).toMatchObject({ productId: pid, label: "M / Rouge", sku: "TEE-M-R", barcode: "TEE-M-R0", price: 5500, cost: 3200, minStock: 3, archived: false, tenantId: T, shopId: A });
    expect(JSON.parse(String(v.attributes))).toEqual(attrs("M", "Rouge"));
    expect(st.rows("products").find((p) => p.$id === pid)!.hasVariants).toBe(true);
    expect(await stockScaledVariant(st, vid)).toBe(12); expect(await stockFor(st, pid)).toBe(12);
    expect(st.rows("stock_moves").find((m) => m.variantId === vid)).toMatchObject({ kind: "adjust", refId: "stock-initial", qty: 12, productId: pid });
    expect(st.rows("price_history").find((h) => h.variantId === vid)).toMatchObject({ newPrice: 5500, newCost: 3200 });
    expect(st.rows("audit_log").some((l) => l.action === "variant.create")).toBe(true);
  });
  it("prix, coût et seuil héritent de l'article quand ils ne sont pas donnés", async () => {
    const pid = await mkProduct(); const vid = await mkVariant(pid, { attributes: attrs("S") });
    expect(st.rows("article_variants").find((x) => x.$id === vid)).toMatchObject({ price: 5000, cost: 3000, minStock: 2 });
  });
  it("refuse attributs absents, doublons de combinaison (casse et ordre ignorés), prix invalides", async () => {
    const pid = await mkProduct(); await mkVariant(pid, { attributes: attrs("M", "Rouge") });
    await err(call("own", "variant.save", { productId: pid, attributes: [] }), 400); await err(call("own", "variant.save", { productId: pid, attributes: [{ name: "Taille", value: "" }] }), 400);
    await err(call("own", "variant.save", { productId: pid, attributes: [{ name: "couleur", value: "ROUGE" }, { name: "taille", value: "m" }] }), 409, "existe déjà");
    await err(call("own", "variant.save", { productId: pid, attributes: attrs("L"), price: -1 }), 400); await err(call("own", "variant.save", { productId: pid, attributes: attrs("L"), price: 10.5 }), 400);
    await err(call("own", "variant.save", { productId: pid, attributes: attrs("L"), minStock: 1.5 }), 400);
    expect(st.rows("article_variants")).toHaveLength(1);
  });
  it("SKU et code-barres uniques dans la boutique, articles ET variantes confondus ; libres dans une autre boutique", async () => {
    const pid = await mkProduct(); await mkVariant(pid, { attributes: attrs("M"), sku: "V-M", barcode: "BC-M" });
    await err(call("own", "variant.save", { productId: pid, attributes: attrs("L"), sku: "V-M" }), 409, "Référence");
    await err(call("own", "variant.save", { productId: pid, attributes: attrs("L"), barcode: "BC-M" }), 409, "Code-barres");
    await err(call("own", "variant.save", { productId: pid, attributes: attrs("L"), sku: "TEE" }), 409, "Référence"); // SKU d'un article
    await err(call("own", "article.save", { data: { name: "Autre", price: 1, sku: "V-M" } }), 409, "Référence"); // SKU d'une variante
    await err(call("own", "article.save", { data: { name: "Autre", price: 1, barcode: "BC-M" } }), 409, "Code-barres");
    const pidB = await mkProduct({ ...TEE, sku: "TEE", barcode: "TEE0" }, B); await mkVariant(pidB, { attributes: attrs("M"), sku: "V-M", barcode: "BC-M" }, B);
  });
  it("un article qui a du stock ne peut devenir décliné qu'après comptage à 0", async () => {
    const pid = (await ok(call("own", "article.save", { data: TEE, initialQty: 10 }))).id;
    await err(call("own", "variant.save", { productId: pid, attributes: attrs("M") }), 409, "comptez-le à 0");
    await ok(call("own", "stock.adjust", { productId: pid, counted: 0 }));
    await mkVariant(pid, { attributes: attrs("M"), initialQty: 4 }); expect(await stockFor(st, pid)).toBe(4);
  });
  it("modification : attributs, prix et coût historisés, unicité conservée", async () => {
    const pid = await mkProduct(); const a = await mkVariant(pid, { attributes: attrs("M"), sku: "A" }); const b = await mkVariant(pid, { attributes: attrs("L"), sku: "B" });
    await ok(call("own", "variant.save", { productId: pid, id: a, price: 6000, cost: 3500 }));
    expect(st.rows("price_history").filter((h) => h.variantId === a && h.newPrice === 6000)).toHaveLength(1);
    await err(call("own", "variant.save", { productId: pid, id: a, attributes: attrs("L") }), 409); await err(call("own", "variant.save", { productId: pid, id: a, sku: "B" }), 409);
    await ok(call("own", "variant.save", { productId: pid, id: a, attributes: attrs("XL") })); expect(st.rows("article_variants").find((x) => x.$id === a)!.label).toBe("XL");
    await ok(call("own", "variant.save", { productId: pid, id: b, sku: "B" })); // son propre SKU : pas un doublon
  });
  it("création idempotente et reprise après coupure (stock initial recréé, sans doublon)", async () => {
    const pid = await mkProduct(); const body = { productId: pid, requestId: "req-var-000001", attributes: attrs("M"), initialQty: 5 };
    const a = await ok(call("own", "variant.save", body)); await st.remove("stock_moves", `${a.id}_init`); await st.remove("price_history", `${a.id}_p0`);
    const b = await ok(call("own", "variant.save", body)); await ok(call("own", "variant.save", body));
    expect(b).toMatchObject({ id: a.id, duplicate: true }); expect(st.rows("article_variants")).toHaveLength(1); expect(await stockScaledVariant(st, a.id)).toBe(5);
    expect(st.rows("price_history").filter((h) => h.variantId === a.id)).toHaveLength(1); expect(st.rows("audit_log").filter((l) => l.action === "variant.create")).toHaveLength(1);
  });
});

describe("vente par variante", () => {
  let pid = "", m = "", l = "";
  beforeEach(async () => { pid = await mkProduct(); m = await mkVariant(pid, { attributes: attrs("M", "Rouge"), price: 5500, cost: 3200, initialQty: 10 }); l = await mkVariant(pid, { attributes: attrs("L", "Rouge"), price: 6000, cost: 3400, initialQty: 3 }); });
  it("exige la variante, applique son prix et son coût, retire son stock seulement", async () => {
    await err(sell([{ productId: pid, qty: 1 }], 5000), 400, "Choisissez une variante");
    await ok(sell([{ productId: pid, variantId: m, qty: 2 }], 11000));
    expect(await stockScaledVariant(st, m)).toBe(8); expect(await stockScaledVariant(st, l)).toBe(3); expect(await stockFor(st, pid)).toBe(11);
    const line = JSON.parse(String(st.rows("sales")[0]!.lines))[0]; expect(line).toMatchObject({ productId: pid, variantId: m, name: "Tee-shirt — M / Rouge", unitPrice: 5500, unitCost: 3200, qty: 2 });
    expect(st.rows("stock_moves").find((x) => x.kind === "sale")).toMatchObject({ variantId: m, qty: 2 });
  });
  it("stock insuffisant par variante (pas le total de l'article), cumul des lignes d'une même variante interdit en double", async () => {
    await err(sell([{ productId: pid, variantId: l, qty: 4 }], 24000), 409, "Stock insuffisant"); // 3 en L même s'il y a 13 au total
    await ok(sell([{ productId: pid, variantId: m, qty: 1 }, { productId: pid, variantId: l, qty: 3 }], 23500));
    await err(sell([{ productId: pid, variantId: m, qty: 1 }, { productId: pid, variantId: m, qty: 1 }], 11000), 400, "double");
  });
  it("refuse une variante archivée, d'un autre article, ou citée sur un article simple", async () => {
    const other = await mkProduct({ ...TEE, name: "Pantalon", sku: "PAN", barcode: "PAN0" }); const ov = await mkVariant(other, { attributes: attrs("M"), initialQty: 5 });
    await err(sell([{ productId: pid, variantId: ov, qty: 1 }], 5000), 404); // variante d'un autre article
    const simple = await mkProduct({ name: "Chaussette", price: 800, sku: "CH", barcode: "CH0" }, A); await ok(call("own", "stock.adjust", { productId: simple, counted: 5 }));
    await err(sell([{ productId: simple, variantId: m, qty: 1 }], 800), 400, "pas de variantes");
    await ok(call("own", "variant.archive", { id: m, archived: true })); await err(sell([{ productId: pid, variantId: m, qty: 1 }], 5500), 404);
    await ok(call("own", "variant.archive", { id: m, archived: false })); await ok(sell([{ productId: pid, variantId: m, qty: 1 }], 5500));
  });
  it("modifier une variante ne réécrit jamais une vente passée", async () => {
    await ok(sell([{ productId: pid, variantId: m, qty: 2 }], 11000)); const before = JSON.parse(JSON.stringify(st.rows("sales")[0]));
    await ok(call("own", "variant.save", { productId: pid, id: m, price: 9999, cost: 1, attributes: attrs("XXL") })); expect(st.rows("sales")[0]).toEqual(before);
    await ok(sell([{ productId: pid, variantId: m, qty: 1 }], 9999)); expect(st.rows("sales").at(-1)!.total).toBe(9999);
  });
  it("variante + conditionnement + quantité décimale se combinent", async () => {
    const sac = await ok(call("own", "article.save", { data: { name: "Riz", price: 1000, cost: 700, unit: "kg", qtyScale: 3, sku: "RZ", barcode: "RZ0" } })); const parfume = await mkVariant(sac.id, { attributes: [{ name: "Type", value: "Parfumé" }], price: 1200, initialQty: "50.5" });
    await ok(call("own", "article.units.save", { productId: sac.id, units: [{ unit: "sac", factor: 25 }] }));
    await ok(sell([{ productId: sac.id, variantId: parfume, qty: "1.25" }, ], 1500)); expect(await stockScaledVariant(st, parfume)).toBe(49250);
    await ok(sell([{ productId: sac.id, variantId: parfume, qty: 1, unit: "sac" }], 30000)); expect(await stockScaledVariant(st, parfume)).toBe(24250);
    expect(st.rows("stock_moves").find((x) => x.unit === "sac")).toMatchObject({ variantId: parfume, qty: 25000, unitQty: 1 });
  });
  it("reprise de la même vente : le stock de la variante n'est retiré qu'une fois", async () => {
    const body = { clientId: "vente-var-reprise1", lines: [{ productId: pid, variantId: m, qty: 3 }], payments: [{ method: "cash", amount: 16500 }] };
    await ok(call("own", "checkout", body)); expect((await ok(call("own", "checkout", body))).duplicate).toBe(true); expect(await stockScaledVariant(st, m)).toBe(7);
  });
});

describe("inventaire, achats, transferts, rapports", () => {
  let pid = "", m = "", l = "";
  beforeEach(async () => { pid = await mkProduct(); m = await mkVariant(pid, { attributes: attrs("M"), cost: 3000, initialQty: 10 }); l = await mkVariant(pid, { attributes: attrs("L"), cost: 3400, initialQty: 3 }); });
  it("inventaire : variante obligatoire, écart tracé sur la bonne variante", async () => {
    await err(call("own", "stock.adjust", { productId: pid, counted: 5 }), 400, "variante");
    expect((await ok(call("own", "stock.adjust", { productId: pid, variantId: m, counted: 7 }))).diff).toBe(-3);
    expect(await stockScaledVariant(st, m)).toBe(7); expect(await stockScaledVariant(st, l)).toBe(3);
    expect(st.rows("stock_moves").at(-1)).toMatchObject({ variantId: m, qty: -3, kind: "adjust", refId: "inventaire" });
    await err(call("own", "stock.adjust", { productId: pid, variantId: "inconnue", counted: 5 }), 400);
  });
  it("achats : commande et réception par variante, coût moyen pondéré de la variante seulement", async () => {
    const { id: sup } = await ok(call("own", "entity.save", { table: "suppliers", data: { name: "Grossiste" } }));
    await err(call("own", "po.create", { clientId: "commande-var-0001", supplierId: sup, lines: [{ productId: pid, qty: 5, unitCost: 3000 }] }), 400, "variante");
    const po = await ok(call("own", "po.create", { clientId: "commande-var-0002", supplierId: sup, lines: [{ productId: pid, variantId: m, qty: 10, unitCost: 4000 }, { productId: pid, variantId: l, qty: 2, unitCost: 3400 }] }));
    await err(call("own", "po.create", { clientId: "commande-var-0003", supplierId: sup, lines: [{ productId: pid, variantId: m, qty: 1, unitCost: 1 }, { productId: pid, variantId: m, qty: 1, unitCost: 1 }] }), 400, "double");
    expect(JSON.parse(String(st.rows("purchase_orders")[0]!.lines))[0].name).toBe("Tee-shirt — M");
    await ok(call("own", "po.receive", { poId: po.id, receiptId: "reception-var-001", lines: [{ productId: pid, variantId: m, qty: 10 }] }));
    expect(await stockScaledVariant(st, m)).toBe(20); expect(await stockScaledVariant(st, l)).toBe(3);
    expect(st.rows("article_variants").find((v) => v.$id === m)!.cost).toBe(3500); expect(st.rows("article_variants").find((v) => v.$id === l)!.cost).toBe(3400); expect(st.rows("products").find((p) => p.$id === pid)!.cost).toBe(3000);
    expect(st.rows("stock_moves").find((x) => x.kind === "purchase")).toMatchObject({ variantId: m, qty: 10 });
    await err(call("own", "po.receive", { poId: po.id, receiptId: "reception-var-002", lines: [{ productId: pid, variantId: l, qty: 5 }] }), 409); // plus que commandé
    await ok(call("own", "po.receive", { poId: po.id, receiptId: "reception-var-003", lines: [{ productId: pid, variantId: l, qty: 2 }] })); expect(st.rows("purchase_orders")[0]!.status).toBe("received");
    const inv = await ok(call("own", "invoice.supplier.create", { poId: po.id, invoiceId: "facture-var-00001" })); expect(inv.total).toBeGreaterThan(0);
  });
  it("transfert : la variante est retrouvée ou copiée dans l'autre boutique, les stocks restent séparés", async () => {
    await err(call("own", "stock.transfer", { transferId: "transfert-var-0001", toShopId: B, lines: [{ productId: pid, qty: 1 }] }), 400, "variante");
    await ok(call("own", "stock.transfer", { transferId: "transfert-var-0002", toShopId: B, lines: [{ productId: pid, variantId: m, qty: 4 }] }));
    const tp = st.rows("products").find((p) => p.shopId === B)!; expect(tp.hasVariants).toBe(true);
    const tv = st.rows("article_variants").filter((v) => v.shopId === B); expect(tv).toHaveLength(1); expect(tv[0]).toMatchObject({ label: "M", productId: tp.$id, attrKey: st.rows("article_variants").find((v) => v.$id === m)!.attrKey });
    expect(await stockScaledVariant(st, m)).toBe(6); expect(await stockScaledVariant(st, tv[0]!.$id)).toBe(4);
    await ok(call("own", "stock.transfer", { transferId: "transfert-var-0003", toShopId: B, lines: [{ productId: pid, variantId: m, qty: 1 }] })); // même variante : pas de copie en double
    expect(st.rows("article_variants").filter((v) => v.shopId === B)).toHaveLength(1); expect(await stockScaledVariant(st, tv[0]!.$id)).toBe(5);
    await err(call("own", "stock.transfer", { transferId: "transfert-var-0004", toShopId: B, lines: [{ productId: pid, variantId: l, qty: 9 }] }), 409, "Stock insuffisant");
  });
  it("rapport : stock valorisé et ruptures calculés variante par variante", async () => {
    await mkProduct({ name: "Simple", price: 100, cost: 50, sku: "SI", barcode: "SI0", minStock: 0 }); const sid = st.rows("products").find((p) => p.name === "Simple")!.$id; await ok(call("own", "stock.adjust", { productId: sid, counted: 4 }));
    const day = new Date().toISOString().slice(0, 10); const r = await ok(call("own", "report.consolidated", { from: day, to: day }));
    expect(r.totals.stockValue).toBe(10 * 3000 + 3 * 3400 + 4 * 50);
    await ok(call("own", "stock.adjust", { productId: pid, variantId: l, counted: 0 })); const r2 = await ok(call("own", "report.consolidated", { from: day, to: day }));
    expect(r2.totals.stockouts).toBe(1 + 0); // L à 0 sous son seuil (2) ; M (10) et Simple (4 > 0) non
  });
});

describe("cas limites", () => {
  it("supprimer la dernière variante (sans historique) rend l'article simple : il se revend et se compte sans variante", async () => {
    const pid = await mkProduct(); const a = await mkVariant(pid, { attributes: attrs("M"), initialQty: 2 });
    await ok(call("own", "variant.delete", { id: a })); expect(st.rows("products").find((p) => p.$id === pid)!.hasVariants).toBe(false);
    await ok(call("own", "stock.adjust", { productId: pid, counted: 6 })); await ok(sell([{ productId: pid, qty: 1 }], 5000)); expect(await stockFor(st, pid)).toBe(5);
    await err(call("own", "article.delete", { id: pid }), 409, "historique"); // la vente a créé un historique : l'archivage reste la seule voie
  });
  it("inventaire : une variante d'un autre article ou d'une autre boutique est refusée", async () => {
    const p1 = await mkProduct(); await mkVariant(p1, { attributes: attrs("M"), initialQty: 2 });
    const p2 = await mkProduct({ ...TEE, name: "Pantalon", sku: "PA", barcode: "PA0" }); const v2 = await mkVariant(p2, { attributes: attrs("M"), initialQty: 2 });
    await err(call("own", "stock.adjust", { productId: p1, variantId: v2, counted: 0 }), 400, "variante"); expect(await stockScaledVariant(st, v2)).toBe(2);
  });
  it("transfert vers une boutique où l'article existe sans variantes : refusé", async () => {
    const p1 = await mkProduct(); const v1 = await mkVariant(p1, { attributes: attrs("M"), initialQty: 5 });
    await mkProduct({ ...TEE, sku: "X1" }, B); // même code-barres dans la boutique cible, sans variantes
    await err(call("own", "stock.transfer", { transferId: "transfert-var-9001", toShopId: B, lines: [{ productId: p1, variantId: v1, qty: 1 }] }), 409, "pas de variantes");
    expect(await stockScaledVariant(st, v1)).toBe(5);
  });
});

describe("archivage, suppression, droits de formule, isolation", () => {
  it("suppression : refusée avec historique ; sans historique, retire stock initial, prix et photo ; dernière variante retirée → article simple", async () => {
    const pid = await mkProduct(); const a = await mkVariant(pid, { attributes: attrs("M"), initialQty: 5 }); const b = await mkVariant(pid, { attributes: attrs("L"), initialQty: 5 });
    await err(call("own", "article.delete", { id: pid }), 409, "variantes");
    await ok(sell([{ productId: pid, variantId: a, qty: 1 }], 5000)); await err(call("own", "variant.delete", { id: a }), 409, "archivez");
    await ok(call("own", "article.image", { id: pid, variantId: b, data: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]).toString("base64") })); expect(st.files.size).toBe(1);
    await ok(call("own", "variant.delete", { id: b })); expect(st.files.size).toBe(0); expect(st.rows("stock_moves").filter((x) => x.variantId === b)).toHaveLength(0); expect(st.rows("price_history").filter((x) => x.variantId === b)).toHaveLength(0);
    expect(st.rows("products").find((p) => p.$id === pid)!.hasVariants).toBe(true);
    await ok(call("own", "variant.archive", { id: a, archived: true })); // la dernière variante ne peut pas être supprimée (historique) mais peut être archivée
  });
  it("une variante commandée ne se supprime pas", async () => {
    const pid = await mkProduct(); const a = await mkVariant(pid, { attributes: attrs("M") }); const { id: sup } = await ok(call("own", "entity.save", { table: "suppliers", data: { name: "G" } }));
    await ok(call("own", "po.create", { clientId: "commande-var-9999", supplierId: sup, lines: [{ productId: pid, variantId: a, qty: 2, unitCost: 10 }] }));
    await err(call("own", "variant.delete", { id: a }), 409, "historique");
  });
  it("seuls propriétaire et gérant suppriment ; le magasinier gère mais ne supprime pas ; le caissier n'a aucun droit de gestion", async () => {
    const pid = await mkProduct(); const a = await mkVariant(pid, { attributes: attrs("M") });
    await ok(call(U.mag!, "variant.save", { productId: pid, attributes: attrs("L") })); await ok(call(U.mag!, "variant.archive", { id: a, archived: true })); await err(call(U.mag!, "variant.delete", { id: a }), 403);
    await err(call(U.cais!, "variant.save", { productId: pid, attributes: attrs("S") }), 403); await err(call(U.cais!, "variant.archive", { id: a, archived: false }), 403);
    await ok(call(U.ger!, "variant.delete", { id: a }));
  });
  it("Business : aucune création ni modification de variante (402) ; Pro → Business : les ventes d'articles déjà déclinés continuent", async () => {
    const pid = await mkProduct(); const a = await mkVariant(pid, { attributes: attrs("M"), initialQty: 10 });
    setPlan("business");
    await err(call("own", "variant.save", { productId: pid, attributes: attrs("L") }), 402, "Pro"); await err(call("own", "variant.save", { productId: pid, id: a, price: 1 }), 402);
    await err(call("own", "variant.archive", { id: a, archived: true }), 402); await err(call("own", "variant.delete", { id: a }), 402);
    await ok(sell([{ productId: pid, variantId: a, qty: 1 }], 5000)); // la caisse ne s'arrête pas
    expect(st.rows("article_variants")).toHaveLength(1); setPlan("pro"); await ok(call("own", "variant.save", { productId: pid, attributes: attrs("L") }));
    setPlan("starter"); await err(call("own", "variant.save", { productId: pid, attributes: attrs("XL") }), 402);
  });
  it("isolation entre entreprises et entre boutiques ; droits de lecture comme les articles", async () => {
    const pid = await mkProduct(); const a = await mkVariant(pid, { attributes: attrs("M"), initialQty: 5 });
    await st.grant("tenantvarX", "intruder", ["owner"], []); const xs = (await ok(handle(st, "intruder", { action: "shop.create", tenantId: "tenantvarX", shopId: "", payload: { name: "X" } }))).shopId;
    Object.assign(st.rows("subscriptions").find((r) => r.$id === "tenantvarX")!, { plan: "pro", period: "month", status: "paid", renewsAt: new Date(Date.now() + 864e6).toISOString() });
    const x = (action: string, payload: object) => handle(st, "intruder", { action, tenantId: "tenantvarX", shopId: xs, payload });
    await err(x("variant.save", { productId: pid, attributes: attrs("Z") }), 404); await err(x("variant.save", { productId: pid, id: a, price: 1 }), 404);
    await err(x("variant.archive", { id: a, archived: true }), 404); await err(x("variant.delete", { id: a }), 404);
    await err(call("own", "variant.save", { productId: pid, attributes: attrs("Z") }, B), 404); // autre boutique du même commerce
    const v = st.rows("article_variants")[0]!; expect(st.readableBy(U.cais!, "article_variants").map((r) => r.$id)).toContain(v.$id); expect(st.readableBy("intruder", "article_variants")).toHaveLength(0);
  });
  it("référence automatique des variantes : référence de l'article + numéro", async () => {
    const pid = await mkProduct({ name: "Polo", price: 5000 }); const base = st.rows("products").find((p) => p.$id === pid)!.sku;
    expect(base).toBe(`DMP-000001-${new Date().getUTCFullYear()}`);
    const v1 = await mkVariant(pid, { attributes: attrs("S") }); const v2 = await mkVariant(pid, { attributes: attrs("M") });
    expect(st.rows("article_variants").find((v) => v.$id === v1)!.sku).toBe(`DMP-000001-${new Date().getUTCFullYear()}-01`); expect(st.rows("article_variants").find((v) => v.$id === v2)!.sku).toBe(`DMP-000001-${new Date().getUTCFullYear()}-02`);
  });
});
