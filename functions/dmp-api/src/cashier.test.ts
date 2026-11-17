import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { stockOf } from "../../../src/domain/stock";
import { serialRowId } from "./tracking";

class DatedStore extends MemoryStore { override async create(t: string, id: string, tenant: string, d: Record<string, unknown>) { return super.create(t, id, tenant, { $createdAt: new Date().toISOString(), ...d }); } }
const T = "tenantcs001", T2 = "tenantcs002";
let st: DatedStore; let A = "", B = "", X = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}, shop = A, tenant = T) => handle(st, user, { action, tenantId: tenant, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); };
const setPlan = (plan: string, tenant = T) => { const row = st.rows("subscriptions").find((r) => r.$id === tenant); const data = { tenantId: tenant, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", tenant, tenant, data); };
let n = 0; const id8 = (p: string) => `${p}-${String(++n).padStart(8, "0")}`;
const mk = async (name: string, price: number, cost: number, qty = 0, extra: object = {}) => (await ok(call("own", "article.save", { data: { name, price, cost, ...extra }, ...(qty ? { initialQty: qty } : {}) }))).id as string;
const sell = (user: string, lines: object[], payments: object[], extra: object = {}, shop = A) => call(user, "checkout", { clientId: id8("vente"), lines, payments, ...extra }, shop);
const cash = (v: number) => [{ method: "cash", amount: v }];
const stockOfProduct = (id: string) => stockOf(st.rows("stock_moves").filter((m) => m.productId === id).map((m) => ({ productId: id, qty: Number(m.qty), kind: m.kind as never })));
let eau = "", jus = "";

beforeEach(async () => {
  st = new DatedStore(); n = 0; await st.grant(T, "own", ["owner"], []); await st.grant(T2, "own2", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId; X = (await ok(call("own2", "shop.create", { name: "Autre" }, "", T2))).shopId;
  for (const [u, role, shops] of [["cais", "cashier", [A]], ["cais2", "cashier", [A]], ["ger", "manager", [A]]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: shops }, ""))).userId;
  setPlan("business"); setPlan("business", T2);
  eau = await mk("Eau", 500, 300, 100); jus = await mk("Jus", 1000, 600, 100);
});

describe("droits et abonnement", () => {
  it("Starter : vente possible mais fonctions de caisse intelligente refusées (402) ; Business : accessibles ; isolation entre commerces", async () => {
    setPlan("starter"); await ok(sell("own", [{ productId: eau, qty: 1 }], cash(500))); for (const a of ["cash.open", "cash.current", "cash.sessions", "sales.list"]) await err(call(U.cais!, a, { openingFloat: 0 }), 402);
    setPlan("business"); await ok(call(U.cais!, "cash.open", { openingFloat: 1000 })); await err(call("own2", "sale.get", { saleId: "x" }, X, T2), 404);
  });
});

describe("session de caisse : ouverture, mouvements, fermeture, écarts", () => {
  it("fond initial, ventes par moyen de paiement, remboursement espèces, sortie autorisée → solde théorique ; écart de comptage ; fermeture rejouable", async () => {
    const o = await ok(call(U.cais!, "cash.open", { openingFloat: 10000, requestId: "open-0001-aaaa" })); await err(call(U.cais!, "cash.open", { openingFloat: 5 }), 409, "déjà ouverte"); expect((await ok(call(U.cais!, "cash.open", { openingFloat: 10000, requestId: "open-0001-aaaa" }))).duplicate).toBe(true);
    await ok(sell(U.cais!, [{ productId: eau, qty: 4 }], [{ method: "cash", amount: 5000 }])); // 2 000, rend 3 000
    await ok(sell(U.cais!, [{ productId: jus, qty: 3 }], [{ method: "cash", amount: 1000 }, { method: "card", amount: 2000, reference: "TPE-889" }])); // 3 000 : 1 000 espèces + 2 000 carte
    const r = await ok(call(U.cais!, "cash.move", { kind: "out", amount: 500, reason: "Achat de sacs" })); expect(r.status).toBe("pending");
    const cur = await ok(call(U.cais!, "cash.current")); expect(cur.totals.sales).toMatchObject({ count: 2, total: 5000, byMethod: { cash: 3000, card: 2000 } }); expect(cur.totals.theoreticalCash).toBe(10000 + 3000); expect(cur.totals.movements.pending).toBe(1);
    await err(call(U.cais!, "cash.close", { counted: 13000 }), 409, "en attente"); await err(call(U.cais!, "cash.authorize", { id: r.id }), 403); await ok(call(U.ger!, "cash.authorize", { id: r.id, approve: true }));
    const sale = (await ok(call("own", "sales.list", {}))).sales.find((x: any) => x.total === 2000); await ok(call(U.ger!, "sale.refund", { returnId: "rt-0000001", saleId: sale.id, kind: "refund", lines: [{ index: 0, qty: 1 }], reason: "Article abîmé", refunds: [{ method: "cash", amount: 500 }] })); // la caisse du gérant n'est pas ouverte : remboursement hors session
    const t1 = (await ok(call(U.cais!, "cash.current"))).totals; expect(t1.theoreticalCash).toBe(10000 + 3000 - 500); expect(t1.movements).toMatchObject({ out: 500, in: 0, pending: 0 });
    const c = await ok(call(U.cais!, "cash.close", { sessionId: o.id, counted: 12400, note: "100 manquants" })); expect(c.theoreticalCash).toBe(12500); expect(c.variance).toBe(-100);
    expect((await ok(call(U.cais!, "cash.close", { sessionId: o.id, counted: 12400 }))).duplicate).toBe(true); await err(call(U.cais!, "cash.close", { sessionId: o.id, counted: 99 }), 409, "déjà fermée"); await err(call(U.cais!, "cash.move", { kind: "out", amount: 1, reason: "test" }), 409, "Ouvrez la caisse");
    const h = await ok(call(U.cais!, "cash.sessions", {})); expect(h.sessions[0]).toMatchObject({ status: "closed", countedCash: 12400, theoreticalCash: 12500, variance: -100, seller: "cais" }); expect(h.sessions[0].totals.sales.total).toBe(5000);
  });
  it("sortie supérieure au solde refusée ; entrée d'espèces ; remboursement espèces depuis une session ouverte réduit son solde", async () => {
    await ok(call(U.ger!, "cash.open", { openingFloat: 2000 })); await err(call(U.ger!, "cash.move", { kind: "out", amount: 5000, reason: "Trop" }), 409, "insuffisante"); await ok(call(U.ger!, "cash.move", { kind: "in", amount: 1000, reason: "Apport fond" })); await err(call(U.ger!, "cash.move", { kind: "out", amount: 10, reason: "x" }), 400, "Motif");
    await ok(sell(U.cais!, [{ productId: eau, qty: 2 }], cash(1000))); const sale = (await ok(call("own", "sales.list", {}))).sales[0]; await ok(call(U.ger!, "sale.refund", { returnId: "rt-0000002", saleId: sale.id, kind: "cancel", reason: "Erreur de saisie", refunds: [{ method: "cash", amount: 1000 }] }));
    expect((await ok(call(U.ger!, "cash.current"))).totals).toMatchObject({ theoreticalCash: 2000 + 1000 - 1000, refunds: { total: 1000, byMethod: { cash: 1000 } } });
  });
  it("session obligatoire (réglage boutique) : sans session, la vente est refusée ; avec session ouverte, elle passe", async () => {
    await ok(call("own", "shop.save", { cashRequired: true })); await err(sell(U.cais!, [{ productId: eau, qty: 1 }], cash(500)), 409, "Ouvrez la caisse"); await ok(call(U.cais!, "cash.open", { openingFloat: 0 })); await ok(sell(U.cais!, [{ productId: eau, qty: 1 }], cash(500)));
    await err(call(U.cais!, "shop.save", { cashRequired: false }), 403);
  });
  it("rapport par vendeur : ventes, remboursements, écarts cumulés ; un vendeur ne voit que ses sessions", async () => {
    for (const u of [U.cais!, U.cais2!]) { await ok(call(u, "cash.open", { openingFloat: 1000 })); await ok(sell(u, [{ productId: eau, qty: 2 }], cash(1000))); await ok(call(u, "cash.close", { counted: u === U.cais ? 1900 : 2000 })); }
    const r = await ok(call(U.ger!, "cash.sellers", {})); expect(r.sellers.map((s: any) => [s.seller, s.sessions, s.salesTotal, s.variance]).sort()).toEqual([["cais", 1, 1000, -100], ["cais2", 1, 1000, 0]]); await err(call(U.cais!, "cash.sellers", {}), 403); expect((await ok(call(U.cais!, "cash.sessions", {}))).sessions).toHaveLength(1);
  });
});

describe("paiements : cohérence, mixte, références", () => {
  it("paiement insuffisant ou monnaie sans espèces refusés ; mixte exact accepté ; références Mobile Money non vérifiées ; carte avec référence ; sans rien d'inventé", async () => {
    await err(sell("own", [{ productId: jus, qty: 1 }], cash(500)), 402, "insuffisant"); await err(sell("own", [{ productId: jus, qty: 1 }], [{ method: "card", amount: 1500 }]), 402, "monnaie");
    await err(sell("own", [{ productId: jus, qty: 1 }], [{ method: "wave", amount: 1000 }]), 400, "référence"); await err(sell("own", [{ productId: jus, qty: 1 }], [{ method: "wave", amount: 1000, reference: "ab" }]), 400, "référence"); await err(sell("own", [{ productId: jus, qty: 1 }], [{ method: "wave", amount: 1000, reference: "x".repeat(70) }]), 400, "invalide");
    const r = await ok(sell("own", [{ productId: jus, qty: 2 }], [{ method: "cash", amount: 500 }, { method: "wave", amount: 1000, reference: "WV-123456" }, { method: "card", amount: 500, reference: "TPE-1" }])); expect(r.change).toBe(0);
    const sale = (await ok(call("own", "sale.get", { saleId: r.saleId }))); expect(sale.payments).toEqual([{ method: "cash", amount: 500 }, { method: "wave", amount: 1000, reference: "WV-123456", verified: false }, { method: "card", amount: 500, reference: "TPE-1", verified: false }]);
    const qr = await ok(sell("own", [{ productId: eau, qty: 1 }], [{ method: "cash", amount: 1000 }])); expect(qr.change).toBe(500);
  });
  it("prix serveur : le client ne peut pas imposer un prix ; remise manuelle réservée aux gérants", async () => {
    await err(sell(U.cais!, [{ productId: eau, qty: 1, discountPct: 10 }], cash(500)), 403); await ok(sell(U.ger!, [{ productId: eau, qty: 2, discountPct: 10 }], cash(900))); const s = st.rows("sales").at(-1)!; expect(Number(s.total)).toBe(900);
    const r = await ok(sell("own", [{ productId: eau, qty: 1, unitPrice: 1 } as never], cash(500))); expect(r.total).toBe(500);
  });
  it("double validation : même clé d'idempotence = une seule vente, un seul mouvement de stock, un seul encaissement de session", async () => {
    await ok(call(U.cais!, "cash.open", { openingFloat: 0 })); const body = { clientId: "doublon-00000001", lines: [{ productId: eau, qty: 3 }], payments: cash(1500) };
    const rs = await Promise.all([call(U.cais!, "checkout", body), call(U.cais!, "checkout", body)]); expect(rs.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1); await call(U.cais!, "checkout", body);
    expect(st.rows("sales").filter((s) => s.status === "paid")).toHaveLength(1); expect(stockOfProduct(eau)).toBe(97); expect((await ok(call(U.cais!, "cash.current"))).totals.sales.total).toBe(1500);
  });
});

describe("annulation et remboursement : tracés, jamais de suppression", () => {
  it("remboursement partiel : stock remis, montant calculé par le serveur (prix et remises figés), vente conservée, comptabilité inverse, historique", async () => {
    const r = await ok(sell("own", [{ productId: eau, qty: 4 }, { productId: jus, qty: 1 }], cash(3000))); const before = stockOfProduct(eau); expect(before).toBe(96);
    const view = await ok(call("own", "sale.get", { saleId: r.saleId })); expect(view.refundable.lines.map((l: any) => [l.remainingQty, l.remainingNet])).toEqual([[4, 2000], [1, 1000]]);
    const body = { returnId: "rt-0000010", saleId: r.saleId, kind: "refund", lines: [{ index: 0, qty: 1 }], reason: "Client insatisfait", refunds: [{ method: "cash", amount: 500 }] };
    await err(call(U.cais!, "sale.refund", body), 403); await err(call("own", "sale.refund", { ...body, refunds: [{ method: "cash", amount: 400 }] }), 400, "répartition"); await err(call("own", "sale.refund", { ...body, lines: [{ index: 0, qty: 9 }] }), 400, "quantité"); await err(call("own", "sale.refund", { ...body, reason: "" }), 400, "Motif");
    await err(call("own", "sale.refund", { ...body, refunds: [{ method: "wave", amount: 500 }] }), 400, "Référence"); await err(call("own", "sale.refund", { ...body, refunds: [{ method: "credit", amount: 500 }] }), 400, "client");
    const a = await ok(call("own", "sale.refund", body)); expect(a).toMatchObject({ amount: 500, kind: "refund", duplicate: false }); expect((await ok(call("own", "sale.refund", body))).duplicate).toBe(true);
    expect(stockOfProduct(eau)).toBe(97); expect(st.rows("sale_returns")).toHaveLength(1); const s = st.rows("sales").find((x) => x.$id === r.saleId)!; expect(s.status).toBe("paid"); expect(Number(s.total)).toBe(3000);
    expect(st.rows("journal_entries").filter((j) => String(j.ref).endsWith("-RETOUR")).reduce((acc, j) => acc + Number(j.debit) - Number(j.credit), 0)).toBe(0);
    const after = await ok(call("own", "sale.get", { saleId: r.saleId })); expect(after.refunded).toBe(500); expect(after.refundable.lines[0]).toMatchObject({ remainingQty: 3, remainingNet: 1500 }); expect(after.returnsDetail[0]).toMatchObject({ amount: 500, reason: "Client insatisfait" });
    // rembourser le reste solde la vente (statut « refunded »), sans jamais la supprimer
    await ok(call("own", "sale.refund", { returnId: "rt-0000011", saleId: r.saleId, kind: "refund", lines: [{ index: 0, qty: 3 }, { index: 1, qty: 1 }], reason: "Reste", refunds: [{ method: "card", amount: 2500, reference: "TPE-0001" }] })); expect(st.rows("sales").find((x) => x.$id === r.saleId)!.status).toBe("refunded"); expect(stockOfProduct(jus)).toBe(100); expect(st.rows("sales")).toHaveLength(1);
    await err(call("own", "sale.refund", { returnId: "rt-0000012", saleId: r.saleId, kind: "refund", lines: [{ index: 0, qty: 1 }], reason: "Encore", refunds: [{ method: "cash", amount: 500 }] }), 409, "déjà entièrement");
  });
  it("annulation complète : stock remis, statut cancelled, CA du tableau de bord = 0, clients et crédit restaurés", async () => {
    const c = (await ok(call("own", "entity.save", { table: "customers", data: { name: "Awa", creditLimit: 100000 } }))).id as string; const r = await ok(sell("own", [{ productId: jus, qty: 3 }], [{ method: "cash", amount: 1000 }, { method: "credit", amount: 2000 }], { customerId: c }));
    await ok(call("own", "sale.refund", { returnId: "rt-0000021", saleId: r.saleId, kind: "cancel", reason: "Annulation", refunds: [{ method: "cash", amount: 1000 }, { method: "credit", amount: 2000 }] }));
    const s = st.rows("sales").find((x) => x.$id === r.saleId)!; expect(s.status).toBe("cancelled"); expect(stockOfProduct(jus)).toBe(100); const cu = st.rows("customers").find((x) => x.$id === c)!; expect(Number(cu.creditBalance)).toBe(0); expect(Number(cu.annualSpend)).toBe(0);
    expect((await ok(call("own", "dashboard.business", { preset: "today" }))).kpis.today.revenue).toBe(0); expect(st.rows("sale_returns")[0]!.status).toBe("done");
    await err(call("own", "sale.refund", { returnId: "rt-0000022", saleId: r.saleId, kind: "cancel", reason: "Encore", refunds: [{ method: "cash", amount: 3000 }] }), 409, "annulée");
  });
  const fake = async (id: string, lines: object[], total: number, extra: object = {}) => st.create("sales", id, T, { tenantId: T, shopId: A, number: `V-${id.slice(0, 6)}`, total, vat: 0, status: "paid", soldAt: new Date().toISOString(), cashierId: "own", payments: JSON.stringify(cash(total)), lines: JSON.stringify(lines), ...extra });
  const moves = (ref: string) => st.rows("stock_moves").filter((m) => m.refId === `retour-${ref}`).map((m) => ({ kind: m.kind, productId: m.productId, qty: Number(m.qty), lotId: m.lotId ?? "", serial: m.serial ?? "" }));
  it("retour d'un bundle : chaque composant revient en stock ; vente inconnue ou d'un autre commerce introuvable", async () => {
    await fake("bundle000001", [{ productId: jus, name: "Pack", qty: 2, unitPrice: 1000, components: [{ productId: eau, name: "Eau", qty: 4, perBundle: 2 }, { productId: jus, name: "Jus", qty: 2, perBundle: 1 }] }], 2000);
    await ok(call("own", "sale.refund", { returnId: "rt-bundle-1", saleId: "bundle000001", kind: "refund", reason: "Test", lines: [{ index: 0, qty: 1 }], refunds: [{ method: "cash", amount: 1000 }] }));
    expect(moves("V-bundle")).toEqual([{ kind: "return", productId: eau, qty: 2, lotId: "", serial: "" }, { kind: "return", productId: jus, qty: 1, lotId: "", serial: "" }]);
    expect(st.rows("sales").find((s) => s.$id === "bundle000001")!.status).toBe("paid");
    await err(call("own", "sale.refund", { returnId: "rt-0000030", saleId: "inconnue", kind: "cancel", reason: "test", refunds: [{ method: "cash", amount: 1 }] }), 404);
    await err(call("own2", "sale.refund", { returnId: "rt-0000031", saleId: "bundle000001", kind: "cancel", reason: "test", refunds: [{ method: "cash", amount: 1 }] }, X, T2), 404);
  });
  it("article à série : revendable → disponible (cycle +1, garantie effacée) ; abîmé → défectueux + sortie en perte ; numéro déjà retourné refusé", async () => {
    for (const [sn, status] of [["SN1", "sold"], ["SN2", "sold"]]) await st.create("article_serials", serialRowId(eau, sn), T, { tenantId: T, shopId: A, productId: eau, serial: sn, status, saleId: "serial000001", saleRef: "V-serial", warrantyUntil: "2030-01-01", cycle: 0 });
    await fake("serial000001", [{ productId: eau, name: "Téléphone", qty: 2, unitPrice: 500, serials: ["SN1", "SN2"] }], 1000);
    const pv = await ok(call("own", "sale.refund", { preview: true, saleId: "serial000001", kind: "refund", reason: "Retour client", lines: [{ index: 0, qty: 1, serials: ["sn2"], condition: "damaged" }], refunds: [{ method: "cash", amount: 500 }] }));
    expect(pv).toMatchObject({ preview: true, amount: 500, effects: [{ qty: 1, condition: "damaged", serials: ["SN2"] }] }); expect(st.rows("sale_returns")).toHaveLength(0);
    await ok(call("own", "sale.refund", { returnId: "rt-serial-1", saleId: "serial000001", kind: "refund", reason: "Écran cassé", lines: [{ index: 0, qty: 1, serials: ["SN2"], condition: "damaged" }], refunds: [{ method: "cash", amount: 500 }] }));
    expect(st.rows("article_serials").find((r) => r.serial === "SN2")).toMatchObject({ status: "defective", saleId: "", cycle: 1 });
    expect(moves("V-serial")).toEqual([{ kind: "return", productId: eau, qty: 1, lotId: "", serial: "SN2" }, { kind: "loss", productId: eau, qty: 1, lotId: "", serial: "SN2" }]);
    await err(call("own", "sale.refund", { returnId: "rt-serial-2", saleId: "serial000001", kind: "refund", reason: "Retour client", lines: [{ index: 0, qty: 1, serials: ["SN2"] }], refunds: [{ method: "cash", amount: 500 }] }), 400, "numéro");
    await ok(call("own", "sale.refund", { returnId: "rt-serial-3", saleId: "serial000001", kind: "refund", reason: "Ne plaît pas", lines: [{ index: 0, qty: 1 }], refunds: [{ method: "cash", amount: 500 }] }));
    expect(st.rows("article_serials").find((r) => r.serial === "SN1")).toMatchObject({ status: "available", saleId: "", warrantyUntil: null, cycle: 1 });
    expect(st.rows("sales").find((s) => s.$id === "serial000001")!.status).toBe("refunded");
  });
  it("article à lots : retour dans les lots vendus (dernier lot d'abord), plafonné à la quantité vendue ; article simple abîmé : retour puis perte, stock inchangé", async () => {
    await fake("lots00000001", [{ productId: eau, name: "Eau", qty: 3, unitPrice: 500, lots: [{ lotId: "LA", lotNo: "A", qty: 2 }, { lotId: "LB", lotNo: "B", qty: 1 }] }, { productId: jus, name: "Jus", qty: 1, unitPrice: 1000 }], 2500);
    const before = stockOfProduct(jus);
    await ok(call("own", "sale.refund", { returnId: "rt-lots-1", saleId: "lots00000001", kind: "refund", reason: "Retour client", lines: [{ index: 0, qty: 2 }, { index: 1, qty: 1, condition: "damaged" }], refunds: [{ method: "cash", amount: 2000 }] }));
    const m = moves("V-lots00"); expect(m.filter((x) => x.productId === eau).map((x) => [x.lotId, x.qty]).sort()).toEqual([["LA", 1], ["LB", 1]]);
    expect(m.filter((x) => x.productId === jus).map((x) => x.kind)).toEqual(["return", "loss"]); expect(stockOfProduct(jus)).toBe(before);
    await ok(call("own", "sale.refund", { returnId: "rt-lots-2", saleId: "lots00000001", kind: "refund", reason: "Retour client", lines: [{ index: 0, qty: 1 }], refunds: [{ method: "cash", amount: 500 }] }));
    expect(moves("V-lots00").filter((x) => x.productId === eau && x.lotId === "LA").reduce((a, x) => a + x.qty, 0)).toBe(2);
    await err(call("own", "sale.refund", { returnId: "rt-lots-3", saleId: "lots00000001", kind: "refund", reason: "Retour client", lines: [{ index: 0, qty: 1 }], refunds: [{ method: "cash", amount: 500 }] }), 409, "entièrement");
  });
  it("annulation : coupon redevenu utilisable (trace « void »), reprise idempotente sans double écriture", async () => {
    await fake("coupon000001", [{ productId: eau, name: "Eau", qty: 2, unitPrice: 500 }], 1000);
    await st.create("promotion_coupons", "coupon1", T, { tenantId: T, shopId: A, code: "BIENVENUE", usedCount: 1 });
    await st.create("promotion_coupon_usage", "cuse1", T, { tenantId: T, shopId: A, couponId: "coupon1", saleId: "coupon000001", outcome: "used" });
    const pv = await ok(call("own", "sale.refund", { preview: true, saleId: "coupon000001", kind: "cancel", reason: "Retour client", refunds: [{ method: "cash", amount: 1000 }] })); expect(pv.couponReleased).toBe(true);
    const body = { returnId: "rt-coupon-1", saleId: "coupon000001", kind: "cancel", reason: "Erreur de caisse", refunds: [{ method: "cash", amount: 1000 }] };
    await ok(call("own", "sale.refund", body)); const nMoves = st.rows("stock_moves").length;
    expect(st.rows("promotion_coupon_usage")[0]).toMatchObject({ outcome: "void", reason: "vente annulée" }); expect(st.rows("promotion_coupons")[0]!.usedCount).toBe(0);
    expect(st.rows("sales").find((s) => s.$id === "coupon000001")!.status).toBe("cancelled");
    expect((await ok(call("own", "sale.refund", body))).duplicate).toBe(true); expect(st.rows("stock_moves").length).toBe(nMoves); expect(st.rows("sale_returns")).toHaveLength(1);
  });
});

describe("historique, détail, réimpression", () => {
  it("le vendeur ne voit que ses ventes, le gérant toutes ; recherche et période ; réimpression tracée sans nouvelle vente ni mouvement", async () => {
    await ok(sell(U.cais!, [{ productId: eau, qty: 1 }], cash(500))); await ok(sell(U.cais2!, [{ productId: jus, qty: 1 }], cash(1000)));
    expect((await ok(call(U.cais!, "sales.list", {}))).sales).toHaveLength(1); const all = await ok(call(U.ger!, "sales.list", {})); expect(all.sales).toHaveLength(2); expect(all.totals).toMatchObject({ count: 2, paid: 1500, refunded: 0 }); expect(all.sales.map((s: any) => s.seller).sort()).toEqual(["cais", "cais2"]);
    expect((await ok(call(U.ger!, "sales.list", { q: all.sales[0].number.slice(-4) }))).sales.length).toBeGreaterThan(0); expect((await ok(call(U.ger!, "sales.list", { from: "2020-01-01", to: "2020-01-02" }))).sales).toEqual([]); await err(call(U.ger!, "sales.list", { from: "2020-01-01", to: "2026-01-01" }), 400);
    const mine = all.sales.find((s: any) => s.seller === "cais2"); await err(call(U.cais!, "sale.get", { saleId: mine.id }), 403);
    const salesBefore = st.rows("sales").length, movesBefore = st.rows("stock_moves").length, stockBefore = stockOfProduct(jus); const d = await ok(call(U.cais2!, "sale.get", { saleId: mine.id, reprint: true })); expect(d.lines[0]).toMatchObject({ name: "Jus", qty: 1, amount: 1000 }); await ok(call(U.cais2!, "sale.get", { saleId: mine.id, reprint: true }));
    expect(st.rows("sales")).toHaveLength(salesBefore); expect(st.rows("stock_moves")).toHaveLength(movesBefore); expect(stockOfProduct(jus)).toBe(stockBefore); expect(st.rows("audit_log").filter((a) => a.action === "sale.reprint")).toHaveLength(2);
  });
});

describe("session de caisse obligatoire PAR DÉFAUT (Business et Pro)", () => {
  /** Les boutiques de test partent avec « session non obligatoire » (test-setup.ts) : ici on repart d'une boutique sans réglage, comme une boutique réelle déjà existante. */
  const unset = () => { const row = st.rows("shops").find((r) => r.$id === A.slice(0, 36)); if (row) delete (row as Record<string, unknown>).cashRequired; return row; };
  it("sans réglage explicite : vente refusée (409) tant qu'aucune session n'est ouverte, acceptée une fois la caisse ouverte", async () => {
    unset();
    expect((await ok(call(U.cais!, "cash.current"))).required).toBe(true);
    await err(sell(U.cais!, [{ productId: eau, qty: 1 }], cash(500)), 409, "Ouvrez la caisse");
    await ok(call(U.cais!, "cash.open", { openingFloat: 1000 }));
    await ok(sell(U.cais!, [{ productId: eau, qty: 1 }], cash(500)));
  });
  it("le gérant peut désactiver explicitement l'obligation ; la vente passe alors sans session", async () => {
    unset(); await ok(call("own", "shop.save", { cashRequired: false }));
    expect((await ok(call(U.cais!, "cash.current"))).required).toBe(false);
    await ok(sell(U.cais!, [{ productId: eau, qty: 1 }], cash(500)));
    await ok(call("own", "shop.save", { cashRequired: true })); await err(sell(U.cais!, [{ productId: eau, qty: 1 }], cash(500)), 409, "Ouvrez la caisse");
  });
  it("Starter (sans sessions de caisse) : aucune obligation, la vente reste possible", async () => {
    unset(); setPlan("starter"); await ok(sell("own", [{ productId: eau, qty: 1 }], cash(500)));
  });
  it("une session ouverte par un AUTRE vendeur ne couvre pas la vente", async () => {
    unset(); await ok(call(U.cais2!, "cash.open", { openingFloat: 0 })); await err(sell(U.cais!, [{ productId: eau, qty: 1 }], cash(500)), 409, "Ouvrez la caisse");
  });
  it("remboursement en espèces refusé sans session (par défaut)", async () => {
    await ok(call(U.cais!, "cash.open", { openingFloat: 5000 })); await ok(sell(U.cais!, [{ productId: eau, qty: 2 }], cash(1000)));
    const sale = (await ok(call("own", "sales.list", {}))).sales[0]; await ok(call(U.cais!, "cash.close", { counted: 6000 })); unset();
    await err(call(U.ger!, "sale.refund", { returnId: "rt-0000009", saleId: sale.id, kind: "refund", lines: [{ index: 0, qty: 1 }], reason: "Article abîmé", refunds: [{ method: "cash", amount: 500 }] }), 409, "Ouvrez la caisse");
  });
});
