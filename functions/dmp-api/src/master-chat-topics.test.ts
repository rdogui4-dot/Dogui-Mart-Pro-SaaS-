import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { GUIDED, matchQuestion } from "../../../src/domain/master-chat";

process.env.MASTER_CHAT_MIN_INTERVAL_MS = "0"; process.env.MASTER_CHAT_USER_DAILY = "1000";
class DatedStore extends MemoryStore { override async create(t: string, id: string, tenant: string, d: Record<string, unknown>) { return super.create(t, id, tenant, { $createdAt: new Date().toISOString(), ...d }); } }
const T = "tenanttp0001"; let st: DatedStore; let A = "", B = ""; const U: Record<string, string> = {}; let n = 0;
const call = (user: string, action: string, payload: unknown = {}, shop = "") => handle(st, U[user] ?? user, { action, tenantId: T, shopId: shop, payload }, { admins: ["admin1"] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const ask = async (qid: string, extra: Record<string, unknown> = {}, user = "own") => (await ok(call(user, "md.chat.ask", { requestKey: `req-${String(++n).padStart(10, "0")}`, qid, shopId: A, days: 7, ...extra }))).assistant.answer;
const facts = (a: any) => Object.fromEntries(a.facts.map((f: any) => [f.label, f.value]));
const ago = (d: number) => new Date(Date.now() - d * 864e5 - 1000).toISOString();
const row = (table: string, id: string, data: Record<string, unknown>, shop = A) => st.create(table, id, T, { tenantId: T, shopId: shop, ...data });

beforeEach(async () => {
  st = new DatedStore(); n = 0; await st.grant(T, "own", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }))).shopId;
  for (const [u, role, shops] of [["cais", "cashier", [A]], ["ger", "manager", [A]]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: shops }))).userId;
  void st.create("subscriptions", T, T, { tenantId: T, plan: "business", period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }); await st.update("shops", A, { phone: "0701020304" }); await ok(call("own", "md.trial.start", {}));
});

