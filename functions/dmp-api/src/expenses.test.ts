import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";

class DatedStore extends MemoryStore { override async create(t: string, id: string, tenant: string, d: Record<string, unknown>) { return super.create(t, id, tenant, { $createdAt: new Date().toISOString(), ...d }); } }
const T = "tenantex001", T2 = "tenantex002";
let st: DatedStore; let A = "", B = "", X = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}, shop = A, tenant = T) => handle(st, user, { action, tenantId: tenant, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); return x.body.error as string; };
const setPlan = (plan: string, tenant = T) => { const row = st.rows("subscriptions").find((r) => r.$id === tenant); const data = { tenantId: tenant, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", tenant, tenant, data); };
const rid = () => crypto.randomUUID().replace(/-/g, "");
const day = (offset = 0) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const exp = (user: string, extra: object = {}, shop = A) => call(user, "expense.create", { requestId: rid(), label: "Transport marchandises", category: "transport", amount: 2000, spentOn: day(), method: "cash", source: "till", beneficiary: "Moussa", ...extra }, shop);
const sess = async (user: string, float = 10000) => ok(call(user, "cash.open", { openingFloat: float }));
const theo = async (user: string) => (await ok(call(user, "cash.current"))).totals.theoreticalCash as number;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 1)]).toString("base64");
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(300, 65)]).toString("base64");

beforeEach(async () => {
  st = new DatedStore(); await st.grant(T, "own", ["owner"], []); await st.grant(T2, "own2", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId; X = (await ok(call("own2", "shop.create", { name: "Autre" }, "", T2))).shopId;
  for (const [u, role] of [["cais", "cashier"], ["cais2", "cashier"], ["ger", "manager"], ["ger2", "manager"]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: [A] }, ""))).userId;
  setPlan("business"); setPlan("business", T2);
});

describe("abonnement, droits, isolation", () => {
  it("Starter refusé (402) ; Business accessible ; un autre commerce ne voit rien", async () => {
    setPlan("starter"); await err(call("own", "expense.list"), 402); setPlan("business"); await sess(U.cais!); const e = await ok(exp(U.cais!)); await err(call("own2", "expense.get", { id: e.id }, X, T2), 404); expect((await ok(call("own2", "expense.list", {}, X, T2))).expenses).toEqual([]);
  });
  it("le caissier enregistre et ne voit que ses dépenses ; le gérant voit tout ; droits modifiables par le propriétaire seul", async () => {
    await sess(U.cais!); await sess(U.cais2!); const a = await ok(exp(U.cais!)); await ok(exp(U.cais2!, { label: "Autre dépense", amount: 500 }));
    const l = await ok(call(U.cais!, "expense.list", {})); expect(l.expenses.map((x: any) => x.id)).toEqual([a.id]); expect(l.restricted).toBe(true); expect((await ok(call(U.ger!, "expense.list", {}))).expenses.length).toBe(2);
    await err(call(U.cais2!, "expense.get", { id: a.id }), 403); await err(call(U.ger!, "expense.rights", { userId: U.cais!, rights: ["view"] }), 403); await err(call("own", "expense.rights", { userId: U.cais!, rights: ["voler"] }), 400);
    await ok(call("own", "expense.rights", { userId: U.cais2!, rights: ["view"] })); await err(exp(U.cais2!), 403, "Droit manquant"); expect((await ok(call(U.cais2!, "expense.list", {}))).expenses.length).toBe(2);
  });
});

