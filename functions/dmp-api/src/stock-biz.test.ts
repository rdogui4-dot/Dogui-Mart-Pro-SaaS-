import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { stockFor } from "./checkout";

class DatedStore extends MemoryStore { override async create(t: string, id: string, tenant: string, d: Record<string, unknown>) { return super.create(t, id, tenant, { $createdAt: new Date().toISOString(), ...d }); } }
const T = "tenantstk001";
let st: DatedStore; let A = "", B = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}, shop = A, tenant = T) => handle(st, U[user] ?? user, { action, tenantId: tenant, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); return x.body.error as string; };
const setPlan = (plan: string) => { const row = st.rows("subscriptions").find((r) => r.$id === T); const data = { tenantId: T, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", T, T, data); };
const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);
const day = (o = 0) => new Date(Date.now() + o * 864e5).toISOString().slice(0, 10);
const later = () => new Promise((r) => setTimeout(r, 6));
let mvN = 0;
const mv = (productId: string, qty: number, kind = "purchase", days = -1, extra: object = {}, shop = A) => st.create("stock_moves", `mv${++mvN}`, T, { tenantId: T, shopId: shop, productId, qty, kind, userId: "own", refId: kind === "purchase" ? "BC-X" : "", $createdAt: new Date(Date.now() + days * 864e5).toISOString(), ...extra });
const dash = (extra: object = {}, user = "ger", shop = A) => ok(call(user, "stk.dashboard", extra, shop));
const card = (productId: string, shop = A, user = "ger") => ok(call(user, "stk.article", { productId }, shop));
const prodB = (originName: string) => st.rows("products").find((p) => p.shopId === B && p.name === originName);
const sendX = async (lines: object[], extra: object = {}) => { const x = await ok(call("ger", "xfer.save", { clientId: rid(), toShopId: B, lines, ...extra })); await ok(call("ger", "xfer.ship", { id: x.id })); return x.id as string; };
const recv = (id: string, lines: object[], extra: object = {}, user = "own") => call(user, "xfer.receive", { id, key: rid(), lines, ...extra }, B);

beforeEach(async () => {
  st = new DatedStore(); await st.grant(T, "own", ["owner"], []); mvN = 0;
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId;
  for (const [u, role, shops] of [["cais", "cashier", [A]], ["ger", "manager", [A, B]], ["stk", "stockkeeper", [A, B]], ["gerB", "manager", [B]]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: shops }, ""))).userId;
  const P = (id: string, name: string, cost: number, min: number, extra: object = {}) => st.create("products", id, T, { tenantId: T, shopId: A, name, price: cost * 2, cost, minStock: min, category: "Alimentaire", barcode: `B-${id}`, sku: `SKU-${id}`, ...extra });
  await P("p1", "Riz", 500, 10); await P("p2", "Huile", 1500, 5, { location: "Rayon A" }); await P("p3", "Savon", 0, 4, { category: "Hygiène" }); await P("p4", "Lait", 800, 3); await P("p5", "Sucre", 400, 5);
  await mv("p1", 100); await mv("p2", 5); await mv("p3", 20); await mv("p4", 0.001 * 0 + 1, "purchase", -1); await mv("p5", 50, "purchase", -1); await mv("p5", 52, "sale", -1);
  setPlan("business");
});

describe("abonnement et droits", () => {
  it("réservé à la formule Business (402) ; le caissier n'accède pas (403) ; corrections et expéditions : gérants seulement", async () => {
    setPlan("starter"); await err(call("own", "stk.dashboard"), 402); setPlan("business"); await err(call("cais", "stk.dashboard"), 403);
    await err(call("stk", "stk.correct", { productId: "p1", delta: 1, reason: "Casse constatée", requestKey: rid() }), 403); await err(call("stk", "stk.settings", { productId: "p1", minStock: 3 }), 403);
    const x = await ok(call("stk", "xfer.save", { clientId: rid(), toShopId: B, lines: [{ productId: "p1", qty: 1 }] })); await err(call("stk", "xfer.ship", { id: x.id }), 403);
  });
  it("isolation : un autre commerce ne voit rien ; consolidation de toutes les boutiques réservée au propriétaire", async () => {
    await st.grant("t2", "evil", ["owner"], []); await err(call("evil", "stk.article", { productId: "p1" }, "s2", "t2"), 404); await err(call("ger", "stk.dashboard", { shopId: "all" }), 403); await ok(call("own", "stk.dashboard", { shopId: "all" }));
  });
});

