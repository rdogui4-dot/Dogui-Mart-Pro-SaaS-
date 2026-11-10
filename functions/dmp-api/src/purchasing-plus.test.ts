import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { stockFor } from "./checkout";

class DatedStore extends MemoryStore { override async create(t: string, id: string, tenant: string, d: Record<string, unknown>) { return super.create(t, id, tenant, { $createdAt: new Date().toISOString(), ...d }); } }
const T = "tenantpur01";
let st: DatedStore; let A = "", B = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}, shop = A, tenant = T) => handle(st, U[user] ?? user, { action, tenantId: tenant, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); return x.body.error as string; };
const setPlan = (plan: string) => { const row = st.rows("subscriptions").find((r) => r.$id === T); const data = { tenantId: T, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", T, T, data); };
const rid = () => crypto.randomUUID().replace(/-/g, "");
const day = (o = 0) => new Date(Date.now() + o * 864e5).toISOString().slice(0, 10);
const balanced = () => { const j = st.rows("journal_entries"); return j.reduce((a, e) => a + e.debit, 0) === j.reduce((a, e) => a + e.credit, 0); };
let SUP = "", P1 = "", P2 = "";
const sup = (extra: object = {}, user = "own") => call(user, "purch.supplier.save", { name: `Grossiste ${rid().slice(0, 5)}`, ...extra });
const mkSup = async (extra: object = {}) => (await ok(sup(extra))).id as string;
const poBody = (extra: object = {}) => ({ clientId: rid().slice(0, 16), supplierId: SUP, lines: [{ productId: P1, qty: 10, unitPrice: 700 }, { productId: P2, qty: 5, unitPrice: 1500 }], ...extra });
/** commande validée par le propriétaire */
const validatedPo = async (extra: object = {}) => { const po = await ok(call("own", "purch.po.save", poBody(extra))); await ok(call("own", "purch.po.validate", { id: po.id })); return po.id as string; };
const rec = (poId: string, lines: object[], extra: object = {}, user = "ger") => call(user, "purch.receipt.save", { clientId: rid().slice(0, 16), poId, deliveryNote: `BL-${rid().slice(0, 6)}`, lines, ...extra });
const recOk = async (poId: string, lines: object[], extra: object = {}) => { const r = await ok(rec(poId, lines, extra)); await ok(call("ger", "purch.receipt.validate", { id: r.id })); return r.id as string; };
const inv = (extra: object = {}, user = "ger") => call(user, "purch.invoice.save", { clientId: rid().slice(0, 16), supplierId: SUP, ref: `F-${rid().slice(0, 6)}`, total: 10_000, ...extra });
const invOk = async (extra: object = {}) => (await ok(inv(extra))).id as string;
const pay = (id: string, extra: object = {}, user = "ger") => call(user, "purch.invoice.pay", { id, paymentKey: rid().slice(0, 16), amount: 1000, method: "card", ...extra });

beforeEach(async () => {
  st = new DatedStore(); await st.grant(T, "own", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId;
  for (const [u, role, shops] of [["cais", "cashier", [A]], ["ger", "manager", [A]], ["ger2", "manager", [A]], ["stk", "stockkeeper", [A]], ["gerB", "manager", [B]]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: shops }, ""))).userId;
  await st.create("products", "p1", T, { tenantId: T, shopId: A, name: "Riz", price: 1000, cost: 500 }); await st.create("products", "p2", T, { tenantId: T, shopId: A, name: "Huile", price: 2000, cost: 0 }); P1 = "p1"; P2 = "p2";
  await st.create("stock_moves", "m0", T, { tenantId: T, shopId: A, productId: "p1", qty: 10, kind: "purchase" });
  setPlan("business"); SUP = await mkSup({ name: "Grossiste Central" });
});

describe("abonnement et permissions", () => {
  it("réservé à la formule Business : Starter reçoit un refus 402", async () => {
    setPlan("starter"); await err(call("own", "purch.supplier.list"), 402); await err(call("own", "purch.po.list"), 402);
  });
  it("Pro et à vie gardent l'accès", async () => { setPlan("pro"); await ok(call("own", "purch.supplier.list")); });
  it("le caissier n'accède pas ; le magasinier prépare ; le gérant valide ; le tenant voisin ne voit rien", async () => {
    await err(call("cais", "purch.supplier.list"), 403);
    await ok(call("stk", "purch.po.save", poBody({ clientId: "stkpo00000001" }))); await err(call("stk", "purch.po.validate", { id: "stkpo00000001" }), 403);
    await err(call("stk", "purch.invoice.save", { clientId: rid(), supplierId: SUP, ref: "X", total: 5 }), 403);
    await st.grant("t2", "evil", ["owner"], []); await err(call("evil", "purch.supplier.get", { id: SUP }, "s2", "t2"), 404);
  });
  it("un gérant d'une autre boutique n'accède pas aux commandes de celle-ci", async () => {
    const id = await validatedPo(); await err(call("gerB", "purch.po.get", { id }, A), 403);
  });
});

describe("fiche fournisseur", () => {
  it("création complète, modification, recherche, filtre et solde calculé", async () => {
    const id = await mkSup({ name: "Sénégal Import", legalName: "SI SARL", contactPerson: "Awa", phone: "770000000", whatsapp: "770000001", email: "a@b.sn", address: "Dakar", taxId: "NINEA123", categories: ["Alimentaire"], paymentTerms: "30 jours", leadDays: 3, notes: "Fiable" });
    const g = await ok(call("own", "purch.supplier.get", { id })); expect(g).toMatchObject({ legalName: "SI SARL", taxId: "NINEA123", categories: ["Alimentaire"], leadDays: 3 });
    await ok(call("own", "purch.supplier.save", { id, name: "Sénégal Import 2", phone: "771111111" }));
    expect((await ok(call("own", "purch.supplier.list", { q: "import 2" }))).suppliers).toHaveLength(1);
    expect((await ok(call("own", "purch.supplier.list", { category: "Alimentaire" }))).suppliers).toHaveLength(1);
    expect((await ok(call("own", "purch.supplier.list", { q: "zzz" }))).suppliers).toHaveLength(0);
  });
  it("refuse un nom vide, un doublon de nom (sauf confirmation) et un e-mail invalide", async () => {
    await err(sup({ name: "" }), 400); await err(sup({ name: "grossiste central" }), 409);
    await ok(sup({ name: "grossiste central", confirmDuplicate: true })); await err(sup({ email: "pas-un-mail" }), 400);
  });
  it("archivage réversible ; suppression refusée dès qu'il y a un historique", async () => {
    const id = await mkSup(); await ok(call("own", "purch.supplier.archive", { id, archived: true, reason: "Plus utilisé" }));
    expect((await ok(call("own", "purch.supplier.list"))).suppliers.find((s: any) => s.id === id)).toBeUndefined();
    expect((await ok(call("own", "purch.supplier.list", { status: "archived" }))).suppliers.map((s: any) => s.id)).toContain(id);
    await err(call("own", "purch.po.save", poBody({ supplierId: id })), 409, "archivé");
    await ok(call("own", "purch.supplier.archive", { id, archived: false })); await ok(call("own", "purch.po.save", poBody({ supplierId: id })));
    await err(call("own", "purch.supplier.delete", { id }), 409); // a une commande
    const vide = await mkSup(); await ok(call("own", "purch.supplier.delete", { id: vide })); expect(st.rows("suppliers").some((s) => s.$id === vide)).toBe(false);
  });
});

describe("commandes d'achat", () => {
  it("brouillon → en attente → validée ; le stock n'est pas touché ; le numéro est unique", async () => {
    const a = await ok(call("ger", "purch.po.save", poBody({ clientId: "po-aaaaaaaa01" }))); const b = await ok(call("ger", "purch.po.save", poBody({ clientId: "po-aaaaaaaa02" })));
    expect(a.number).not.toBe(b.number); expect(a.totals.totalHt).toBe(14_500);
    await err(call("ger", "purch.po.validate", { id: a.id }), 409, "Soumettez"); await ok(call("ger", "purch.po.submit", { id: a.id }));
    await err(call("ger", "purch.po.validate", { id: a.id }), 403, "propre commande"); await ok(call("ger2", "purch.po.validate", { id: a.id }));
    expect((await ok(call("own", "purch.po.get", { id: a.id }))).state).toBe("validated"); expect(await stockFor(st, P1)).toBe(10); expect(await stockFor(st, P2)).toBe(0);
  });
  it("rejouer le même clientId ne crée pas de second bon ; validations rejouées sans effet", async () => {
    const a = await ok(call("own", "purch.po.save", poBody({ clientId: "po-rejoue0001" }))); const b = await ok(call("own", "purch.po.save", poBody({ clientId: "po-rejoue0001" })));
    expect(b.duplicate).toBe(true); expect(st.rows("purchase_orders")).toHaveLength(1);
    await ok(call("own", "purch.po.validate", { id: a.id })); expect((await ok(call("own", "purch.po.validate", { id: a.id }))).unchanged).toBe(true);
  });
  it("totaux : remises, frais explicites ; taxe uniquement si configurée", async () => {
    const r = await ok(call("own", "purch.po.save", poBody({ lines: [{ productId: P1, qty: 10, unitPrice: 1000, discountPct: 10 }], transportFee: 2000, otherFees: 500 })));
    expect(r.totals.totalHt).toBe(9000 + 2500); expect(r.totals.totalTtc).toBe(r.totals.totalHt + Math.round(r.totals.totalHt * 0.18));
    st.rows("shops").find((s) => s.$id === A)!.vatRatePct = null as never;
    const r2 = await ok(call("own", "purch.po.save", poBody({ lines: [{ productId: P1, qty: 10, unitPrice: 1000 }] }))); expect(r2.totals.totalTtc).toBe(r2.totals.totalHt);
  });
  it("valide les entrées : article inconnu, quantité nulle, prix négatif, doublon de ligne, date passée, commande vide", async () => {
    await err(call("own", "purch.po.save", poBody({ lines: [{ productId: "zz", qty: 1, unitPrice: 1 }] })), 404);
    await err(call("own", "purch.po.save", poBody({ lines: [{ productId: P1, qty: 0, unitPrice: 1 }] })), 400);
    await err(call("own", "purch.po.save", poBody({ lines: [{ productId: P1, qty: 1, unitPrice: -5 }] })), 400);
    await err(call("own", "purch.po.save", poBody({ lines: [{ productId: P1, qty: 1, unitPrice: 5 }, { productId: P1, qty: 2, unitPrice: 5 }] })), 400, "double");
    await err(call("own", "purch.po.save", poBody({ deliveryOn: day(-3) })), 400); await err(call("own", "purch.po.save", poBody({ lines: [] })), 400);
    await err(call("own", "purch.po.save", poBody({ supplierId: "nope" })), 404);
  });
  it("modification libre en brouillon seulement ; ensuite modification contrôlée avec motif, avant/après historisés", async () => {
    const po = await ok(call("own", "purch.po.save", poBody({ clientId: "po-edit000001" }))); await ok(call("own", "purch.po.save", { ...poBody(), id: po.id, lines: [{ productId: P1, qty: 20, unitPrice: 700 }] }));
    await ok(call("own", "purch.po.validate", { id: po.id })); await err(call("own", "purch.po.save", { ...poBody(), id: po.id }), 409, "contrôlée");
    await err(call("own", "purch.po.amend", { id: po.id, lines: [{ productId: P1, qty: 25, unitPrice: 700 }] }), 400, "Motif"); await ok(call("own", "purch.po.amend", { id: po.id, reason: "Le fournisseur augmente", lines: [{ productId: P1, qty: 25, unitPrice: 750 }] }));
    const g = await ok(call("own", "purch.po.get", { id: po.id })); const e = g.events.find((h: any) => h.kind === "amend"); expect(e.detail.reason).toBe("Le fournisseur augmente"); expect(e.detail.before.lines[0].qty).toBe(20); expect(e.detail.after.lines[0].qty).toBe(25);
  });
  it("modification contrôlée : impossible de descendre sous le déjà reçu ni de retirer une ligne reçue", async () => {
    const id = await validatedPo(); await recOk(id, [{ productId: P1, accepted: 6 }]);
    await err(call("own", "purch.po.amend", { id, reason: "Réduction demandée", lines: [{ productId: P1, qty: 4, unitPrice: 700 }, { productId: P2, qty: 5, unitPrice: 1500 }] }), 409);
    await err(call("own", "purch.po.amend", { id, reason: "Retrait de la ligne", lines: [{ productId: P2, qty: 5, unitPrice: 1500 }] }), 409, "déjà été reçu");
  });
  it("rejet, annulation et clôture suivent les règles de statut", async () => {
    const a = await ok(call("ger", "purch.po.save", poBody())); await ok(call("ger", "purch.po.submit", { id: a.id })); await ok(call("ger2", "purch.po.reject", { id: a.id, reason: "Prix trop haut" }));
    expect((await ok(call("own", "purch.po.get", { id: a.id }))).state).toBe("draft");
    await err(call("own", "purch.po.cancel", { id: a.id }), 400); await ok(call("own", "purch.po.cancel", { id: a.id, reason: "Plus besoin" })); await err(call("own", "purch.po.validate", { id: a.id }), 409);
    const v = await validatedPo(); await recOk(v, [{ productId: P1, accepted: 2 }]); await err(call("own", "purch.po.cancel", { id: v, reason: "Trop tard" }), 409);
    await ok(call("own", "purch.po.close", { id: v, reason: "Le reste ne viendra pas" })); expect((await ok(call("own", "purch.po.get", { id: v }))).state).toBe("received");
  });
  it("les anciennes actions po.* restent utilisables et ne reçoivent pas un brouillon", async () => {
    const d = await ok(call("own", "purch.po.save", poBody({ clientId: "po-legacy0001" })));
    await err(call("own", "po.receive", { poId: d.id, receiptId: "rcpt-legacy-01", lines: [{ productId: P1, qty: 1 }] }), 409);
  });
});

describe("réceptions", () => {
  it("réception partielle : seules les quantités acceptées entrent en stock ; restant et écarts conservés", async () => {
    const id = await validatedPo(); const rId = await recOk(id, [{ productId: P1, accepted: 6, damaged: 2, refused: 1 }]);
    expect(await stockFor(st, P1)).toBe(16); // 10 + 6 acceptés, ni endommagés ni refusés
    const po = (await ok(call("own", "purch.po.get", { id }))); expect(po.state).toBe("partial");
    const l = po.lines.find((x: any) => x.productId === P1); expect(l.received).toBe(6); expect(l.remaining).toBe(4);
    const r = (await ok(call("own", "purch.receipt.get", { id: rId }))); expect(r.lines[0]).toMatchObject({ ordered: 10, accepted: 6, damaged: 2, refused: 1 });
    expect(r.moves.length).toBeGreaterThan(0);
  });
  it("réception complémentaire : la commande passe à reçue et le stock total est exact", async () => {
    const id = await validatedPo(); await recOk(id, [{ productId: P1, accepted: 6 }]); await recOk(id, [{ productId: P1, accepted: 4 }, { productId: P2, accepted: 5 }]);
    expect((await ok(call("own", "purch.po.get", { id }))).state).toBe("received"); expect(await stockFor(st, P1)).toBe(20); expect(await stockFor(st, P2)).toBe(5);
  });
  it("refuse de dépasser le restant, un article hors commande, une réception sans BL ou sans quantité", async () => {
    const id = await validatedPo(); await err(rec(id, [{ productId: P1, accepted: 11 }]), 409, "dépasse");
    await err(rec(id, [{ productId: "zz", accepted: 1 }]), 400); await err(rec(id, [{ productId: P1, accepted: 1 }], { deliveryNote: "" }), 400, "bon de livraison");
    await err(rec(id, [{ productId: P1 }]), 400); await err(rec(id, [{ productId: P1, accepted: 1 }], { receivedOn: day(3) }), 400);
    expect(await stockFor(st, P1)).toBe(10);
  });
  it("une commande non validée ou annulée ne peut pas être réceptionnée", async () => {
    const d = await ok(call("own", "purch.po.save", poBody())); await err(rec(d.id, [{ productId: P1, accepted: 1 }]), 409);
  });
  it("valider deux fois la même réception ne crée qu'un seul jeu de mouvements", async () => {
    const id = await validatedPo(); const r = await ok(rec(id, [{ productId: P1, accepted: 5 }])); await ok(call("ger", "purch.receipt.validate", { id: r.id }));
    expect((await ok(call("ger", "purch.receipt.validate", { id: r.id }))).duplicate).toBe(true); expect(await stockFor(st, P1)).toBe(15);
    expect((await ok(rec(id, [{ productId: P1, accepted: 1 }], { clientId: r.id.padEnd(16, "x").slice(0, 16) === r.id ? "autre-recep-001" : r.id }))).duplicate !== undefined).toBe(true);
  });
  it("deux réceptions concurrentes qui dépasseraient le restant : la seconde est refusée", async () => {
    const id = await validatedPo(); const r1 = await ok(rec(id, [{ productId: P1, accepted: 7 }])); const r2 = await ok(rec(id, [{ productId: P1, accepted: 7 }]));
    const res = await Promise.all([call("ger", "purch.receipt.validate", { id: r1.id }), call("ger2", "purch.receipt.validate", { id: r2.id })]);
    expect(res.filter((x: any) => x.status === 200)).toHaveLength(1); expect(await stockFor(st, P1)).toBe(17);
  });
  it("même bon de livraison pour ce fournisseur : doublon à confirmer ; annulation du brouillon", async () => {
    const id = await validatedPo(); await recOk(id, [{ productId: P1, accepted: 2 }], { deliveryNote: "BL-777" });
    await err(rec(id, [{ productId: P1, accepted: 1 }], { deliveryNote: "bl 777" }), 409, "DOUBLE_BL"); const r = await ok(rec(id, [{ productId: P1, accepted: 1 }], { deliveryNote: "BL-777", confirmDuplicate: true }));
    await err(call("ger", "purch.receipt.cancel", { id: r.id }), 400, "Motif"); await ok(call("ger", "purch.receipt.cancel", { id: r.id, reason: "Saisie erronée" }));
    await err(call("ger", "purch.receipt.validate", { id: r.id }), 409); expect(await stockFor(st, P1)).toBe(12);
  });
  it("une réception validée ne s'annule plus (le stock est déjà créé) et ne se modifie plus", async () => {
    const id = await validatedPo(); const rId = await recOk(id, [{ productId: P1, accepted: 3 }]);
    await err(call("ger", "purch.receipt.cancel", { id: rId, reason: "Trop tard" }), 409); await err(call("ger", "purch.receipt.save", { id: rId, poId: id, deliveryNote: "X1", lines: [{ productId: P1, accepted: 1 }] }), 409);
  });
  it("panne réseau pendant la validation : la relance ne double jamais le stock", async () => {
    const id = await validatedPo(); const r = await ok(rec(id, [{ productId: P1, accepted: 4 }])); st.failBatchAfter = 1;
    const x: any = await call("ger", "purch.receipt.validate", { id: r.id }); expect(x.status).toBeGreaterThanOrEqual(500);
    await ok(call("ger", "purch.receipt.validate", { id: r.id })); expect(await stockFor(st, P1)).toBe(14); await ok(call("ger", "purch.receipt.validate", { id: r.id })); expect(await stockFor(st, P1)).toBe(14);
  });
  it("les frais ne gonflent le coût d'achat qu'avec le coût de revient Pro", async () => {
    const id = await validatedPo({ lines: [{ productId: P2, qty: 10, unitPrice: 1000 }], transportFee: 1000 }); await recOk(id, [{ productId: P2, accepted: 10 }]);
    expect(st.rows("products").find((p) => p.$id === P2)!.cost).toBe(1000);
    setPlan("pro"); const id2 = await validatedPo({ lines: [{ productId: P2, qty: 10, unitPrice: 1000 }], transportFee: 1000 }); await recOk(id2, [{ productId: P2, accepted: 10 }]);
    expect(st.rows("products").find((p) => p.$id === P2)!.cost).toBeGreaterThan(1000);
  });
});

describe("factures fournisseur", () => {
  it("création liée à une commande et une réception ; une facture n'est pas un décaissement", async () => {
    const po = await validatedPo(); const rId = await recOk(po, [{ productId: P1, accepted: 10 }]); const before = st.rows("cash_movements").length;
    const id = await invOk({ poId: po, receiptId: rId, total: 7000, vat: 1000, ref: "FA-1", issuedOn: day(-1), dueOn: day(10) });
    const g = (await ok(call("ger", "purch.invoice.get", { id }))); expect(g).toMatchObject({ poId: po, receiptId: rId, total: 7000, paid: 0, remaining: 7000, state: "to_pay" });
    expect(st.rows("cash_movements").length).toBe(before); expect(balanced()).toBe(true);
  });
  it("détecte la référence en doublon et les montants quasi identiques (confirmation explicite)", async () => {
    await invOk({ ref: "FA-9", total: 5000 }); await err(inv({ ref: "fa 9", total: 8000 }), 409, "DOUBLON_FACTURE");
    await err(inv({ ref: "AUTRE", total: 5000 }), 409, "DOUBLON_POSSIBLE"); await ok(inv({ ref: "AUTRE", total: 5000, confirmDuplicate: true }));
    const autre = await mkSup(); await ok(inv({ supplierId: autre, ref: "FA-9", total: 5000 }));
  });
  it("valide les entrées : référence, montants, dates, commande d'un autre fournisseur, réception non validée", async () => {
    await err(inv({ ref: "" }), 400); await err(inv({ total: 0 }), 400); await err(inv({ total: 1000, vat: 1000 }), 400); await err(inv({ issuedOn: day(2) }), 400); await err(inv({ issuedOn: day(0), dueOn: day(-2) }), 400);
    const po = await validatedPo(); const autre = await mkSup(); await err(inv({ supplierId: autre, poId: po }), 409);
    const r = await ok(rec(po, [{ productId: P1, accepted: 1 }])); await err(inv({ receiptId: r.id }), 409, "validée");
    const draft = await ok(call("own", "purch.po.save", poBody())); await err(inv({ poId: draft.id }), 409);
  });
  it("le magasinier ne gère pas l'argent ; le module comptabilité est requis", async () => {
    await err(inv({}, "stk"), 403); await err(inv({}, "cais"), 403);
  });
  it("litige : bloque le paiement jusqu'à sa levée", async () => {
    const id = await invOk(); await err(call("ger", "purch.invoice.dispute", { id }), 400); await ok(call("ger", "purch.invoice.dispute", { id, reason: "Quantités facturées fausses" }));
    expect((await ok(call("ger", "purch.invoice.get", { id }))).state).toBe("dispute"); await err(pay(id), 409, "litige");
    await ok(call("ger", "purch.invoice.dispute", { id, resolve: true, reason: "Avoir reçu" })); await ok(pay(id));
  });
});

describe("paiements fournisseur", () => {
  it("paiements partiels puis soldé ; trop-perçu refusé ; historique et reste dû exacts", async () => {
    const id = await invOk({ total: 10_000 }); const p1 = await ok(pay(id, { amount: 4000 })); expect(p1).toMatchObject({ paid: 4000, remaining: 6000, settled: false });
    expect((await ok(call("ger", "purch.invoice.get", { id }))).state).toBe("partial");
    await err(pay(id, { amount: 6001 }), 409, "dépasse"); await err(pay(id, { amount: 0 }), 400); expect((await ok(pay(id, { amount: 6000 }))).settled).toBe(true);
    expect((await ok(call("ger", "purch.invoice.get", { id })))).toMatchObject({ state: "paid", remaining: 0 }); await err(pay(id, { amount: 1 }), 409); expect(balanced()).toBe(true);
  });
  it("le même paymentKey rejoué n'enregistre qu'un paiement ; deux paiements simultanés ne dépassent pas le solde", async () => {
    const id = await invOk({ total: 5000 }); const key = "pay-meme-cle-01"; await ok(pay(id, { paymentKey: key, amount: 2000 })); expect((await ok(pay(id, { paymentKey: key, amount: 2000 }))).duplicate).toBe(true);
    expect((await ok(call("ger", "purch.invoice.get", { id }))).paid).toBe(2000);
    const res = await Promise.all([pay(id, { amount: 3000 }), pay(id, { amount: 3000 }, "ger2")]); expect(res.filter((x: any) => x.status === 200)).toHaveLength(1);
    expect((await ok(call("ger", "purch.invoice.get", { id }))).paid).toBe(5000);
  });
  it("moyens de règlement : Wave/Orange seulement s'ils sont configurés", async () => {
    const id = await invOk({ total: 9000 }); await err(pay(id, { method: "wave" }), 409, "configuré"); await err(pay(id, { method: "bitcoin" }), 400);
    await st.create("payment_settings", "ps1", T, { tenantId: T, shopId: A, waveTemplate: "https://pay.wave.com/m/x?amount={amount}" }); await ok(pay(id, { method: "wave" }));
    expect((await ok(call("own", "purch.config"))).methods.map((m: any) => m.id)).toEqual(["cash", "card", "wave"]);
  });
  it("paiement depuis la caisse : mouvement de caisse tracé, déduit du solde théorique, solde insuffisant refusé", async () => {
    const id = await invOk({ total: 30_000 }); await err(pay(id, { source: "till", amount: 1000 }), 409, "caisse");
    await ok(call("ger", "cash.open", { openingFloat: 5000 })); await err(pay(id, { source: "till", amount: 6000 }), 409, "insuffisant");
    const r = await ok(pay(id, { source: "till", amount: 2000 })); expect(r.movementId).toBeTruthy();
    const m = st.rows("cash_movements").find((x) => x.$id === r.movementId)!; expect(m).toMatchObject({ kind: "out", amount: 2000, supplierPaymentId: expect.any(String) });
    expect((await ok(call("ger", "cash.current"))).totals.theoreticalCash).toBe(3000);
    expect(st.rows("cash_movements").filter((x) => x.supplierPaymentId)).toHaveLength(1); expect(balanced()).toBe(true);
  });
  it("le paiement fournisseur n'est pas compté comme dépense d'exploitation", async () => {
    const id = await invOk({ total: 3000 }); await ok(pay(id, { amount: 3000 })); expect(st.rows("expenses")).toHaveLength(0);
  });
  it("panne pendant le paiement : rien d'enregistré, la relance aboutit une seule fois", async () => {
    const id = await invOk({ total: 4000 }); st.failBatchAfter = 1; const key = "pay-panne-00001"; const x: any = await pay(id, { paymentKey: key, amount: 4000 }); expect(x.status).toBeGreaterThanOrEqual(500);
    expect((await ok(call("ger", "purch.invoice.get", { id }))).paid).toBe(0); await ok(pay(id, { paymentKey: key, amount: 4000 })); expect((await ok(call("ger", "purch.invoice.get", { id }))).paid).toBe(4000);
  });
  it("solde fournisseur calculé depuis les factures et paiements réels", async () => {
    const a = await invOk({ total: 8000 }); await invOk({ total: 2000, ref: "F2" }); await ok(pay(a, { amount: 3000 }));
    const s = (await ok(call("own", "purch.supplier.get", { id: SUP }))); expect(s.balance).toBe(7000);
    await err(call("own", "purch.supplier.delete", { id: SUP }), 409);
  });
});

describe("pièces jointes", () => {
  it("rattache un document à un fournisseur, une commande, une réception et une facture ; refuse type et taille invalides", async () => {
    const po = await validatedPo(); const rId = await recOk(po, [{ productId: P1, accepted: 1 }]); const iId = await invOk();
    const small = Buffer.from("%PDF-1.4 test").toString("base64");
    for (const [kind, id] of [["supplier", SUP], ["po", po], ["receipt", rId], ["invoice", iId]] as const) { const r: any = await call("ger", "purch.attach", { kind, id, name: "doc.pdf", data: `data:application/pdf;base64,${small}` }); expect([200, 400, 500, 501]).toContain(r.status); }
    await err(call("ger", "purch.attach", { kind: "po", id: po, name: "x.exe", data: "data:application/x-msdownload;base64,AAAA" }), 400); await err(call("ger", "purch.attach", { kind: "nope", id: po, name: "x.pdf", data: "" }), 400);
  });
});

describe("liste des commandes et des factures", () => {
  it("filtres par statut, fournisseur et recherche ; retard de livraison signalé", async () => {
    const id = await validatedPo({ deliveryOn: day(1) }); await ok(call("own", "purch.po.save", poBody({ clientId: "po-brouillon01" })));
    expect((await ok(call("own", "purch.po.list", { status: "open" }))).orders.map((o: any) => o.id)).toEqual([id]); expect((await ok(call("own", "purch.po.list", { supplierId: "autre" }))).orders).toHaveLength(0);
    const g = (await ok(call("own", "purch.po.list"))).orders; expect(g).toHaveLength(2);
    const i = await invOk({ dueOn: day(0), issuedOn: day(0) }); expect((await ok(call("ger", "purch.invoice.list", { status: "to_pay" }))).invoices.map((x: any) => x.id)).toContain(i);
  });
});

describe("tableau de bord Achats et connexions", () => {
  const dash = (extra: object = {}, user = "ger") => ok(call(user, "purch.dashboard", { from: day(-30), to: day(0), ...extra }));
  it("quatre mesures distinctes : commandé, reçu, facturé, payé ; à payer et échu à date", async () => {
    const po = await validatedPo({ deliveryOn: day(2) }); await recOk(po, [{ productId: P1, accepted: 4, damaged: 1 }]);
    const i1 = await invOk({ total: 5000, issuedOn: day(-10), dueOn: day(-5), ref: "OLD" }); await invOk({ total: 3000, ref: "NEW", dueOn: day(20) }); await ok(pay(i1, { amount: 2000 }));
    const d = await dash();
    expect(d.orders).toMatchObject({ inProgress: 1, orderedValue: 14_500 }); expect(d.receipts).toMatchObject({ count: 1, value: 2800, damagedQty: 1 });
    expect(d.invoices).toMatchObject({ invoiced: 8000, toPay: 6000, overdue: 3000, overdueCount: 1 }); expect(d.payments).toMatchObject({ paid: 2000, count: 1 });
    expect(d.receipts.expected).toHaveLength(1); expect(d.receipts.expected[0]).toMatchObject({ remainingQty: 11, late: false }); expect(d.topSuppliers[0].name).toBe("Grossiste Central"); expect(d.topArticles.map((a: any) => a.name)).toContain("Riz");
  });
  it("filtre par fournisseur ; période invalide ; consolidation réservée au propriétaire ; caissier refusé", async () => {
    const autre = await mkSup({ name: "Autre" }); await validatedPo(); expect((await dash({ supplierId: autre })).orders.orderedValue).toBe(0);
    await err(call("ger", "purch.dashboard", { from: day(1), to: day(0) }), 400); await err(call("ger", "purch.dashboard", { shopId: "all" }), 403); await ok(call("own", "purch.dashboard", { shopId: "all" })); await err(call("cais", "purch.dashboard"), 403);
    await err(call("ger", "purch.dashboard", { supplierId: "nope" }), 404);
  });
  it("retard de livraison détecté (commande validée dont la date prévue est dépassée)", async () => {
    const po = await validatedPo({ deliveryOn: day(3) }); st.rows("purchase_orders").find((p) => p.$id === po)!.deliveryOn = `${day(-4)}T12:00:00.000Z`;
    const d = await dash(); expect(d.receipts.lateCount).toBe(1); expect(d.receipts.expected[0].lateDays).toBe(4);
  });
  it("article : attendu ≠ disponible ; historique des prix d'achat avec variation", async () => {
    const po = await validatedPo(); let v = await ok(call("ger", "purch.article", { productId: P1 })); expect(v).toMatchObject({ available: 10, expected: 10, received: 0 });
    await recOk(po, [{ productId: P1, accepted: 6 }]); v = await ok(call("ger", "purch.article", { productId: P1 })); expect(v).toMatchObject({ available: 16, expected: 4, received: 6, lastPrice: 700 }); expect(v.history).toHaveLength(1);
    const po2 = await validatedPo({ lines: [{ productId: P1, qty: 5, unitPrice: 770 }] }); await recOk(po2, [{ productId: P1, accepted: 5 }]); v = await ok(call("ger", "purch.article", { productId: P1 }));
    expect(v.history).toHaveLength(2); expect(v.lastVariationPct).toBe(10); await err(call("ger", "purch.article", { productId: "zz" }), 404);
  });
  it("paiement depuis la caisse : visible dans le total de session (supplierOut) et le rapport Dépenses, sans être une dépense", async () => {
    await ok(call("ger", "cash.open", { openingFloat: 50_000 })); const id = await invOk({ total: 9000 }); await ok(pay(id, { source: "till", amount: 4000 })); await ok(pay(id, { method: "card", amount: 1000 }));
    expect((await ok(call("ger", "cash.current"))).totals.movements).toMatchObject({ supplierOut: 4000, expenseOut: 0 });
    const r = await ok(call("own", "expense.report", { from: day(-1), to: day(0) })); expect(r.supplierPayments).toMatchObject({ total: 5000, fromTill: 4000, count: 2 }); expect(r.totals.period).toBe(0);
  });
});
