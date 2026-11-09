import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { stockOf } from "../../../src/domain/stock";

class DatedStore extends MemoryStore { override async create(t: string, id: string, tenant: string, d: Record<string, unknown>) { return super.create(t, id, tenant, { $createdAt: new Date().toISOString(), ...d }); } }
const T = "tenantpp001", T2 = "tenantpp002";
let st: DatedStore; let A = "", B = "", X = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}, shop = A, tenant = T) => handle(st, user, { action, tenantId: tenant, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); return x.body.error as string; };
const setPlan = (plan: string, tenant = T) => { const row = st.rows("subscriptions").find((r) => r.$id === tenant); const data = { tenantId: tenant, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", tenant, tenant, data); };
const cid = () => crypto.randomUUID().replace(/-/g, "");
const mk = async (name: string, price: number, cost: number, qty = 0) => (await ok(call("own", "article.save", { data: { name, price, cost }, ...(qty ? { initialQty: qty } : {}) }))).id as string;
const sell = (user: string, lines: object[], payments: object[], extra: object = {}, shop = A) => call(user, "checkout", { clientId: cid(), lines, payments, ...extra }, shop);
const cash = (v: number) => [{ method: "cash", amount: v }];
const stockOfProduct = (id: string) => stockOf(st.rows("stock_moves").filter((m) => m.productId === id).map((m) => ({ productId: id, qty: Number(m.qty), kind: m.kind as never })));
let eau = "", jus = "", pain = "";

beforeEach(async () => {
  st = new DatedStore(); await st.grant(T, "own", ["owner"], []); await st.grant(T2, "own2", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId; X = (await ok(call("own2", "shop.create", { name: "Autre" }, "", T2))).shopId;
  for (const [u, role, shops] of [["cais", "cashier", [A]], ["cais2", "cashier", [A]], ["ger", "manager", [A]], ["ger2", "manager", [A]]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: shops }, ""))).userId;
  setPlan("pro"); setPlan("pro", T2);
  eau = await mk("Eau", 500, 300, 100); jus = await mk("Jus", 1000, 600, 100); pain = await mk("Pain", 200, 150, 100);
});

describe("abonnement et isolation", () => {
  it("Business : les fonctions Pro de la caisse sont refusées (402), la vente et ses garde-fous Business restent intacts ; pas de journal financier", async () => {
    setPlan("business");
    for (const [a, p] of [["approval.request", { kind: "margin" }], ["approval.list", {}], ["pos.suggest", {}], ["pos.simulate", { lines: [{ productId: eau, qty: 1 }] }], ["pos.insights", {}], ["ledger.verify", {}], ["voucher.check", { code: "X" }], ["cash.performance", {}], ["customer.profile", { customerId: "x" }]] as const) await err(call("own", a, p), 402);
    await err(sell(U.cais!, [{ productId: eau, qty: 1, discountPct: 10 }], cash(500)), 403); // Business : remise réservée au gérant
    await ok(sell("own", [{ productId: eau, qty: 1 }], cash(500))); expect(st.rows("finance_ledger").length).toBe(0); expect(st.rows("payment_refs").length).toBe(1); // seul le rang de stock (anti-surventes) est écrit
  });
  it("un autre commerce ne voit ni approbations, ni bons d'achat, ni journal", async () => {
    const a = await ok(call(U.cais!, "approval.request", { kind: "discount", details: {} })); await err(call("own2", "approval.decide", { id: a.id, approve: true }, X, T2), 404);
    await err(call("own2", "voucher.check", { code: "AV-XXXX" }, X, T2), 404);
  });
});

describe("concurrence : une seule vente gagne", () => {
  it("dernière unité vendue en même temps par deux caisses : exactement une vente, stock jamais négatif", async () => {
    const rare = await mk("Rare", 5000, 3000, 1);
    const [r1, r2] = await Promise.all([sell(U.cais!, [{ productId: rare, qty: 1 }], cash(5000)), sell(U.cais2!, [{ productId: rare, qty: 1 }], cash(5000))]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]); expect(stockOfProduct(rare)).toBe(0); expect(st.rows("sales").filter((s) => JSON.stringify(s.lines).includes(rare)).length).toBe(1);
    expect(JSON.stringify([r1.body, r2.body])).toContain("Stock insuffisant");
  });
  it("même clientId envoyé deux fois en parallèle : une seule vente, une seule sortie de stock, une seule écriture au journal", async () => {
    const clientId = cid(); const mkc = () => call(U.cais!, "checkout", { clientId, lines: [{ productId: eau, qty: 3 }], payments: cash(1500) });
    const r = await Promise.all([mkc(), mkc(), mkc()]); expect(r.every((x) => x.status === 200)).toBe(true); expect(st.rows("sales").length).toBe(1); expect(stockOfProduct(eau)).toBe(97); expect(st.rows("finance_ledger").filter((l) => l.kind === "sale").length).toBe(1);
  });
  it("dix ventes simultanées sur 5 unités : 5 réussissent, 5 échouent proprement", async () => {
    const x = await mk("Cinq", 100, 50, 5); const r = await Promise.all(Array.from({ length: 10 }, (_, i) => sell(i % 2 ? U.cais! : U.cais2!, [{ productId: x, qty: 1 }], cash(100))));
    expect(r.filter((y) => y.status === 200).length).toBe(5); expect(r.filter((y) => y.status === 409).length).toBe(5); expect(stockOfProduct(x)).toBe(0);
  });
  it("référence de paiement : une transaction ne paie qu'UNE vente (même en parallèle)", async () => {
    const pay = [{ method: "card", amount: 500, reference: "TPE-12345" }]; await ok(sell(U.cais!, [{ productId: eau, qty: 1 }], pay));
    const e = await err(sell(U.cais2!, [{ productId: eau, qty: 1 }], pay), 409); expect(e).toContain("doublon"); expect(stockOfProduct(eau)).toBe(99);
    const pay2 = [{ method: "wave", amount: 500, reference: "WV-777777" }]; const r = await Promise.all([sell(U.cais!, [{ productId: eau, qty: 1 }], pay2), sell(U.cais2!, [{ productId: eau, qty: 1 }], pay2)]); expect([r[0]!.status, r[1]!.status].sort()).toEqual([200, 409]); expect(stockOfProduct(eau)).toBe(98);
    await err(sell(U.cais!, [{ productId: eau, qty: 2 }], [{ method: "card", amount: 500, reference: "DUP-1" }, { method: "card", amount: 500, reference: "dup-1" }]), 400, "deux fois");
  });
});