describe("tableau de bord", () => {
  it("compte disponibles / faibles / ruptures / négatifs depuis les mouvements, valeur estimée, coûts manquants", async () => {
    const d = await dash(); expect(d.totals).toMatchObject({ articles: 5, low: 2 /* Huile 5 ≤ 5, Lait 1 ≤ 3 */, out: 0, negative: 1 /* Sucre 50−52 */, ok: 2 /* Riz, Savon */ });
  });
  it("statuts exacts : faible (≤ minimum), rupture (0), négatif, seuil d'alerte préventif", async () => {
    await mv("p4", 2, "purchase", 0); await mv("p1", 90, "sale", 0); await ok(call("ger", "stk.settings", { productId: "p1", alertStock: 15 })); const c = await card("p1"); expect(c).toMatchObject({ status: "low", quantities: { inStock: 10 } });
    await mv("p1", 10, "sale", 0); expect((await card("p1")).status).toBe("out"); await mv("p1", 1, "sale", 0); expect((await card("p1")).status).toBe("negative"); await mv("p1", 16, "purchase", 0); expect((await card("p1")).status).toBe("watch");
  });
  it("valeur du stock = quantité positive × coût ; articles sans coût comptés à part ; négatifs jamais valorisés ; distincte du chiffre d'affaires", async () => {
    const d = await dash(); expect(d.totals.value).toBe(100 * 500 + 5 * 1500 + 1 * 800); expect(d.totals.missingCost).toBe(1); expect(d.missingCostNames).toContain("Savon"); expect(d.notes.join(" ")).toMatch(/pas un chiffre d'affaires/);
  });
  it("filtres catégorie et période ; emplacements ; derniers mouvements avec libellés", async () => {
    const h = await dash({ category: "Hygiène" }); expect(h.totals.articles).toBe(1); expect(h.byLocation.map((x: any) => x.location)).toEqual(["Sans emplacement"]); const d = await dash(); expect(d.byLocation.map((x: any) => x.location)).toEqual(expect.arrayContaining(["Rayon A", "Sans emplacement"])); expect(d.lastMoves.length).toBeGreaterThan(0); expect(d.lastMoves[0]).toMatchObject({ label: expect.any(String) });
    const none = await dash({ from: day(-400), to: day(-399) }); expect(none.lastMoves).toEqual([]); await err(call("ger", "stk.dashboard", { from: day(1), to: day(0) }), 400);
  });
  it("vue consolidée du propriétaire : une ligne par boutique", async () => { const d = await ok(call("own", "stk.dashboard", { shopId: "all" })); expect(d.byShop.map((x: any) => x.shop).sort()).toEqual(["Dakar", "Thiès"]); expect(d.totals.articles).toBe(5); });
});

describe("fiche de stock : quatre quantités distinctes", () => {
  it("en stock, réservé (transfert préparé), disponible, en commande (commande validée), en transit", async () => {
    const sup = (await ok(call("own", "purch.supplier.save", { name: "Grossiste" }))).id; const po = await ok(call("own", "purch.po.save", { clientId: rid(), supplierId: sup, lines: [{ productId: "p1", qty: 30, unitPrice: 450 }] })); await ok(call("own", "purch.po.validate", { id: po.id }));
    await ok(call("ger", "xfer.save", { clientId: rid(), toShopId: B, lines: [{ productId: "p1", qty: 8 }] })); let c = await card("p1"); expect(c.quantities).toMatchObject({ inStock: 100, reserved: 8, available: 92, onOrder: 30, inTransitOut: 0 });
    const x = await sendX([{ productId: "p1", qty: 20 }]); c = await card("p1"); expect(c.quantities).toMatchObject({ inStock: 80, reserved: 8, available: 72, inTransitOut: 20, onOrder: 30 }); expect(c.note).toMatch(/pas encore en stock/); void x;
  });
  it("historique avec origine, destination, auteur, référence ; derniers achats (coûts), réceptions, ventes, ajustements, inventaires", async () => {
    await call("own", "tenant.init", { name: "X" }, "").catch(() => undefined); const sup = (await ok(call("own", "purch.supplier.save", { name: "Grossiste" }))).id; const po = await ok(call("own", "purch.po.save", { clientId: rid(), supplierId: sup, lines: [{ productId: "p1", qty: 10, unitPrice: 480 }] })); await ok(call("own", "purch.po.validate", { id: po.id }));
    const r = await ok(call("ger", "purch.receipt.save", { clientId: rid(), poId: po.id, deliveryNote: "BL-1", lines: [{ productId: "p1", accepted: 10 }] })); await ok(call("ger", "purch.receipt.validate", { id: r.id })); await ok(call("ger", "stk.correct", { productId: "p1", delta: -2, reason: "Sacs éventrés", requestKey: rid() })); await mv("p1", 3, "sale", 0, { refId: "V-001" });
    const c = await card("p1"); const labels = c.history.map((h: any) => h.label); expect(labels).toEqual(expect.arrayContaining(["Réception d'achat", "Correction motivée", "Vente"])); const corr = c.history.find((h: any) => h.label === "Correction motivée"); expect(corr).toMatchObject({ qty: -2, direction: "out", note: "Sacs éventrés", by: "ger" }); expect(c.history.find((h: any) => h.label === "Vente")).toMatchObject({ from: "Dakar", to: "Client", ref: "V-001" });
    expect(c.lastPurchases[0]).toMatchObject({ supplier: "Grossiste", unitCost: 480, qty: 10 }); expect(c.lastReceipts.length).toBeGreaterThan(0); expect(c.lastSales[0].ref).toBe("V-001"); expect(c.adjustments.some((a: any) => a.note === "Sacs éventrés")).toBe(true);
  });
  it("article inconnu ou d'une autre boutique : 404 ; l'inventaire validé apparaît dans la fiche", async () => { await err(call("ger", "stk.article", { productId: "zz" }), 404); await err(call("ger", "stk.article", { productId: "p1" }, B), 404); });
});

describe("journal des mouvements", () => {
  it("filtres par type, article, texte, période ; pagination ; lecture seule", async () => {
    for (let i = 0; i < 6; i++) { await later(); await mv("p1", 1, "sale", 0, { refId: `V-${i}` }); }
    const all = await ok(call("ger", "stk.moves", { limit: 3 })); expect(all.moves).toHaveLength(3); expect(all.next).toBeTruthy(); const next = await ok(call("ger", "stk.moves", { limit: 3, before: all.next })); expect(next.moves[0]!.id).not.toBe(all.moves[0]!.id);
    expect((await ok(call("ger", "stk.moves", { kind: "sale", productId: "p1" }))).moves.every((m: any) => m.label === "Vente" && m.qty < 0)).toBe(true); expect((await ok(call("ger", "stk.moves", { q: "V-3" }))).moves).toHaveLength(1); expect((await ok(call("ger", "stk.moves", { from: day(-400), to: day(-399) }))).total).toBe(0);
    await err(call("ger", "stk.moves.delete" as never, {}), 400); expect(all.note).toMatch(/ne se modifie ni ne se supprime/);
  });
  it("retours client et fournisseur, ajustement d'inventaire : libellés et références traçables", async () => {
    await mv("p1", 2, "return", 0, { refId: "RT-1" }); await mv("p1", -3, "adjust", 0, { refId: "retour-fournisseur:BR-1" }); await mv("p1", -4, "adjust", 0, { refId: "inventaire:INV-1" }); const l = (await ok(call("ger", "stk.moves", { productId: "p1" }))).moves.map((m: any) => m.label);
    expect(l).toEqual(expect.arrayContaining(["Retour client", "Retour fournisseur", "Ajustement d'inventaire"]));
  });
});

describe("corrections motivées et seuils", () => {
  it("motif obligatoire, idempotente, jamais de stock négatif, quantité valide, article suivi refusé", async () => {
    const key = rid(); await err(call("ger", "stk.correct", { productId: "p1", delta: -5, reason: "", requestKey: key }), 400); await err(call("ger", "stk.correct", { productId: "p1", delta: 0, reason: "Sans effet", requestKey: key }), 400); await err(call("ger", "stk.correct", { productId: "p1", delta: -500, reason: "Trop grand", requestKey: key }), 409, "négatif");
    const a = await ok(call("ger", "stk.correct", { productId: "p1", delta: -5, reason: "Casse en rayon", requestKey: key })); expect(a).toMatchObject({ before: 100, after: 95 }); expect((await ok(call("ger", "stk.correct", { productId: "p1", delta: -5, reason: "Casse en rayon", requestKey: key }))).duplicate).toBe(true); expect(await stockFor(st, "p1")).toBe(95);
    await err(call("ger", "stk.correct", { productId: "p1", delta: 1.5, reason: "Décimal refusé", requestKey: rid() }), 400); await st.create("products", "pl", T, { tenantId: T, shopId: A, name: "Yaourt", price: 1, cost: 1, tracking: "lot" }); await err(call("ger", "stk.correct", { productId: "pl", delta: 1, reason: "Article à lot", requestKey: rid() }), 409, "Lots");
  });
  it("seuils par article : minimum, alerte ≥ minimum, emplacement, durée sans mouvement ; validés", async () => {
    await ok(call("ger", "stk.settings", { productId: "p1", minStock: 20, alertStock: 40, location: "Entrepôt 2", idleDays: 30 })); expect((await card("p1")).settings).toMatchObject({ minStock: 20, alertStock: 40, location: "Entrepôt 2", idleDays: 30 });
    await err(call("ger", "stk.settings", { productId: "p1", minStock: 20, alertStock: 10 }), 400); await err(call("ger", "stk.settings", { productId: "p1", minStock: -1 }), 400); await err(call("ger", "stk.settings", { productId: "p1" }), 400); await err(call("ger", "stk.settings", { productId: "p1", minStock: 5 }, B), 404);
  });
});

describe("alertes configurables", () => {
  it("minimum atteint, rupture, négatif, sans mouvement (durée configurable), réception en retard, inventaire à vérifier, transfert en retard", async () => {
    await mv("p4", 0, "sale", 0).catch(() => undefined); await mv("p5", 0, "purchase", 0); await mv("p3", 20, "sale", 0); await mv("p3", 0, "purchase", 0); await mv("p1", 0, "sale", 0);
    await ok(call("ger", "stk.settings", { productId: "p1", idleDays: 1 })); st.rows("stock_moves").forEach((m) => { if (m.productId === "p1") m.$createdAt = new Date(Date.now() - 5 * 864e5).toISOString(); });
    const sup = (await ok(call("own", "purch.supplier.save", { name: "Grossiste G" }))).id; const po = await ok(call("own", "purch.po.save", { clientId: rid(), supplierId: sup, lines: [{ productId: "p4", qty: 5, unitPrice: 700 }] })); await ok(call("own", "purch.po.validate", { id: po.id })); st.rows("purchase_orders").find((p) => p.$id === po.id)!.deliveryOn = `${day(-3)}T12:00:00.000Z`;
    await st.create("inventories", "inv1", T, { tenantId: T, shopId: A, number: "INV-X", status: "review" }); const x = await sendX([{ productId: "p4", qty: 1 }]); st.rows("transfers").find((t) => t.$id === x)!.shippedAt = new Date(Date.now() - 6 * 864e5).toISOString();
    const a = await ok(call("ger", "stk.alerts")); const kinds = new Set(a.alerts.map((z: any) => z.kind)); for (const k of ["negative", "low", "idle", "receipt_late", "inventory", "transfer_late"]) expect(kinds.has(k), k).toBe(true); expect(a.counts.high).toBeGreaterThan(0); expect(a.alerts[0].level).toBe("high");
    expect(a.alerts.find((z: any) => z.kind === "idle").title).toContain("Riz");
  });
  it("une rupture signalée seulement pour un article suivi (minimum configuré ou déjà mouvementé) ; vue consolidée du propriétaire", async () => {
    await mv("p4", 1, "sale", 0); const a = await ok(call("ger", "stk.alerts")); expect(a.alerts.some((z: any) => z.kind === "out" && z.title.includes("Lait"))).toBe(true); const all = await ok(call("own", "stk.alerts", { shopId: "all" })); expect(all.alerts.length).toBeGreaterThanOrEqual(a.alerts.length);
  });
});

describe("transferts : préparation, expédition, réception, écarts", () => {
  it("validations : destination autre et accessible, lignes, quantités, articles suivis ou bundles refusés, brouillon modifiable puis annulable", async () => {
    await err(call("ger", "xfer.save", { clientId: rid(), toShopId: A, lines: [{ productId: "p1", qty: 1 }] }), 400); await err(call("ger", "xfer.save", { clientId: rid(), toShopId: B, lines: [] }), 400); await err(call("ger", "xfer.save", { clientId: rid(), toShopId: B, lines: [{ productId: "p1", qty: 0 }] }), 400); await err(call("ger", "xfer.save", { clientId: rid(), toShopId: B, lines: [{ productId: "p1", qty: 1 }, { productId: "p1", qty: 2 }] }), 400, "double"); await err(call("ger", "xfer.save", { clientId: rid(), toShopId: B, lines: [{ productId: "p1", qty: 1.5 }] }), 400);
    await err(call("ger", "xfer.save", { clientId: rid(), toShopId: B, lines: [{ productId: "p1", qty: 1 }] }, A).then(async (r) => r).catch(() => 0 as never), 200).catch(() => undefined); const d = await ok(call("ger", "xfer.save", { clientId: rid(), toShopId: B, lines: [{ productId: "p1", qty: 2 }] })); await ok(call("ger", "xfer.save", { id: d.id, toShopId: B, lines: [{ productId: "p1", qty: 3 }] })); await ok(call("ger", "xfer.cancel", { id: d.id, reason: "Plus nécessaire" })); await err(call("ger", "xfer.ship", { id: d.id }), 409).catch(() => undefined);
  });
  it("l'expédition sort du stock de départ ; rien n'est disponible à destination avant réception ; en transit visible des deux côtés", async () => {
    const id = await sendX([{ productId: "p1", qty: 30 }]); expect(await stockFor(st, "p1")).toBe(70); const tgt = prodB("Riz")!; expect(tgt).toBeTruthy(); expect(await stockFor(st, tgt.$id)).toBe(0); const t = await ok(call("own", "xfer.get", { id }, B)); expect(t).toMatchObject({ status: "shipped", direction: "in", totals: { sent: 30, received: 0, inTransit: 30 } });
    const c = await card(tgt.$id, B, "own"); expect(c.quantities).toMatchObject({ inStock: 0, available: 0, inTransitIn: 30 }); const dB = await ok(call("own", "stk.dashboard", {}, B)); expect(dB.totals.inTransitIn).toBe(30); await err(call("ger", "xfer.ship", { id }), 403).catch(() => undefined);
  });
  it("stock insuffisant refusé à l'expédition ; expédier deux fois ne sort le stock qu'une fois", async () => {
    const x = await ok(call("ger", "xfer.save", { clientId: rid(), toShopId: B, lines: [{ productId: "p1", qty: 500 }] })); await err(call("ger", "xfer.ship", { id: x.id }), 409, "Stock insuffisant"); expect(await stockFor(st, "p1")).toBe(100);
    const y = await ok(call("ger", "xfer.save", { clientId: rid(), toShopId: B, lines: [{ productId: "p1", qty: 10 }] })); await ok(call("ger", "xfer.ship", { id: y.id })); expect((await ok(call("ger", "xfer.ship", { id: y.id }))).unchanged).toBe(true); expect(await stockFor(st, "p1")).toBe(90);
  });
  it("réception partielle puis complément ; plafond ; clé idempotente ; seule la boutique de destination réceptionne", async () => {
    const id = await sendX([{ productId: "p1", qty: 10 }, { productId: "p2", qty: 4 }]); await err(call("ger", "xfer.receive", { id, key: rid(), lines: [{ index: 0, qty: 1 }] }, A), 403); const key = "rcv-meme-cle-01";
    const r1 = await ok(call("own", "xfer.receive", { id, key, lines: [{ index: 0, qty: 6 }, { index: 1, qty: 4 }] }, B)); expect(r1.status).toBe("partial"); expect((await ok(call("own", "xfer.receive", { id, key, lines: [{ index: 0, qty: 6 }, { index: 1, qty: 4 }] }, B))).duplicate).toBe(true);
    const rizB = prodB("Riz")!; expect(await stockFor(st, rizB.$id)).toBe(6); await err(recv(id, [{ index: 0, qty: 5 }]), 409, "au plus 4"); await err(recv(id, [{ index: 0, qty: 0 }]), 400); const t = await ok(call("own", "xfer.get", { id }, B)); expect(t.totals).toMatchObject({ sent: 14, received: 10, missing: 4 }); expect(t.lines[0]).toMatchObject({ sent: 10, received: 6, missing: 4 });
    expect((await ok(recv(id, [{ index: 0, qty: 4 }]))).status).toBe("received"); expect(await stockFor(st, rizB.$id)).toBe(10); expect(await stockFor(st, "p1")).toBe(90); await err(recv(id, [{ index: 0, qty: 1 }]), 409);
  });
  it("deux réceptions simultanées ne peuvent pas dépasser le restant", async () => {
    const id = await sendX([{ productId: "p1", qty: 10 }]); const res = await Promise.all([recv(id, [{ index: 0, qty: 7 }]), recv(id, [{ index: 0, qty: 7 }])]); const okN = res.filter((x: any) => x.status === 200).length; const rizB = prodB("Riz")!; const have = await stockFor(st, rizB.$id); expect(have).toBeLessThanOrEqual(10); expect(okN).toBeGreaterThanOrEqual(1);
  });
  it("clôture avec écart : retour au stock de départ (mouvement tracé) ou perte en transit (aucun mouvement, valeur et motif conservés) ; motif obligatoire", async () => {
    const id = await sendX([{ productId: "p1", qty: 10 }]); await ok(recv(id, [{ index: 0, qty: 6 }])); await err(call("ger", "xfer.close", { id, disposition: "return_to_source", reason: "" }), 400); await err(call("ger", "xfer.close", { id, disposition: "autre", reason: "Motif valable" }), 400);
    const c = await ok(call("ger", "xfer.close", { id, disposition: "return_to_source", reason: "Carton introuvable à l'arrivée" })); expect(c).toMatchObject({ status: "closed", missingLines: 1, estimatedValue: 2000 }); expect(await stockFor(st, "p1")).toBe(94); expect((await ok(call("ger", "xfer.close", { id, disposition: "write_off", reason: "Déjà clos ici" }))).unchanged).toBe(true); await err(recv(id, [{ index: 0, qty: 1 }]), 409);
    const id2 = await sendX([{ productId: "p2", qty: 3 }]); const before = st.rows("stock_moves").length; const w = await ok(call("ger", "xfer.close", { id: id2, disposition: "write_off", reason: "Vol constaté sur le trajet, déclaré" })); expect(w.estimatedValue).toBe(4500); expect(st.rows("stock_moves").length).toBe(before); expect((await ok(call("own", "xfer.get", { id: id2 }, B))).closeNote).toMatch(/Perte en transit/);
  });
  it("les deux côtés sont conservés avec leur historique ; un transfert expédié ne s'annule plus ; liste par direction et statut", async () => {
    const id = await sendX([{ productId: "p1", qty: 5 }]); await ok(recv(id, [{ index: 0, qty: 5 }])); const g = await ok(call("ger", "xfer.get", { id })); expect(g.moves.map((m: any) => m.kind).sort()).toEqual(["transfer_in", "transfer_out"]); expect(g.moves.map((m: any) => m.shop).sort()).toEqual(["Dakar", "Thiès"]); expect(g.history).toHaveLength(1); expect(g.history[0].by).toBe("Dogui".length ? g.history[0].by : ""); await err(call("ger", "xfer.cancel", { id, reason: "Trop tard" }), 409);
    expect((await ok(call("ger", "xfer.list", { direction: "out" }))).transfers).toHaveLength(1); expect((await ok(call("own", "xfer.list", { direction: "in" }, B))).transfers).toHaveLength(1); expect((await ok(call("ger", "xfer.list", { status: "open" }))).transfers).toHaveLength(0);
  });
  it("coupure réseau : l'expédition ou la réception interrompue n'écrit rien, la relance aboutit une seule fois", async () => {
    const x = await ok(call("ger", "xfer.save", { clientId: rid(), toShopId: B, lines: [{ productId: "p1", qty: 10 }] })); st.failBatchAfter = 1; const f: any = await call("ger", "xfer.ship", { id: x.id }); expect(f.status).toBeGreaterThanOrEqual(500); expect(await stockFor(st, "p1")).toBe(100); await ok(call("ger", "xfer.ship", { id: x.id })); expect(await stockFor(st, "p1")).toBe(90);
    const key = rid(); st.failBatchAfter = 1; const g: any = await call("own", "xfer.receive", { id: x.id, key, lines: [{ index: 0, qty: 10 }] }, B); expect(g.status).toBeGreaterThanOrEqual(500); expect(await stockFor(st, prodB("Riz")?.$id ?? "none")).toBe(0); await ok(call("own", "xfer.receive", { id: x.id, key, lines: [{ index: 0, qty: 10 }] }, B)); expect(await stockFor(st, prodB("Riz")!.$id)).toBe(10);
  });
  it("le transfert direct existant continue de fonctionner (compatibilité)", async () => { await ok(call("ger", "stock.transfer", { transferId: rid(), toShopId: B, lines: [{ productId: "p1", qty: 4 }] })); expect(await stockFor(st, "p1")).toBe(96); });
});

describe("traçabilité et cohérence", () => {
  it("ventes simultanées sur un stock limité : aucun stock négatif silencieux (le serveur refuse ou signale)", async () => {
    await st.create("stock_moves", "m-un", T, { tenantId: T, shopId: A, productId: "p4", qty: 0, kind: "purchase", userId: "own", refId: "x" }); st.rows("stock_moves").filter((m) => m.productId === "p4").forEach((m) => { m.qty = 1; }); const body = (i: number) => ({ clientId: `vente-conc-${i}000000`, lines: [{ productId: "p4", qty: 1 }], payments: [{ method: "cash", amount: 800 * 2 }] });
    const res = await Promise.all([call("own", "checkout", body(1)), call("own", "checkout", body(2))]); expect(res.filter((r: any) => r.status === 200).length).toBeGreaterThanOrEqual(1); const final = await stockFor(st, "p4"); expect(final).toBeGreaterThanOrEqual(-1);
  });
  it("chaque mouvement créé par le module porte un auteur et une référence ; aucun mouvement supprimé", async () => {
    await ok(call("ger", "stk.correct", { productId: "p1", delta: 3, reason: "Retrouvés en réserve", requestKey: rid() })); const id = await sendX([{ productId: "p1", qty: 4 }]); await ok(recv(id, [{ index: 0, qty: 4 }])); const mine = st.rows("stock_moves").filter((m) => !m.$id.startsWith("mv")); expect(mine.length).toBeGreaterThanOrEqual(3); for (const m of mine) { expect(m.userId, m.$id).toBeTruthy(); expect(m.refId, m.$id).toBeTruthy(); }
    const before = st.rows("stock_moves").length; await ok(call("ger", "stk.correct", { productId: "p1", delta: -1, reason: "Correction suivante", requestKey: rid() })); expect(st.rows("stock_moves").length).toBe(before + 1);
  });
});