describe("MASTER DOGUI — assistant : sujets supplémentaires (chiffres exacts sur données de test)", () => {
  it("catalogue : tous les sujets ont un outil, une question et des mots-clés ; la liste annonce 21 sujets", async () => {
    expect(GUIDED.length).toBe(21); const l = await ok(call("own", "md.chat.list")); expect(l.guided).toHaveLength(21); expect(new Set(GUIDED.map((g) => g.label)).size).toBe(21);
  });
  it("appariement des questions naturelles vers les nouveaux sujets", () => {
    const m = (q: string) => (matchQuestion(q) as any).id;
    expect([m("Combien ai-je dépensé ce mois ?"), m("Où en sont mes commandes fournisseurs ?"), m("Combien dois-je à mes fournisseurs ?"), m("Quelle est ma trésorerie ?"), m("Combien ai-je de clients ?"), m("Où en est mon pipeline commercial ?"), m("Où en sont mes promotions ?"), m("Où en sont mes inventaires ?"), m("Où en sont mes transferts de stock ?"), m("Où en sont mes investissements ?"), m("Où en est ma comptabilité ?"), m("Combien de personnes dans mon équipe ?"), m("Quelle est la valeur de mon stock ?")])
      .toEqual(["expenses", "purchases", "payables", "treasury", "customers", "pipeline", "promos", "inventories", "transfers", "invest", "accounting", "team", "stockvalue"]);
    expect([m("Quels articles sont en rupture ?"), m("Quel est l'encours de crédit de mes clients ?"), m("Mes ventes de la semaine")]).toEqual(["stock", "credit", "sales"]);
  });
  it("dépenses : approuvées, en attente, reste à payer, variation vs période précédente", async () => {
    await row("expenses", "e1", { number: "D1", label: "Taxi", category: "Transport", amount: 2000, spentOn: ago(1), status: "approved", payMode: "immediate" }); await row("expenses", "e2", { number: "D2", label: "Loyer", category: "Loyer", amount: 3000, spentOn: ago(2), status: "approved", payMode: "immediate" });
    await row("expenses", "e3", { number: "D3", label: "Gros", category: "Achats", amount: 4000, spentOn: ago(3), status: "approved", payMode: "deferred", paidAmount: 1000 }); await row("expenses", "e4", { number: "D4", label: "Attente", category: "Divers", amount: 500, spentOn: ago(1), status: "pending" }); await row("expenses", "e5", { number: "D5", label: "Ancien", category: "Loyer", amount: 5000, spentOn: ago(10), status: "approved" });
    const a = await ask("expenses"); const f = facts(a); expect(f["Dépenses approuvées (nombre)"]).toBe(3); expect(f["Dépenses approuvées (FCFA)"]).toBe(9000); expect(f["En attente d'approbation (nombre)"]).toBe(1); expect(f["En attente d'approbation (FCFA)"]).toBe(500); expect(f["Reste à payer sur dépenses différées (FCFA)"]).toBe(3000); expect(f["Période précédente (FCFA)"]).toBe(5000); expect(a.observations.join(" ")).toContain("+80 %"); expect(a.observations[0]).toContain("Achats"); expect(a.recommendations).toHaveLength(1);
  });
  it("commandes fournisseurs : ouvertes, en retard, montants", async () => {
    await row("purchase_orders", "p1", { number: "CF-1", supplierId: "s", status: "ordered", total: 1000, deliveryOn: ago(5) }); await row("purchase_orders", "p2", { number: "CF-2", supplierId: "s", status: "partial", total: 2000, deliveryOn: new Date(Date.now() + 5 * 864e5).toISOString() }); await row("purchase_orders", "p3", { number: "CF-3", supplierId: "s", status: "received", total: 9999 }); await row("purchase_orders", "p4", { number: "CF-4", supplierId: "s", status: "cancelled", total: 1 });
    const a = await ask("purchases"); const f = facts(a); expect(f["Commandes ouvertes (passées ou partielles)"]).toBe(2); expect(f["Montant des commandes ouvertes (FCFA)"]).toBe(3000); expect(f["En retard de livraison"]).toBe(1); expect(f["Reçues"]).toBe(1); expect(a.observations[0]).toContain("CF-1");
  });
  it("dettes fournisseurs : restes à payer, échues, litiges", async () => {
    await row("invoices", "i1", { number: "F1", kind: "supplier", partyId: "s", total: 5000, paid: 0, status: "unpaid", dueAt: ago(3), disputed: true }); await row("invoices", "i2", { number: "F2", kind: "supplier", partyId: "s", total: 3000, paid: 1000, status: "partial", dueAt: new Date(Date.now() + 9 * 864e5).toISOString() }); await row("invoices", "i3", { number: "F3", kind: "supplier", partyId: "s", total: 800, paid: 800, status: "paid" }); await row("invoices", "i4", { number: "V1", kind: "sale", total: 700, paid: 0, status: "unpaid" });
    const f = facts(await ask("payables")); expect(f["Factures non soldées"]).toBe(2); expect(f["Reste à payer (FCFA)"]).toBe(7000); expect(f["Dont échues (nombre)"]).toBe(1); expect(f["Dont échues (FCFA)"]).toBe(5000); expect(f["Factures en litige"]).toBe(1);
  });
  it("trésorerie : soldes des comptes configurés (module Finance)", async () => {
    await row("fin_accounts", "fa1", { name: "Caisse principale", kind: "cash", methods: JSON.stringify(["cash"]), openingBalance: 10_000, openingDate: ago(40).slice(0, 10), active: true });
    const a = await ask("treasury"); expect(a.title).toBe("Trésorerie"); expect(facts(a)["Solde des comptes configurés (FCFA)"]).toBe(10_000); expect(a.limits.join(" ")).toContain("Indicatif");
  });
  it("clients : actifs, nouveaux, crédit en cours ; aucune donnée nominative", async () => {
    await row("customers", "c1", { name: "Awa Diop", phone: "0700000001", creditLimit: 1000, creditBalance: 400 }); await row("customers", "c2", { name: "Bob", creditLimit: 0, creditBalance: 0 }); await row("customers", "c3", { name: "Ancien", archived: true });
    const a = await ask("customers"); const f = facts(a); expect(f["Clients actifs"]).toBe(2); expect(f["Nouveaux clients (période)"]).toBe(2); expect(f["Clients avec un crédit en cours"]).toBe(1); expect(JSON.stringify(a)).not.toMatch(/Awa|Diop|0700000001/);
  });
  it("pipeline commercial : prospects, opportunités ouvertes, tâches en retard", async () => {
    await row("crm_leads", "l1", { name: "P1", stage: "new" }); await row("crm_leads", "l2", { name: "P2", stage: "won" }); await row("crm_opps", "o1", { title: "A", stage: "qualified", value: 1000 }); await row("crm_opps", "o2", { title: "B", stage: "proposal", value: 2000 }); await row("crm_opps", "o3", { title: "C", stage: "won", value: 9999 });
    await row("crm_tasks", "t1", { title: "x", status: "open", dueAt: ago(2) }); await row("crm_tasks", "t2", { title: "y", status: "open", dueAt: new Date(Date.now() + 864e5).toISOString() }); await row("crm_tasks", "t3", { title: "z", status: "done", dueAt: ago(5) });
    const f = facts(await ask("pipeline")); expect(f["Prospects actifs"]).toBe(1); expect(f["Opportunités ouvertes"]).toBe(2); expect(f["Valeur des opportunités ouvertes (FCFA)"]).toBe(3000); expect(f["Tâches ouvertes"]).toBe(2); expect(f["Tâches en retard"]).toBe(1);
  });
  it("promotions : actives, programmées, utilisations et remises de la période", async () => {
    await row("promotions", "pr1", { name: "Active", kind: "pct", scope: "all", status: "active", startAt: ago(2), endAt: new Date(Date.now() + 5 * 864e5).toISOString() }); await row("promotions", "pr2", { name: "Future", kind: "pct", scope: "all", status: "active", startAt: new Date(Date.now() + 3 * 864e5).toISOString(), endAt: new Date(Date.now() + 9 * 864e5).toISOString() }); await row("promotions", "pr3", { name: "Brouillon", kind: "pct", scope: "all", status: "draft", startAt: ago(2), endAt: new Date(Date.now() + 5 * 864e5).toISOString() });
    await row("promotion_usage", "u1", { promotionId: "pr1", saleId: "s1", discount: 100, usedAt: ago(1) }); await row("promotion_usage", "u2", { promotionId: "pr1", saleId: "s2", discount: 200, usedAt: ago(2) }); await row("promotion_usage", "u3", { promotionId: "pr1", saleId: "s3", discount: 999, usedAt: ago(20) });
    const f = facts(await ask("promos")); expect(f["Promotions actives"]).toBe(1); expect(f["Promotions programmées"]).toBe(1); expect(f["Utilisations (période)"]).toBe(2); expect(f["Remises accordées (FCFA)"]).toBe(300);
  });
  it("inventaires et transferts : décomptes par statut, retards", async () => {
    for (const [i, s] of ["draft", "in_progress", "counted", "review", "validated", "closed"].entries()) await row("inventories", `v${i}`, { number: `I${i}`, status: s, validatedAt: s === "validated" ? ago(4) : null });
    let f = facts(await ask("inventories")); expect(f["Brouillons"]).toBe(1); expect(f["En comptage"]).toBe(1); expect(f["À vérifier (comptés ou en revue)"]).toBe(2); expect(f["Validés ou clôturés"]).toBe(2); expect(f["Dernier inventaire validé"]).toBe(ago(4).slice(0, 10));
    await row("transfers", "x1", { toShopId: B, number: "T1", status: "shipped", dueAt: ago(2) }); await row("transfers", "x2", { toShopId: B, number: "T2", status: "partial", dueAt: new Date(Date.now() + 864e5).toISOString() }); await row("transfers", "x3", { toShopId: B, number: "T3", status: "received" }); await row("transfers", "x4", { toShopId: B, number: "T4", status: "draft" }); await row("transfers", "x5", { toShopId: A, number: "T5", status: "shipped", dueAt: ago(1) }, B);
    f = facts(await ask("transfers")); expect(f["En transit (expédiés ou partiels)"]).toBe(3); expect(f["En retard"]).toBe(2); expect(f["Reçus ou clôturés"]).toBe(1); expect(f["En préparation"]).toBe(1);
  });
  it("investissements et comptabilité : budgets, statuts, écritures à valider", async () => {
    await row("inv_items", "n1", { kind: "project", name: "Magasin", status: "in_progress", budget: 5_000_000 }); await row("inv_items", "n2", { kind: "project", name: "Camion", status: "study", budget: 1_000_000 }); await row("inv_items", "n3", { kind: "project", name: "Annulé", status: "abandoned", budget: 777 }); await row("inv_items", "n4", { kind: "placement", name: "Fonds", status: "active", budget: 0 });
    let a = await ask("invest"); let f = facts(a); expect(f["Budget des projets non abandonnés (FCFA)"]).toBe(6_000_000); expect(f["Projets · En cours"]).toBe(1); expect(f["Projets · En étude"]).toBe(1); expect(f["Placements · En cours"]).toBe(1); expect(a.limits.join(" ")).toContain("Aucun rendement futur");
    const month = new Date().toISOString().slice(0, 7); for (const [i, s] of ["pending", "pending", "draft", "rejected", "validated", "validated"].entries()) await row("acct_entries", `a${i}`, { journal: "OD", date: `${month}-01`, period: i === 5 ? "2020-01" : month, status: s, total: 1 });
    f = facts(await ask("accounting")); expect(f["Écritures à valider"]).toBe(2); expect(f["Brouillons"]).toBe(1); expect(f["Rejetées"]).toBe(1); expect(f["Validées (total)"]).toBe(2); expect(f["Validées (mois en cours)"]).toBe(1);
  });
  it("équipe et valeur du stock : totaux sans noms ; articles sans coût exclus de la valeur", async () => {
    let a = await ask("team", { shopId: undefined }); let f = facts(a); expect(f["Propriétaires"]).toBe(1); expect(f["Gérants"]).toBe(1); expect(f["Caissiers"]).toBe(1); expect(JSON.stringify(a)).not.toMatch(/"cais"|"ger"|motdepasse/);
    await ok(call("own", "article.save", { data: { name: "Eau", price: 500, cost: 300 }, initialQty: 10 }, A)); await ok(call("own", "article.save", { data: { name: "Sans coût", price: 1000, cost: 0 }, initialQty: 4 }, A));
    a = await ask("stockvalue"); f = facts(a); expect(f["Articles en stock"]).toBe(2); expect(f["Articles valorisés (coût connu)"]).toBe(1); expect(f["Articles sans coût"]).toBe(1); expect(f["Valeur au coût (FCFA)"]).toBe(3000); expect(f["Valeur au prix de vente (FCFA)"]).toBe(9000); expect(a.confidence).toBe("medium");
  });
  it("droits : un module non accessible répond « accès refusé » sans chiffres ; périmètre de boutique respecté ; caissier refusé", async () => {
    await row("inv_items", "n1", { kind: "project", name: "Magasin", status: "in_progress", budget: 5_000_000 }); await st.update("staff", U.ger!, { access: JSON.stringify(["pos"]) });
    const d = await ask("invest", {}, "ger"); expect(d.title).toBe("Accès refusé"); expect(d.facts).toEqual([]); const x = await ask("expenses", {}, "ger"); expect(x.title).toBe("Dépenses");
    await expect(call("ger", "md.chat.ask", { requestKey: "req-fixed-777777", qid: "payables", shopId: B })).resolves.toMatchObject({ status: 404 }); await expect(call("cais", "md.chat.ask", { requestKey: "req-fixed-888888", qid: "expenses", shopId: A })).resolves.toMatchObject({ status: 403 });
  });
  it("isolation : les chiffres d'une autre boutique ne se mélangent pas", async () => {
    await row("expenses", "e1", { number: "D1", label: "A", category: "X", amount: 1000, spentOn: ago(1), status: "approved" }); await row("expenses", "e2", { number: "D2", label: "B", category: "X", amount: 7777, spentOn: ago(1), status: "approved" }, B);
    expect(facts(await ask("expenses"))["Dépenses approuvées (FCFA)"]).toBe(1000); expect(facts(await ask("expenses", { shopId: B }))["Dépenses approuvées (FCFA)"]).toBe(7777);
  });
});
