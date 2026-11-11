import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";

const T = "tenantinvest01";
let st: MemoryStore; let A = "", B = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}, shop = A, tenant = T) => handle(st, U[user] ?? user, { action, tenantId: tenant, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); return x.body.error as string; };
const setPlan = (plan: string) => { const row = st.rows("subscriptions").find((r) => r.$id === T); const data = { tenantId: T, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", T, T, data); };
const rid = () => `k${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
const day = (o = 0) => new Date(Date.now() + o * 864e5).toISOString().slice(0, 10);
const PROJ = (over: object = {}) => ({ kind: "project", requestKey: rid(), name: "Nouveau magasin Thiès", budget: 5_000_000, startOn: day(-40), objective: "Ouvrir un second point de vente", type: "Nouveau magasin", financing: [{ source: "Fonds propres", amount: 3_000_000 }, { source: "Prêt bancaire", amount: 2_000_000 }], ...over });
const HYP = (over: object = {}) => ({ months: 24, monthlySales: 1_500_000, marginPct: 30, fixedCosts: 150_000, growthPct: 0, delayMonths: 1, residualValue: 0, extras: [], ...over });
const PLC = (over: object = {}) => ({ kind: "placement", requestKey: rid(), asset: "Dépôt à terme banque X", amount: 2_000_000, boughtOn: day(-30), horizonMonths: 12, fees: 10_000, expectedRatePct: 6, risk: "low", riskNotes: "Risque de défaillance de la banque émettrice", maturities: [{ id: "m1", date: day(10), amount: 50_000, label: "Intérêts trimestriels" }], ...over });
const project = async (over: object = {}) => (await ok(call("own", "inv.item.save", PROJ(over)))).id as string;
const scenarios = async (id: string) => { await ok(call("ger", "inv.scenario.save", { id, name: "prudent", ...HYP({ monthlySales: 1_000_000 }) })); await ok(call("ger", "inv.scenario.save", { id, name: "central", ...HYP() })); await ok(call("ger", "inv.scenario.save", { id, name: "optimistic", ...HYP({ monthlySales: 2_000_000 }) })); };

beforeEach(async () => {
  st = new MemoryStore(); await st.grant(T, "own", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId;
  for (const [u, role, shops] of [["ger", "manager", [A]], ["gerB", "manager", [B]], ["compta", "accountant", [A]], ["cais", "cashier", [A]]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: shops }, ""))).userId;
  setPlan("business");
});

describe("IProj-Invest — accès, abonnement, droits", () => {
  it("Starter refusé ; caissier refusé ; comptable en lecture seule ; gérant et propriétaire écrivent", async () => {
    const id = await project(); setPlan("starter"); await err(call("own", "inv.items"), 402); setPlan("business"); await err(call("cais", "inv.items"), 403);
    expect((await ok(call("compta", "inv.items"))).items).toHaveLength(1); await ok(call("compta", "inv.item", { id })); await err(call("compta", "inv.item.save", PROJ()), 403, "Lecture seule"); await err(call("compta", "inv.scenario.save", { id, name: "central", ...HYP() }), 403); await err(call("compta", "inv.actual.add", { id, requestKey: rid() }), 403);
    await ok(call("ger", "inv.item.save", PROJ({ name: "Équipement frigo" }))); expect((await ok(call("own", "inv.items"))).items).toHaveLength(2);
  });
  it("isolation par boutique : un gérant d'une autre boutique ne voit ni ne modifie rien", async () => {
    const id = await project(); await err(call("gerB", "inv.items", {}, A), 403); expect((await ok(call("gerB", "inv.items", {}, B))).items).toEqual([]); await err(call("gerB", "inv.item", { id }, B), 404); await err(call("gerB", "inv.scenario.save", { id, name: "central", ...HYP() }, B), 404);
  });
  it("Pro conserve l'accès (Business inclus) ; rétrogradation Starter verrouille sans rien perdre", async () => { const id = await project(); setPlan("pro"); await ok(call("own", "inv.item", { id })); setPlan("starter"); await err(call("own", "inv.item", { id }), 402); setPlan("business"); expect((await ok(call("own", "inv.items"))).items).toHaveLength(1); });
});

describe("IProj-Invest — projets et scénarios", () => {
  it("création idempotente, validations, cycle de vie, journal", async () => {
    const b = PROJ(); const a = await ok(call("own", "inv.item.save", b)); const again = await ok(call("own", "inv.item.save", b)); expect(again).toMatchObject({ id: a.id, duplicate: true }); expect(st.rows("inv_items")).toHaveLength(1);
    await err(call("own", "inv.item.save", PROJ({ budget: 0 })), 400, "Budget"); await err(call("own", "inv.item.save", PROJ({ objective: "x" })), 400, "Objectif"); await err(call("own", "inv.item.save", { ...PROJ(), kind: undefined }), 400, "Type"); expect(st.rows("audit_log").some((l) => l.action === "invest.item.create")).toBe(true);
    const upd = await ok(call("ger", "inv.item.save", { ...PROJ({ budget: 6_000_000 }), id: a.id })); expect(upd.id).toBe(a.id); expect(st.rows("inv_items")[0]!.budget).toBe(6_000_000);
  });
  it("approbation impossible sans les trois scénarios ; propriétaire seul approuve ; transitions contrôlées avec motif", async () => {
    const id = await project(); await err(call("own", "inv.item.status", { id, status: "approved" }), 409, "scénarios"); await ok(call("ger", "inv.scenario.save", { id, name: "central", ...HYP() })); await err(call("own", "inv.item.status", { id, status: "approved" }), 409, "Prudent"); await scenarios(id);
    await err(call("ger", "inv.item.status", { id, status: "approved" }), 403, "propriétaire"); await err(call("own", "inv.item.status", { id, status: "in_progress" }), 409, "impossible"); expect((await ok(call("own", "inv.item.status", { id, status: "approved" }))).status).toBe("approved"); expect((await ok(call("own", "inv.item.status", { id, status: "approved" }))).duplicate).toBe(true);
    await err(call("own", "inv.item.status", { id, status: "abandoned" }), 400, "Motif"); await ok(call("own", "inv.item.status", { id, status: "in_progress" })); await err(call("ger", "inv.item.save", { ...PROJ(), id }), 403, "en cours"); await ok(call("own", "inv.item.status", { id, status: "abandoned", reason: "Local finalement indisponible" })); await err(call("own", "inv.item.save", { ...PROJ(), id }), 409, "clôturée"); await err(call("own", "inv.item.status", { id, status: "study", reason: "reprendre" }), 409);
  });
  it("scénarios : résultats recalculés, versionnés, idempotents, concurrence détectée, sensibilité fournie, rien d'inventé", async () => {
    const id = await project(); expect((await ok(call("ger", "inv.item", { id }))).item.scenarios.every((s: any) => !s.set)).toBe(true); const r1 = await ok(call("ger", "inv.scenario.save", { id, name: "central", ...HYP() })); expect(r1.version).toBe(1); expect((await ok(call("ger", "inv.scenario.save", { id, name: "central", ...HYP() }))).duplicate).toBe(true);
    const c = (await ok(call("ger", "inv.item", { id }))).item.scenarios.find((s: any) => s.name === "central"); expect(c.metrics.net).toBe(-5_000_000 - 150_000 + 23 * 300_000); expect(c.metrics.flows[0]).toBe(-5_000_000); expect(c.metrics.flows[1]).toBe(-150_000); expect(c.metrics.flows[2]).toBe(300_000); expect(c.metrics.breakEvenSales).toBe(500_000); expect(c.metrics.paybackMonths).toBeGreaterThan(0); expect(c.sensitivity.rows).toHaveLength(8);
    const r2 = await ok(call("ger", "inv.scenario.save", { id, name: "central", ...HYP({ monthlySales: 2_000_000 }), expectedVersion: 1 })); expect(r2.version).toBe(2); await err(call("ger", "inv.scenario.save", { id, name: "central", ...HYP({ monthlySales: 900_000 }), expectedVersion: 1 }), 409, "modifiées entre-temps"); expect((await ok(call("ger", "inv.item", { id }))).item.scenarios.find((s: any) => s.name === "central").history).toHaveLength(2);
    await err(call("ger", "inv.scenario.save", { id, name: "bizarre", ...HYP() }), 400); await err(call("ger", "inv.scenario.save", { id, name: "central", ...HYP({ marginPct: 150 }) }), 400, "Marge");
  });
  it("flux négatifs permanents : jamais récupéré et clairement présenté", async () => { const id = await project(); await ok(call("ger", "inv.scenario.save", { id, name: "prudent", ...HYP({ monthlySales: 100_000 }) })); const s = (await ok(call("ger", "inv.item", { id }))).item.scenarios.find((x: any) => x.name === "prudent"); expect(s.metrics.paybackMonths).toBeNull(); expect(s.metrics.net).toBeLessThan(0); expect(s.metrics.roiPct).toBeLessThan(0); });
});

describe("IProj-Invest — réel contre prévu", () => {
  const approved = async () => { const id = await project(); await scenarios(id); await ok(call("own", "inv.item.status", { id, status: "approved" })); return id; };
  it("réel enregistré avec source, idempotent, jamais mélangé au prévu, annulation motivée, alerte de dépassement", async () => {
    const id = await project(); await err(call("ger", "inv.actual.add", { id, requestKey: rid(), date: day(-10), amount: 100, label: "Loyer d'avance" }), 409, "approuvé"); await scenarios(id); await ok(call("own", "inv.item.status", { id, status: "approved" }));
    const k = rid(); const a = await ok(call("ger", "inv.actual.add", { id, requestKey: k, date: day(-10), amount: 2_000_000, label: "Aménagement du local" })); expect((await ok(call("ger", "inv.actual.add", { id, requestKey: k, date: day(-10), amount: 2_000_000, label: "Aménagement du local" }))).duplicate).toBe(true); expect(st.rows("inv_actuals")).toHaveLength(1);
    await err(call("ger", "inv.actual.add", { id, requestKey: rid(), date: day(5), amount: 5, label: "Futur" }), 400, "Date"); await err(call("ger", "inv.actual.add", { id, requestKey: rid(), date: day(-3), amount: 0, label: "Zéro" }), 400, "Montant"); await err(call("ger", "inv.actual.add", { id, requestKey: rid(), date: day(-90), amount: 5, label: "Avant le début" }), 400, "précède");
    let v = (await ok(call("ger", "inv.item", { id }))).item; expect(v.actualTotals).toEqual({ out: 2_000_000, in: 0, net: -2_000_000 }); expect(v.budgetUsedPct).toBe(40); expect(v.scenarios.find((s: any) => s.name === "central").metrics.flows[0]).toBe(-5_000_000); expect(v.comparison.at(-1)).toMatchObject({ actual: -2_000_000 }); expect(v.actuals[0].sourceLabel).toBe("Saisie manuelle"); expect(v.alerts.filter((x: any) => x.level === "critical")).toHaveLength(0);
    await ok(call("ger", "inv.actual.add", { id, requestKey: rid(), date: day(-5), amount: 3_500_000, label: "Équipements" })); v = (await ok(call("ger", "inv.item", { id }))).item; expect(v.alerts.some((x: any) => x.level === "critical" && /supérieurs au budget/.test(x.text))).toBe(true);
    await err(call("ger", "inv.actual.void", { id: a.id, reason: "x" }), 400); await err(call("gerB", "inv.actual.void", { id: a.id, reason: "Erreur de saisie" }, B), 404); await ok(call("ger", "inv.actual.void", { id: a.id, reason: "Erreur de saisie" })); expect((await ok(call("ger", "inv.actual.void", { id: a.id, reason: "Erreur de saisie" }))).duplicate).toBe(true); v = (await ok(call("ger", "inv.item", { id }))).item; expect(v.actualTotals.out).toBe(3_500_000); expect(v.actuals.find((x: any) => x.id === a.id).status).toBe("void"); expect(st.rows("inv_actuals")).toHaveLength(2);
  });
  it("rattachement d'une dépense réelle : source identifiée, montant repris, une seule fois, libérée par l'annulation", async () => {
    const id = await approved(); await st.create("expenses", "e1", T, { tenantId: T, shopId: A, number: "D-1", label: "Caution du local", category: "Loyer", amount: 400_000, spentOn: `${day(-6)}T10:00:00.000Z`, status: "approved", payMode: "immediate", method: "cash" }); await st.create("expenses", "e2", T, { tenantId: T, shopId: A, number: "D-2", label: "En attente", category: "X", amount: 10, spentOn: `${day(-6)}T10:00:00.000Z`, status: "pending" });
    const a = await ok(call("ger", "inv.actual.add", { id, requestKey: rid(), expenseId: "e1" })); await err(call("ger", "inv.actual.add", { id, requestKey: rid(), expenseId: "e1" }), 409, "déjà rattachée"); await err(call("ger", "inv.actual.add", { id, requestKey: rid(), expenseId: "e2" }), 404); await err(call("ger", "inv.actual.add", { id, requestKey: rid(), expenseId: "inconnue" }), 404);
    const row = st.rows("inv_actuals").find((r) => r.$id === a.id)!; expect(row).toMatchObject({ source: "expense", sourceRef: "e1", amount: 400_000, kind: "out" }); expect((await ok(call("ger", "inv.item", { id }))).item.actuals[0].sourceLabel).toContain("Dépenses"); await ok(call("ger", "inv.actual.void", { id: a.id, reason: "Mauvais projet" })); await ok(call("ger", "inv.actual.add", { id, requestKey: rid(), expenseId: "e1" }));
  });
  it("deux rattachements simultanés de la même dépense : un seul passe", async () => { const id = await approved(); await st.create("expenses", "e1", T, { tenantId: T, shopId: A, number: "D-1", label: "Caution", category: "Loyer", amount: 400_000, spentOn: `${day(-6)}T10:00:00.000Z`, status: "approved", payMode: "immediate", method: "cash" }); const r = await Promise.all([call("ger", "inv.actual.add", { id, requestKey: rid(), expenseId: "e1" }), call("own", "inv.actual.add", { id, requestKey: rid(), expenseId: "e1" })]); expect(r.map((x) => x.status).sort()).toEqual([200, 409]); expect(st.rows("inv_actuals").filter((x) => x.status === "active")).toHaveLength(1); });
});

describe("IProj-Invest — placements", () => {
  it("fiche complète exigée (risque, risques déclarés, rendement déclaré) ; projection non garantie ; aucun conseil", async () => {
    await err(call("own", "inv.item.save", PLC({ risk: undefined })), 400, "risque"); await err(call("own", "inv.item.save", PLC({ riskNotes: "" })), 400, "risques"); await err(call("own", "inv.item.save", PLC({ expectedRatePct: undefined })), 400, "Rendement"); await err(call("own", "inv.item.save", PLC({ fees: 2_000_000 })), 400, "frais");
    const p = await ok(call("ger", "inv.item.save", PLC())); const v = (await ok(call("ger", "inv.item", { id: p.id }))).item; expect(v.projection.projected).toBe(Math.round(1_990_000 * 1.06)); expect(v.projection.projected).toBeGreaterThan(0); expect(JSON.stringify(v)).not.toMatch(/recommand/i); expect(v.endsOn).toBeTruthy(); expect((await ok(call("ger", "inv.item", { id: p.id }))).limits.join(" ")).toContain("conseil financier");
  });
  it("profil de risque : propriétaire seul, écart signalé, absence signalée ; échéances proches et dépassées", async () => {
    const p = await ok(call("ger", "inv.item.save", PLC({ risk: "high", expectedRatePct: 30, maturities: [{ id: "a", date: day(5), amount: 1, label: "Coupon" }, { id: "b", date: day(-2), amount: 1, label: "Remboursement partiel" }] })));
    let v = (await ok(call("ger", "inv.item", { id: p.id }))).item; expect(v.alerts.some((a: any) => /Profil de risque non défini/.test(a.text))).toBe(true); await err(call("ger", "inv.config.save", { profile: "prudent" }), 403); await err(call("own", "inv.config.save", { profile: "agressif" }), 400); await ok(call("own", "inv.config.save", { profile: "prudent" })); v = (await ok(call("ger", "inv.item", { id: p.id }))).item;
    const t = v.alerts.map((a: any) => a.text).join("|"); expect(t).toMatch(/supérieur à celui de votre profil/); expect(t).toMatch(/Échéance dans 5 jour/); expect(t).toMatch(/Échéance dépassée depuis 2/); expect(t).toMatch(/très élevé/); expect((await ok(call("compta", "inv.config"))).profile).toBe("prudent"); expect((await ok(call("own", "inv.overview"))).alerts.length).toBeGreaterThan(2);
  });
  it("échéance constatée, clôture avec montant réellement récupéré saisi (identifié), irréversible, idempotente", async () => {
    const p = await ok(call("ger", "inv.item.save", PLC())); await ok(call("ger", "inv.maturity", { id: p.id, maturity: "m1" })); expect((await ok(call("ger", "inv.maturity", { id: p.id, maturity: "m1" }))).duplicate).toBe(true); expect((await ok(call("ger", "inv.item", { id: p.id }))).item.data.maturities[0].done).toBe(true);
    await err(call("ger", "inv.item.status", { id: p.id, status: "closed", realizedAmount: 2_100_000, reason: "x" }), 400, "Motif"); await err(call("ger", "inv.item.status", { id: p.id, status: "approved" }), 400); await ok(call("ger", "inv.item.status", { id: p.id, status: "closed", realizedAmount: 2_090_000, reason: "Arrivé à échéance" })); expect((await ok(call("ger", "inv.item.status", { id: p.id, status: "closed", realizedAmount: 1, reason: "Arrivé à échéance" }))).duplicate).toBe(true); const v = (await ok(call("ger", "inv.item", { id: p.id }))).item; expect(v.realized).toMatchObject({ amount: 2_090_000, gain: 90_000 }); expect(v.projection.projected).toBeGreaterThan(0); await err(call("ger", "inv.item.save", { ...PLC(), id: p.id }), 409, "clôturée");
  });
});

describe("IProj-Invest — synthèse, source des données, export", () => {
  it("synthèse : chiffres issus des données, capacité FinI identifiée comme telle, limites affichées", async () => {
    const id = await project(); await scenarios(id); await ok(call("own", "inv.item.status", { id, status: "approved" })); await ok(call("ger", "inv.item.save", PLC())); await st.create("sales", "s1", T, { tenantId: T, shopId: A, total: 90_000, status: "confirmed" });
    const o = await ok(call("compta", "inv.overview")); expect(o.projects).toMatchObject({ total: 1, budget: 5_000_000 }); expect(o.placements).toMatchObject({ total: 1, invested: 2_000_000 }); expect(o.financing.source).toContain("FinI"); expect(o.limits).toHaveLength(4); expect(o.canEdit).toBe(false);
  });
  it("export PDF/Excel : journalisé, limites rappelées, prévu et réel séparés", async () => { const id = await project(); await scenarios(id); await ok(call("own", "inv.item.status", { id, status: "approved" })); await ok(call("ger", "inv.actual.add", { id, requestKey: rid(), date: day(-3), amount: 100_000, label: "Études" })); const r = await ok(call("compta", "inv.report", { id })); expect(r.sections.map((s: any) => s.name)).toEqual([expect.stringContaining("Projet"), "Scénarios (prévisions)", "Réalisations constatées"]); expect(r.notes.join(" ")).toContain("conseil financier"); expect(st.rows("audit_log").some((a) => a.action === "invest.export")).toBe(true); await ok(call("compta", "inv.report", {})); });
  it("aucune écriture comptable ni mouvement financier n'est créé par IProj-Invest", async () => { const id = await project(); await scenarios(id); await ok(call("own", "inv.item.status", { id, status: "approved" })); await ok(call("ger", "inv.actual.add", { id, requestKey: rid(), date: day(-3), amount: 100_000, label: "Études" })); expect(st.rows("acct_entries")).toHaveLength(0); expect(st.rows("cash_movements")).toHaveLength(0); expect(st.rows("journal_entries")).toHaveLength(0); });
});