describe("atomicité", () => {
  it("panne au milieu de la transaction : ni vente, ni stock, ni journal, ni référence, ni rang — et la même vente rejouée aboutit", async () => {
    const clientId = cid(); const body = { clientId, lines: [{ productId: eau, qty: 2 }], payments: [{ method: "card", amount: 1000, reference: "TPE-ATOM1" }] }; st.failBatchAfter = 3;
    const r = await call(U.cais!, "checkout", body); expect(r.status).toBeGreaterThanOrEqual(500); expect(st.rows("sales").length).toBe(0); expect(stockOfProduct(eau)).toBe(100); expect(st.rows("finance_ledger").length).toBe(0); expect(st.rows("payment_refs").length).toBe(0); expect(st.rows("journal_entries").length).toBe(0);
    await ok(call(U.cais!, "checkout", body)); expect(st.rows("sales").length).toBe(1); expect(stockOfProduct(eau)).toBe(98); expect(st.rows("finance_ledger").length).toBe(1);
  });
});

describe("droits distincts et approbations hiérarchiques", () => {
  it("remise manuelle : le caissier est bloqué avec une demande d'approbation ; le responsable l'accorde ; elle ne sert qu'une fois et seulement pour ce panier", async () => {
    const lines = [{ productId: jus, qty: 2, discountPct: 10 }]; const e = await err(sell(U.cais!, lines, cash(1800)), 403, "APPROBATION_REQUISE:discount:"); const fp = /discount:([0-9a-f]+)/.exec(e)![1]!;
    const a = await ok(call(U.cais!, "approval.request", { kind: "discount", refId: fp, amount: 200, details: { motif: "client fidèle" } }));
    await err(call(U.cais!, "approval.decide", { id: a.id, approve: true }), 403); await err(sell(U.cais!, lines, cash(1800), { approvals: { discount: a.id } }), 409, "non accordée");
    expect((await ok(call(U.cais!, "approval.list", {}))).approvals[0].status).toBe("pending"); const list = await ok(call(U.ger!, "approval.list", { status: "pending" })); expect(list.canDecide).toBe(true); expect(list.approvals.length).toBe(1);
    await ok(call(U.ger!, "approval.decide", { id: a.id, approve: true, note: "OK" })); await err(call(U.ger!, "approval.decide", { id: a.id, approve: true }), 409, "déjà traitée");
    await err(sell(U.cais2!, lines, cash(1800), { approvals: { discount: a.id } }), 403, "autre vendeur"); await err(sell(U.cais!, [{ productId: jus, qty: 3, discountPct: 10 }], cash(2700), { approvals: { discount: a.id } }), 409, "autre panier");
    await ok(sell(U.cais!, lines, cash(1800), { approvals: { discount: a.id } })); await err(sell(U.cais!, lines, cash(1800), { approvals: { discount: a.id } }), 409, "déjà utilisée");
    expect(st.rows("sales").length).toBe(1); expect(Number(st.rows("sales")[0]!.total)).toBe(1800);
  });
  it("un responsable ne valide pas sa propre demande ; une approbation expirée est refusée", async () => {
    const a = await ok(call(U.ger!, "approval.request", { kind: "discount", details: {} })); await err(call(U.ger!, "approval.decide", { id: a.id, approve: true }), 403, "propre demande"); await ok(call(U.ger2!, "approval.decide", { id: a.id, approve: false, note: "non" }));
    const b = await ok(call(U.cais!, "approval.request", { kind: "discount", details: {} })); st.rows("pos_approvals").find((r) => r.$id === b.id)!.expiresAt = new Date(Date.now() - 1000).toISOString(); await err(call(U.ger!, "approval.decide", { id: b.id, approve: true }), 409, "expirée");
  });
  it("le propriétaire fixe les droits d'un employé : remise accordée sans approbation ; droit inconnu refusé ; réservé au propriétaire", async () => {
    await err(call(U.ger!, "staff.rights", { userId: U.cais!, rights: ["discount"] }), 403); await err(call("own", "staff.rights", { userId: U.cais!, rights: ["voler"] }), 400);
    await ok(call("own", "staff.rights", { userId: U.cais!, rights: ["open", "close", "discount"] })); expect((await ok(call(U.cais!, "my.rights"))).rights).toEqual(["open", "close", "discount"]);
    await ok(sell(U.cais!, [{ productId: jus, qty: 1, discountPct: 5 }], cash(950))); await err(call(U.cais!, "sale.refund", { returnId: "rt-pp-00001", saleId: st.rows("sales")[0]!.$id, kind: "cancel", reason: "Erreur", refunds: [{ method: "cash", amount: 950 }] }), 403, "APPROBATION_REQUISE");
    await ok(call("own", "staff.rights", { userId: U.cais!, rights: ["cancel", "open"] })); await ok(call(U.cais!, "sale.refund", { returnId: "rt-pp-00002", saleId: st.rows("sales")[0]!.$id, kind: "cancel", reason: "Erreur de saisie", refunds: [{ method: "cash", amount: 950 }] }));
    await err(call(U.cais!, "cash.close", { counted: 0 }), 403, "Droit manquant"); // « fermer » retiré
  });
  it("remboursement : approbation d'un responsable permet à un caissier sans droit de rembourser — une fois", async () => {
    const s = await ok(sell(U.cais!, [{ productId: eau, qty: 2 }], cash(1000))); const sale = st.rows("sales").find((x) => x.$id === s.saleId)!; const body = { saleId: sale.$id, kind: "refund", lines: [{ index: 0, qty: 1 }], reason: "Article abîmé", refunds: [{ method: "cash", amount: 500 }] };
    await err(call(U.cais!, "sale.refund", { ...body, returnId: "rt-pp-00010" }), 403, "APPROBATION_REQUISE:refund"); const a = await ok(call(U.cais!, "approval.request", { kind: "refund", refId: sale.$id, amount: 500, details: {} })); await ok(call(U.ger!, "approval.decide", { id: a.id, approve: true }));
    await ok(call(U.cais!, "sale.refund", { ...body, returnId: "rt-pp-00011", approvalId: a.id })); await err(call(U.cais!, "sale.refund", { ...body, returnId: "rt-pp-00012", approvalId: a.id }), 409, "déjà utilisée");
  });
});

