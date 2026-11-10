import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";

class DatedStore extends MemoryStore { override async create(t: string, id: string, tenant: string, d: Record<string, unknown>) { return super.create(t, id, tenant, { $createdAt: new Date().toISOString(), ...d }); } }
const T = "tenantxp001";
let st: DatedStore; let A = "", B = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}, shop = A, tenant = T) => handle(st, U[user] ?? user, { action, tenantId: tenant, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); return x.body.error as string; };
const setPlan = (plan: string) => { const row = st.rows("subscriptions").find((r) => r.$id === T); const data = { tenantId: T, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", T, T, data); };
const rid = () => crypto.randomUUID().replace(/-/g, "");
const day = (o = 0) => new Date(Date.now() + o * 864e5).toISOString().slice(0, 10);
const month = () => day().slice(0, 7);
const quarter = () => `${day().slice(0, 4)}-Q${Math.ceil(Number(day().slice(5, 7)) / 3)}`;
const exp = (user: string, extra: object = {}, shop = A) => call(user, "expense.create", { requestId: rid(), label: `Dépense ${rid().slice(0, 4)}`, category: "transport", amount: 2000, spentOn: day(), method: "transfer", source: "external", beneficiary: "Moussa", ...extra }, shop);
const sess = async (user: string, float = 100000, shop = A) => ok(call(user, "cash.open", { openingFloat: float }, shop));
const theo = async (user: string) => (await ok(call(user, "cash.current"))).totals.theoreticalCash as number;
const get = async (id: string, user = "own") => ok(call(user, "expense.get", { id }));
const budgetRaw = (extra: object = {}, user = "own") => call(user, "exppro.budget.save", { shopId: "", kind: "month", key: month(), category: "transport", amount: 50000, mode: "approval", ...extra });
const budget = (extra: object = {}, user = "own") => ok(budgetRaw(extra, user));

beforeEach(async () => {
  st = new DatedStore(); await st.grant(T, "own", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId;
  for (const [u, role, shops] of [["cais", "cashier", [A]], ["ger", "manager", [A]], ["ger2", "manager", [A]], ["gerB", "manager", [B]]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: shops }, ""))).userId;
  setPlan("pro"); await ok(call("own", "expense.settings", { codeRequired: false }));
});

describe("abonnement : Business ↔ Pro sans perte ni doublon", () => {
  it("Business : toute fonction Pro refusée (402) et champs Pro refusés à la création ; Starter idem", async () => {
    setPlan("business"); for (const [a, p] of [["exppro.budget.save", { kind: "month", key: month(), amount: 1 }], ["exppro.budgets", {}], ["exppro.plans.generate", {}], ["expense.pay", { id: "x" }], ["expense.reallocate", { id: "x" }], ["exppro.config", {}]] as const) await err(call("own", a, p), 402, "Pro");
    await err(exp("own", { payMode: "deferred", dueOn: day(5) }), 402, "Pro"); await err(exp("own", { service: "Atelier" }), 402); await ok(exp("own")); setPlan("starter"); await err(call("own", "exppro.budgets", {}), 402);
  });
  it("redescente puis remontée : budgets, échéances, paiements et dépenses conservés (aucun doublon) ; en Business les dépenses Pro restent lisibles et le circuit reste appliqué", async () => {
    await budget({ amount: 10000 }); await ok(call("own", "exppro.rule.save", { name: "Gros", minAmount: 100000, levels: ["manager", "owner"] })); const d = await ok(exp("ger", { amount: 120000, payMode: "deferred", dueOn: day(10), service: "Atelier" })); expect(d.status).toBe("pending");
    const before = [st.rows("expenses").length, st.rows("expense_config").length]; setPlan("business"); const g = await get(d.id); expect(g).toMatchObject({ payMode: "deferred", dueOn: day(10), service: "Atelier", lifecycle: "pending" }); expect(g.levels).toEqual(["manager", "owner"]); expect((await ok(call("own", "expense.list", {}))).expenses.length).toBe(1);
    const p = await ok(call("ger2", "expense.decide", { id: d.id, approve: true })); expect(p).toMatchObject({ status: "pending", level: 1, of: 2 }); await err(call("ger2", "expense.decide", { id: d.id, approve: true }), 403, "déjà validé"); await err(call("gerB", "expense.decide", { id: d.id, approve: true }), 403); // circuit appliqué quel que soit l'abonnement
    expect(await ok(call("own", "expense.decide", { id: d.id, approve: true }))).toMatchObject({ status: "approved" }); await err(call("own", "expense.pay", { id: d.id, requestKey: rid(), amount: 1 }), 402);
    setPlan("pro"); expect([st.rows("expenses").length, st.rows("expense_config").length]).toEqual(before); expect((await ok(call("own", "expense.pay", { id: d.id, requestKey: rid(), amount: 20000 }))).remaining).toBe(100000); expect((await ok(call("own", "exppro.budgets", {}))).budgets.length).toBe(1);
  });
});

describe("budgets et alertes de dépassement", () => {
  it("jamais de validation automatique en cas de dépassement : gérant → en attente, autre responsable valide ; propriétaire → confirmation motivée tracée", async () => {
    await budget(); expect((await ok(exp("ger", { amount: 30000 }))).status).toBe("approved"); const o = await ok(exp("ger", { amount: 25000 })); expect(o.status).toBe("pending"); expect(o.alerts.some((a: any) => a.code === "overrun" && /dépassé de 5\D000/.test(a.message))).toBe(true);
    const g = await get(o.id); expect(g.reasons[0]).toContain("Budget transport"); expect(g.status).toBe("pending"); await err(call("ger", "expense.decide", { id: o.id, approve: true }), 403, "propre dépense"); expect((await ok(call("ger2", "expense.decide", { id: o.id, approve: true, note: "ok" }))).status).toBe("approved");
    const e1 = await err(exp("own", { amount: 1000 }), 409, "BUDGET_DEPASSE"); expect(e1).toContain("motif"); await err(exp("own", { amount: 1000, overrideBudget: true, overrideReason: "x" }), 409); const ov = await ok(exp("own", { amount: 1000, overrideBudget: true, overrideReason: "Urgence réparation" })); expect(ov.status).toBe("approved"); expect((await get(ov.id)).override).toMatchObject({ reason: "Urgence réparation" });
  });
  it("annulée et rejetée libèrent le budget ; en attente compté à part ; alerte à 90 % ; budget de boutique, de trimestre et de service", async () => {
    await budget({ amount: 100000 }); const a = await ok(exp("ger", { amount: 85000 })); expect((await ok(exp("ger", { amount: 7000 }))).alerts.some((x: any) => x.code === "budget_near")).toBe(true);
    const x = await ok(exp("ger", { amount: 20000 })); expect(x.status).toBe("pending"); let s = (await ok(call("own", "exppro.budgets", { kind: "month" }))).budgets[0]; expect(s).toMatchObject({ realized: 92000, pending: 20000, committed: 112000, over: true }); await ok(call("ger2", "expense.decide", { id: x.id, approve: false, note: "Trop élevé" }));
    s = (await ok(call("own", "exppro.budgets", {}))).budgets[0]; expect(s).toMatchObject({ pending: 0, committed: 92000, over: false, remaining: 8000 }); await ok(call("own", "expense.cancel", { id: a.id, reason: "Facture annulée" })); expect((await ok(call("own", "exppro.budgets", {}))).budgets[0].committed).toBe(7000);
    await budget({ kind: "quarter", key: quarter(), category: "", amount: 1000000, shopId: B }); await budget({ category: "", service: "Atelier", amount: 5000 }); expect((await ok(exp("ger", { amount: 6000, category: "eau", service: "Atelier" }))).status).toBe("pending"); expect((await ok(exp("ger", { amount: 6000, category: "eau" }))).status).toBe("approved");
    expect((await ok(call("own", "exppro.budgets", { kind: "quarter", key: quarter() }))).budgets[0]).toMatchObject({ shop: "Thiès", realized: 0 });
  });
  it("budget bloquant : refusé (403) pour un responsable, propriétaire avec motif ; réponses 400 sur période/montant invalides ; seul un responsable de la boutique configure sa boutique", async () => {
    await budget({ mode: "block", amount: 5000 }); await err(exp("ger", { amount: 6000 }), 403, "BUDGET_BLOQUANT"); expect((await ok(exp("own", { amount: 6000, overrideBudget: true, overrideReason: "Décision du propriétaire" }))).status).toBe("approved");
    await err(budgetRaw({ key: "2026-13" }), 400, "Période"); await err(budgetRaw({ amount: 0 }), 400); await err(budgetRaw({ kind: "decade" }), 400); await err(budgetRaw({ category: "inconnue" }), 400, "Catégorie");
    await err(budgetRaw({ shopId: "" }, "ger"), 403, "propriétaire"); await err(budgetRaw({ shopId: B }, "ger"), 403); await budget({ shopId: A, category: "eau" }, "ger"); await err(call("cais", "exppro.budget.save", { shopId: A, kind: "month", key: month(), amount: 1000 }), 403);
    const again = await budget({ amount: 8000, mode: "block" }); expect(again.updated).toBe(true); expect(st.rows("expense_config").filter((r) => r.type === "budget" && JSON.parse(String(r.config)).category === "transport").length).toBe(1); expect(st.rows("audit_log").some((l) => l.action === "exppro.budget.save" && String(l.detail).includes("8000"))).toBe(true);
  });
});

describe("plafonds par responsable et circuit d'approbation", () => {
  it("plafond par dépense et mensuel : dépassement → autorisation d'un autre responsable ; employé hors boutique introuvable", async () => {
    await ok(call("own", "exppro.limit.save", { userId: U.ger!, perExpense: 20000, perMonth: 50000 })); expect((await ok(exp("ger", { amount: 15000 }))).status).toBe("approved"); const o = await ok(exp("ger", { amount: 25000 })); expect(o.status).toBe("pending"); expect((await get(o.id)).reasons[0]).toContain("Plafond par dépense");
    const m = await ok(exp("ger", { amount: 15000, label: "autre" })); expect(m.status).toBe("pending"); expect((await get(m.id)).reasons[0]).toContain("Plafond mensuel"); expect((await ok(exp("ger2", { amount: 90000 }))).status).toBe("approved"); await err(call("own", "exppro.limit.save", { userId: "inconnu" }), 404);
  });
  it("circuit à 2 niveaux (gérant puis propriétaire) : en attente tant que tout n'est pas validé, sans effet sur la caisse ; le gérant ne franchit pas un niveau propriétaire ; le propriétaire franchit seul ; rejet motivé à tout niveau", async () => {
    await err(call("ger", "exppro.rule.save", { name: "X", levels: ["owner"] , shopId: A }), 403, "propriétaire"); await ok(call("own", "exppro.rule.save", { name: "Gros montants", minAmount: 100000, levels: ["manager", "owner"] })); await sess("ger", 500000); const e = await ok(exp("ger", { amount: 150000, source: "till", method: "cash" })); expect(e).toMatchObject({ status: "pending", levels: ["manager", "owner"] });
    expect(await theo("ger")).toBe(500000); const l1 = await ok(call("ger2", "expense.decide", { id: e.id, approve: true })); expect(l1).toMatchObject({ status: "pending", level: 1, of: 2 }); expect(await theo("ger")).toBe(500000); await err(call("ger2", "expense.decide", { id: e.id, approve: true }), 403, "déjà validé");
    await err(call("ger", "expense.decide", { id: e.id, approve: true }), 403, "propre dépense"); const d1 = await get(e.id); expect(d1.approvals.length).toBe(1); expect(d1.approvals[0].name).toBe("ger2"); expect(d1.status).toBe("pending");
    const fin = await ok(call("own", "expense.decide", { id: e.id, approve: true })); expect(fin.status).toBe("approved"); expect(await theo("ger")).toBe(350000); const d2 = await get(e.id); expect(d2.events.map((x: any) => x.kind)).toEqual(["create", "approve_level", "approve"]);
    const o = await ok(exp("own", { amount: 200000, source: "external" })); expect(o.status).toBe("approved"); expect((await get(o.id)).approvals.length).toBe(2); expect((await get(o.id)).approvals[0].tier).toBe("owner");
    const r = await ok(exp("ger", { amount: 300000, label: "Rejetée" })); await ok(call("ger2", "expense.decide", { id: r.id, approve: true })); await err(call("own", "expense.decide", { id: r.id, approve: false }), 400, "Motif"); await ok(call("own", "expense.decide", { id: r.id, approve: false, note: "Non prévu" })); expect((await get(r.id)).status).toBe("rejected");
  });
  it("circuit et code : le vendeur saisit successivement les codes de deux responsables ; sortie de caisse seulement au dernier niveau ; règles par catégorie et boutique ; règle désactivée ignorée", async () => {
    await ok(call("own", "expense.settings", { codeRequired: true })); const r = await ok(call("own", "exppro.rule.save", { name: "Salaires", category: "salaires", minAmount: 0, levels: ["manager", "manager"] })); await sess("cais", 300000); const e = await ok(exp("cais", { amount: 80000, category: "salaires", source: "till", method: "cash" })); expect(e).toMatchObject({ status: "pending", awaitingCode: true, levels: ["manager", "manager"] });
    const c1 = (await ok(call("ger", "expense.code", { id: e.id }))).code; const p = await ok(call("cais", "expense.code.validate", { id: e.id, code: c1 })); expect(p).toMatchObject({ status: "pending", level: 1, of: 2 }); expect(await theo("cais")).toBe(300000); await err(call("cais", "expense.code.validate", { id: e.id, code: c1 }), 403);
    const c2 = (await ok(call("ger2", "expense.code", { id: e.id }))).code; expect((await ok(call("cais", "expense.code.validate", { id: e.id, code: c2 }))).status).toBe("approved"); expect(await theo("cais")).toBe(220000); expect(st.rows("cash_movements")[0]).toMatchObject({ authorizedBy: U.ger2 });
    await ok(call("own", "exppro.toggle", { id: r.id, active: false })); expect((await ok(exp("ger", { amount: 1000, category: "salaires" }))).status).toBe("approved");
  });
});

describe("paiements partiels, solde restant, échéances", () => {
  const deferred = async (amount = 100000, user = "ger", extra: object = {}) => ok(exp(user, { amount, payMode: "deferred", dueOn: day(15), ...extra }));
  it("dépense à payer plus tard : validée sans sortie de caisse ; paiements partiels (compte externe puis caisse) ; solde restant exact ; trop-payé refusé ; soldée → payée", async () => {
    const d = await deferred(); expect(d.status).toBe("approved"); expect(st.rows("cash_movements").length).toBe(0); let g = await get(d.id); expect(g).toMatchObject({ lifecycle: "committed", paid: 0, remaining: 100000, payMode: "deferred", dueOn: day(15) });
    const k1 = rid(); expect(await ok(call("ger", "expense.pay", { id: d.id, requestKey: k1, amount: 40000, method: "transfer", reference: "VIR-1" }))).toMatchObject({ paid: 40000, remaining: 60000, settled: false }); expect((await ok(call("ger", "expense.pay", { id: d.id, requestKey: k1, amount: 40000, method: "transfer" }))).duplicate).toBe(true);
    g = await get(d.id); expect(g).toMatchObject({ lifecycle: "partial", paid: 40000, remaining: 60000 }); await err(call("ger", "expense.pay", { id: d.id, requestKey: rid(), amount: 70000, method: "transfer" }), 409, "dépasse le solde restant"); await err(call("ger", "expense.pay", { id: d.id, requestKey: rid(), amount: 10000, source: "till" }), 409, "Ouvrez la caisse");
    await sess("ger", 50000); expect(await ok(call("ger", "expense.pay", { id: d.id, requestKey: rid(), amount: 30000, source: "till" }))).toMatchObject({ remaining: 30000 }); expect(await theo("ger")).toBe(20000); expect(st.rows("cash_movements")[0]).toMatchObject({ expenseId: d.id, amount: 30000 }); await err(call("ger", "expense.pay", { id: d.id, requestKey: rid(), amount: 30000, source: "till" }), 409, "Solde de caisse insuffisant");
    expect((await ok(call("ger", "expense.pay", { id: d.id, requestKey: rid(), amount: 30000, method: "mobile" }))).settled).toBe(true); g = await get(d.id); expect(g).toMatchObject({ lifecycle: "paid", remaining: 0 }); expect(g.events.map((x: any) => x.kind)).toEqual(["create", "approve", "payment", "payment", "paid"]); await err(call("ger", "expense.pay", { id: d.id, requestKey: rid(), amount: 1, method: "mobile" }), 409, "dépasse");
    const ps = await ok(call("ger", "expense.payments", { id: d.id })); expect(ps.payments.map((p: any) => [p.amount, p.source])).toEqual([[40000, "external"], [30000, "till"], [30000, "external"]]); expect(ps.paid).toBe(100000);
  });
  it("règles : dépense immédiate déjà payée ; en attente non payable ; échéance obligatoire et cohérente ; annulation impossible après paiement ; deux paiements simultanés = un seul ; panne = rien d'écrit", async () => {
    const im = await ok(exp("ger", { amount: 5000 })); expect(await get(im.id)).toMatchObject({ lifecycle: "paid", paid: 5000, remaining: 0 }); await err(call("ger", "expense.pay", { id: im.id, requestKey: rid(), amount: 1, method: "transfer" }), 409, "payée à sa validation");
    await ok(call("own", "exppro.rule.save", { name: "Gros", minAmount: 50000, levels: ["manager"] })); const pend = await deferred(60000, "ger"); expect(pend.status).toBe("pending"); await err(call("ger", "expense.pay", { id: pend.id, requestKey: rid(), amount: 1, method: "transfer" }), 409, "validée");
    await err(exp("ger", { payMode: "deferred" }), 400, "échéance"); await err(exp("ger", { payMode: "deferred", dueOn: day(-3) }), 400, "précéder"); await err(exp("ger", { payMode: "plus tard", dueOn: day(3) }), 400);
    const d = await deferred(30000, "own"); const bad = rid(); st.failBatchAfter = 1; expect((await call("own", "expense.pay", { id: d.id, requestKey: bad, amount: 10000, method: "transfer" })).status).toBeGreaterThanOrEqual(500); expect(st.rows("expense_payments").length).toBe(0); expect((await get(d.id)).paid).toBe(0); await ok(call("own", "expense.pay", { id: d.id, requestKey: bad, amount: 10000, method: "transfer" }));
    const r = await Promise.all([call("own", "expense.pay", { id: d.id, requestKey: rid(), amount: 20000, method: "transfer" }), call("ger", "expense.pay", { id: d.id, requestKey: rid(), amount: 20000, method: "transfer" })]); expect(r.map((x) => x.status).sort()).toEqual([200, 409]); expect((await get(d.id)).paid).toBe(30000);
    await err(call("own", "expense.cancel", { id: d.id, reason: "Erreur de saisie" }), 409, "paiements"); const z = await deferred(1000, "own"); expect((await ok(call("own", "expense.cancel", { id: z.id, reason: "Erreur de saisie" }))).status).toBe("cancelled"); await err(call("cais", "expense.pay", { id: d.id, requestKey: rid(), amount: 1, method: "transfer" }), 403);
  });
});

describe("dépenses récurrentes et planifiées", () => {
  const recRaw = (extra: object = {}, user = "ger") => call(user, "exppro.recurring.save", { label: "Loyer", category: "loyer", amount: 150000, frequency: "monthly", startOn: day(-40), beneficiary: "Bailleur", method: "transfer", shopId: A, ...extra });
  const rec = (extra: object = {}, user = "ger") => ok(recRaw(extra, user));
  it("génération idempotente (même en parallèle) des échéances à venir ; conversion en dépense à payer sans doublon ; passage ignoré motivé ; le planifié compte dans le budget à part", async () => {
    await rec(); const g1 = await ok(call("ger", "exppro.plans.generate", { days: 60 })); expect(g1.created).toBeGreaterThanOrEqual(2); const n = st.rows("expense_config").filter((r) => r.type === "plan").length; expect(n).toBe(g1.created); const g2 = await Promise.all([call("ger", "exppro.plans.generate", { days: 60 }), call("own", "exppro.plans.generate", { days: 60 })]); expect(g2.every((x) => x.status === 200)).toBe(true); expect(st.rows("expense_config").filter((r) => r.type === "plan").length).toBe(n);
    const plans = (await ok(call("ger", "exppro.plans.list", {}))).plans; expect(plans.every((p: any) => p.dueOn >= day() && p.status === "planned" && p.shop === "Dakar")).toBe(true); const p0 = plans[0];
    await budget({ category: "loyer", amount: 400000, key: p0.dueOn.slice(0, 7) }); await budget({ category: "loyer", amount: 400000, key: month() }); const bs = (await ok(call("own", "exppro.budgets", { kind: "month", key: p0.dueOn.slice(0, 7) }))).budgets[0]; expect(bs.planned).toBeGreaterThanOrEqual(150000); expect(bs.realized).toBe(0);
    const c = await ok(call("ger", "exppro.plan.convert", { id: p0.id })); expect(c.status).toBe("approved"); const g = await get(c.id); expect(g).toMatchObject({ payMode: "deferred", dueOn: p0.dueOn, label: "Loyer", amount: 150000, recurringId: p0.recurringId, lifecycle: "committed" }); const c2 = await ok(call("ger", "exppro.plan.convert", { id: p0.id })); expect(c2.id).toBe(c.id); expect(st.rows("expenses").length).toBe(1);
    await err(call("ger", "exppro.plan.skip", { id: plans[1].id, reason: "x" }), 400); expect((await ok(call("ger", "exppro.plan.skip", { id: plans[1].id, reason: "Local gratuit ce mois" }))).status).toBe("skipped"); await err(call("ger", "exppro.plan.convert", { id: plans[1].id }), 409, "déjà traitée"); expect((await ok(call("ger", "exppro.plans.list", { status: "skipped" }))).plans.length).toBe(1);
    const bs2 = (await ok(call("own", "exppro.budgets", { kind: "month", key: g.spentOn.slice(0, 7) }))).budgets[0]; expect(bs2.realized).toBe(150000); // la dépense compte à sa date (aujourd'hui si convertie avant l'échéance), le reste du planifié reste « planifié »
  });
  it("modèles : fréquences et validations ; responsable limité à sa boutique ; désactivé = plus d'échéances nouvelles (les existantes et l'historique restent)", async () => {
    await err(recRaw({ frequency: "chaque lune" }), 400); await err(recRaw({ startOn: "demain" }), 400); await err(recRaw({ endOn: day(-100) }), 400); await err(recRaw({ dayOfMonth: 40 }), 400); await err(recRaw({ shopId: B }), 403); await err(recRaw({ amount: 0 }), 400); await err(recRaw({}, "cais"), 403);
    const r = await rec({ frequency: "weekly", label: "Gardiennage", amount: 20000, startOn: day(0) }); const g = await ok(call("ger", "exppro.plans.generate", { days: 30 })); expect(g.created).toBeGreaterThanOrEqual(4); await ok(call("ger", "exppro.toggle", { id: r.id, active: false })); const before = st.rows("expense_config").filter((x) => x.type === "plan").length; await ok(call("ger", "exppro.plans.generate", { days: 60 })); expect(st.rows("expense_config").filter((x) => x.type === "plan").length).toBe(before);
    expect(st.rows("expense_config").find((x) => x.$id === r.id)!.active).toBe(false); expect((await ok(call("gerB", "exppro.plans.list", {}, B))).plans).toEqual([]);
  });
});

describe("ventilation entre boutiques et corrections", () => {
  it("le propriétaire ventile (pourcentages ou montants, somme exacte) ; un responsable local ne le peut pas ; le budget de chaque boutique compte sa part ; correction tracée avant/après avec motif", async () => {
    await budget({ shopId: B, category: "", amount: 100000 }); await err(exp("ger", { amount: 100000, allocations: [{ shopId: A, pct: 60 }, { shopId: B, pct: 40 }] }), 403, "propriétaire"); await err(exp("own", { amount: 100000, allocations: [{ shopId: A, pct: 60 }, { shopId: B, pct: 30 }] }), 400, "100 %"); await err(exp("own", { amount: 100000, allocations: [{ shopId: A, amount: 60000 }, { shopId: B, amount: 30000 }] }), 400); await err(exp("own", { amount: 100000, allocations: [{ shopId: "inconnue", pct: 100 }] }), 404);
    const e = await ok(exp("own", { amount: 100001, label: "Facture commune", allocations: [{ shopId: A, pct: 60 }, { shopId: B, pct: 40 }] })); const g = await get(e.id); expect(g.allocations).toEqual([{ shopId: A, amount: 60001 }, { shopId: B, amount: 40000 }]); expect((await ok(call("own", "exppro.budgets", {}))).budgets[0]).toMatchObject({ realized: 40000 });
    await err(call("ger", "expense.reallocate", { id: e.id, allocations: [{ shopId: A, pct: 100 }], reason: "Correction" }), 403); await err(call("own", "expense.reallocate", { id: e.id, allocations: [{ shopId: A, pct: 100 }], reason: "ok" }), 400, "Motif"); await ok(call("own", "expense.reallocate", { id: e.id, allocations: [{ shopId: A, amount: 50001 }, { shopId: B, amount: 50000 }], reason: "Clé de répartition revue" }));
    const g2 = await get(e.id); expect(g2.allocations[1].amount).toBe(50000); const ev = g2.events.find((x: any) => x.kind === "reallocate"); expect(ev.detail.before[1].amount).toBe(40000); expect(ev.detail.reason).toBe("Clé de répartition revue"); expect((await ok(call("own", "exppro.budgets", {}))).budgets[0].realized).toBe(50000); expect(st.rows("expenses").length).toBe(1);
    await ok(call("own", "expense.cancel", { id: e.id, reason: "Facture annulée" })); await err(call("own", "expense.reallocate", { id: e.id, allocations: [{ shopId: A, pct: 100 }], reason: "Trop tard" }), 409);
  });
});
