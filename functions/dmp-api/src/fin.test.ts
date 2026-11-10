import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";

const T = "tenantfin00001";
let st: MemoryStore; let A = "", B = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}, shop = A, tenant = T) => handle(st, U[user] ?? user, { action, tenantId: tenant, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); return x.body; };
const setPlan = (plan: string) => { const row = st.rows("subscriptions").find((r) => r.$id === T); const data = { tenantId: T, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", T, T, data); };
const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);
const day = (o = 0) => new Date(Date.now() + o * 864e5).toISOString().slice(0, 10);
let jN = 0;
const jr = (account: string, debit: number, credit: number, label = "Vente V-1", ref = "V-1", date = day(-1), shop = A) => st.create("journal_entries", `jj${++jN}`, T, { tenantId: T, shopId: shop, ref, account, debit, credit, label, date: `${date}T10:00:00.000Z` });
const acct = async (name: string, kind: string, methods: string[], ob: number | null = 10_000, od: string | null = day(-10), user = "ger", shop = A) => (await ok(call(user, "fin.account.save", { requestKey: rid(), name, kind, methods, ...(ob === null ? {} : { openingBalance: ob, openingDate: od }) }, shop))).id as string;
const bal = async (shop = A) => { const r = await ok(call("own", "fin.accounts", {}, shop)); return Object.fromEntries(r.accounts.map((a: any) => [a.name, a.balance])); };

beforeEach(async () => {
  st = new MemoryStore(); await st.grant(T, "own", ["owner"], []); jN = 0;
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId;
  for (const [u, role, shops] of [["cais", "cashier", [A]], ["ger", "manager", [A]], ["gerB", "manager", [B]], ["compta", "accountant", [A]], ["stk", "stockkeeper", [A]]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: shops }, ""))).userId;
  setPlan("business");
});

describe("FinI Business — accès et abonnement", () => {
  it("réservé aux rôles ayant le module comptabilité (propriétaire, gérant, comptable)", async () => {
    for (const u of ["own", "ger", "compta"]) await ok(call(u, "fin.accounts"));
    await err(call("cais", "fin.accounts"), 403); await err(call("stk", "fin.dashboard"), 403);
  });
  it("Starter refusé (402), Business et Pro acceptés ; rétrogradation conserve les données", async () => {
    await acct("Caisse", "cash", ["cash"]); setPlan("starter"); await err(call("own", "fin.accounts"), 402); setPlan("pro"); expect((await ok(call("own", "fin.accounts"))).accounts).toHaveLength(1); setPlan("business"); expect(st.rows("fin_accounts")).toHaveLength(1);
  });
  it("aucune boutique choisie : refus clair", async () => { await err(call("own", "fin.accounts", {}, ""), 400); });
  it("isolation entre boutiques et entre commerces", async () => {
    const a = await acct("Caisse", "cash", ["cash"]); expect((await ok(call("own", "fin.accounts", {}, B))).accounts).toHaveLength(0);
    await err(call("gerB", "fin.accounts", {}, A), 403); await err(call("gerB", "fin.transfer.save", { requestKey: rid(), fromId: a, toId: a, amount: 5, reason: "x" }, B), 404);
  });
});