describe("protection des marges", () => {
  it("vente sous le coût ou sous le seuil : bloquée pour un caissier (approbation), autorisée pour un responsable avec droit « valider » ; simulation sans écriture", async () => {
    await ok(call("own", "shop.save", { minMarginPct: 20 })); const cheap = await mk("Soldé", 400, 300, 10); // marge 25 % : correcte
    await ok(sell(U.cais!, [{ productId: cheap, qty: 1 }], cash(400)));
    // jus 1000, coût 600 : remise 50 % → 500 < coût 600 ; remise manuelle d'abord autorisée par le droit
    await ok(call("own", "staff.rights", { userId: U.cais!, rights: ["open", "close", "discount"] })); const lines = [{ productId: jus, qty: 1, discountPct: 50 }];
    const before = st.rows("sales").length; const sim = await ok(call(U.cais!, "pos.simulate", { lines })); expect(sim.ok).toBe(true); expect(sim.alerts.map((a: any) => a.code)).toContain("below_cost"); expect(sim.alerts[0].level).toBe("block"); expect(sim.margin.alerts[0].marginPct).toBeLessThan(0); expect(st.rows("sales").length).toBe(before); expect(stockOfProduct(jus)).toBe(100);
    const e = await err(sell(U.cais!, lines, cash(500)), 403, "APPROBATION_REQUISE:margin"); const fp = /margin:([0-9a-f]+)/.exec(e)![1]!; expect(fp).toBe(sim.fp);
    const a = await ok(call(U.cais!, "approval.request", { kind: "margin", refId: fp, details: {} })); await ok(call(U.ger!, "approval.decide", { id: a.id, approve: true })); await ok(sell(U.cais!, lines, cash(500), { approvals: { margin: a.id } }));
    await ok(sell(U.ger!, lines, cash(500))); // le responsable porte le droit « valider » : pas d'approbation, mais l'opération reste tracée
    expect(st.rows("sales").length).toBe(before + 2);
  });
  it("marge sous le seuil (sans être sous le coût) : alerte non bloquante pour qui a le droit, bloquante sinon ; coût inconnu : aucune alerte inventée", async () => {
    await ok(call("own", "shop.save", { minMarginPct: 50 })); const nocost = await mk("SansCoût", 100, 0, 10);
    const s = await ok(call(U.cais!, "pos.simulate", { lines: [{ productId: eau, qty: 1 }, { productId: nocost, qty: 1 }] })); expect(s.margin.alerts.map((a: any) => a.name)).toEqual(["Eau"]); expect(s.margin.alerts[0].level).toBe("low_margin"); expect(s.needsApproval.margin).toBe(true);
    const m = await ok(call(U.ger!, "pos.simulate", { lines: [{ productId: eau, qty: 1 }] })); expect(m.needsApproval.margin).toBe(false); expect(m.alerts[0].level).toBe("warn");
  });
  it("simulation : stock insuffisant remonté comme alerte bloquante, rien n'est écrit", async () => {
    const r = await ok(call(U.cais!, "pos.simulate", { lines: [{ productId: eau, qty: 500 }] })); expect(r.ok).toBe(false); expect(r.alerts[0].message).toContain("Stock insuffisant"); expect(st.rows("sales").length).toBe(0);
  });
});