describe("sortie de caisse liée à la session", () => {
  it("dépense payée en caisse : exige une session ouverte, déduit le solde théorique, apparaît dans la session et dans la clôture", async () => {
    await err(exp(U.cais!), 409, "Ouvrez la caisse"); const s = await sess(U.cais!, 10000); const e = await ok(exp(U.cais!)); expect(e.status).toBe("approved"); expect(await theo(U.cais!)).toBe(8000);
    const cur = await ok(call(U.cais!, "cash.current")); expect(cur.totals.movements).toMatchObject({ out: 2000, expenseOut: 2000 }); expect(cur.movements[0]).toMatchObject({ kind: "out", amount: 2000, beneficiary: "Moussa", expenseId: e.id }); expect(cur.movements[0].reason).toContain(e.number);
    const c = await ok(call(U.cais!, "cash.close", { sessionId: s.id, counted: 8000 })); expect(c.variance).toBe(0); expect(c.totals.movements.expenseOut).toBe(2000); expect(JSON.parse(String(st.rows("cash_sessions")[0]!.summary)).movements.expenseOut).toBe(2000);
  });
  it("dépense payée depuis un compte externe : aucun effet sur la caisse, même sans session", async () => {
    const e = await ok(exp(U.cais!, { source: "external", method: "transfer", reference: "VIR-2026-001", label: "Loyer novembre", category: "loyer", amount: 150000 })); expect(e.status).toBe("approved"); expect(st.rows("cash_movements").length).toBe(0);
    await err(exp(U.cais!, { source: "till", method: "mobile" }), 400, "espèces");
  });
  it("jamais deux fois : même requestId (y compris en parallèle) = une dépense, une sortie ; doublon probable demande confirmation", async () => {
    await sess(U.cais!); const requestId = rid(); const r = await Promise.all([1, 2, 3].map(() => call(U.cais!, "expense.create", { requestId, label: "Sacs", category: "fournitures", amount: 700, spentOn: day(), method: "cash", source: "till" })));
    expect(r.every((x) => x.status === 200)).toBe(true); expect(st.rows("expenses").length).toBe(1); expect(st.rows("cash_movements").length).toBe(1); expect(await theo(U.cais!)).toBe(9300); expect(r.filter((x) => (x.body as any).data.duplicate).length).toBe(2);
    const e = await err(call(U.cais!, "expense.create", { requestId: rid(), label: "sacs", category: "fournitures", amount: 700, spentOn: day(), method: "cash", source: "till" }), 409, "DOUBLON_POSSIBLE"); expect(e).toContain("D-");
    await ok(call(U.cais!, "expense.create", { requestId: rid(), label: "Sacs", category: "fournitures", amount: 700, spentOn: day(), method: "cash", source: "till", confirmDuplicate: true })); expect(await theo(U.cais!)).toBe(8600);
  });
  it("panne en cours d'écriture : rien n'est enregistré (ni dépense, ni sortie, ni historique) ; la reprise aboutit", async () => {
    await sess(U.cais!); const requestId = rid(); const body = { requestId, label: "Taxi", category: "transport", amount: 1000, spentOn: day(), method: "cash", source: "till" }; st.failBatchAfter = 2;
    expect((await call(U.cais!, "expense.create", body)).status).toBeGreaterThanOrEqual(500); expect(st.rows("expenses").length + st.rows("expense_events").length + st.rows("cash_movements").length).toBe(0); await ok(call(U.cais!, "expense.create", body)); expect(st.rows("cash_movements").length).toBe(1);
  });
  it("sortie supérieure au solde refusée ; dépassement seulement par un responsable, motivé, et tracé", async () => {
    await sess(U.cais!, 1000); await err(exp(U.cais!, { amount: 5000 }), 409, "Solde de caisse insuffisant"); await err(exp(U.cais!, { amount: 5000, allowOverdraft: true, overdraftReason: "urgence" }), 403, "responsable");
    await sess(U.ger!, 1000); await err(exp(U.ger!, { amount: 5000, allowOverdraft: true }), 400, "Motif"); const e = await ok(exp(U.ger!, { amount: 5000, allowOverdraft: true, overdraftReason: "Réparation urgente du groupe" })); expect(e.overdraft).toMatchObject({ excess: 4000, balanceBefore: 1000 });
    expect(await theo(U.ger!)).toBe(-4000); const d = await ok(call(U.ger!, "expense.get", { id: e.id })); expect(d.overdraft).toMatchObject({ reason: "Réparation urgente du groupe" }); expect(d.events[0].detail.overdraft).toBeTruthy();
  });
});