describe("FinI Business — comptes", () => {
  it("solde non configuré : aucun solde inventé", async () => { await acct("Banque", "bank", ["card"], null); const r = await ok(call("own", "fin.accounts")); expect(r.accounts[0].balance).toBeNull(); expect(r.accounts[0].configured).toBe(false); expect(r.unconfigured).toBe(1); });
  it("solde = ouverture + flux réels du journal (vente, remboursement, règlement), ignore les flux antérieurs", async () => {
    await acct("Caisse", "cash", ["cash"], 10_000, day(-10)); await jr("571", 5000, 0); await jr("571", 0, 1000, "Remboursement vente V-1", "V-1"); await jr("571", 0, 2000, "Règlement F1", "RF-F1"); await jr("571", 9999, 0, "Vente ancienne", "V-0", day(-30)); await jr("571", 300, 0, "Remboursement crédit Awa", "R-AB12");
    expect((await bal()).Caisse).toBe(10_000 + 5000 - 1000 - 2000 + 300);
  });
  it("un moyen de règlement n'alimente qu'un seul compte", async () => { await acct("Caisse", "cash", ["cash"]); await err(call("ger", "fin.account.save", { requestKey: rid(), name: "Coffre", kind: "safe", methods: ["cash"] }), 409, "déjà rattaché"); });
  it("nom unique, type et moyens validés", async () => {
    await acct("Caisse", "cash", ["cash"]); await err(call("ger", "fin.account.save", { requestKey: rid(), name: "caisse", kind: "cash", methods: [] }), 409); await err(call("ger", "fin.account.save", { requestKey: rid(), name: "X1", kind: "or", methods: [] }), 400); await err(call("ger", "fin.account.save", { requestKey: rid(), name: "X2", kind: "bank", methods: ["bitcoin"] }), 400);
    await err(call("ger", "fin.account.save", { requestKey: rid(), name: "X3", kind: "bank", methods: [], openingBalance: 5, openingDate: "2026-02-30" }), 400); await err(call("ger", "fin.account.save", { requestKey: rid(), name: "X4", kind: "bank", methods: [], openingBalance: 5, openingDate: day(5) }), 400);
  });
  it("création idempotente ; le comptable ne crée pas de compte (responsable requis)", async () => {
    const key = rid(); const p = { requestKey: key, name: "Banque", kind: "bank", methods: ["card"] }; const a = await ok(call("ger", "fin.account.save", p)); const b = await ok(call("ger", "fin.account.save", p)); expect(b.duplicate).toBe(true); expect(b.id).toBe(a.id); expect(st.rows("fin_accounts")).toHaveLength(1);
    await err(call("compta", "fin.account.save", { requestKey: rid(), name: "Autre", kind: "bank", methods: [] }), 403);
  });
  it("modification journalisée (avant/après) et désactivation libère les moyens", async () => {
    const id = await acct("Caisse", "cash", ["cash"], 1000); await ok(call("ger", "fin.account.save", { id, openingBalance: 2000, openingDate: day(-10) })); expect(st.rows("audit_log").some((a) => a.action === "fin.account.update" && String(a.detail).includes("\"openingBalance\":1000"))).toBe(true);
    await ok(call("ger", "fin.account.save", { id, active: false })); await acct("Coffre", "safe", ["cash"]);
  });
});

describe("FinI Business — registre des flux", () => {
  it("dépenses immédiates, paiements différés et mouvements de caisse manuels comptés une seule fois", async () => {
    await acct("Caisse", "cash", ["cash"], 10_000); await acct("Mobile", "mobile", ["wave", "mobile"], 0, day(-10));
    await st.create("expenses", "e1", T, { tenantId: T, shopId: A, number: "D-1", label: "Loyer", category: "Loyer", amount: 3000, spentOn: `${day(-2)}T12:00:00.000Z`, method: "cash", status: "approved", payMode: "immediate" });
    await st.create("expenses", "e2", T, { tenantId: T, shopId: A, number: "D-2", label: "Transport", category: "Transport", amount: 4000, spentOn: `${day(-2)}T12:00:00.000Z`, method: "mobile", status: "approved", payMode: "deferred", paidAmount: 1500 });
    await st.create("expense_payments", "p1", T, { tenantId: T, shopId: A, expenseId: "e2", amount: 1500, method: "mobile", source: "external", paidOn: `${day(-1)}T12:00:00.000Z` });
    await st.create("expenses", "e3", T, { tenantId: T, shopId: A, number: "D-3", label: "Annulée", category: "Autre", amount: 777, spentOn: `${day(-2)}T12:00:00.000Z`, method: "cash", status: "cancelled", payMode: "immediate" });
    await st.create("cash_movements", "c1", T, { tenantId: T, shopId: A, kind: "out", amount: 500, reason: "Retrait gérant", status: "authorized", at: `${day(-1)}T08:00:00.000Z` });
    await st.create("cash_movements", "c2", T, { tenantId: T, shopId: A, kind: "out", amount: 3000, reason: "Dépense D-1", status: "authorized", expenseId: "e1", at: `${day(-2)}T08:00:00.000Z` });
    const b = await bal(); expect(b.Caisse).toBe(10_000 - 3000 - 500); expect(b.Mobile).toBe(-1500);
    const f = await ok(call("own", "fin.flows", {})); expect(f.count).toBe(3);
  });
  it("flux non affectés signalés, jamais perdus", async () => { await acct("Caisse", "cash", ["cash"]); await jr("5722", 800, 0, "Vente W", "V-9"); const r = await ok(call("own", "fin.accounts")); expect(r.unassigned).toEqual([expect.objectContaining({ method: "wave", inflow: 800, count: 1 })]); expect((await ok(call("own", "fin.dashboard"))).alerts.some((a: any) => a.text.includes("aucun compte"))).toBe(true); });
  it("filtres, recherche et dates invalides", async () => {
    await acct("Caisse", "cash", ["cash"]); await jr("571", 100, 0, "Vente A", "V-1"); await jr("521", 200, 0, "Vente B", "V-2"); expect((await ok(call("own", "fin.flows", { method: "card" }))).count).toBe(1); expect((await ok(call("own", "fin.flows", { q: "v-1" }))).count).toBe(1); expect((await ok(call("own", "fin.flows", { source: "sale" }))).count).toBe(2);
    await err(call("own", "fin.flows", { from: "2026-02-30" }), 400); await err(call("own", "fin.flows", { from: day(0), to: day(-5) }), 400);
  });
  it("le registre ne contient aucune écriture d'une autre boutique", async () => { await acct("Caisse", "cash", ["cash"]); await jr("571", 100, 0, "Vente A", "V-1", day(-1), A); await jr("571", 999, 0, "Vente B", "V-2", day(-1), B); expect((await bal()).Caisse).toBe(10_100); });
});