describe("bons d'achat et avoirs", () => {
  it("remboursement en avoir : bon créé une seule fois (rejeu), utilisable à la caisse, solde décrémenté, titulaire respecté, jamais dépensé deux fois", async () => {
    const cu = (await ok(call("own", "entity.save", { table: "customers", data: { name: "Awa" } }))).id as string; const s = await ok(sell(U.ger!, [{ productId: jus, qty: 2 }], cash(2000), { customerId: cu })); const body = { returnId: "rt-pp-00020", saleId: s.saleId, kind: "cancel", reason: "Client mécontent", refunds: [{ method: "voucher", amount: 2000 }] };
    await err(call(U.ger!, "sale.refund", { ...body, refunds: [{ method: "cash", amount: 2000 }, { method: "voucher", amount: 0 }] }), 400); await ok(call(U.ger!, "sale.refund", { ...body })); await ok(call(U.ger!, "sale.refund", { ...body })); // rejeu
    const vs = st.rows("customer_vouchers"); expect(vs.length).toBe(1); const code = String(vs[0]!.code); expect(Number(vs[0]!.amount)).toBe(2000);
    const chk = await ok(call(U.cais!, "voucher.check", { code, customerId: cu })); expect(chk).toMatchObject({ balance: 2000, usable: true }); expect((await ok(call(U.cais!, "voucher.check", { code }))).usable).toBe(false); // nominatif
    await err(sell(U.cais!, [{ productId: jus, qty: 1 }], [{ method: "voucher", amount: 1000, reference: code }]), 409, "titulaire");
    await ok(sell(U.cais!, [{ productId: jus, qty: 1 }], [{ method: "voucher", amount: 1000, reference: code }], { customerId: cu })); expect((await ok(call(U.cais!, "voucher.check", { code, customerId: cu }))).balance).toBe(1000);
    await err(sell(U.cais!, [{ productId: jus, qty: 2 }], [{ method: "voucher", amount: 2000, reference: code }], { customerId: cu }), 409, "Solde du bon insuffisant");
    const r = await Promise.all([sell(U.cais!, [{ productId: jus, qty: 1 }], [{ method: "voucher", amount: 1000, reference: code }], { customerId: cu }), sell(U.cais2!, [{ productId: jus, qty: 1 }], [{ method: "voucher", amount: 1000, reference: code }], { customerId: cu })]);
    expect(r.map((x) => x.status).sort()).toEqual([200, 409]); expect((await ok(call(U.cais!, "voucher.check", { code, customerId: cu }))).usable).toBe(false); await err(call(U.cais!, "voucher.check", { code: "AV-INCONNU" }), 404);
  });
});

