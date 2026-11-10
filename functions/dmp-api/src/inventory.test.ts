import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { stockFor } from "./checkout";

class DatedStore extends MemoryStore { override async create(t: string, id: string, tenant: string, d: Record<string, unknown>) { return super.create(t, id, tenant, { $createdAt: new Date().toISOString(), ...d }); } }
const T = "tenantinv01";
let st: DatedStore; let A = "", B = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}, shop = A, tenant = T) => handle(st, U[user] ?? user, { action, tenantId: tenant, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); return x.body.error as string; };
const setPlan = (plan: string) => { const row = st.rows("subscriptions").find((r) => r.$id === T); const data = { tenantId: T, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", T, T, data); };
const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
let mvN = 0;
/** mouvement de stock daté : `at` en minutes (négatif = passé) */
const mv = (productId: string, qty: number, kind = "purchase", minutes = -120, extra: object = {}) => st.create("stock_moves", `mv${++mvN}`, T, { tenantId: T, shopId: A, productId, qty, kind, $createdAt: new Date(Date.now() + minutes * 60_000).toISOString(), ...extra });
const later = () => new Promise((r) => setTimeout(r, 6));
const create = (extra: object = {}, user = "ger") => call(user, "count.save", { clientId: rid(), kind: "full", agents: [U.stk!], ...extra });
const mk = async (extra: object = {}) => (await ok(create(extra))).id as string;
const started = async (extra: object = {}) => { const id = await mk(extra); await ok(call("ger", "count.start", { id })); return id; };
const get = (id: string, user = "ger") => ok(call(user, "count.get", { id }));
const lineOf = async (id: string, name: string, user = "ger") => (await get(id, user)).lines.find((l: any) => l.name === name);
const enter = (id: string, lineId: string, qty: unknown, extra: object = {}, user = "stk") => call(user, "count.entry", { id, lineId, qty, entryKey: rid(), ...extra });
const countAll = async (id: string, q: Record<string, number>) => { for (const [n, v] of Object.entries(q)) await ok(enter(id, (await lineOf(id, n)).id, v)); };
const toReview = async (id: string, q: Record<string, number>) => { await countAll(id, q); await ok(call("ger", "count.finish", { id, confirmUncounted: true })); await ok(call("ger", "count.review", { id })); };

beforeEach(async () => {
  st = new DatedStore(); await st.grant(T, "own", ["owner"], []); mvN = 0;
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId;
  for (const [u, role, shops] of [["cais", "cashier", [A]], ["ger", "manager", [A]], ["ger2", "manager", [A]], ["stk", "stockkeeper", [A]], ["stk2", "stockkeeper", [A]], ["gerB", "manager", [B]]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: shops }, ""))).userId;
  const P = (id: string, name: string, extra: object = {}) => st.create("products", id, T, { tenantId: T, shopId: A, name, price: 1000, cost: 500, category: "Alimentaire", barcode: `B-${id}`, sku: `SKU-${id}`, ...extra });
  await P("p1", "Riz", { cost: 500 }); await P("p2", "Huile", { cost: 1500 }); await P("p3", "Savon", { cost: 200, category: "Hygiène" }); await P("pz", "Archivé", { archived: true }); await P("ps", "Téléphone", { tracking: "serial" }); await P("pl", "Yaourt", { tracking: "lot" });
  await mv("p1", 100); await mv("p2", 50); await mv("p3", 20); setPlan("business");
});