describe("FinI Business — virements internes", () => {
  let c = "", k = "";
  beforeEach(async () => { c = await acct("Caisse", "cash", ["cash"], 10_000); k = await acct("Banque", "bank", ["card"], 5000); });
  const save = (o: object = {}) => call("compta", "fin.transfer.save", { requestKey: rid(), fromId: c, toId: k, amount: 4000, reason: "Dépôt bancaire", ...o });
  it("création en attente puis confirmation : le total ne change pas, seuls les comptes bougent", async () => {
    const t = await ok(save()); expect(t.status).toBe("pending"); expect(await bal()).toEqual({ Caisse: 10_000, Banque: 5000 }); await ok(call("compta", "fin.transfer.confirm", { id: t.id })); expect(await bal()).toEqual({ Caisse: 6000, Banque: 9000 });
  });
  it("idempotence : même clé = même virement, confirmation répétée sans double effet", async () => {
    const key = rid(); const a = await ok(save({ requestKey: key })); const b = await ok(save({ requestKey: key })); expect(b.duplicate).toBe(true); expect(st.rows("fin_transfers")).toHaveLength(1);
    await Promise.all([call("compta", "fin.transfer.confirm", { id: a.id }), call("ger", "fin.transfer.confirm", { id: a.id })]); await ok(call("ger", "fin.transfer.confirm", { id: a.id })); expect((await bal()).Caisse).toBe(6000);
  });
  it("validations : comptes distincts, même boutique, montant entier positif, motif, date", async () => {
    await err(save({ toId: c }), 400); await err(save({ amount: 0 }), 400); await err(save({ amount: 1.5 }), 400); await err(save({ amount: -5 }), 400); await err(save({ reason: "" }), 400); await err(save({ date: day(3) }), 400);
    const other = await acct("Autre", "bank", ["transfer"], 0, day(-5), "gerB", B); await err(save({ toId: other }), 404);
  });
  it("solde insuffisant refusé ; un responsable peut forcer avec motif", async () => {
    const t = await ok(save({ amount: 20_000 })); await err(call("compta", "fin.transfer.confirm", { id: t.id }), 409, "Solde insuffisant"); await err(call("compta", "fin.transfer.confirm", { id: t.id, force: true, forceReason: "exceptionnel" }), 403);
    await err(call("ger", "fin.transfer.confirm", { id: t.id, force: true }), 400); await ok(call("ger", "fin.transfer.confirm", { id: t.id, force: true, forceReason: "avance exceptionnelle" })); expect((await bal()).Caisse).toBe(-10_000);
  });
  it("compte sans solde d'ouverture : confirmation refusée", async () => { const x = await acct("Coffre", "safe", ["other"], null); const t = await ok(save({ toId: x })); await err(call("compta", "fin.transfer.confirm", { id: t.id }), 409, "solde d'ouverture"); });
  it("annulation : motif obligatoire, en attente par tout accès, confirmé par un responsable, effet annulé", async () => {
    const t = await ok(save()); await err(call("compta", "fin.transfer.cancel", { id: t.id }), 400); await ok(call("compta", "fin.transfer.cancel", { id: t.id, reason: "erreur de saisie" })); await err(call("ger", "fin.transfer.confirm", { id: t.id }), 409);
    const u = await ok(save()); await ok(call("ger", "fin.transfer.confirm", { id: u.id })); await err(call("compta", "fin.transfer.cancel", { id: u.id, reason: "annulation" }), 403); await ok(call("ger", "fin.transfer.cancel", { id: u.id, reason: "dépôt refusé" })); expect(await bal()).toEqual({ Caisse: 10_000, Banque: 5000 });
    expect((await ok(call("own", "fin.transfers"))).transfers.map((x: any) => x.status).sort()).toEqual(["cancelled", "cancelled"]); expect(st.rows("audit_log").filter((a) => String(a.action).startsWith("fin.transfer")).length).toBeGreaterThanOrEqual(5);
  });
});