describe("journal financier immuable", () => {
  it("chaque vente, remboursement, ouverture/fermeture et mouvement écrit une entrée ; le contrôle détecte une altération et une entrée orpheline", async () => {
    await ok(call(U.cais!, "cash.open", { openingFloat: 1000, register: "Caisse 1" })); const s = await ok(sell(U.cais!, [{ productId: eau, qty: 2 }], cash(1000))); await ok(call(U.ger!, "sale.refund", { returnId: "rt-pp-00030", saleId: s.saleId, kind: "cancel", reason: "Erreur", refunds: [{ method: "cash", amount: 1000 }] }));
    await ok(call(U.cais!, "cash.close", { counted: 1000 })); const kinds = st.rows("finance_ledger").map((l) => l.kind).sort(); expect(kinds).toEqual(["cancel", "sale", "session_close", "session_open"]);
    expect((await ok(call(U.ger!, "ledger.verify", {}))).ok).toBe(false); // vente annulée : n'est plus « paid » → écriture de vente sans vente terminée
    const s2 = await ok(sell(U.cais2!, [{ productId: jus, qty: 1 }], cash(1000))); void s2; const v = await ok(call("own", "ledger.verify", {})); expect(v.tampered).toEqual([]);
    const led = st.rows("finance_ledger").find((l) => l.kind === "sale" && Number(l.amount) === 1000 && String(l.payload).includes(s2.saleId))!; led.amount = 1; const v2 = await ok(call("own", "ledger.verify", {})); expect(v2.ok).toBe(false); expect(v2.tampered.length).toBe(1);
    await err(call(U.cais!, "ledger.verify", {}), 403);
  });
});