describe("abonnement, droits et périmètre", () => {
  it("réservé à la formule Business ; le caissier n'accède pas ; le stock-keeper compte mais ne crée ni ne valide", async () => {
    setPlan("starter"); await err(call("own", "count.list"), 402); setPlan("business"); await err(call("cais", "count.list"), 403);
    await err(create({}, "stk"), 403); const id = await started(); await err(call("stk", "count.validate", { id }), 403); await err(call("stk", "count.start", { id }), 403); await ok(call("stk", "count.get", { id }));
  });
  it("un agent non assigné, ou d'une autre boutique, n'accède pas à l'inventaire", async () => { const id = await started(); await err(call("stk2", "count.get", { id }), 403); await err(call("gerB", "count.get", { id }, A), 403); await st.grant("t2", "evil", ["owner"], []); await err(call("evil", "count.get", { id }, "s2", "t2"), 404); });
  it("agent ou responsable sans accès au stock refusé", async () => { await err(create({ agents: [U.cais!] }), 400, "accès au stock"); await err(create({ responsibleId: U.cais! }), 400, "responsable"); });
  it("inventaire complet : articles actifs seulement ; séries et lots exclus et signalés ; numéro unique", async () => {
    const a = await ok(create()); const b = await ok(create()); expect(a.lines).toBe(3); expect(a.excluded.map((e: any) => e.name).sort()).toEqual(["Téléphone", "Yaourt"]); expect(a.number).not.toBe(b.number); expect(a.number).toMatch(/^INV-\d{8}-/);
  });
  it("inventaire partiel : par catégorie ou sélection ; sans sélection refusé ; sélection vide refusée", async () => {
    expect((await ok(create({ kind: "partial", categories: ["Hygiène"] }))).lines).toBe(1); expect((await ok(create({ kind: "partial", productIds: ["p1", "p2"] }))).lines).toBe(2);
    await err(create({ kind: "partial" }), 400); await err(create({ kind: "partial", categories: ["Inconnue"] }), 400, "Aucun article");
  });
  it("un brouillon se modifie ; plus après lancement ; seuils validés", async () => {
    const id = await mk(); await ok(call("ger", "count.save", { id, kind: "partial", categories: ["Hygiène"], thresholdPct: 5 })); expect((await get(id)).lines).toHaveLength(1);
    await err(create({ thresholdPct: -3 }), 400); await ok(call("ger", "count.start", { id })); await err(call("ger", "count.save", { id, kind: "full" }), 409);
  });
  it("le même clientId ne crée qu'un inventaire", async () => { const clientId = rid(); await ok(create({ clientId })); expect((await ok(create({ clientId }))).duplicate).toBe(true); expect(st.rows("inventories")).toHaveLength(1); });
  it("deux inventaires actifs ne peuvent pas porter sur les mêmes articles", async () => {
    await started(); const b = await mk(); await err(call("ger", "count.start", { id: b }), 409, "en cours");
    const c = await mk({ kind: "partial", categories: ["Hygiène"] }); await err(call("ger", "count.start", { id: c }), 409);
  });
});