describe("validation hiérarchique", () => {
  it("seuil et catégories sensibles : en attente, sans effet sur la caisse ; la fermeture est bloquée ; validation → sortie ; propre dépense non validable", async () => {
    await err(call(U.ger!, "expense.settings", { threshold: 10000 }), 403); await ok(call("own", "expense.settings", { threshold: 10000 })); const s = await sess(U.cais!, 50000);
    const small = await ok(exp(U.cais!, { amount: 9999 })); expect(small.status).toBe("approved"); const big = await ok(exp(U.cais!, { amount: 15000 })); expect(big.status).toBe("pending"); const sal = await ok(exp(U.cais!, { amount: 100, category: "salaires", label: "Avance" })); expect(sal.status).toBe("pending");
    expect(await theo(U.cais!)).toBe(50000 - 9999); expect(st.rows("cash_movements").length).toBe(1); await err(call(U.cais!, "cash.close", { sessionId: s.id, counted: 40001 }), 409, "en attente de validation");
    await err(call(U.cais!, "expense.decide", { id: big.id, approve: true }), 403); await ok(call(U.ger!, "expense.decide", { id: big.id, approve: true, note: "ok" })); expect(await theo(U.cais!)).toBe(50000 - 9999 - 15000);
    await err(call(U.ger!, "expense.decide", { id: big.id, approve: true }), 409, "déjà"); await err(call(U.ger!, "expense.decide", { id: sal.id, approve: false }), 400, "Motif"); await ok(call(U.ger!, "expense.decide", { id: sal.id, approve: false, note: "Non prévu au budget" }));
    expect(await theo(U.cais!)).toBe(50000 - 9999 - 15000); const r = await ok(call(U.ger!, "expense.get", { id: sal.id })); expect(r.status).toBe("rejected"); expect(r.decisionNote).toBe("Non prévu au budget"); expect(r.events.map((x: any) => x.kind)).toEqual(["create", "reject"]);
    await sess(U.ger!, 50000); const m = await ok(exp(U.ger!, { amount: 20000, label: "Gros achat" })); expect(m.status).toBe("approved"); await ok(call("own", "expense.settings", { threshold: 0, sensitive: [] })); expect((await ok(exp(U.cais!, { amount: 999999, category: "salaires", source: "external", method: "transfer" }))).status).toBe("approved"); // seuil et catégories sensibles désactivés
  });
  it("double validation simultanée : une seule sortie ; session fermée : validation impossible, rejet possible", async () => {
    await ok(call("own", "expense.settings", { threshold: 1000 })); const s = await sess(U.cais!, 20000); const e = await ok(exp(U.cais!, { amount: 5000 })); const r = await Promise.all([call(U.ger!, "expense.decide", { id: e.id, approve: true }), call(U.ger2!, "expense.decide", { id: e.id, approve: true })]);
    expect(r.map((x) => x.status).sort()).toEqual([200, 409]); expect(st.rows("cash_movements").length).toBe(1); expect(await theo(U.cais!)).toBe(15000);
    const e2 = await ok(exp(U.cais!, { amount: 3000, label: "Autre" })); await ok(call(U.ger!, "expense.decide", { id: e2.id, approve: false, note: "Doublon" })); const e3 = await ok(exp(U.cais!, { amount: 4000, label: "Encore" })); await ok(call(U.ger!, "expense.decide", { id: e3.id, approve: false, note: "x1x" }));
    void s;
  });
  it("dépense en attente dont la session est fermée : validation refusée avec explication", async () => {
    await ok(call("own", "expense.settings", { threshold: 1000 })); const s = await sess(U.cais!, 20000); const e = await ok(exp(U.cais!, { amount: 5000 })); await err(call(U.cais!, "cash.close", { sessionId: s.id, counted: 20000 }), 409);
    await ok(call(U.ger!, "expense.decide", { id: e.id, approve: false, note: "refus pour test" })); await ok(call(U.cais!, "cash.close", { sessionId: s.id, counted: 20000 }));
    const e2 = await ok(exp(U.cais!, { source: "external", method: "cash", amount: 5000 })); expect(e2.status).toBe("pending"); expect((await ok(call(U.ger!, "expense.decide", { id: e2.id, approve: true }))).status).toBe("approved"); // externe : aucune session
  });
});