describe("multi-caisses, transfert, écarts, performance", () => {
  it("deux caisses ouvertes en même temps par deux vendeurs ; même caisse refusée (même en parallèle) ; droit d'ouverture exigé", async () => {
    await ok(call("own", "staff.rights", { userId: U.cais2!, rights: ["close"] })); await err(call(U.cais2!, "cash.open", { openingFloat: 0, register: "Caisse 2" }), 403, "Droit manquant");
    await ok(call(U.cais!, "cash.open", { openingFloat: 1000, register: "Caisse 1" })); await ok(call(U.ger!, "cash.open", { openingFloat: 500, register: "Caisse 2" })); await err(call(U.ger2!, "cash.open", { openingFloat: 0, register: "caisse 1" }), 409, "déjà ouverte");
    const r = await Promise.all([call(U.ger2!, "cash.open", { openingFloat: 0, register: "Caisse 3" }), call("own", "cash.open", { openingFloat: 0, register: "Caisse 3" })]); expect(r.map((x) => x.status).sort()).toEqual([200, 409]);
    await ok(sell(U.cais!, [{ productId: eau, qty: 1 }], cash(500))); await ok(sell(U.ger!, [{ productId: pain, qty: 2 }], cash(400))); expect((await ok(call(U.cais!, "cash.current"))).totals.sales.total).toBe(500); expect((await ok(call(U.ger!, "cash.current"))).totals.sales.total).toBe(400);
  });
  it("transfert contrôlé : la session sortante est comptée et fermée, la nouvelle s'ouvre au nom du repreneur avec le montant compté ; droit « transférer » exigé", async () => {
    const o = await ok(call(U.cais!, "cash.open", { openingFloat: 1000, register: "Caisse 1" })); await ok(sell(U.cais!, [{ productId: eau, qty: 2 }], cash(1000)));
    await err(call(U.cais!, "cash.handover", { sessionId: o.id, toUserId: U.cais2!, counted: 1900 }), 403, "Droit manquant"); await err(call(U.ger!, "cash.handover", { sessionId: o.id, toUserId: "inconnu", counted: 1900 }), 404);
    const h = await ok(call(U.ger!, "cash.handover", { sessionId: o.id, toUserId: U.cais2!, counted: 1900, note: "relève" })); expect(h.variance).toBe(-100);
    const cur = await ok(call(U.cais2!, "cash.current")); expect(cur.session).toMatchObject({ register: "Caisse 1", openingFloat: 1900, handoverFrom: o.id }); await err(call(U.cais!, "cash.close", { sessionId: o.id, counted: 99 }), 409, "déjà fermée");
    const sess = st.rows("cash_sessions").find((s) => s.$id === o.id)!; expect(sess.status).toBe("closed"); expect(sess.varianceStatus).toBe("pending");
  });
  it("écart de caisse : validation hiérarchique (pas son propre écart), motif de refus, tolérance, correction tracée", async () => {
    await ok(call("own", "shop.save", { varianceTolerance: 50 })); const o1 = await ok(call(U.cais!, "cash.open", { openingFloat: 1000 })); await ok(call(U.cais!, "cash.close", { counted: 980 })); expect(st.rows("cash_sessions").find((s) => s.$id === o1.id)!.varianceStatus).toBe("ok"); // −20 ≤ tolérance
    const o2 = await ok(call(U.ger!, "cash.open", { openingFloat: 1000 })); await ok(call(U.ger!, "cash.close", { counted: 700 })); await err(call(U.ger!, "cash.validate", { sessionId: o2.id }), 403, "propre écart");
    const o3 = await ok(call(U.cais2!, "cash.open", { openingFloat: 1000 })); await ok(call(U.cais2!, "cash.close", { counted: 800 })); await err(call(U.ger!, "cash.validate", { sessionId: o3.id, approve: false }), 400, "Motif"); await ok(call(U.ger!, "cash.validate", { sessionId: o3.id, approve: true, note: "recompté" })); await err(call(U.ger!, "cash.validate", { sessionId: o3.id }), 409, "déjà traité");
    await ok(call("own", "cash.validate", { sessionId: o2.id, approve: true })); await err(call(U.cais!, "cash.correct", { sessionId: o3.id, counted: 1000, reason: "erreur de comptage" }), 403);
    const c = await ok(call(U.ger!, "cash.correct", { sessionId: o3.id, counted: 1000, reason: "erreur de comptage" })); expect(c.variance).toBe(0); expect(st.rows("finance_ledger").filter((l) => l.kind === "correction").length).toBe(1); await err(call(U.ger!, "cash.correct", { sessionId: o3.id, counted: 1000, reason: "encore" }), 400);
  });
  it("performance par caisse, vendeur et boutique (chiffres réels) ; le propriétaire compare ses boutiques, le responsable voit la sienne", async () => {
    await ok(call(U.cais!, "cash.open", { openingFloat: 0, register: "Caisse 1" })); await ok(sell(U.cais!, [{ productId: eau, qty: 4 }], cash(2000))); await ok(sell(U.cais!, [{ productId: jus, qty: 1 }], cash(1000)));
    const p = await ok(call("own", "cash.performance", {})); expect(p.shops.length).toBe(2); expect(p.shops.find((s: any) => s.shop === "Dakar")).toMatchObject({ sales: 2, total: 3000, avgBasket: 1500 }); expect(p.sellers[0]).toMatchObject({ seller: "cais", count: 2, total: 3000 }); expect(p.registers[0]).toMatchObject({ register: "Caisse 1", salesTotal: 3000 });
    expect((await ok(call(U.ger!, "cash.performance", {}))).shops.length).toBe(1); await err(call(U.cais!, "cash.performance", {}), 403);
  });
});