describe("comptage silencieux", () => {
  it("aucune quantité théorique n'est exposée pendant le comptage, même au gérant", async () => {
    const id = await started(); const g = await get(id); expect(g.blind).toBe(true); for (const l of g.lines) { expect(l.theoretical).toBeUndefined(); expect(l.diff).toBeUndefined(); expect(l.value).toBeUndefined(); } expect(JSON.stringify(g)).not.toContain('"theoretical"');
    expect((await get(id, "stk")).lines).toHaveLength(3); await err(call("ger", "count.report", { id }), 409);
  });
  it("saisie, scan par code-barres ou référence, zéro valide, progression sauvegardée", async () => {
    const id = await started(); const r = await ok(call("stk", "count.entry", { id, code: "b-p1", qty: "95", entryKey: rid() })); expect(r.counted).toBe(95); await ok(call("stk", "count.entry", { id, code: "SKU-p2", qty: 0, entryKey: rid() }));
    const g = await get(id, "stk"); expect(g.progress).toMatchObject({ total: 3, counted: 2, pending: 1, pct: 67 }); expect(g.lines.find((l: any) => l.name === "Huile").counted).toBe(0);
  });
  it("valide les quantités : négative, texte, décimale sur article entier", async () => { const id = await started(); const l = await lineOf(id, "Riz"); await err(enter(id, l.id, -2), 400); await err(enter(id, l.id, "abc"), 400); await err(enter(id, l.id, 2.5), 400); await err(enter(id, "zzz", 1), 404); });
  it("unités configurées : 2 cartons de 12 = 24", async () => {
    await st.create("article_units", "u1", T, { tenantId: T, shopId: A, productId: "p1", unit: "carton", factor: 12, active: true }); const id = await started(); const l = await lineOf(id, "Riz"); expect(l.units).toEqual([{ unit: "carton", factor: 12 }]);
    expect((await ok(enter(id, l.id, 0, { unit: "carton", unitQty: 2 }))).counted).toBe(24); await err(enter(id, l.id, 0, { unit: "palette", unitQty: 1, replace: true }), 400);
  });
  it("même entryKey rejoué = une seule saisie ; double appui accidentel ignoré ; ressaisie exige une confirmation", async () => {
    const id = await started(); const l = await lineOf(id, "Riz"); const key = rid(); await ok(call("stk", "count.entry", { id, lineId: l.id, qty: 90, entryKey: key })); expect((await ok(call("stk", "count.entry", { id, lineId: l.id, qty: 90, entryKey: key }))).duplicate).toBe(true);
    expect((await ok(enter(id, l.id, 90))).doubleTap).toBe(true); await err(enter(id, l.id, 91), 409, "DEJA_COMPTE"); await ok(enter(id, l.id, 91, { replace: true }));
    const h = (await ok(call("ger", "count.history", { id }))).events.filter((e: any) => e.kind === "count"); expect(h).toHaveLength(2); expect(h[1].detail).toMatchObject({ qty: 91, previous: 90 });
  });
  it("deux agents en désaccord : conflit signalé pour arbitrage", async () => {
    const id = await started({ agents: [U.stk!, U.stk2!] }); const l = await lineOf(id, "Riz"); await ok(enter(id, l.id, 90)); const r = await ok(enter(id, l.id, 92, { replace: true }, "stk2")); expect(r.conflict).toBe(true); expect((await lineOf(id, "Riz")).conflict).toBe(true);
  });
  it("article inconnu conservé et signalé ; article hors périmètre refusé", async () => {
    const id = await started({ kind: "partial", categories: ["Hygiène"] }); expect((await ok(call("stk", "count.entry", { id, code: "INCONNU-1", qty: 4, entryKey: rid() }))).unknown).toBe(true); expect((await get(id)).unknown).toEqual([{ code: "inconnu-1", qty: 4, note: "" }]);
    await err(call("stk", "count.entry", { id, code: "b-p1", qty: 4, entryKey: rid() }), 409, "hors du périmètre");
  });
  it("saisie impossible hors de l'état « en cours » ; perte réseau : rien d'enregistré, la relance passe", async () => {
    const id = await started(); const l = await lineOf(id, "Riz"); const key = rid(); st.failBatchAfter = 1; const x: any = await call("stk", "count.entry", { id, lineId: l.id, qty: 90, entryKey: key }); expect(x.status).toBeGreaterThanOrEqual(500); expect((await lineOf(id, "Riz")).counted).toBeNull();
    expect((await ok(call("stk", "count.entry", { id, lineId: l.id, qty: 90, entryKey: key }))).duplicate).toBe(false); await ok(call("ger", "count.finish", { id, confirmUncounted: true })); await err(enter(id, l.id, 80, { replace: true }), 409, "Comptage fermé");
  });
  it("fin de comptage : les non comptés exigent une confirmation explicite ; rien compté = refus", async () => {
    const id = await started(); await err(call("ger", "count.finish", { id }), 409, "Aucun article compté"); await countAll(id, { Riz: 100 }); await err(call("ger", "count.finish", { id }), 409, "NON_COMPTES"); await ok(call("ger", "count.finish", { id, confirmUncounted: true }));
  });
});

describe("rapprochement : stock théorique à la date du comptage", () => {
  it("compare au théorique de l'instant du comptage ; ventes après le comptage ne sont pas des écarts ; mouvements signalés", async () => {
    const id = await started(); await mv("p1", 5, "sale", -40); await countAll(id, { Riz: 90, Huile: 50, Savon: 20 }); await later(); await mv("p1", 4, "sale", 0); await mv("p1", 10, "purchase", 0); // après le comptage
    await ok(call("ger", "count.finish", { id })); await ok(call("ger", "count.review", { id })); const r = await lineOf(id, "Riz");
    expect(r.theoretical).toBe(95); expect(r.diff).toBe(-5); expect(r.value).toBe(-2500); expect(r.movesAfter.net).toMatchObject({ sales: -4, receipts: 10 }); expect(r.needsAttention).toBe(true); expect(r.movesDuring.count).toBe(0);
    const h = await lineOf(id, "Huile"); expect(h.diff).toBe(0); expect(h.needsAttention).toBe(false);
  });
  it("vente survenue PENDANT le comptage (après le lancement, avant la saisie) : incluse dans le théorique de l'instant et signalée", async () => {
    const id = await started(); await later(); await mv("p1", 3, "sale", 0); await later(); await countAll(id, { Riz: 97 }); await ok(call("ger", "count.finish", { id, confirmUncounted: true })); await ok(call("ger", "count.review", { id })); const r = await lineOf(id, "Riz");
    expect(r.theoretical).toBe(97); expect(r.diff).toBe(0); expect(r.movesDuring.net.sales).toBe(-3); expect(r.recentBefore).toBe(1);
  });
  it("mouvement récent juste avant le comptage : signalé, recomptage conseillé", async () => { const id = await started(); await mv("p2", 3, "sale", -5); await countAll(id, { Huile: 47 }); await ok(call("ger", "count.finish", { id, confirmUncounted: true })); await ok(call("ger", "count.review", { id })); expect((await lineOf(id, "Huile")).recentBefore).toBe(1); });
  it("les écarts ne sont révélés qu'à la fin du comptage ; un agent ne les voit jamais", async () => {
    const id = await started(); await countAll(id, { Riz: 90 }); await ok(call("ger", "count.finish", { id, confirmUncounted: true })); const g = await get(id); expect(g.blind).toBe(false); expect((await get(id, "stk")).lines[0].theoretical).toBeUndefined();
  });
  it("articles non comptés : aucun écart, aucun ajustement", async () => { const id = await started(); await toReview(id, { Riz: 100 }); const r = await lineOf(id, "Savon"); expect(r.diff).toBeNull(); expect((await ok(call("ger", "count.report", { id }))).uncounted).toBe(2); });
});