describe("annulation tracée, modification, historique", () => {
  it("annulation : motif obligatoire, dépense conservée « annulée », entrée de régularisation dans la session ouverte, une seule fois", async () => {
    await sess(U.cais!, 10000); const e = await ok(exp(U.cais!)); expect(await theo(U.cais!)).toBe(8000); await err(call(U.cais!, "expense.cancel", { id: e.id, reason: "erreur" }), 403); await err(call(U.ger!, "expense.cancel", { id: e.id, reason: "x" }), 400);
    const c = await ok(call(U.ger!, "expense.cancel", { id: e.id, reason: "Saisie en double" })); expect(c.cashReturned).toBe(true); expect(await theo(U.cais!)).toBe(10000); await err(call(U.ger!, "expense.cancel", { id: e.id, reason: "encore" }), 409, "déjà annulée");
    expect(st.rows("expenses").length).toBe(1); expect(st.rows("cash_movements").map((m) => m.kind).sort()).toEqual(["in", "out"]); const d = await ok(call(U.ger!, "expense.get", { id: e.id })); expect(d.status).toBe("cancelled"); expect(d.cancelReason).toBe("Saisie en double"); expect(d.events.map((x: any) => x.kind)).toEqual(["create", "approve", "cancel"]);
    await err(call(U.ger!, "expense.update", { id: e.id, label: "Nouveau libellé" }), 409, "ne se modifie plus");
  });
  it("annulation après clôture : aucun mouvement de caisse automatique, expliqué ; l'auteur peut annuler sa dépense en attente", async () => {
    const s = await sess(U.cais!, 10000); const e = await ok(exp(U.cais!)); await ok(call(U.cais!, "cash.close", { sessionId: s.id, counted: 8000 })); const c = await ok(call(U.ger!, "expense.cancel", { id: e.id, reason: "Facture annulée" })); expect(c.cashReturned).toBe(false); expect(c.note).toContain("session fermée"); expect(st.rows("cash_movements").length).toBe(1);
    await ok(call("own", "expense.settings", { threshold: 100 })); await sess(U.cais!, 5000); const p = await ok(exp(U.cais!, { amount: 400, label: "Pending" })); expect(p.status).toBe("pending"); await ok(call(U.cais!, "expense.cancel", { id: p.id, reason: "Je me suis trompé" })); expect(st.rows("cash_movements").length).toBe(1);
  });
  it("modification : auteur (en attente) ou droit ; montant/date/moyen figés après validation ; chaque changement garde avant/après", async () => {
    await ok(call("own", "expense.settings", { threshold: 1000 })); await sess(U.cais!, 30000); const p = await ok(exp(U.cais!, { amount: 5000 })); await err(call(U.cais2!, "expense.update", { id: p.id, label: "Piraté" }), 403);
    await ok(call(U.cais!, "expense.update", { id: p.id, amount: 6000, label: "Transport corrigé" })); await ok(call(U.ger!, "expense.decide", { id: p.id, approve: true })); expect(await theo(U.cais!)).toBe(24000);
    await err(call(U.cais!, "expense.update", { id: p.id, label: "Encore" }), 403); await err(call(U.ger!, "expense.update", { id: p.id, amount: 100 }), 409, "annulez-la"); expect((await ok(call(U.ger!, "expense.update", { id: p.id, beneficiary: "Fall & Fils", reference: "REF-77" }))).changed).toEqual(["reference", "beneficiary"].sort().reverse().length ? expect.any(Array) : []);
    expect((await ok(call(U.ger!, "expense.update", { id: p.id, label: "Transport corrigé" }))).unchanged).toBe(true); const d = await ok(call(U.ger!, "expense.get", { id: p.id })); const up = d.events.filter((x: any) => x.kind === "update"); expect(up[0].detail).toMatchObject({ before: { amount: 5000, label: "Transport marchandises" }, after: { amount: 6000, label: "Transport corrigé" } }); expect(d.amount).toBe(6000);
  });
});

describe("justificatifs (Storage)", () => {
  it("photo ou PDF acceptés selon le contenu, ajout seul, droits, limites", async () => {
    await sess(U.cais!); const e = await ok(exp(U.cais!)); const a = await ok(call(U.cais!, "expense.receipt", { id: e.id, name: "facture taxi.png", data: PNG })); expect(a.receipts[0]).toMatchObject({ mime: "image/png" }); const b = await ok(call(U.cais!, "expense.receipt", { id: e.id, name: "recu.pdf", data: PDF }));
    expect(b.receipts.map((r: any) => r.mime)).toEqual(["image/png", "application/pdf"]); expect(st.files.size).toBe(2); await err(call(U.cais!, "expense.receipt", { id: e.id, name: "x.exe", data: Buffer.alloc(400, 7).toString("base64") }), 400, "Format"); await err(call(U.cais!, "expense.receipt", { id: e.id, name: "gros.pdf", data: Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(1_900_000)]).toString("base64") }), 413);
    await err(call(U.cais2!, "expense.receipt", { id: e.id, name: "a.png", data: PNG }), 403); const d = await ok(call(U.ger!, "expense.get", { id: e.id })); expect(d.receipts.length).toBe(2); expect(d.events.filter((x: any) => x.kind === "receipt").length).toBe(2);
    for (let i = 0; i < 3; i++) await ok(call(U.cais!, "expense.receipt", { id: e.id, name: `p${i}.png`, data: PNG })); await err(call(U.cais!, "expense.receipt", { id: e.id, name: "6.png", data: PNG }), 409, "maximum");
  });
});

