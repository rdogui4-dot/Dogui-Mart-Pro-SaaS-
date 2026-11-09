import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { stockFor } from "./checkout";
import { lotRowId, lotsWithStock, serialRowId } from "./tracking";

const T = "tenanttrk001";
let st: MemoryStore; let A = "", B = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown, shop = A, tenant = T) => handle(st, user, { action, tenantId: tenant, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); return x.body.error as string; };
const setPlan = (plan: string) => { const row = st.rows("subscriptions").find((r) => r.$id === T); const data = { tenantId: T, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", T, T, data); };
let n = 0; const id8 = (p: string) => `${p}-${String(++n).padStart(8, "0")}`;
const dayStr = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const sell = (lines: object[], amount: number, extra: object = {}) => call("own", "checkout", { clientId: id8("vente"), lines, payments: [{ method: "cash", amount }], ...extra });
const lastLine = (i = 0) => JSON.parse(String(st.rows("sales").at(-1)!.lines))[i];
const mkLot = async (extra: object = {}) => (await ok(call("own", "article.save", { data: { name: "Yaourt", price: 500, cost: 300, sku: "YAO", barcode: "YAO0", tracking: "lot", ...extra } }))).id as string;
const mkSerial = async (extra: object = {}) => (await ok(call("own", "article.save", { data: { name: "Téléphone", price: 50000, cost: 40000, sku: "TEL", barcode: "TEL0", tracking: "serial", ...extra } }))).id as string;
const lot = (productId: string, lotNo: string, qty: number | string, expDays: number | null, extra: object = {}) => call("own", "lot.receive", { productId, lotNo, qty, ...(expDays === null ? {} : { expiresAt: dayStr(expDays) }), ...extra });
const stockOfLot = async (productId: string, lotNo: string, variantId = "") => (await lotsWithStock(st, { userId: "own", tenantId: T, shopId: A, roles: ["owner"] }, productId, variantId)).find((l) => l.row.lotNo === lotNo)?.qty ?? 0;
const serials = (productId: string, list: string, extra: object = {}) => call("own", "serial.add", { productId, serials: list, ...extra });
let lotP = "", serP = "";

beforeEach(async () => {
  st = new MemoryStore(); n = 0;
  await st.grant(T, "own", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId;
  for (const [u, role] of [["cais", "cashier"], ["mag", "stockkeeper"], ["ger", "manager"]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: [A] }, ""))).userId;
  setPlan("pro"); lotP = await mkLot(); serP = await mkSerial();
});

describe("mode de suivi d'un article", () => {
  it("lot / série : Pro seulement, jamais de stock initial direct, et plus modifiable une fois le stock mouvementé", async () => {
    expect(st.rows("products").find((p) => p.$id === lotP)).toMatchObject({ tracking: "lot" });
    await err(call("own", "article.save", { data: { name: "X", price: 1, tracking: "lot", sku: "X", barcode: "X0" }, initialQty: 5 }), 400, "par lot"); await err(call("own", "article.save", { data: { name: "X", price: 1, tracking: "serial", sku: "X", barcode: "X0" }, initialQty: 5 }), 400, "numéros");
    await err(call("own", "article.save", { data: { name: "X", price: 1, tracking: "banane", sku: "X", barcode: "X0" } }), 400, "suivi");
    await err(call("own", "article.save", { data: { name: "Kg", price: 1, tracking: "serial", unit: "kg", qtyScale: 2, sku: "K", barcode: "K0" } }), 400, "unité entière");
    const plain = (await ok(call("own", "article.save", { data: { name: "Pain", price: 100, sku: "P", barcode: "P0" } }))).id;
    await ok(call("own", "article.save", { id: plain, data: { tracking: "lot" } })); await ok(call("own", "article.save", { id: plain, data: { tracking: "" } })); // sans mouvement : modifiable
    await ok(lot(lotP, "L1", 5, 30)); await err(call("own", "article.save", { id: lotP, data: { tracking: "" } }), 409, "mouvements");
    setPlan("business"); await err(call("own", "article.save", { data: { name: "Y", price: 1, tracking: "lot", sku: "Y", barcode: "Y0" } }), 402, "Pro"); await err(call("own", "article.save", { data: { name: "Z", price: 1, tracking: "serial", sku: "Z", barcode: "Z0" } }), 402);
  });
  it("série : pas de conditionnement actif", async () => {
    const s = (await ok(call("own", "article.save", { data: { name: "S", price: 1, sku: "S", barcode: "S0" } }))).id; await ok(call("own", "article.units.save", { productId: s, units: [{ unit: "carton", factor: 12 }] }));
    await err(call("own", "article.save", { id: s, data: { tracking: "serial" } }), 409, "conditionnements");
  });
});

describe("lots : entrée de stock", () => {
  it("crée le lot et son mouvement, journalise ; rejouable sans doublon", async () => {
    const a = await ok(lot(lotP, "l-2026/07", 24, 60, { requestId: "req-lot-000001", supplierId: undefined, unitCost: 280 }));
    expect(st.rows("article_lots")[0]).toMatchObject({ lotNo: "L-2026/07", productId: lotP, variantId: "", unitCost: 280, status: "active", tenantId: T, shopId: A }); expect(st.rows("article_lots")[0]!.expiresAt).toBe(`${dayStr(60)}T00:00:00.000Z`);
    expect(st.rows("stock_moves").find((m) => m.lotId === a.lotId)).toMatchObject({ qty: 24, kind: "adjust", refId: "lot-entry" }); expect(await stockFor(st, lotP)).toBe(24);
    expect((await ok(lot(lotP, "L-2026/07", 24, 60, { requestId: "req-lot-000001" }))).duplicate).toBe(true); expect(await stockFor(st, lotP)).toBe(24); expect(st.rows("audit_log").filter((l) => l.action === "lot.receive")).toHaveLength(1);
  });
  it("même lot, nouvelle entrée : le stock s'ajoute au lot ; une autre péremption sous le même numéro est refusée", async () => {
    await ok(lot(lotP, "L1", 10, 30)); await ok(lot(lotP, "L1", 5, 30)); expect(await stockOfLot(lotP, "L1")).toBe(15); expect(st.rows("article_lots")).toHaveLength(1);
    await err(lot(lotP, "L1", 5, 31), 409, "autre date"); await err(lot(lotP, "L1", 5, null), 409, "autre date"); expect(await stockOfLot(lotP, "L1")).toBe(15);
  });
  it("valide numéro, quantité, dates, fournisseur, mode de suivi", async () => {
    await err(lot(lotP, "", 5, 30), 400, "lot"); await err(lot(lotP, "L<1>", 5, 30), 400); await err(lot(lotP, "L1", 0, 30), 400); await err(lot(lotP, "L1", 1.5, 30), 400, "entière"); await err(lot(lotP, "L1", 5, 30, { expiresAt: "2026-02-30" }), 400, "invalide");
    await err(lot(lotP, "L1", 5, 30, { manufacturedAt: dayStr(40) }), 400, "précéder"); await err(lot(lotP, "L1", 5, 30, { supplierId: "inconnu" }), 404);
    const plain = (await ok(call("own", "article.save", { data: { name: "Pain", price: 100, sku: "P", barcode: "P0" } }))).id; await err(call("own", "lot.receive", { productId: plain, lotNo: "L1", qty: 1 }), 400, "pas suivi par lot"); expect(st.rows("article_lots")).toHaveLength(0);
  });
  it("article au kilo : lot en sous-unités exactes", async () => {
    const kg = await mkLot({ name: "Farine", unit: "kg", qtyScale: 3, sku: "F", barcode: "F0" }); await ok(lot(kg, "F1", "12.5", 90)); expect(await stockFor(st, kg)).toBe(12.5); expect(st.rows("stock_moves").at(-1)!.qty).toBe(12500);
    await err(lot(kg, "F2", "1.2345", 90), 400);
  });
});

describe("vente en FEFO", () => {
  beforeEach(async () => { await ok(lot(lotP, "TARD", 10, 120, { unitCost: 320 })); await ok(lot(lotP, "TOT", 5, 20, { unitCost: 280 })); await ok(lot(lotP, "SANS", 10, null, { unitCost: 300 })); });
  it("le lot qui expire le premier sort le premier, la vente peut couvrir plusieurs lots, chaque sortie est tracée par lot", async () => {
    await ok(sell([{ productId: lotP, qty: 8 }], 4000));
    expect(await stockOfLot(lotP, "TOT")).toBe(0); expect(await stockOfLot(lotP, "TARD")).toBe(7); expect(await stockOfLot(lotP, "SANS")).toBe(10);
    expect(lastLine().lots.map((l: any) => [l.lotNo, l.qty])).toEqual([["TOT", 5], ["TARD", 3]]);
    const mv = st.rows("stock_moves").filter((m) => m.kind === "sale"); expect(mv.map((m) => [m.lotId, m.qty]).sort()).toEqual([[lotRowId(lotP, "", "TOT"), 5], [lotRowId(lotP, "", "TARD"), 3]].sort());
    await ok(sell([{ productId: lotP, qty: 10 }], 5000)); expect(lastLine().lots.map((l: any) => l.lotNo)).toEqual(["TARD", "SANS"]); // lots sans date en dernier
  });
  it("le coût figé de la ligne est le coût moyen des lots réellement sortis", async () => {
    await ok(sell([{ productId: lotP, qty: 8 }], 4000)); expect(lastLine().unitCost).toBeCloseTo((5 * 280 + 3 * 320) / 8, 6);
  });
  it("lots périmés ou bloqués jamais vendus (politique par défaut) ; message précis", async () => {
    await ok(lot(lotP, "PERIME", 50, -2)); await ok(call("own", "lot.update", { id: lotRowId(lotP, "", "SANS"), status: "blocked" })); await ok(call("own", "lot.update", { id: lotRowId(lotP, "", "TARD"), status: "blocked" }));
    const e = await err(sell([{ productId: lotP, qty: 6 }], 3000), 409, "Stock insuffisant"); expect(e).toContain("50 périmé"); expect(e).toContain("bloqué");
    await ok(sell([{ productId: lotP, qty: 5 }], 2500)); expect(await stockOfLot(lotP, "TOT")).toBe(0); expect(await stockOfLot(lotP, "PERIME")).toBe(50);
    await ok(call("own", "lot.update", { id: lotRowId(lotP, "", "TARD"), status: "active" })); await ok(sell([{ productId: lotP, qty: 4 }], 2000)); // un lot débloqué redevient vendable
  });
  it("politique « autoriser » (propriétaire, Pro, journalisée) : le lot périmé sort alors en premier", async () => {
    await ok(lot(lotP, "PERIME", 3, -2)); await err(sell([{ productId: lotP, qty: 100 }], 1), 409);
    await err(call(U.ger!, "shop.save", { expiredPolicy: "allow" }), 403); await err(call("own", "shop.save", { expiredPolicy: "n'importe" }), 400); await ok(call("own", "shop.save", { expiredPolicy: "allow" }));
    expect(st.rows("audit_log").find((l) => l.action === "shop.expiredPolicy")!.detail).toBe("block → allow");
    await ok(sell([{ productId: lotP, qty: 4 }], 2000)); expect(lastLine().lots.map((l: any) => l.lotNo)).toEqual(["PERIME", "TOT"]);
    setPlan("business"); await err(call("own", "shop.save", { expiredPolicy: "block" }), 402, "Pro");
  });
  it("deux lignes d'un même article : les lots ne sont pas affectés deux fois", async () => {
    await ok(call("own", "article.units.save", { productId: (await ok(call("own", "article.save", { data: { name: "Eau", price: 100, sku: "E", barcode: "E0", tracking: "lot" } }))).id, units: [{ unit: "carton", factor: 6 }] }));
    const eau = st.rows("products").find((p) => p.name === "Eau")!.$id; await ok(lot(eau, "E1", 10, 30));
    await ok(sell([{ productId: eau, qty: 1, unit: "carton" }, { productId: eau, qty: 4 }], 1000)); expect(await stockOfLot(eau, "E1")).toBe(0);
    await err(sell([{ productId: eau, qty: 1 }], 100), 409);
  });
  it("reprise de la même vente : stock et affectation des lots inchangés", async () => {
    const body = { clientId: "vente-reprise-lots1", lines: [{ productId: lotP, qty: 8 }], payments: [{ method: "cash", amount: 4000 }] };
    await ok(call("own", "checkout", body)); expect((await ok(call("own", "checkout", body))).duplicate).toBe(true); expect(await stockOfLot(lotP, "TOT")).toBe(0); expect(await stockOfLot(lotP, "TARD")).toBe(7);
  });
  it("reprise après coupure en pleine vente : les mêmes lots sont réutilisés, pas une nouvelle affectation", async () => {
    // vente « posted » interrompue après la création de ses mouvements : les lots enregistrés dans la vente font foi
    const lines = [{ productId: lotP, name: "Yaourt", unitPrice: 500, qty: 8, amount: 4000, lots: [{ lotId: lotRowId(lotP, "", "TOT"), lotNo: "TOT", qty: 5 }, { lotId: lotRowId(lotP, "", "TARD"), lotNo: "TARD", qty: 3 }] }];
    await st.create("sales", "vente-coupure-lots1", T, { tenantId: T, shopId: A, number: "V-X", total: 4000, vat: 0, status: "pending", clientId: "vente-coupure-lots1", soldAt: new Date().toISOString(), lines: JSON.stringify(lines), payments: "[]", cashierId: "own" });
    await ok(call("own", "checkout", { clientId: "vente-coupure-lots1", lines: [{ productId: lotP, qty: 8 }], payments: [{ method: "cash", amount: 4000 }] }));
    expect(await stockOfLot(lotP, "TOT")).toBe(0); expect(await stockOfLot(lotP, "TARD")).toBe(7); expect(await stockOfLot(lotP, "SANS")).toBe(10);
  });
  it("inventaire par lot : le lot est obligatoire, l'écart est tracé sur ce lot", async () => {
    await err(call("own", "stock.adjust", { productId: lotP, counted: 3 }), 400, "lot"); await err(call("own", "stock.adjust", { productId: lotP, lotId: "inconnu", counted: 3 }), 400);
    expect((await ok(call("own", "stock.adjust", { productId: lotP, lotId: lotRowId(lotP, "", "TOT"), counted: 3 }))).diff).toBe(-2); expect(await stockOfLot(lotP, "TOT")).toBe(3); expect(st.rows("stock_moves").at(-1)).toMatchObject({ lotId: lotRowId(lotP, "", "TOT"), qty: -2, refId: "inventaire" });
  });
});

describe("mise au rebut d'un lot", () => {
  it("sortie tracée avec motif, totale ou partielle, jamais au-delà du stock, rejouable", async () => {
    await ok(lot(lotP, "VIEUX", 10, -5)); const id = lotRowId(lotP, "", "VIEUX");
    expect((await ok(call("own", "lot.writeoff", { lotId: id, qty: 4, reason: "périmé", requestId: "req-rebut-00001" }))).qty).toBe(4); expect((await ok(call("own", "lot.writeoff", { lotId: id, qty: 4, reason: "périmé", requestId: "req-rebut-00001" }))).duplicate).toBe(true);
    expect(await stockOfLot(lotP, "VIEUX")).toBe(6); expect(st.rows("stock_moves").find((m) => m.kind === "loss")).toMatchObject({ lotId: id, qty: 4, refId: "rebut:périmé" });
    await err(call("own", "lot.writeoff", { lotId: id, qty: 7 }), 409, "supérieure"); await ok(call("own", "lot.writeoff", { lotId: id, qty: "all", reason: "casse" })); expect(await stockOfLot(lotP, "VIEUX")).toBe(0);
    await err(call("own", "lot.writeoff", { lotId: id }), 409, "plus de stock"); expect(st.rows("audit_log").filter((l) => l.action === "lot.writeoff")).toHaveLength(2);
  });
});

describe("réception d'achat d'articles suivis", () => {
  let sup = "";
  beforeEach(async () => { sup = (await ok(call("own", "entity.save", { table: "suppliers", data: { name: "Laiterie" } }))).id; });
  const po = async (lines: object[]) => (await ok(call("own", "po.create", { clientId: id8("cmd"), supplierId: sup, lines }))).id as string;
  const receive = (poId: string, lines: object[], extra: object = {}) => call("own", "po.receive", { poId, receiptId: id8("rec"), lines, ...extra });
  it("lots : la somme doit égaler la quantité ; un mouvement par lot, coût de revient du lot, fournisseur retenu", async () => {
    const o = await po([{ productId: lotP, qty: 30, unitCost: 300 }]);
    await err(receive(o, [{ productId: lotP, qty: 30 }]), 400, "lots"); await err(receive(o, [{ productId: lotP, qty: 30, lots: [{ lotNo: "A", qty: 10, expiresAt: dayStr(30) }] }]), 400, "somme"); await err(receive(o, [{ productId: lotP, qty: 30, lots: [{ lotNo: "A", qty: 15 }, { lotNo: "a", qty: 15 }] }]), 400, "double");
    expect(st.rows("purchase_orders")[0]!.status).toBe("ordered"); expect(st.rows("article_lots")).toHaveLength(0); // rien d'écrit en cas de refus
    await ok(receive(o, [{ productId: lotP, qty: 30, lots: [{ lotNo: "A", qty: 10, expiresAt: dayStr(30) }, { lotNo: "B", qty: 20, expiresAt: dayStr(90) }] }], { fees: 600 }));
    expect(await stockOfLot(lotP, "A")).toBe(10); expect(await stockOfLot(lotP, "B")).toBe(20); expect(st.rows("article_lots").map((l) => [l.lotNo, l.unitCost, l.supplierId])).toEqual(expect.arrayContaining([["A", 320, sup], ["B", 320, sup]])); // 300 + 600/30
    expect(st.rows("stock_moves").filter((m) => m.kind === "purchase" && m.lotId)).toHaveLength(2); expect(await stockFor(st, lotP)).toBe(30);
  });
  it("réception rejouée : ni lots ni mouvements en double", async () => {
    const o = await po([{ productId: lotP, qty: 6, unitCost: 300 }]); const body = { poId: o, receiptId: "reception-lots-0001", lines: [{ productId: lotP, qty: 6, lots: [{ lotNo: "A", qty: 6, expiresAt: dayStr(30) }] }] };
    await ok(call("own", "po.receive", body)); await ok(call("own", "po.receive", body)); expect(await stockFor(st, lotP)).toBe(6); expect(st.rows("article_lots")).toHaveLength(1);
  });
  it("lot existant avec une autre péremption : réception refusée sans rien écrire", async () => {
    await ok(lot(lotP, "A", 5, 30)); const o = await po([{ productId: lotP, qty: 4, unitCost: 300 }]);
    await err(receive(o, [{ productId: lotP, qty: 4, lots: [{ lotNo: "A", qty: 4, expiresAt: dayStr(99) }] }]), 409, "autre date"); expect(st.rows("purchase_orders")[0]!.status).toBe("ordered"); expect(await stockFor(st, lotP)).toBe(5);
  });
  it("séries : une par unité reçue, uniques, avec le coût de revient ; refus des doublons et des comptes faux", async () => {
    const o = await po([{ productId: serP, qty: 3, unitCost: 40000 }]);
    await err(receive(o, [{ productId: serP, qty: 3 }]), 400, "exactement 3"); await err(receive(o, [{ productId: serP, qty: 3, serials: "SN001 SN002" }]), 400, "exactement 3"); await err(receive(o, [{ productId: serP, qty: 3, serials: "SN001 SN002 sn001" }]), 400, "double");
    await ok(serials(serP, "SN003")); await err(receive(o, [{ productId: serP, qty: 3, serials: "SN001 SN002 SN003" }]), 409, "déjà enregistré"); expect(st.rows("purchase_orders")[0]!.status).toBe("ordered"); expect(st.rows("article_serials")).toHaveLength(1);
    await ok(receive(o, [{ productId: serP, qty: 3, serials: "SN010 SN011 SN012" }], { fees: 3000 })); expect(await stockFor(st, serP)).toBe(4);
    expect(st.rows("article_serials").find((r) => r.serial === "SN010")).toMatchObject({ status: "available", unitCost: 41000, supplierId: sup, productId: serP }); expect(st.rows("stock_moves").filter((m) => m.kind === "purchase" && m.serial)).toHaveLength(3);
  });
  it("réception de séries rejouée : aucun doublon", async () => {
    const o = await po([{ productId: serP, qty: 2, unitCost: 40000 }]); const body = { poId: o, receiptId: "reception-serie-0001", lines: [{ productId: serP, qty: 2, serials: "AB123 AB124" }] };
    await ok(call("own", "po.receive", body)); await ok(call("own", "po.receive", body)); expect(await stockFor(st, serP)).toBe(2); expect(st.rows("article_serials")).toHaveLength(2);
  });
  it("réception partielle d'un article simple dans la même commande : inchangée", async () => {
    const plain = (await ok(call("own", "article.save", { data: { name: "Pain", price: 100, cost: 50, sku: "P", barcode: "P0" } }))).id; const o = await po([{ productId: plain, qty: 10, unitCost: 60 }, { productId: lotP, qty: 5, unitCost: 300 }]);
    await ok(receive(o, [{ productId: plain, qty: 10 }, { productId: lotP, qty: 5, lots: [{ lotNo: "A", qty: 5, expiresAt: dayStr(30) }] }])); expect(await stockFor(st, plain)).toBe(10); expect(await stockOfLot(lotP, "A")).toBe(5);
  });
});

describe("numéros de série", () => {
  it("entrée : une ligne et un mouvement par numéro, uniques, rejouable, journalisée", async () => {
    const r = await ok(serials(serP, "sn-001\nsn-002, SN-003", { warrantyMonths: 12, unitCost: 41000, requestId: "req-ser-000001" })); expect(r.count).toBe(3);
    expect(st.rows("article_serials").map((s) => s.serial).sort()).toEqual(["SN-001", "SN-002", "SN-003"]); expect(st.rows("article_serials")[0]).toMatchObject({ status: "available", warrantyMonths: 12, unitCost: 41000, cycle: 0, tenantId: T, shopId: A });
    expect(await stockFor(st, serP)).toBe(3); await ok(serials(serP, "sn-001 sn-002 sn-003", { warrantyMonths: 12, unitCost: 41000, requestId: "req-ser-000001" })); expect(await stockFor(st, serP)).toBe(3); expect(st.rows("article_serials")).toHaveLength(3);
    await err(serials(serP, "SN-003 SN-004"), 409, "déjà enregistré"); expect(await stockFor(st, serP)).toBe(3); expect(st.rows("article_serials")).toHaveLength(3); expect(st.rows("audit_log").filter((l) => l.action === "serial.add")).toHaveLength(1);
  });
  it("valide format, doublons dans la saisie, volume, mode de suivi, fournisseur, garantie", async () => {
    for (const bad of ["", "ab", "SN<1>", "SN001 SN001"]) await err(serials(serP, bad), 400); await err(serials(serP, Array.from({ length: 201 }, (_, i) => `SN${1000 + i}`).join(" ")), 400, "200");
    await err(serials(serP, "SN001", { supplierId: "inconnu" }), 404); await err(serials(serP, "SN001", { warrantyMonths: 500 }), 400); await err(call("own", "serial.add", { productId: lotP, serials: "SN001" }), 400, "numéro de série"); expect(st.rows("article_serials")).toHaveLength(0);
  });
  it("vente : les numéros doivent exister et être disponibles ; la vente les passe « vendu » avec référence et garantie", async () => {
    await ok(serials(serP, "SN001 SN002 SN003", { warrantyMonths: 12 }));
    await err(sell([{ productId: serP, qty: 2, serials: "SN001" }], 100000), 400, "exactement 2"); await err(sell([{ productId: serP, qty: 1, serials: "SN999" }], 50000), 404, "inconnu"); await err(sell([{ productId: serP, qty: 2, serials: "SN001 SN001" }], 1), 400, "double");
    expect(st.rows("sales")).toHaveLength(0); expect(await stockFor(st, serP)).toBe(3);
    await ok(sell([{ productId: serP, qty: 2, serials: "sn001 sn002" }], 100000)); expect(await stockFor(st, serP)).toBe(1); const sale = st.rows("sales").at(-1)!;
    const row = st.rows("article_serials").find((r) => r.serial === "SN001")!; expect(row).toMatchObject({ status: "sold", saleId: sale.$id, saleRef: sale.number }); expect(row.warrantyUntil).toBeTruthy(); expect(lastLine().serials).toEqual(["SN001", "SN002"]);
    expect(st.rows("stock_moves").filter((m) => m.kind === "sale" && m.serial)).toHaveLength(2); expect(st.rows("article_serials").find((r) => r.serial === "SN003")!.status).toBe("available");
  });
  it("caisse : sans numéro saisi, les plus anciennes unités disponibles sont attribuées automatiquement", async () => {
    await ok(serials(serP, "SN001 SN002 SN003")); await ok(sell([{ productId: serP, qty: 2 }], 100000));
    expect(lastLine().serials).toEqual(["SN001", "SN002"]); expect(st.rows("article_serials").filter((r) => r.status === "sold").map((r) => r.serial).sort()).toEqual(["SN001", "SN002"]); expect(await stockFor(st, serP)).toBe(1);
    await ok(sell([{ productId: serP, qty: 1 }], 50000)); expect(lastLine().serials).toEqual(["SN003"]); expect(await stockFor(st, serP)).toBe(0);
    await err(sell([{ productId: serP, qty: 1 }], 50000), 409, "Stock insuffisant"); expect(st.rows("sales")).toHaveLength(2);
  });
  it("un numéro déjà vendu ne se revend pas, et un conflit en cours de vente annule les réservations déjà faites", async () => {
    await ok(serials(serP, "SN001 SN002")); await ok(sell([{ productId: serP, qty: 1, serials: "SN001" }], 50000));
    await err(sell([{ productId: serP, qty: 1, serials: "SN001" }], 50000), 409, "indisponible"); expect(await stockFor(st, serP)).toBe(1);
    // course : SN002 est réservé par une autre vente entre la lecture et l'écriture (mouvement de réservation déjà présent)
    await st.create("stock_moves", `${serialRowId(serP, "SN002")}_0`, T, { tenantId: T, shopId: A, productId: serP, serial: "SN002", qty: 1, kind: "sale", refId: "V-AUTRE" });
    await err(sell([{ productId: serP, qty: 1, serials: "SN002" }], 50000), 409, "déjà vendu"); expect(st.rows("article_serials").find((r) => r.serial === "SN002")!.status).toBe("available");
  });
  it("conflit sur le 2e numéro d'une vente : le 1er n'est pas perdu", async () => {
    await ok(serials(serP, "SN001 SN002")); await st.create("stock_moves", `${serialRowId(serP, "SN002")}_0`, T, { tenantId: T, shopId: A, productId: serP, serial: "SN002", qty: 1, kind: "sale", refId: "V-AUTRE" });
    await err(sell([{ productId: serP, qty: 2, serials: "SN001 SN002" }], 100000), 409, "déjà vendu"); expect(st.rows("stock_moves").filter((m) => m.serial === "SN001" && m.kind === "sale")).toHaveLength(0); expect(st.rows("article_serials").find((r) => r.serial === "SN001")!.status).toBe("available");
    await ok(sell([{ productId: serP, qty: 1, serials: "SN001" }], 50000)); // le numéro libre se vend normalement
  });
  it("reprise de la même vente : aucune double réservation", async () => {
    await ok(serials(serP, "SN001")); const body = { clientId: "vente-reprise-serie1", lines: [{ productId: serP, qty: 1, serials: "SN001" }], payments: [{ method: "cash", amount: 50000 }] };
    await ok(call("own", "checkout", body)); expect((await ok(call("own", "checkout", body))).duplicate).toBe(true); expect(st.rows("stock_moves").filter((m) => m.serial === "SN001" && m.kind === "sale")).toHaveLength(1);
  });
  it("coût figé = coût des numéros vendus", async () => {
    await ok(serials(serP, "SN001 SN002", { unitCost: 38000 })); await ok(sell([{ productId: serP, qty: 2, serials: "SN001 SN002" }], 100000)); expect(lastLine().unitCost).toBe(38000);
  });
  it("statuts : retour client → remise en stock (nouveau cycle, revendable) ; défectueux ; transitions interdites", async () => {
    await ok(serials(serP, "SN001 SN002")); await ok(sell([{ productId: serP, qty: 1, serials: "SN001" }], 50000)); const id = serialRowId(serP, "SN001"), id2 = serialRowId(serP, "SN002");
    await err(call("own", "serial.status", { id, status: "available" }), 409, "impossible"); await err(call("own", "serial.status", { id, status: "n'importe" }), 409);
    await ok(call("own", "serial.status", { id, status: "returned" })); expect(await stockFor(st, serP)).toBe(1); await ok(call("own", "serial.status", { id, status: "available" })); expect(await stockFor(st, serP)).toBe(2);
    expect(st.rows("article_serials").find((r) => r.$id === id)).toMatchObject({ status: "available", cycle: 1, saleRef: "", saleId: "" });
    await ok(sell([{ productId: serP, qty: 1, serials: "SN001" }], 50000)); expect(await stockFor(st, serP)).toBe(1); // revendu : nouveau verrou, pas de conflit avec l'ancienne vente
    await ok(call("own", "serial.status", { id: id2, status: "defective" })); expect(await stockFor(st, serP)).toBe(0); await err(call("own", "serial.status", { id: id2, status: "available" }), 409); await err(sell([{ productId: serP, qty: 1, serials: "SN002" }], 50000), 409, "indisponible");
    await ok(call("own", "serial.status", { id, status: "warranty" })); await ok(call("own", "serial.status", { id, status: "sold" })); expect(await stockFor(st, serP)).toBe(0);
  });
  it("inventaire d'un article en série : refusé (le stock se corrige par statut)", async () => { await ok(serials(serP, "SN001")); await err(call("own", "stock.adjust", { productId: serP, counted: 0 }), 409, "numéro de série"); });
  it("pas de vente en carton d'un article en série", async () => {
    await ok(serials(serP, "SN001")); await err(sell([{ productId: serP, qty: 1, unit: "carton", serials: "SN001" }], 1), 400); // unité non définie
  });
});

describe("combinaisons, rapports, droits, isolation", () => {
  it("lot par variante : chaque variante a ses lots et son FEFO", async () => {
    const tee = await mkLot({ name: "Crème", sku: "C", barcode: "C0" }); await ok(call("own", "stock.adjust", { productId: tee, lotId: "x", counted: 0 }).catch(() => ({ status: 400 })) as never).catch(() => undefined);
    const prod = (await ok(call("own", "article.save", { data: { name: "Lait", price: 500, sku: "LA", barcode: "LA0", tracking: "lot" } }))).id;
    const v1 = (await ok(call("own", "variant.save", { productId: prod, attributes: [{ name: "Format", value: "1L" }], price: 800, cost: 500 }))).id, v2 = (await ok(call("own", "variant.save", { productId: prod, attributes: [{ name: "Format", value: "50cl" }], price: 450, cost: 260 }))).id;
    await err(lot(prod, "L1", 5, 30), 400, "variante"); await ok(lot(prod, "L1", 5, 30, { variantId: v1 })); await ok(lot(prod, "L1", 7, 90, { variantId: v2 })); // même numéro, variantes distinctes : lots distincts
    expect(st.rows("article_lots")).toHaveLength(2); await ok(sell([{ productId: prod, variantId: v1, qty: 5 }], 4000)); expect(await stockOfLot(prod, "L1", v1)).toBe(0); expect(await stockOfLot(prod, "L1", v2)).toBe(7);
    await err(sell([{ productId: prod, variantId: v1, qty: 1 }], 800), 409);
  });
  it("valeur du stock par lot dans les rapports : chaque lot à son coût", async () => {
    await ok(lot(lotP, "A", 10, 30, { unitCost: 200 })); await ok(lot(lotP, "B", 10, 60, { unitCost: 400 })); const d = new Date().toISOString().slice(0, 10);
    expect((await ok(call("own", "report.consolidated", { from: d, to: d }))).totals.stockValue).toBe(10 * 200 + 10 * 400);
    await ok(sell([{ productId: lotP, qty: 4 }], 2000)); expect((await ok(call("own", "report.consolidated", { from: d, to: d }))).totals.stockValue).toBe(6 * 200 + 10 * 400); // le lot A (péremption proche) est sorti en premier
  });
  it("transfert d'un article suivi : refusé clairement", async () => {
    await ok(lot(lotP, "A", 10, 30)); await err(call("own", "stock.transfer", { transferId: id8("trf"), toShopId: B, lines: [{ productId: lotP, qty: 1 }] }), 409, "pas encore disponible"); expect(await stockFor(st, lotP)).toBe(10);
  });
  it("Business : plus de création de lots/séries/blocage/rebut (402) ; la vente FEFO et les séries continuent ; la réception d'articles suivis reste possible", async () => {
    await ok(lot(lotP, "A", 10, 30)); await ok(serials(serP, "SN001 SN002")); setPlan("business");
    await err(lot(lotP, "B", 5, 30), 402, "Pro"); await err(serials(serP, "SN010"), 402); await err(call("own", "lot.update", { id: lotRowId(lotP, "", "A"), status: "blocked" }), 402); await err(call("own", "lot.writeoff", { lotId: lotRowId(lotP, "", "A"), qty: 1 }), 402); await err(call("own", "serial.status", { id: serialRowId(serP, "SN001"), status: "defective" }), 402);
    await ok(sell([{ productId: lotP, qty: 3 }], 1500)); await ok(sell([{ productId: serP, qty: 1, serials: "SN001" }], 50000)); expect(await stockFor(st, lotP)).toBe(7); expect(await stockFor(st, serP)).toBe(1);
    const sup = (await ok(call("own", "entity.save", { table: "suppliers", data: { name: "F" } }))).id; const o = (await ok(call("own", "po.create", { clientId: id8("cmd"), supplierId: sup, lines: [{ productId: lotP, qty: 4, unitCost: 300 }] }))).id;
    await ok(call("own", "po.receive", { poId: o, receiptId: id8("rec"), lines: [{ productId: lotP, qty: 4, lots: [{ lotNo: "C", qty: 4, expiresAt: dayStr(50) }] }] })); expect(await stockFor(st, lotP)).toBe(11);
  });
  it("rôles : le caissier vend avec séries/lots mais ne gère ni lots, ni séries ; le magasinier gère", async () => {
    await ok(lot(lotP, "A", 10, 30)); await ok(serials(serP, "SN001"));
    await err(call(U.cais!, "lot.receive", { productId: lotP, lotNo: "Z", qty: 1 }), 403); await err(call(U.cais!, "serial.add", { productId: serP, serials: "SN555" }), 403); await err(call(U.cais!, "serial.status", { id: serialRowId(serP, "SN001"), status: "defective" }), 403); await err(call(U.cais!, "lot.writeoff", { lotId: lotRowId(lotP, "", "A"), qty: 1 }), 403);
    await ok(call(U.mag!, "lot.receive", { productId: lotP, lotNo: "Z", qty: 1, expiresAt: dayStr(10) })); await ok(call(U.mag!, "serial.add", { productId: serP, serials: "SN777" }));
    await ok(call(U.cais!, "checkout", { clientId: id8("vente"), lines: [{ productId: lotP, qty: 2 }, { productId: serP, qty: 1, serials: "SN001" }], payments: [{ method: "cash", amount: 51000 }] }));
  });
  it("isolation entre entreprises et boutiques ; lecture comme les articles", async () => {
    await ok(lot(lotP, "A", 10, 30)); await ok(serials(serP, "SN001"));
    await st.grant("tenanttrkX", "intruder", ["owner"], []); const xs = (await ok(handle(st, "intruder", { action: "shop.create", tenantId: "tenanttrkX", shopId: "", payload: { name: "X" } }))).shopId;
    Object.assign(st.rows("subscriptions").find((r) => r.$id === "tenanttrkX")!, { plan: "pro", period: "month", status: "paid", renewsAt: new Date(Date.now() + 864e6).toISOString() });
    const x = (a: string, p: object) => handle(st, "intruder", { action: a, tenantId: "tenanttrkX", shopId: xs, payload: p });
    await err(x("lot.receive", { productId: lotP, lotNo: "Z", qty: 1 }), 404); await err(x("lot.update", { id: lotRowId(lotP, "", "A"), status: "blocked" }), 404); await err(x("lot.writeoff", { lotId: lotRowId(lotP, "", "A"), qty: 1 }), 404);
    await err(x("serial.add", { productId: serP, serials: "SN9" + "99" }), 404); await err(x("serial.status", { id: serialRowId(serP, "SN001"), status: "defective" }), 404); await err(call("own", "lot.receive", { productId: lotP, lotNo: "Z", qty: 1 }, B), 404);
    expect(st.readableBy(U.cais!, "article_lots")).toHaveLength(1); expect(st.readableBy(U.cais!, "article_serials")).toHaveLength(1); expect(st.readableBy("intruder", "article_lots")).toHaveLength(0); expect(st.readableBy("intruder", "article_serials")).toHaveLength(0);
  });
});
