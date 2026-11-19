import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { stockFor } from "./checkout";
import { serialRowId } from "./tracking";

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
const serials = (productId: string, list: string, extra: object = {}) => call("own", "serial.add", { productId, serials: list, ...extra });
let serP = "";

beforeEach(async () => {
  st = new MemoryStore(); n = 0;
  await st.grant(T, "own", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId;
  for (const [u, role] of [["cais", "cashier"], ["mag", "stockkeeper"], ["ger", "manager"]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: [A] }, ""))).userId;
  setPlan("pro"); serP = await mkSerial();
});


const row = (sn: string) => st.rows("article_serials").find((r) => r.serial === sn)!;
const refund = (saleId: string, lines: object[], returnId = id8("rt"), amount = 0, extra: object = {}) => call("own", "sale.refund", { returnId, saleId, kind: "refund", lines, reason: "Retour client", refunds: [{ method: "cash", amount }], ...extra });
const lastSale = async () => (await ok(call("own", "sales.list", {}))).sales[0];

describe("numéros de série à quantité", () => {
  it("ajout : « NUMERO:quantité » ou quantité par numéro ; le stock est la somme des quantités", async () => {
    await ok(serials(serP, "SN-A:24 SN-B:5 SN-C")); expect(await stockFor(st, serP)).toBe(30);
    expect(row("SN-A")).toMatchObject({ qty: 24, initialQty: 24, seq: 0, status: "available" }); expect(row("SN-C")).toMatchObject({ qty: 1, initialQty: 1 });
    expect(st.rows("stock_moves").find((m) => m.serial === "SN-A")).toMatchObject({ qty: 24 });
    await ok(serials(serP, "SN-D SN-E", { quantity: 12 })); expect(await stockFor(st, serP)).toBe(54);
    await err(serials(serP, "SN-F:0"), 400, "Quantité"); await err(serials(serP, "SN-G", { quantity: 1.5 }), 400, "Quantité par numéro");
  });
  it("vente partielle : le numéro reste disponible avec la quantité restante, « vendu » à zéro ; refus au-delà", async () => {
    await ok(serials(serP, "SN-A:24")); await ok(sell([{ productId: serP, qty: 5 }], 250000));
    expect(row("SN-A")).toMatchObject({ qty: 19, status: "available", seq: 1 }); expect(await stockFor(st, serP)).toBe(19); expect(lastLine()).toMatchObject({ serials: ["SN-A"], serialQtys: [5], qty: 5 });
    expect(st.rows("stock_moves").filter((m) => m.kind === "sale" && m.serial === "SN-A")).toMatchObject([{ qty: 5 }]);
    await ok(sell([{ productId: serP, qty: 19 }], 950000)); expect(row("SN-A")).toMatchObject({ qty: 0, status: "sold", seq: 2 }); expect(await stockFor(st, serP)).toBe(0); expect(st.rows("stock_moves").filter((m) => m.kind === "sale" && m.serial === "SN-A")).toHaveLength(2);
    await err(sell([{ productId: serP, qty: 1 }], 50000), 409, "Stock insuffisant");
  });
  it("vente sur plusieurs numéros : les plus anciens d'abord, en entamant le dernier ; numéros choisis avec quantités", async () => {
    await ok(serials(serP, "SN-A:3")); await ok(serials(serP, "SN-B:10")); await ok(sell([{ productId: serP, qty: 5 }], 250000));
    expect(lastLine()).toMatchObject({ serials: ["SN-A", "SN-B"], serialQtys: [3, 2] }); expect(row("SN-A")).toMatchObject({ qty: 0, status: "sold" }); expect(row("SN-B")).toMatchObject({ qty: 8, status: "available" });
    await ok(sell([{ productId: serP, qty: 4, serials: ["SN-B"], serialQtys: [4] }], 200000)); expect(row("SN-B").qty).toBe(4);
    await err(sell([{ productId: serP, qty: 9, serials: ["SN-B"], serialQtys: [9] }], 450000), 409, "restante"); await err(sell([{ productId: serP, qty: 3, serials: ["SN-B"], serialQtys: [2] }], 150000), 400, "totaliser");
    expect(await stockFor(st, serP)).toBe(4);
  });
  it("vente rejouée (même identifiant) : le prélèvement n'est appliqué qu'une fois", async () => {
    await ok(serials(serP, "SN-A:24")); const body = { clientId: "vente-serie-qte-001", lines: [{ productId: serP, qty: 5 }], payments: [{ method: "cash", amount: 250000 }] };
    await ok(call("own", "checkout", body)); await ok(call("own", "checkout", body)); expect(row("SN-A").qty).toBe(19); expect(await stockFor(st, serP)).toBe(19); expect(st.rows("sales")).toHaveLength(1);
  });
  it("deux ventes sur le même état d'un numéro : une seule est acceptée (prélèvement réservé par numéro et compteur)", async () => {
    await ok(serials(serP, "SN-A:10")); const first = await ok(sell([{ productId: serP, qty: 4 }], 200000)); expect(first).toBeTruthy();
    // un second encaissement qui aurait lu l'état d'avant (même compteur) trouve le prélèvement déjà réservé
    const claim = st.rows("stock_moves").find((m) => m.kind === "sale" && m.serial === "SN-A")!; expect(String(claim.$id)).toMatch(/_0$/); await st.update("article_serials", String(row("SN-A").$id), { seq: 0, qty: 10 });
    await err(sell([{ productId: serP, qty: 4 }], 200000, { clientId: "zzzzzz-second-00001" }), 409, "déjà vendu");
  });
  it("retour client : la quantité rendue revient sur le numéro d'origine (un numéro se retourne en entier), rejouable", async () => {
    await ok(serials(serP, "SN-A:24")); await ok(sell([{ productId: serP, qty: 5 }], 250000)); const sale = await lastSale(); expect(row("SN-A").qty).toBe(19);
    await err(refund(sale.id, [{ index: 0, qty: 3 }], "rt-qte-0000001", 150000), 400, "totalisent");
    const rid = "rt-qte-0000002"; await ok(refund(sale.id, [{ index: 0, qty: 5 }], rid, 250000)); await ok(refund(sale.id, [{ index: 0, qty: 5 }], rid, 250000));
    expect(row("SN-A")).toMatchObject({ qty: 24, status: "available" }); expect(await stockFor(st, serP)).toBe(24); expect(st.rows("stock_moves").filter((m) => m.kind === "return" && m.serial === "SN-A")).toHaveLength(1);
    await ok(sell([{ productId: serP, qty: 24 }], 1200000)); expect(row("SN-A")).toMatchObject({ qty: 0, status: "sold" });
  });
  it("retour d'unités abîmées : le restant du numéro ne change pas (les unités rendues sont perdues)", async () => {
    await ok(serials(serP, "SN-A:24")); await ok(sell([{ productId: serP, qty: 5 }], 250000)); const sale = await lastSale();
    await ok(refund(sale.id, [{ index: 0, qty: 5, condition: "damaged" }], "rt-qte-0000003", 250000)); expect(row("SN-A")).toMatchObject({ qty: 19, status: "available" }); expect(await stockFor(st, serP)).toBe(19);
  });
  it("un numéro à quantité ne se change pas de statut à la main (sauf défectueux pour le restant)", async () => {
    await ok(serials(serP, "SN-A:24 SN-B:6")); await ok(sell([{ productId: serP, qty: 24 }], 1200000)); const a = row("SN-A"); await err(call("own", "serial.status", { id: a.$id, status: "returned" }), 409, "retour client");
    const b = row("SN-B"); await ok(call("own", "serial.status", { id: b.$id, status: "defective" })); expect(await stockFor(st, serP)).toBe(0); expect(row("SN-B").status).toBe("defective");
  });
  it("transfert : un numéro se transfère en entier (quantité exacte ou refus), retrouvé en destination avec sa quantité", async () => {
    await ok(serials(serP, "SN-A:24")); await ok(sell([{ productId: serP, qty: 5 }], 250000)); await ok(serials(serP, "SN-B:6"));
    await err(call("own", "stock.transfer", { transferId: "trf-qte-00000001", toShopId: B, lines: [{ productId: serP, qty: 10 }] }), 409, "en entier");
    await ok(call("own", "stock.transfer", { transferId: "trf-qte-00000002", toShopId: B, lines: [{ productId: serP, qty: 25 }] }));
    expect(row("SN-A")).toMatchObject({ status: "transferred", qty: 0 }); const dest = st.rows("article_serials").filter((r) => r.shopId === B); expect(dest.map((r) => [r.serial, r.qty]).sort()).toEqual([["SN-A", 19], ["SN-B", 6]]);
    expect(await stockFor(st, serP)).toBe(0); const dp = st.rows("products").find((p) => p.shopId === B && p.originId === serP)!; expect(await stockFor(st, dp.$id)).toBe(25);
  });
  it("réception d'achat : les numéros doivent totaliser la quantité reçue", async () => {
    const sup = (await ok(call("own", "entity.save", { table: "suppliers", data: { name: "F" } }))).id; const o = (await ok(call("own", "po.create", { clientId: id8("cmd"), supplierId: sup, lines: [{ productId: serP, qty: 30, unitCost: 40000 }] }))).id;
    const rec = (serialsTxt: string) => call("own", "po.receive", { poId: o, receiptId: id8("rec"), lines: [{ productId: serP, qty: 30, serials: serialsTxt }] });
    await err(rec("SN-A:24 SN-B:5"), 400, "totaliser"); await ok(rec("SN-A:24 SN-B:6")); expect(await stockFor(st, serP)).toBe(30); expect(row("SN-A")).toMatchObject({ qty: 24, initialQty: 24 });
  });
});