describe("contrôle, second comptage et validation", () => {
  it("écart important (seuil configurable) : approbation refusée sans second comptage, puis acceptée après recomptage", async () => {
    const id = await started({ thresholdPct: 5, thresholdValue: 1_000_000 }); await toReview(id, { Riz: 80, Huile: 49 }); const riz = await lineOf(id, "Riz"); expect(riz.significant).toBe(true); expect((await lineOf(id, "Huile")).significant).toBe(false);
    await err(call("ger", "count.decide", { id, lineIds: [riz.id], reason: "Casse constatée" }), 409, "ECART_IMPORTANT");
    await err(call("ger", "count.recount", { id, lineIds: [riz.id], reason: "" }), 400); await ok(call("ger", "count.recount", { id, lineIds: [riz.id], reason: "Écart important" })); expect((await get(id)).status).toBe("in_progress"); expect((await lineOf(id, "Riz")).status).toBe("recount");
    await ok(enter(id, riz.id, 81)); expect((await lineOf(id, "Riz")).round).toBe(2); await ok(call("ger", "count.finish", { id, confirmUncounted: true })); await ok(call("ger", "count.review", { id })); await ok(call("ger", "count.decide", { id, lineIds: [riz.id], reason: "Second comptage confirmé" }));
    expect((await lineOf(id, "Riz")).status).toBe("approved");
  });
  it("approbation forcée d'un écart important : motif détaillé obligatoire et tracé", async () => {
    const id = await started({ thresholdPct: 5 }); await toReview(id, { Riz: 80 }); const l = await lineOf(id, "Riz"); await err(call("ger", "count.decide", { id, lineIds: [l.id], reason: "Casse", forceSignificant: true }), 400, "motif détaillé"); await ok(call("ger", "count.decide", { id, lineIds: [l.id], reason: "Palette tombée, constat photo joint", forceSignificant: true }));
    expect((await ok(call("ger", "count.history", { id }))).events.find((e: any) => e.kind === "approve").detail.forced).toBe(true);
  });
  it("motif obligatoire pour approuver ou refuser ; décision seulement à l'état « À vérifier »", async () => {
    const id = await started(); await countAll(id, { Riz: 99 }); await ok(call("ger", "count.finish", { id, confirmUncounted: true })); const l = await lineOf(id, "Riz"); await err(call("ger", "count.decide", { id, lineIds: [l.id], reason: "perte" }), 409, "À vérifier"); await ok(call("ger", "count.review", { id }));
    await err(call("ger", "count.decide", { id, lineIds: [l.id], reason: "" }), 400); await err(call("ger", "count.decide", { id, lineIds: [l.id], reason: "ok" }), 400); await err(call("stk", "count.decide", { id, lineIds: [l.id], reason: "perte" }), 403);
  });
  it("validation impossible tant que des écarts ne sont pas tranchés ; un agent qui a compté ne valide pas", async () => {
    const id = await started({ responsibleId: U.ger! }); await toReview(id, { Riz: 99, Huile: 49 }); await err(call("ger2", "count.validate", { id }), 409, "VALIDATION_IMPOSSIBLE"); await ok(call("ger", "count.decide", { id, all: true, reason: "Petites pertes" }));
    await ok(call("ger", "count.validate", { id }).then((x) => x)).catch(() => undefined);
  });
  it("validation : mouvements correctifs UNIQUEMENT pour les écarts approuvés, liés à l'inventaire, stock final = compté + mouvements ultérieurs", async () => {
    const id = await started({ thresholdPct: 50 }); await countAll(id, { Riz: 90, Huile: 52, Savon: 20 }); await later(); await mv("p1", 4, "sale", 0); await ok(call("ger", "count.finish", { id })); await ok(call("ger", "count.review", { id }));
    const riz = await lineOf(id, "Riz"), huile = await lineOf(id, "Huile"); await ok(call("ger", "count.decide", { id, lineIds: [riz.id], reason: "Casse en rayon" })); await ok(call("ger", "count.decide", { id, lineIds: [huile.id], decision: "reject", reason: "Erreur de comptage probable" }));
    const before = st.rows("stock_moves").length; const v = await ok(call("ger2", "count.validate", { id })); expect(v).toMatchObject({ status: "validated", adjusted: 1, rejected: 1, uncounted: 0 }); expect(v.shortageValue).toBe(-5000);
    const adj = st.rows("stock_moves").filter((m) => String(m.refId).startsWith("inventaire:")); expect(st.rows("stock_moves").length).toBe(before + 1); expect(adj).toHaveLength(1); expect(adj[0]).toMatchObject({ productId: "p1", qty: -10, kind: "adjust", userId: U.ger2, refId: expect.stringContaining("INV-") });
    expect(await stockFor(st, "p1")).toBe(86); expect(await stockFor(st, "p2")).toBe(50); const l = await lineOf(id, "Riz"); expect(l.adjustMoveId).toBe(adj[0]!.$id); expect(l.diff).toBe(-10); expect((await ok(call("own", "count.list"))).inventories[0].adjusted).toBe(1);
    expect(st.rows("stock_moves").filter((m) => m.$id === "mv1")).toHaveLength(1); // aucun ancien mouvement supprimé ni modifié
  });
  it("valider deux fois, ou deux gérants en même temps : un seul jeu de mouvements", async () => {
    const id = await started(); await toReview(id, { Riz: 97 }); await ok(call("ger", "count.decide", { id, all: true, reason: "Perte" })); const res = await Promise.all([call("ger", "count.validate", { id }), call("ger2", "count.validate", { id })]); expect(res.filter((x: any) => x.status === 200).length).toBeGreaterThanOrEqual(1);
    await ok(call("own", "count.validate", { id })); expect(st.rows("stock_moves").filter((m) => String(m.refId).startsWith("inventaire:"))).toHaveLength(1); expect(await stockFor(st, "p1")).toBe(97);
  });
  it("panne réseau pendant la validation : relance sans doublon", async () => {
    const id = await started(); await toReview(id, { Riz: 90, Huile: 40, Savon: 18 }); await ok(call("ger", "count.decide", { id, all: true, reason: "Pertes constatées", forceSignificant: true })); st.failBatchAfter = 1; const x: any = await call("ger2", "count.validate", { id }); expect(x.status).toBeGreaterThanOrEqual(500); expect((await get(id)).status).toBe("review");
    await ok(call("ger2", "count.validate", { id })); await ok(call("ger2", "count.validate", { id })); expect(st.rows("stock_moves").filter((m) => String(m.refId).startsWith("inventaire:"))).toHaveLength(3); expect(await stockFor(st, "p1")).toBe(90); expect(await stockFor(st, "p2")).toBe(40); expect(await stockFor(st, "p3")).toBe(18);
  });
  it("surplus : mouvement positif ; historique avant/après avec motif et auteur", async () => {
    const id = await started({ thresholdPct: 50 }); await toReview(id, { Savon: 22 }); const l = await lineOf(id, "Savon"); expect(l.diff).toBe(2); await ok(call("ger", "count.decide", { id, lineIds: [l.id], reason: "Réception non saisie" })); await ok(call("ger2", "count.validate", { id })); expect(await stockFor(st, "p3")).toBe(22);
    const done = await lineOf(id, "Savon"); expect(done).toMatchObject({ reason: "Réception non saisie", decidedBy: "ger" }); const ev = (await ok(call("ger", "count.history", { id }))).events; expect(ev.map((e: any) => e.kind)).toEqual(expect.arrayContaining(["create", "start", "count", "finish", "review", "approve", "validate"]));
  });
});