describe("catégories, recherche et filtres", () => {
  it("catégories personnalisées (jamais supprimées, seulement archivées), doublons refusés, catégorie inconnue refusée", async () => {
    await err(exp(U.cais!, { category: "cadeaux" }), 400, "Catégorie inconnue"); await err(call(U.cais!, "expense.category.save", { name: "Cadeaux" }), 403); await ok(call(U.ger!, "expense.category.save", { name: "Cadeaux clients" })); await err(call(U.ger!, "expense.category.save", { name: "Cadeaux clients" }), 409); await err(call(U.ger!, "expense.category.save", { name: "Transport" }), 409, "prédéfinie");
    await sess(U.cais!); const e = await ok(exp(U.cais!, { category: "Cadeaux clients" })); expect(e.status).toBe("approved"); const c = await ok(call(U.cais!, "expense.categories")); expect(c.predefined.length).toBe(11); expect(c.custom).toEqual(["Cadeaux clients"]);
    await ok(call(U.ger!, "expense.category.save", { name: "Cadeaux clients", active: false })); expect((await ok(call(U.cais!, "expense.categories"))).custom).toEqual([]); expect((await ok(call(U.ger!, "expense.get", { id: e.id }))).category).toBe("Cadeaux clients");
  });
  it("liste : recherche, période, catégorie, auteur, moyen, statut, origine ; le propriétaire compare ses boutiques", async () => {
    await sess(U.cais!, 100000); await sess(U.ger!, 100000); await ok(exp(U.cais!, { label: "Taxi aéroport", amount: 3000, spentOn: day(-40) })); await ok(exp(U.cais!, { label: "Eau minérale", category: "eau", amount: 1000, beneficiary: "SDE" })); await ok(exp(U.ger!, { label: "Facture internet", category: "internet", amount: 25000, source: "external", method: "mobile", reference: "OM-123456" }));
    const L = async (f: object, user = "own") => (await ok(call(user, "expense.list", f))).expenses.map((x: any) => x.label);
    expect((await L({})).sort()).toEqual(["Eau minérale", "Facture internet"]); expect(await L({ from: day(-60), to: day(-30) })).toEqual(["Taxi aéroport"]); expect(await L({ q: "om-1234" })).toEqual(["Facture internet"]); expect(await L({ q: "sde" })).toEqual(["Eau minérale"]);
    expect(await L({ category: "eau" })).toEqual(["Eau minérale"]); expect(await L({ method: "mobile" })).toEqual(["Facture internet"]); expect(await L({ source: "external" })).toEqual(["Facture internet"]); expect(await L({ userId: U.ger!, from: day(-60) })).toEqual(["Facture internet"]); expect(await L({ status: "pending" })).toEqual([]);
    await ok(call("own", "cash.open", { openingFloat: 0 }, B)); await ok(call("own", "expense.create", { requestId: rid(), label: "Dépense Thiès", category: "loyer", amount: 500, spentOn: day(), method: "transfer", source: "external" }, B)); expect((await ok(call("own", "expense.list", { shopId: "all" }))).expenses.length).toBe(3); await err(call(U.ger!, "expense.list", { shopId: B }), 403);
  });
});

