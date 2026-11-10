import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";

const T = "tenantfinpro01";
let st: MemoryStore; let A = "", B = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}, shop = A, tenant = T) => handle(st, U[user] ?? user, { action, tenantId: tenant, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); return x.body.error as string; };
const setPlan = (plan: string) => { const row = st.rows("subscriptions").find((r) => r.$id === T); const data = { tenantId: T, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", T, T, data); };
const rid = () => `k${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
const day = (o = 0) => new Date(Date.now() + o * 864e5).toISOString().slice(0, 10);
let jN = 0;
const jr = (account: string, debit: number, credit: number, label: string, date: string, shop: string) => st.create("journal_entries", `jq${++jN}`, T, { tenantId: T, shopId: shop, ref: `V-${jN}`, account, debit, credit, label, date: `${date}T10:00:00.000Z` });
const acct = async (shop: string, name = "Caisse", ob = 10_000) => (await ok(call("own", "fin.account.save", { requestKey: rid(), name, kind: "cash", methods: ["cash"], openingBalance: ob, openingDate: day(-40) }, shop))).id as string;
/** 25 jours de ventes en espèces (1000/jour) dans la boutique */
const history = async (shop: string, days = 25) => { for (let i = 1; i <= days; i++) await jr("571", 1000, 0, `Vente ${i}`, day(-i), shop); };
const fc = (user: string, extra: object = {}, shop = A) => call(user, "finpro.forecast", { days: 30, ...extra }, shop);

beforeEach(async () => {
  st = new MemoryStore(); await st.grant(T, "own", ["owner"], []); jN = 0;
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId;
  for (const [u, role, shops] of [["ger", "manager", [A]], ["gerB", "manager", [B]], ["gerAB", "manager", [A, B]], ["compta", "accountant", [A]], ["cais", "cashier", [A]]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: shops }, ""))).userId;
  setPlan("pro");
});

describe("FinI Pro — abonnement et droits", () => {
  it("Business : actions Pro refusées (402), lecture de l'historique conservée ; Pro → Business ne supprime rien", async () => {
    const id = (await ok(call("own", "finpro.plan.save", { requestKey: rid(), kind: "out", label: "Loyer", amount: 50_000, dueOn: day(5) }))).id; setPlan("business");
    await err(call("own", "finpro.plan.save", { requestKey: rid(), kind: "out", label: "X1", amount: 1, dueOn: day(5) }), 402); await err(fc("own"), 402); await err(call("own", "finpro.rules.save", { rules: {} }), 402); await err(call("own", "finpro.plan.done", { id, reference: "FAC-1" }), 402);
    expect((await ok(call("own", "finpro.plans"))).plans).toHaveLength(1); await ok(call("own", "finpro.rules")); await ok(call("own", "finpro.scenarios")); expect(st.rows("fin_plans")).toHaveLength(1);
  });
  it("Starter refusé ; caissier/magasinier refusés ; comptable accepté", async () => { setPlan("starter"); await err(call("own", "finpro.plans"), 402); setPlan("pro"); await err(call("cais", "finpro.plans"), 403); await ok(call("compta", "finpro.plans")); });
  it("consolidation : le propriétaire voit toutes les boutiques, un gérant seulement les siennes, le comptable est refusé", async () => {
    await acct(A); await acct(B, "Caisse B");
    expect((await ok(fc("own", { scope: "all" }))).shops.map((s: any) => s.name).sort()).toEqual(["Dakar", "Thiès"]); expect((await ok(fc("ger", { scope: "all" }))).shops.map((s: any) => s.name)).toEqual(["Dakar"]); expect((await ok(fc("gerB", { scope: "all" }, B))).shops.map((s: any) => s.name)).toEqual(["Thiès"]);
    expect((await ok(fc("gerAB", { scope: "all" }))).shops).toHaveLength(2); await err(fc("compta", { scope: "all" }), 403); await err(fc("gerB", {}, A), 403);
    expect((await ok(call("own", "finpro.consolidated"))).totals).toMatchObject({ shops: 2, shopsConfigured: 2, balance: 20_000 }); expect((await ok(call("gerB", "finpro.consolidated", {}, B))).shops).toHaveLength(1);
  });
});

describe("FinI Pro — seuils d'approbation", () => {
  it("seuils : propriétaire seul les modifie, valeurs validées, journalisés", async () => {
    await err(call("ger", "finpro.rules.save", { rules: { minCash: 1 } }), 403); await err(call("own", "finpro.rules.save", { rules: { transfer: { managerFrom: 500, ownerFrom: 100 } } }), 400); await err(call("own", "finpro.rules.save", { rules: { minCash: -5 } }), 400);
    await ok(call("own", "finpro.rules.save", { rules: { minCash: 5000, transfer: { managerFrom: 100_000, ownerFrom: 1_000_000 }, plan: { managerFrom: 50_000, ownerFrom: 500_000 } } })); expect((await ok(call("compta", "finpro.rules"))).rules.transfer.ownerFrom).toBe(1_000_000); expect(st.rows("audit_log").some((a) => a.action === "finpro.rules")).toBe(true);
  });
  it("virement : au-dessus du seuil, le comptable est refusé, le gérant agit jusqu'au seuil propriétaire, le propriétaire au-delà", async () => {
    const c = await acct(A, "Caisse", 5_000_000); const k = await ok(call("own", "fin.account.save", { requestKey: rid(), name: "Banque", kind: "bank", methods: ["card"], openingBalance: 0, openingDate: day(-40) })); await ok(call("own", "finpro.rules.save", { rules: { transfer: { managerFrom: 100_000, ownerFrom: 1_000_000 } } }));
    const tr = async (amount: number) => (await ok(call("compta", "fin.transfer.save", { requestKey: rid(), fromId: c, toId: k.id, amount, reason: "Dépôt" }))).id;
    const small = await tr(50_000); await ok(call("compta", "fin.transfer.confirm", { id: small })); const mid = await tr(200_000); await err(call("compta", "fin.transfer.confirm", { id: mid }), 403, "Gérant ou propriétaire"); await ok(call("ger", "fin.transfer.confirm", { id: mid }));
    const big = await tr(1_500_000); await err(call("ger", "fin.transfer.confirm", { id: big }), 403, "Propriétaire"); await ok(call("own", "fin.transfer.confirm", { id: big }));
  });
  it("sans formule Pro, aucun seuil n'est appliqué (Business inchangé)", async () => { const c = await acct(A, "Caisse", 5_000_000); const k = await ok(call("own", "fin.account.save", { requestKey: rid(), name: "Banque", kind: "bank", methods: ["card"], openingBalance: 0, openingDate: day(-40) })); await ok(call("own", "finpro.rules.save", { rules: { transfer: { managerFrom: 1000 } } })); setPlan("business"); const t = await ok(call("compta", "fin.transfer.save", { requestKey: rid(), fromId: c, toId: k.id, amount: 500_000, reason: "Dépôt" })); await ok(call("compta", "fin.transfer.confirm", { id: t.id })); });
  it("paiements planifiés : en attente au-dessus du seuil, pas d'auto-approbation par un gérant, décision tracée et idempotente", async () => {
    await ok(call("own", "finpro.rules.save", { rules: { plan: { managerFrom: 50_000, ownerFrom: 500_000 } } })); const key = rid(); const p = await ok(call("compta", "finpro.plan.save", { requestKey: key, kind: "out", label: "Fournisseur Sané", amount: 80_000, dueOn: day(10) })); expect(p.status).toBe("pending"); expect((await ok(call("compta", "finpro.plan.save", { requestKey: key, kind: "out", label: "Fournisseur Sané", amount: 80_000, dueOn: day(10) }))).duplicate).toBe(true); expect(st.rows("fin_plans")).toHaveLength(1);
    await err(call("compta", "finpro.plan.approve", { id: p.id, decision: "approve" }), 403); const mine = await ok(call("ger", "finpro.plan.save", { requestKey: rid(), kind: "out", label: "Réparation", amount: 90_000, dueOn: day(3) })); await err(call("ger", "finpro.plan.approve", { id: mine.id, decision: "approve" }), 403, "propre paiement");
    await ok(call("ger", "finpro.plan.approve", { id: p.id, decision: "approve" })); expect((await ok(call("ger", "finpro.plan.approve", { id: p.id, decision: "approve" }))).duplicate).toBe(true); await err(call("ger", "finpro.plan.approve", { id: p.id, decision: "reject", note: "trop tard" }), 409);
    const big = await ok(call("compta", "finpro.plan.save", { requestKey: rid(), kind: "out", label: "Machine", amount: 700_000, dueOn: day(20) })); await err(call("ger", "finpro.plan.approve", { id: big.id, decision: "approve" }), 403, "Propriétaire"); await err(call("own", "finpro.plan.approve", { id: big.id, decision: "reject" }), 400); await ok(call("own", "finpro.plan.approve", { id: big.id, decision: "reject", note: "Hors budget" }));
    const pl = (await ok(call("own", "finpro.plans"))).plans; expect(pl.find((x: any) => x.id === p.id).approvals[0].decision).toBe("approve"); expect(pl.find((x: any) => x.id === big.id).status).toBe("rejected");
  });
  it("encaissement planifié sans approbation ; réalisé exige la référence d'une pièce réelle ; annulation motivée", async () => {
    const e = await ok(call("compta", "finpro.plan.save", { requestKey: rid(), kind: "in", label: "Client Diop", amount: 30_000, dueOn: day(4) })); expect(e.status).toBe("planned"); await err(call("compta", "finpro.plan.done", { id: e.id }), 400, "Référence"); await ok(call("compta", "finpro.plan.done", { id: e.id, reference: "F-2026-12" })); await err(call("compta", "finpro.plan.cancel", { id: e.id, reason: "erreur" }), 409);
    const o = await ok(call("compta", "finpro.plan.save", { requestKey: rid(), kind: "out", label: "Eau", amount: 5000, dueOn: day(4) })); await err(call("compta", "finpro.plan.cancel", { id: o.id }), 400); await ok(call("compta", "finpro.plan.cancel", { id: o.id, reason: "payé autrement" }));
    await err(call("compta", "finpro.plan.save", { requestKey: rid(), kind: "x", label: "A1", amount: 1, dueOn: day(1) }), 400); await err(call("compta", "finpro.plan.save", { requestKey: rid(), kind: "in", label: "A1", amount: 0, dueOn: day(1) }), 400); await err(call("compta", "finpro.plan.save", { requestKey: rid(), kind: "in", label: "A1", amount: 5, dueOn: "2026-02-30" }), 400);
  });
});

describe("FinI Pro — prévisions et scénarios", () => {
  it("historique suffisant : série, fourchette croissante, couches réalisé/engagé/prévisionnel, méthode et limites ; jamais présentée comme un solde", async () => {
    await acct(A); await history(A); await st.create("invoices", "fs1", T, { tenantId: T, shopId: A, number: "FF-1", kind: "supplier", partyId: "s1", total: 5000, paid: 0, status: "unpaid", dueAt: `${day(10)}T00:00:00.000Z` });
    await ok(call("own", "finpro.plan.save", { requestKey: rid(), kind: "in", label: "Vente gros", amount: 2000, dueOn: day(5) })); const f = await ok(fc("own")); expect(f.series).toHaveLength(30); expect(f.relative).toBe(false); expect(f.opening).toBe(10_000 + 25_000);
    expect(f.layers.committed.out).toBe(5000); expect(f.layers.planned.in).toBe(2000); expect(f.layers.realized30.in).toBe(25_000); expect(f.series[0].high - f.series[0].low).toBeLessThanOrEqual(f.series[29].high - f.series[29].low); expect(f.notice).toContain("pas un solde disponible"); expect(f.method).toContain("Solde projeté"); expect(f.formulas.length).toBeGreaterThan(3); expect(f.limits.length).toBeGreaterThan(2); expect(f.dataQuality.historyDays).toBeGreaterThanOrEqual(25);
    expect(f.series[29].central).toBeGreaterThan(f.series[0].central); expect(f.alerts.some((a: any) => a.level === "critical")).toBe(false);
  });
  it("tension : seuil minimal configuré → alerte critique datée ; horizons invalides refusés ; 365 jours acceptés", async () => {
    await acct(A, "Caisse", 0); await st.create("invoices", "fs2", T, { tenantId: T, shopId: A, number: "FF-2", kind: "supplier", partyId: "s1", total: 80_000, paid: 0, status: "unpaid", dueAt: `${day(7)}T00:00:00.000Z` }); await history(A); await ok(call("own", "finpro.rules.save", { rules: { minCash: 10_000 } }));
    const f = await ok(fc("own")); expect(f.firstBelow).toBe(day(7)); expect(f.alerts.find((a: any) => a.level === "critical").text).toContain("Tension"); await err(fc("own", { days: 3 }), 400); await err(fc("own", { days: 400 }), 400); expect((await ok(fc("own", { days: 365 }))).series).toHaveLength(365);
  });
  it("aucun solde configuré : variation cumulée, aucun solde inventé ; historique insuffisant : seules les échéances", async () => {
    await jr("571", 5000, 0, "Vente seule", day(-1), A); await ok(call("own", "finpro.plan.save", { requestKey: rid(), kind: "in", label: "Acompte", amount: 7000, dueOn: day(2) })); const f = await ok(fc("own")); expect(f.opening).toBeNull(); expect(f.relative).toBe(true); expect(f.min).toBeNull(); expect(f.end.central).toBe(7000);
    expect(f.alerts.some((a: any) => a.text.includes("historique insuffisant"))).toBe(true); expect(f.alerts.some((a: any) => a.text.includes("Aucun compte configuré"))).toBe(true);
  });
  it("scénario : ventes en baisse, retard des créances et dépense imprévue dégradent la fin d'horizon ; enregistré, idempotent, archivable", async () => {
    await acct(A); await history(A); await st.create("invoices", "fc1", T, { tenantId: T, shopId: A, number: "F-9", kind: "customer", partyId: "", total: 20_000, paid: 0, status: "unpaid", dueAt: `${day(3)}T00:00:00.000Z` });
    const base = await ok(fc("own")); const key = rid(); const s = await ok(call("own", "finpro.scenario.save", { requestKey: key, name: "Prudent", params: { salesDeltaPct: -40, receivableDelayDays: 45, extra: [{ on: day(10), amount: -15_000, label: "Panne frigo" }] } })); expect((await ok(call("own", "finpro.scenario.save", { requestKey: key, name: "Prudent", params: {} }))).duplicate).toBe(true);
    const sc = await ok(fc("own", { scenarioId: s.id })); expect(sc.scenario.name).toBe("Prudent"); expect(sc.end.central).toBeLessThan(base.end.central - 15_000); expect(sc.layers.scenario).toBe(-15_000); expect(sc.layers.committed.in).toBe(0);
    await ok(call("own", "finpro.scenario.save", { id: s.id, archived: true })); expect((await ok(call("own", "finpro.scenarios"))).scenarios).toHaveLength(0); await err(fc("own", { scenarioId: "nope" }), 404);
  });
  it("cohérence inter-magasins : le consolidé est la somme des boutiques ; une boutique sans historique n'entre pas dans la cadence", async () => {
    await acct(A); await acct(B, "Caisse B", 4000); await history(A, 25); await jr("571", 100, 0, "Vente B", day(-1), B);
    const fa = await ok(fc("own", {}, A)); const fb = await ok(fc("own", {}, B)); const all = await ok(fc("own", { scope: "all" })); expect(all.opening).toBe(fa.opening + fb.opening); expect(all.dataQuality).toMatchObject({ shops: 2, shopsProjected: 1 }); expect(all.series[29].central).toBe(fa.series[29].central + fb.series[29].central);
  });
  it("concurrence : deux créations de plan avec la même clé n'en créent qu'un", async () => { const key = rid(); const body = { requestKey: key, kind: "out", label: "Loyer", amount: 1000, dueOn: day(2) }; const r = await Promise.all([call("own", "finpro.plan.save", body), call("own", "finpro.plan.save", body), call("own", "finpro.plan.save", body)]); expect(r.every((x) => x.status === 200)).toBe(true); expect(st.rows("fin_plans")).toHaveLength(1); });
});

describe("FinI Pro — budgets, comparatifs, ventilation, rapprochement", () => {
  const exp = (shop: string, n: number, cat: string, amount: number, o: number, extra: object = {}) => st.create("expenses", `ex${shop.slice(-3)}${n}`, T, { tenantId: T, shopId: shop, number: `D-${n}`, label: cat, category: cat, amount, spentOn: `${day(o)}T12:00:00.000Z`, method: "cash", status: "approved", payMode: "immediate", ...extra });
  it("budget trimestre/année multi-boutiques : réalisé, engagé et reste ; consolidé ; un gérant ne fixe pas hors de sa boutique", async () => {
    const m = day(0).slice(0, 7); const q = `${day(0).slice(0, 4)}-Q${Math.floor((Number(day(0).slice(5, 7)) - 1) / 3) + 1}`;
    await exp(A, 1, "Loyer", 120, -1); await exp(A, 2, "Énergie", 900, -2, { payMode: "deferred", paidAmount: 300, service: "Boutique" }); await exp(B, 3, "Loyer", 50, -1);
    await ok(call("ger", "finpro.budget.save", { period: "quarter", key: q, category: "Loyer", amount: 100 })); await ok(call("ger", "finpro.budget.save", { period: "quarter", key: q, category: "Énergie", service: "Boutique", amount: 2000 })); await ok(call("gerB", "finpro.budget.save", { period: "quarter", key: q, category: "Loyer", amount: 500 }, B));
    const r = await ok(call("own", "finpro.budgets", { period: "quarter", key: q, scope: "all" })); expect(r.shops).toHaveLength(2); const da = r.shops.find((s: any) => s.shop === "Dakar"); expect(da.rows.find((x: any) => x.category === "Loyer")).toMatchObject({ realized: 120, state: "over" }); expect(da.rows.find((x: any) => x.category === "Énergie")).toMatchObject({ realized: 300, committed: 600, remaining: 1100 }); expect(r.consolidated).toMatchObject({ budget: 2600, realized: 120 + 300 + 50, committed: 600 });
    expect((await ok(call("ger", "finpro.budgets", { period: "quarter", key: q, scope: "all" }))).shops).toHaveLength(1); await err(call("ger", "finpro.budget.save", { period: "quarter", key: "2026-Q9", category: "Loyer", amount: 1 }), 400); await err(call("compta", "finpro.budget.save", { period: "month", key: m, category: "Loyer", amount: 1 }), 403);
    await ok(call("own", "finpro.budget.save", { period: "month", key: m, category: "Loyer", amount: 100 })); const again = await ok(call("own", "finpro.budget.save", { period: "month", key: m, category: "loyer", amount: 150 })); expect(again.updated).toBe(true);
  });
  it("comparatifs période contre période et magasin contre magasin ; ventilation par catégorie, service, fournisseur", async () => {
    await acct(A); await jr("571", 1000, 0, "Vente", day(-2), A); await jr("571", 400, 0, "Vente", day(-12), A); await exp(A, 1, "Loyer", 100, -1); await exp(A, 2, "Loyer", 60, -11, { service: "Siège" });
    const c = await ok(call("own", "finpro.compare", { a: { from: day(-14), to: day(-8) }, b: { from: day(-6), to: day(0) } })); expect(c.total.a.in).toBe(400); expect(c.total.b.in).toBe(1000); expect(c.total.pct).toBe(164.7); expect(c.categories[0]).toMatchObject({ category: "Loyer", a: 60, b: 100 }); await err(call("own", "finpro.compare", { a: { from: day(0), to: day(-3) }, b: { from: day(-6), to: day(0) } }), 400);
    const v = await ok(call("own", "finpro.ventilation", { from: day(-14), to: day(0), by: "service" })); expect(v.rows.map((x: any) => x.label).sort()).toEqual(["Sans service", "Siège"]); expect(v.total).toBe(160);
  });
  it("rapprochement avancé : tolérance réglable et regroupement de flux (Pro) ; refusé en Business", async () => {
    const id = await acct(A, "Banque", 0); st.rows("fin_accounts")[0]!.methods = JSON.stringify(["cash"]); await jr("571", 300, 0, "Vente 1", day(-2), A); await jr("571", 700, 0, "Vente 2", day(-2), A); await jr("571", 500, 0, "Vente 3", day(-9), A);
    const body = { accountId: id, asOf: day(0), statementBalance: 1500, statement: [{ date: day(-2), amount: 1000, label: "VIR groupé" }, { date: day(-4), amount: 500, label: "VIR" }] };
    const p = await ok(call("own", "finpro.reconcile.preview", body)); expect(p.groups).toHaveLength(1); expect(p.groups[0].flowKeys).toHaveLength(2); expect(p.suggestions).toHaveLength(0); const wide = await ok(call("own", "finpro.reconcile.preview", { ...body, toleranceDays: 5 })); expect(wide.suggestions).toHaveLength(1);
    const matched = [...p.groups[0].flowKeys.map((k: string) => ({ line: 0, flowKey: k }))]; setPlan("business"); await err(call("own", "finpro.reconcile.preview", body), 402); await err(call("own", "fin.reconcile.save", { requestKey: rid(), ...body, matched, close: false }), 402); setPlan("pro");
    const save = await ok(call("own", "fin.reconcile.save", { requestKey: rid(), ...body, matched, close: true, note: "Écart de 500 : relevé en avance" })); expect(save.status).toBe("closed");
  });
});