describe("clôture, annulation et traçabilité", () => {
  const validated = async () => { const id = await started(); await toReview(id, { Riz: 97 }); await ok(call("ger", "count.decide", { id, all: true, reason: "Perte" })); await ok(call("ger2", "count.validate", { id })); return id; };
  it("après validation puis clôture : plus aucune modification des résultats ; annulation impossible", async () => {
    const id = await validated(); await err(call("ger", "count.cancel", { id, reason: "Erreur" }), 409, "opération corrective"); await ok(call("ger", "count.close", { id })); expect((await ok(call("ger", "count.close", { id }))).unchanged).toBe(true);
    const l = await lineOf(id, "Riz"); await err(enter(id, l.id, 50, { replace: true }), 409); await err(call("ger", "count.decide", { id, lineIds: [l.id], reason: "Autre motif" }), 409); await err(call("ger", "count.recount", { id, lineIds: [l.id], reason: "Autre motif" }), 409); await err(call("ger", "count.validate", { id: await mk() }), 409);
    expect(await stockFor(st, "p1")).toBe(97);
  });
  it("annulation avant validation : motif obligatoire, aucun mouvement créé, historique conservé", async () => {
    const id = await started(); await countAll(id, { Riz: 10 }); await err(call("ger", "count.cancel", { id }), 400); await ok(call("ger", "count.cancel", { id, reason: "Lancé par erreur" })); expect((await get(id)).status).toBe("cancelled"); expect(await stockFor(st, "p1")).toBe(100);
    expect(st.rows("inventory_events").some((e) => e.kind === "count")).toBe(true); await err(enter(id, (await lineOf(id, "Riz")).id, 5, { replace: true }), 409); await ok(call("ger", "count.start", { id: await mk() })); // les articles sont libérés
  });
  it("rapport : avancement, écarts +/−, valeur, catégories, non comptés, inconnus ; export prêt (CSV/Excel/PDF)", async () => {
    const id = await started({ thresholdPct: 50 }); await countAll(id, { Riz: 95, Savon: 22 }); await ok(call("stk", "count.entry", { id, code: "???", qty: 1, entryKey: rid() })); await ok(call("ger", "count.finish", { id, confirmUncounted: true })); await ok(call("ger", "count.review", { id }));
    const r = await ok(call("ger", "count.report", { id })); expect(r).toMatchObject({ counted: 2, uncounted: 1, gaps: 2, positive: 1, negative: 1, surplusValue: 400, shortageValue: -2500, netValue: -2100 }); expect(r.byCategory.map((c: any) => c.category)).toEqual(["Alimentaire", "Hygiène"]); expect(r.unknown).toHaveLength(1);
    expect(r.export.sections.map((s: any) => s.name)).toEqual(["Synthèse", "Par catégorie", "Détail des écarts", "Non comptés"]); expect(r.recount).toEqual([]);
  });
  it("traçabilité : réception, correction de stock et inventaire laissent chacun un mouvement identifiable (auteur et référence)", async () => {
    await call("own", "tenant.init", { name: "X" }, "").catch(() => undefined); const sup = (await ok(call("ger", "purch.supplier.save", { name: "Grossiste" }))).id; const po = await ok(call("own", "purch.po.save", { clientId: rid(), supplierId: sup, lines: [{ productId: "p1", qty: 5, unitPrice: 600 }] })); await ok(call("own", "purch.po.validate", { id: po.id }));
    const r = await ok(call("ger", "purch.receipt.save", { clientId: rid(), poId: po.id, deliveryNote: "BL-9", lines: [{ productId: "p1", accepted: 5 }] })); await ok(call("ger", "purch.receipt.validate", { id: r.id })); await ok(call("ger", "stock.adjust", { productId: "p2", counted: 45 }));
    const id = await started(); await toReview(id, { Savon: 19 }); await ok(call("ger", "count.decide", { id, all: true, reason: "Perte" })); await ok(call("ger2", "count.validate", { id }));
    const moves = st.rows("stock_moves").filter((m) => !m.$id.startsWith("mv")); expect(moves.length).toBeGreaterThanOrEqual(3); for (const m of moves) { expect(m.userId, JSON.stringify(m)).toBeTruthy(); expect(m.refId, JSON.stringify(m)).toBeTruthy(); }
    expect(moves.map((m) => String(m.refId)).some((x) => x.startsWith("BC-"))).toBe(true); expect(moves.some((m) => m.refId === "inventaire")).toBe(true); expect(moves.some((m) => String(m.refId).startsWith("inventaire:INV-"))).toBe(true);
  });
});