describe("suggestions, intelligence et profil client", () => {
  const history = async (n: number, extra: boolean) => { for (let i = 0; i < n; i++) await ok(sell("own", [{ productId: eau, qty: 1 }, ...(extra ? [{ productId: pain, qty: 1 }] : [])], cash(extra ? 700 : 500))); };
  it("vente croisée : seulement à partir de 3 ventes réelles, avec le nombre de ventes ; jamais d'article sans stock ; quantité habituelle ≥ 5 ventes", async () => {
    await history(2, true); expect((await ok(call(U.cais!, "pos.suggest", { productIds: [eau] }))).items).toEqual([]); await history(3, true);
    const r = await ok(call(U.cais!, "pos.suggest", { productIds: [eau] })); expect(r.items[0]).toMatchObject({ productId: pain, count: 5, of: 5, pct: 100 }); expect(r.items[0].reason).toContain("5 ventes sur 5"); expect(r.basedOn.sales).toBe(5); expect(r.quantities[0]).toMatchObject({ productId: eau, typicalQty: 1, sales: 5 });
    await ok(sell("own", [{ productId: pain, qty: stockOfProduct(pain) }], cash(200 * stockOfProduct(pain)))); expect(stockOfProduct(pain)).toBe(0);
    expect((await ok(call(U.cais!, "pos.suggest", { productIds: [eau] }))).items.find((x: any) => x.productId === pain)).toBeUndefined();
  });
  it("sans panier : les plus vendus du mois (≥ 3 ventes), sinon rien ; habitudes d'un client", async () => {
    expect((await ok(call(U.cais!, "pos.suggest", {}))).items).toEqual([]); await history(3, false); const r = await ok(call(U.cais!, "pos.suggest", {})); expect(r.items[0].productId).toBe(eau); expect(r.items[0].reason).toContain("3 ventes en 30 jours");
    const cu = (await ok(call("own", "entity.save", { table: "customers", data: { name: "Awa" } }))).id as string; for (let i = 0; i < 2; i++) await ok(sell("own", [{ productId: jus, qty: 1 }], cash(1000), { customerId: cu })); const f = await ok(call(U.cais!, "pos.suggest", { customerId: cu })); expect(f.items[0]).toMatchObject({ productId: jus, count: 2 }); expect(f.items[0].reason).toContain("Habitude de ce client");
  });
  it("insights : chiffres exacts, anomalie de remise d'un vendeur expliquée, prévision avec méthode et fiabilité, droit « valider » exigé", async () => {
    await ok(call("own", "staff.rights", { userId: U.cais2!, rights: ["open", "close", "discount"] })); for (let i = 0; i < 6; i++) await ok(sell(U.cais!, [{ productId: jus, qty: 1 }], cash(1000))); for (let i = 0; i < 6; i++) await ok(sell(U.cais2!, [{ productId: jus, qty: 1, discountPct: 10 }], cash(900)));
    const r = await ok(call(U.ger!, "pos.insights", { days: 30 })); expect(r.totals).toMatchObject({ sales: 12, revenue: 6000 + 5400, avgBasket: 950, discount: 600, discountRate: 5 }); expect(r.totals.estimatedMargin).toBe(6000 + 5400 - 12 * 600); expect(r.totals.marginCoveragePct).toBe(100);
    expect(r.sellers.find((s: any) => s.seller === "cais2")).toMatchObject({ count: 6, total: 5400, discountRate: 10 }); expect(r.anomalies.map((a: any) => a.code)).toContain("seller_discount"); expect(r.anomalies.find((a: any) => a.code === "seller_discount").basis).toContain("6 ventes");
    expect(r.topItems[0]).toMatchObject({ name: "Jus", qty: 12 }); expect(r.forecast.days.length).toBe(7); expect(r.forecast.method).toContain("mêmes jours"); expect(["faible", "moyenne", "élevée"]).toContain(r.forecast.days[0].reliability); expect(r.forecast.limits).toContain("indicatif");
    expect(r.busyHours.reduce((a: number, h: any) => a + h.sales, 0)).toBe(12); await err(call(U.cais!, "pos.insights", {}), 403);
  });
  it("profil client : historique et statistiques réels ; crédit affiché seulement si une limite est accordée ; client d'une autre boutique introuvable", async () => {
    const a = (await ok(call("own", "entity.save", { table: "customers", data: { name: "Awa" } }))).id as string; const b = (await ok(call("own", "entity.save", { table: "customers", data: { name: "Moussa", creditLimit: 50000 } }))).id as string;
    for (let i = 0; i < 4; i++) await ok(sell("own", [{ productId: eau, qty: 2 }], cash(1000), { customerId: a }));
    const p = await ok(call(U.cais!, "customer.profile", { customerId: a })); expect(p.stats).toMatchObject({ purchases: 4, total: 4000, avgBasket: 1000, last90: 4 }); expect(p.regular).toBe(true); expect(p.credit).toBeUndefined(); expect(p.topItems[0]).toMatchObject({ name: "Eau", times: 4, qty: 8 }); expect(p.history.length).toBe(4);
    expect((await ok(call(U.cais!, "customer.profile", { customerId: b }))).credit).toMatchObject({ limit: 50000, balance: 0, available: 50000 }); await err(call("own", "customer.profile", { customerId: a }, B), 404);
  });
});

describe("ticket vérifiable (QR)", () => {
  it("le code du ticket se vérifie ; un montant falsifié, un autre commerce ou un code illisible échouent", async () => {
    const r = await ok(sell(U.cais!, [{ productId: eau, qty: 2 }], cash(1000))); expect(r.verifyCode).toMatch(/^DMP1\./); const g = await ok(call(U.cais!, "sale.get", { saleId: r.saleId })); expect(g.verifyCode).toBe(r.verifyCode);
    expect(await ok(call(U.cais!, "sale.verify", { code: r.verifyCode }))).toMatchObject({ authentic: true, total: 1000 }); const parts = r.verifyCode.split("."); expect((await ok(call(U.cais!, "sale.verify", { code: `${parts[0]}.${parts[1]}.9999.${parts[3]}` }))).authentic).toBe(false);
    expect((await ok(call("own2", "sale.verify", { code: r.verifyCode }, X, T2))).authentic).toBe(false); expect((await ok(call(U.cais!, "sale.verify", { code: "n'importe quoi" }))).authentic).toBe(false);
  });
});