describe("FinI Business — rapprochement", () => {
  let c = "";
  beforeEach(async () => { c = await acct("Banque", "bank", ["card"], 10_000); await jr("521", 5000, 0, "Vente A", "V-1", day(-3)); await jr("521", 2000, 0, "Vente B", "V-2", day(-2)); });
  const prev = (o: object = {}) => call("compta", "fin.reconcile.preview", { accountId: c, asOf: day(0), statementBalance: 17_000, statement: [{ date: day(-3), amount: 5000, label: "VIR A" }, { date: day(-2), amount: 2000, label: "VIR B" }], ...o });
  it("propose des correspondances et calcule l'écart", async () => { const p = await ok(prev()); expect(p.bookBalance).toBe(17_000); expect(p.diff).toBe(0); expect(p.suggestions).toHaveLength(2); const q = await ok(prev({ statementBalance: 16_500 })); expect(q.diff).toBe(-500); });
  it("clôture : écart non nul exige une explication ; flux rapprochés ne sont plus proposés ; idempotent", async () => {
    const p = await ok(prev({ statementBalance: 16_500 })); const matched = p.suggestions.map((s: any) => ({ line: s.line, flowKey: s.flowKey })); const key = rid(); const body = { requestKey: key, accountId: c, asOf: day(0), statementBalance: 16_500, statement: [{ date: day(-3), amount: 5000, label: "A" }, { date: day(-2), amount: 2000, label: "B" }], matched, close: true };
    await err(call("compta", "fin.reconcile.save", body), 400, "expliquez"); const r = await ok(call("compta", "fin.reconcile.save", { ...body, note: "Frais bancaires de 500" })); expect(r.status).toBe("closed"); expect((await ok(call("compta", "fin.reconcile.save", { ...body, note: "Frais bancaires de 500" }))).duplicate).toBe(true); expect(st.rows("fin_reconciliations")).toHaveLength(1);
    const again = await ok(prev()); expect(again.suggestions).toHaveLength(0); expect(again.reconciledCount).toBe(2); expect((await ok(call("own", "fin.reconciliations"))).reconciliations[0]).toMatchObject({ diff: -500, status: "closed" });
  });
  it("refuse une correspondance entre montants différents, un doublon ou un flux inconnu", async () => {
    const p = await ok(prev()); const f = p.suggestions[0].flowKey; const base = { accountId: c, asOf: day(0), statementBalance: 17_000, statement: [{ date: day(-3), amount: 9999, label: "A" }, { date: day(-3), amount: 5000, label: "B" }] };
    await err(call("compta", "fin.reconcile.save", { requestKey: rid(), ...base, matched: [{ line: 0, flowKey: f }] }), 400, "montants différents"); await err(call("compta", "fin.reconcile.save", { requestKey: rid(), ...base, matched: [{ line: 1, flowKey: f }, { line: 1, flowKey: f }] }), 400); await err(call("compta", "fin.reconcile.save", { requestKey: rid(), ...base, matched: [{ line: 1, flowKey: "j:inconnu" }] }), 409);
  });
  it("relevé invalide, compte non configuré, compte d'une autre boutique", async () => {
    await err(prev({ statement: [{ date: "2026-02-30", amount: 1 }] }), 400); await err(prev({ statementBalance: "abc" }), 400); const u = await acct("Coffre", "safe", [], null); await err(prev({ accountId: u }), 409); await err(call("gerB", "fin.reconcile.preview", { accountId: c, asOf: day(0), statementBalance: 1 }, B), 404);
  });
});