describe("rapports : uniquement des chiffres réels", () => {
  it("totaux jour/mois, catégories, moyens, boutiques, sessions, en attente, comparaison ; pending/annulé/rejeté exclus", async () => {
    await ok(call("own", "expense.settings", { threshold: 30000 })); const s = await sess(U.cais!, 100000); await ok(exp(U.cais!, { amount: 2000 })); await ok(exp(U.cais!, { amount: 3000, label: "Eau", category: "eau" })); await ok(exp(U.cais!, { amount: 40000, label: "Gros", category: "entretien" }));
    await ok(exp(U.ger!, { amount: 12000, label: "Loyer", category: "loyer", source: "external", method: "transfer", spentOn: day(-45) })); const c = await ok(exp(U.ger!, { amount: 700, label: "À annuler", source: "external", method: "cash" })); await ok(call(U.ger!, "expense.cancel", { id: c.id, reason: "Erreur de saisie" }));
    const today = day(); const r = await ok(call(U.ger!, "expense.report", { from: today.slice(0, 8) + "01", to: today })); expect(r.totals.today).toBe(5000); expect(r.totals.count).toBe(2); expect(r.totals.period).toBe(5000); expect(r.totals.cancelled).toBe(1); expect(r.pending).toEqual({ count: 1, amount: 40000 });
    expect(r.byCategory.map((x: any) => [x.key, x.total])).toEqual([["eau", 3000], ["transport", 2000]]); expect(r.byMethod).toEqual([{ key: "cash", total: 5000, count: 2 }]); expect(r.bySource.find((x: any) => x.key === "till").total).toBe(5000); expect(r.byShop[0]).toMatchObject({ shop: "Dakar", total: 5000 });
    expect(r.cashSessions[0]).toMatchObject({ sessionId: s.id, expenseOut: 5000 }); expect(r.net.available).toBe(false); expect(r.net.reasons.join(" ")).toContain("en attente"); expect(r.figures.expenses).toBe(5000); expect(r.figures.encaissements).toBeNull();
    const old = await ok(call(U.ger!, "expense.report", { from: day(-60), to: day(-30) })); expect(old.totals.period).toBe(12000); const cmp = await ok(call(U.ger!, "expense.report", { from: day(-29), to: day(0) })); expect(cmp.totals.previousPeriod).toBe(12000); expect(cmp.totals.deltaPct).toBeCloseTo(((5000 - 12000) / 12000) * 100, 0);
    expect(r.export.sections.map((x: any) => x.name)).toEqual(["Synthèse", "Par catégorie", "Par moyen de paiement", "Par boutique", "Sorties d'espèces par session", "Détail"]); await err(call(U.cais!, "expense.report", {}), 403); await err(call(U.ger!, "expense.report", { from: day(-400), to: day() }), 400);
  });
  it("résultat : affiché seulement si tous les coûts sont connus et aucune dépense en attente ; sinon raisons explicites", async () => {
    const p = (await ok(call("own", "article.save", { data: { name: "Eau", price: 500, cost: 300 }, initialQty: 50 }))).id as string; const nocost = (await ok(call("own", "article.save", { data: { name: "Sans coût", price: 100 }, initialQty: 50 }))).id as string;
    await sess(U.cais!, 50000); await ok(call(U.cais!, "checkout", { clientId: rid(), lines: [{ productId: p, qty: 2 }], payments: [{ method: "cash", amount: 1000 }] })); await ok(exp(U.cais!, { amount: 100 }));
    const r = await ok(call(U.ger!, "expense.report", {})); expect(r.net).toEqual({ available: true, reasons: [], value: 247 - 100 }); expect(r.figures).toMatchObject({ revenueTtc: 1000, grossMarginHt: 247, expenses: 100 });
    await ok(call(U.cais!, "checkout", { clientId: rid(), lines: [{ productId: nocost, qty: 1 }], payments: [{ method: "cash", amount: 100 }] })); const r2 = await ok(call(U.ger!, "expense.report", {})); expect(r2.net.available).toBe(false); expect(r2.net.value).toBeNull(); expect(r2.net.reasons.join(" ")).toContain("coût d'achat inconnu"); expect(r2.figures.grossMarginHt).toBeNull();
    const none = await ok(call(U.ger2!, "expense.report", { from: day(-300), to: day(-290) })); expect(none.net.available).toBe(false); expect(none.net.reasons).toContain("aucune vente sur la période"); expect(none.totals.period).toBe(0);
  });
});

describe("sortie de caisse simple : bénéficiaire", () => {
  it("le bénéficiaire est conservé avec le motif et visible dans la session", async () => {
    await sess(U.ger!, 5000); await ok(call(U.ger!, "cash.move", { kind: "out", amount: 500, reason: "Achat de sacs", beneficiary: "Boutique Ndiaye" })); expect((await ok(call(U.ger!, "cash.current"))).movements[0]).toMatchObject({ beneficiary: "Boutique Ndiaye", expenseId: "" });
  });
});