describe("FinI Business — créances, dettes, budgets, rapports", () => {
  it("échéances par tranche, crédits clients sans échéance, dépenses à payer", async () => {
    await st.create("customers", "c1", T, { tenantId: T, shopId: A, name: "Awa", creditBalance: 700 });
    await st.create("invoices", "i1", T, { tenantId: T, shopId: A, number: "F-1", kind: "customer", partyId: "c1", total: 1000, paid: 400, status: "partial", dueAt: `${day(-40)}T00:00:00.000Z` });
    await st.create("invoices", "i2", T, { tenantId: T, shopId: A, number: "F-2", kind: "customer", partyId: "c1", total: 500, paid: 500, status: "paid", dueAt: `${day(-40)}T00:00:00.000Z` });
    await st.create("invoices", "i3", T, { tenantId: T, shopId: A, number: "FF-1", kind: "supplier", partyId: "s1", total: 3000, paid: 0, status: "unpaid", dueAt: `${day(10)}T00:00:00.000Z` });
    await st.create("expenses", "e9", T, { tenantId: T, shopId: A, number: "D-9", label: "Électricité", category: "Énergie", amount: 900, paidAmount: 300, spentOn: `${day(-5)}T12:00:00.000Z`, status: "approved", payMode: "deferred", dueOn: `${day(-2)}T12:00:00.000Z`, beneficiary: "Senelec" });
    const d = await ok(call("compta", "fin.dues")); expect(d.receivables.total).toBe(600 + 700); expect(d.receivables.overdue).toBe(600); expect(d.receivables.aging.find((x: any) => x.key === "d60").amount).toBe(600); expect(d.receivables.aging.find((x: any) => x.key === "noDue").amount).toBe(700);
    expect(d.payables.total).toBe(3000 + 600); expect(d.payables.dueSoon).toBe(3000); expect(d.payables.overdue).toBe(600);
  });
  it("budgets : enregistrement idempotent par mois et catégorie, dépassement détecté, dépenses sans budget signalées", async () => {
    const m = day(0).slice(0, 7); await st.create("expenses", "e1", T, { tenantId: T, shopId: A, number: "D-1", label: "Loyer", category: "Loyer", amount: 120, spentOn: `${m}-01T12:00:00.000Z`, status: "approved", payMode: "immediate", method: "cash" });
    await st.create("expenses", "e2", T, { tenantId: T, shopId: A, number: "D-2", label: "Pub", category: "Pub", amount: 50, spentOn: `${m}-02T12:00:00.000Z`, status: "approved", payMode: "immediate", method: "cash" });
    await ok(call("ger", "fin.budget.save", { month: m, category: "Loyer", amount: 100 })); const again = await ok(call("ger", "fin.budget.save", { month: m, category: "loyer", amount: 100 })); expect(again.updated).toBe(true); expect(st.rows("fin_budgets")).toHaveLength(1);
    const r = await ok(call("compta", "fin.budgets", { month: m })); expect(r.rows.find((x: any) => x.category === "Loyer")).toMatchObject({ state: "over", remaining: -20 }); expect(r.totals.unbudgeted).toBe(50);
    await err(call("compta", "fin.budget.save", { month: m, category: "Pub", amount: 10 }), 403); await err(call("ger", "fin.budget.save", { month: "2026-13", category: "X1", amount: 1 }), 400); await err(call("ger", "fin.budget.save", { month: m, category: "X1", amount: -1 }), 400);
  });
  it("tableau de bord : position, 30 jours, alertes, perspective indicative", async () => {
    await acct("Caisse", "cash", ["cash"], 1000); await acct("Banque", "bank", ["card"], null); await jr("571", 500, 0); const d = await ok(call("compta", "fin.dashboard")); expect(d.totalConfigured).toBe(1500); expect(d.unconfigured).toBe(1); expect(d.last30.inflow).toBe(500); expect(d.alerts.some((a: any) => a.text.includes("solde d'ouverture"))).toBe(true); expect(d.outlook30.basis).toContain("Indicatif");
  });
  it("rapports : sections, période invalide, export journalisé, isolation boutique", async () => {
    await acct("Caisse", "cash", ["cash"]); await jr("571", 500, 0); await jr("571", 700, 0, "Vente X", "V-X", day(-1), B);
    for (const section of ["flows", "accounts", "dues", "transfers", "budgets"]) { const r = await ok(call("compta", "fin.report", { section, from: day(-30), to: day(0) })); expect(r.sections.length).toBeGreaterThan(0); }
    const f = await ok(call("compta", "fin.report", { section: "flows", from: day(-30), to: day(0) })); expect(f.sections[0].rows).toHaveLength(1); expect(st.rows("audit_log").filter((a) => a.action === "fin.export").length).toBe(6); await err(call("compta", "fin.report", { from: day(0), to: day(-5) }), 400); await err(call("cais", "fin.report", {}), 403);
  });
});
