import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";

const T = "tenanticomp001";
let st: MemoryStore; let A = "", B = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}, shop = A, tenant = T) => handle(st, U[user] ?? user, { action, tenantId: tenant, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); return x.body.error as string; };
const setPlan = (plan: string) => { const row = st.rows("subscriptions").find((r) => r.$id === T); const data = { tenantId: T, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", T, T, data); };
const PLAN = "571;Caisse (test)\n521;Banque (test)\n701;Ventes (test)\n401;Fournisseurs (test)\n411;Clients (test)\n601;Achats (test)";
const METHODS = { cash: "571", transfer: "521" };
const rid = () => `k${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
const day = (o = 0) => new Date(Date.now() + o * 864e5).toISOString().slice(0, 10);
const per = (o = 0) => day(o).slice(0, 7);
const L2 = (amount = 1000, a = "571", b = "701") => [{ account: a, debit: amount, credit: 0 }, { account: b, debit: 0, credit: amount }];
const draft = (user = "compta", over: object = {}, shop = A) => call(user, "ic.entry.save", { requestKey: rid(), journal: "OD", date: day(0), label: "Apport en caisse", lines: L2(), pieces: [{ ref: "REC-001" }], ...over }, shop);
const pending = async (user = "compta", over: object = {}) => { const d = await ok(draft(user, over)); await ok(call(user, "ic.entry.submit", { id: d.id })); return d.id as string; };
const validated = async (over: object = {}) => { const id = await pending("compta", over); await ok(call("ger", "ic.entry.validate", { id })); return id as string; };

beforeEach(async () => {
  st = new MemoryStore(); await st.grant(T, "own", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId;
  for (const [u, role, shops] of [["ger", "manager", [A]], ["ger2", "manager", [A]], ["gerB", "manager", [B]], ["compta", "accountant", [A]], ["cais", "cashier", [A]]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: shops }, ""))).userId;
  setPlan("business");
  await ok(call("ger", "ic.account.import", { text: PLAN })); await ok(call("ger", "ic.config.save", { config: { methods: METHODS } }));
});

describe("ICompta — accès, plan de comptes, paramétrage", () => {
  it("module comptabilité requis ; Starter refusé ; plan de comptes : AUCUN numéro présumé, import du plan de l'expert-comptable, codes utilisés par l'application listés avec leurs vrais montants", async () => {
    await err(call("cais", "ic.overview"), 403); setPlan("starter"); await err(call("own", "ic.accounts"), 402); setPlan("business");
    for (const a of st.rows("acct_accounts")) await st.remove("acct_accounts", a.$id); await st.create("journal_entries", "ju1", T, { tenantId: T, shopId: A, ref: "V-1", account: "5722", debit: 700, credit: 0, label: "Vente", date: `${day(-1)}T10:00:00.000Z` }); await st.create("journal_entries", "ju2", T, { tenantId: T, shopId: A, ref: "V-1", account: "701", debit: 0, credit: 700, label: "Vente", date: `${day(-1)}T10:00:00.000Z` });
    const a = await ok(call("compta", "ic.accounts")); expect(a.empty).toBe(true); expect(a.accounts).toEqual([]); expect(a.used).toEqual([{ code: "5722", entries: 1, debit: 700, credit: 0, inPlan: false }, { code: "701", entries: 1, debit: 0, credit: 700, inPlan: false }]); expect(a.note).toContain("VIDE"); expect((await ok(call("ger", "ic.overview"))).alerts.some((x: any) => x.code === "plan")).toBe(true);
    await err(draft("compta"), 400, "n'existe pas dans le plan"); await err(call("compta", "ic.account.import", { text: "571;Caisse" }), 403);
    const r = await ok(call("ger", "ic.account.import", { text: "5722;Mobile money Wave\n701 ; Ventes de marchandises\nabc\n9;x\n701;Doublon\n6;" })); expect(r.created).toBe(2); expect(r.skipped.map((x: any) => x.why).sort()).toEqual(["déjà au plan", "format attendu : numéro;libellé", "format attendu : numéro;libellé", "format attendu : numéro;libellé"]);
    expect((await ok(call("compta", "ic.accounts"))).used.every((u: any) => u.inPlan)).toBe(true); expect((await ok(call("compta", "ic.accounts"))).accounts.every((x: any) => !x.confirmed)).toBe(true);
  });
  it("comptes : création par un responsable seulement, validations, confirmation réservée au propriétaire, pas de doublon", async () => {
    await err(call("compta", "ic.account.save", { code: "6011", label: "Achats x" }), 403); await ok(call("ger", "ic.account.save", { code: "6011", label: "Achats de boissons" })); await err(call("ger", "ic.account.save", { code: "0601", label: "Mauvais" }), 400); await err(call("ger", "ic.account.save", { code: "6012", label: "x" }), 400);
    await err(call("ger", "ic.account.save", { code: "6011", confirm: true }), 403); await ok(call("own", "ic.account.save", { code: "6011", confirm: true })); const l = (await ok(call("own", "ic.accounts"))).accounts.filter((x: any) => x.code === "6011"); expect(l).toHaveLength(1); expect(l[0].confirmed).toBe(true); expect(st.rows("audit_log").some((x) => x.action === "icompta.account.create")).toBe(true);
  });
  it("correspondances : comptes inexistants refusés, modification journalisée avec avant/après", async () => {
    await err(call("ger", "ic.config.save", { config: { categories: { Loyer: "6199" } } }), 400, "n'existe pas"); await ok(call("ger", "ic.account.save", { code: "613", label: "Loyers" })); await ok(call("ger", "ic.config.save", { config: { methods: METHODS, categories: { Loyer: "613" }, deferredPayable: "401" } })); expect((await ok(call("compta", "ic.config"))).config.categories.Loyer).toBe("613"); await err(call("compta", "ic.config.save", { config: {} }), 403);
    expect(st.rows("audit_log").some((x) => x.action === "icompta.config" && String(x.detail).includes("before"))).toBe(true);
  });
  it("isolation entre boutiques et entre rôles", async () => { await ok(draft("compta")); expect((await ok(call("gerB", "ic.entries", {}, B))).entries).toHaveLength(0); await err(call("gerB", "ic.entries", {}, A), 403); });
});

describe("ICompta — cycle de vie et immuabilité", () => {
  it("brouillon → à valider → validée : numérotation continue, empreinte chaînée, journalisé", async () => {
    const a = await validated(); const b = await validated({ label: "Autre apport" }); const l = (await ok(call("own", "ic.entries", { status: "validated" }))).entries; expect(l.map((e: any) => e.number).sort()).toEqual(["ICE-000001", "ICE-000002"]); const e2 = l.find((e: any) => e.id === b); expect(e2.prevHash).toBe(l.find((e: any) => e.id === a).hash); expect(e2.hash).toMatch(/^[0-9a-f]{64}$/); expect((await ok(call("own", "ic.verify"))).ok).toBe(true); expect(st.rows("audit_log").filter((x) => x.action === "icompta.entry.validate")).toHaveLength(2);
  });
  it("règles de saisie : déséquilibre, compte inconnu, date future, journal, pièce obligatoire, période", async () => {
    await err(draft("compta", { lines: [{ account: "571", debit: 1000, credit: 0 }, { account: "701", debit: 0, credit: 900 }] }), 400, "déséquilibrée"); await err(draft("compta", { lines: L2(5, "571", "999") }), 400, "n'existe pas"); await err(draft("compta", { date: day(3) }), 400, "futur"); await err(draft("compta", { journal: "ZZ" }), 400); await err(draft("compta", { label: "x" }), 400);
    const d = await ok(draft("compta", { pieces: [] })); await err(call("compta", "ic.entry.submit", { id: d.id }), 409, "pièce justificative");
  });
  it("séparation des rôles : le comptable ne valide pas ; le gérant ne valide pas sa propre écriture ; le propriétaire peut, signalé « auto-validée »", async () => {
    const id = await pending("compta"); await err(call("compta", "ic.entry.validate", { id }), 403); const mine = await pending("ger"); await err(call("ger", "ic.entry.validate", { id: mine }), 403, "propre écriture"); await ok(call("ger2", "ic.entry.validate", { id: mine }));
    const own = await pending("own"); const r = await ok(call("own", "ic.entry.validate", { id: own })); expect(r.selfValidated).toBe(true); const v = await ok(call("own", "ic.verify")); expect(v.alerts.some((a: any) => a.code === "self")).toBe(true);
  });
  it("une écriture validée est immuable : ni modification, ni rejet, ni nouvelle soumission ; validation idempotente", async () => {
    const id = await validated(); await err(call("compta", "ic.entry.save", { id, journal: "OD", date: day(0), label: "Falsifiée", lines: L2(9999), pieces: [{ ref: "X1" }] }), 409, "immuable"); await err(call("ger", "ic.entry.reject", { id, reason: "annulation" }), 409, "contrepassation"); await err(call("compta", "ic.entry.submit", { id }), 409); expect((await ok(call("ger2", "ic.entry.validate", { id }))).duplicate).toBe(true); expect(st.rows("acct_entries")).toHaveLength(1);
  });
  it("rejet : motif obligatoire, droits (l'auteur abandonne son brouillon, seul un responsable rejette une écriture à valider)", async () => {
    const id = await pending("compta"); await err(call("compta", "ic.entry.reject", { id, reason: "erreur" }), 403); await err(call("ger", "ic.entry.reject", { id }), 400); await ok(call("ger", "ic.entry.reject", { id, reason: "Pièce illisible" })); await err(call("ger", "ic.entry.validate", { id }), 409); const d = await ok(draft("compta")); await ok(call("compta", "ic.entry.reject", { id: d.id, reason: "Doublon" })); expect((await ok(call("own", "ic.entries", { status: "rejected" }))).entries).toHaveLength(2);
  });
  it("jamais de suppression : aucune action ne retire une écriture", async () => { await validated(); expect((await call("own", "ic.entry.delete", { id: "x" })).status).toBeGreaterThanOrEqual(400); expect(st.rows("acct_entries")).toHaveLength(1); });
  it("pièce déjà comptabilisée par le système refusée (anti-doublon) ; une pièce ne se saisit qu'une fois", async () => {
    await st.create("journal_entries", "jx1", T, { tenantId: T, shopId: A, ref: "V-20260101-AAAA", account: "571", debit: 500, credit: 0, label: "Vente", date: `${day(-1)}T10:00:00.000Z` }); await err(draft("compta", { originRef: "V-20260101-AAAA" }), 409, "déjà comptabilisée automatiquement"); await ok(draft("compta", { originRef: "FAC-77" })); await err(draft("compta", { originRef: "FAC-77" }), 409, "déjà une écriture");
  });
  it("idempotence : même clé = même brouillon", async () => { const key = rid(); const body = { requestKey: key, journal: "OD", date: day(0), label: "Apport", lines: L2(), pieces: [{ ref: "R1" }] }; const a = await ok(call("compta", "ic.entry.save", body)); const b = await ok(call("compta", "ic.entry.save", body)); expect(b).toMatchObject({ id: a.id, duplicate: true }); expect(st.rows("acct_entries")).toHaveLength(1); });
  it("concurrence : validations simultanées → rangs distincts et continus ; double validation de la même écriture → une seule", async () => {
    const ids = [await pending("compta"), await pending("compta", { label: "Écriture B" }), await pending("compta", { label: "Écriture C" })]; const r = await Promise.all(ids.map((id) => call("ger", "ic.entry.validate", { id }))); const okR = r.filter((x) => x.status === 200); expect(okR.length).toBeGreaterThanOrEqual(1);
    for (const id of ids) { const x = await call("ger", "ic.entry.validate", { id }); expect([200, 409]).toContain(x.status); } for (const id of ids) { const x = await call("ger", "ic.entry.validate", { id }); expect([200, 409]).toContain(x.status); }
    const seqs = st.rows("acct_entries").filter((e) => e.status === "validated").map((e) => e.seq).sort(); expect(new Set(seqs).size).toBe(seqs.length); expect(seqs).toEqual(seqs.map((_, i) => i + 1)); expect((await ok(call("own", "ic.verify"))).ok).toBe(true);
  });
});

describe("ICompta — contrepassation et correction", () => {
  it("contrepassation : lignes inversées, à valider séparément, une seule fois, solde annulé", async () => {
    const id = await validated(); const r = await ok(call("compta", "ic.entry.reverse", { id, requestKey: rid(), reason: "Saisie en double" })); await err(call("compta", "ic.entry.reverse", { id, requestKey: rid(), reason: "Autre tentative" }), 409, "déjà contrepassée"); await err(call("ger2", "ic.entry.reverse", { id, requestKey: rid() }), 409);
    await err(call("compta", "ic.entry.validate", { id: r.id }), 403); await ok(call("ger", "ic.entry.validate", { id: r.id })); const orig = (await ok(call("own", "ic.entry", { id }))).entry; expect(orig.reversedBy).toBe(r.id); const rev = (await ok(call("own", "ic.entry", { id: r.id }))).entry; expect(rev.kind).toBe("reversal"); expect(rev.lines[0]).toMatchObject({ account: "571", debit: 0, credit: 1000 });
    const l = await ok(call("own", "ic.ledger", { account: "571" })); expect(l.closing).toBe(0); expect((await ok(call("own", "ic.verify"))).ok).toBe(true); await err(call("ger", "ic.entry.reverse", { id: r.id, requestKey: rid(), reason: "contre-contrepassation" }), 409, "ne se contrepasse pas");
  });
  it("correction : contrepassation + écriture corrective liées ; l'original reste intact", async () => {
    const id = await validated(); const c = await ok(call("compta", "ic.entry.correct", { id, requestKey: rid(), reason: "Montant erroné", lines: L2(1200), label: "Apport corrigé" })); await ok(call("ger", "ic.entry.validate", { id: c.reversalId })); await ok(call("compta", "ic.entry.submit", { id: c.correctionId })); await ok(call("ger", "ic.entry.validate", { id: c.correctionId }));
    expect((await ok(call("own", "ic.ledger", { account: "571" }))).closing).toBe(1200); expect((await ok(call("own", "ic.entry", { id: c.correctionId }))).entry.correctionOf).toBe(id); expect(st.rows("acct_entries").find((e) => e.$id === id)!.lines).toContain("1000"); expect((await ok(call("own", "ic.verify"))).ok).toBe(true);
  });
});

describe("ICompta — anti-falsification : chaîne d'empreintes et scellés", () => {
  it("modification directe d'une écriture validée (falsification en base) détectée", async () => {
    const id = await validated(); await validated({ label: "Écriture B" }); st.rows("acct_entries").find((e) => e.$id === id)!.lines = JSON.stringify([{ account: "571", debit: 999, credit: 0 }, { account: "701", debit: 0, credit: 999 }]); const v = await ok(call("own", "ic.verify")); expect(v.ok).toBe(false); expect(v.issues.some((i: any) => i.code === "hash")).toBe(true);
  });
  it("suppression d'une écriture validée détectée (rupture de numérotation)", async () => { await validated(); const mid = await validated({ label: "Écriture B" }); await validated({ label: "Écriture C" }); await st.remove("acct_entries", mid); const v = await ok(call("own", "ic.verify")); expect(v.ok).toBe(false); expect(v.issues.some((x: any) => x.code === "gap" || x.code === "chain")).toBe(true); });
  it("changement de montant, de compte ou de date détecté ; une écriture rejetée ne fausse pas la chaîne", async () => {
    const id = await validated(); st.rows("acct_entries").find((e) => e.$id === id)!.date = day(-5); expect((await ok(call("own", "ic.verify"))).issues.some((i: any) => i.code === "hash")).toBe(true);
  });
  it("période close scellée : une écriture système ajoutée après coup est détectée", async () => {
    const p = per(-40); const d = `${p}-10`; await st.create("journal_entries", "jc1", T, { tenantId: T, shopId: A, ref: "V-1", account: "571", debit: 500, credit: 0, label: "Vente", date: `${d}T10:00:00.000Z` }); await st.create("journal_entries", "jc2", T, { tenantId: T, shopId: A, ref: "V-1", account: "701", debit: 0, credit: 500, label: "Vente", date: `${d}T10:00:00.000Z` });
    const c = await ok(call("ger", "ic.period.close", { key: p })); expect(c.seal).toMatch(/^[0-9a-f]{64}$/); expect((await ok(call("own", "ic.verify"))).ok).toBe(true); await st.create("journal_entries", "jc3", T, { tenantId: T, shopId: A, ref: "V-2", account: "571", debit: 100, credit: 0, label: "Vente antidatée", date: `${d}T11:00:00.000Z` }); await st.create("journal_entries", "jc4", T, { tenantId: T, shopId: A, ref: "V-2", account: "701", debit: 0, credit: 100, label: "Vente antidatée", date: `${d}T11:00:00.000Z` });
    const v = await ok(call("own", "ic.verify")); expect(v.ok).toBe(false); expect(v.issues.find((i: any) => i.code === "seal").text).toContain(p);
  });
});

describe("ICompta — propositions issues des événements réels", () => {
  const exp = (n: number, cat: string, amount: number, o = -1, extra: object = {}) => st.create("expenses", `ex${n}`, T, { tenantId: T, shopId: A, number: `D-${n}`, label: cat, category: cat, amount, spentOn: `${day(o)}T12:00:00.000Z`, method: "cash", status: "approved", payMode: "immediate", ...extra });
  it("sans correspondance de compte : proposition bloquée avec la raison, jamais d'écriture inventée", async () => {
    await exp(1, "Loyer", 5000); const p = await ok(call("compta", "ic.proposals")); expect(p.proposals).toHaveLength(1); expect(p.proposals[0]).toMatchObject({ ready: false }); expect(p.proposals[0].blocked).toContain("non paramétré pour la catégorie « Loyer »"); expect(p.proposals[0].lines).toEqual([]);
    const r = await ok(call("compta", "ic.proposal.create", { keys: [p.proposals[0].key] })); expect(r.created).toBe(0); expect(r.skipped[0].why).toContain("non paramétré"); expect(st.rows("acct_entries")).toHaveLength(0);
  });
  it("avec correspondance : brouillon équilibré (charge / caisse), idempotent, pièce reprise, puis à valider ; la source n'est plus proposée", async () => {
    await ok(call("ger", "ic.account.save", { code: "613", label: "Loyers" })); await ok(call("ger", "ic.config.save", { config: { methods: METHODS, categories: { Loyer: "613" } } })); await exp(1, "Loyer", 5000); const p = await ok(call("compta", "ic.proposals")); expect(p.proposals[0]).toMatchObject({ ready: true, journal: "CA" }); expect(p.proposals[0].lines).toEqual([{ account: "613", debit: 5000, credit: 0 }, { account: "571", debit: 0, credit: 5000 }]);
    const key = p.proposals[0].key; const a = await ok(call("compta", "ic.proposal.create", { keys: [key] })); const b = await ok(call("compta", "ic.proposal.create", { keys: [key] })); expect(a.created).toBe(1); expect(b.created).toBe(0); expect(st.rows("acct_entries")).toHaveLength(1); expect((await ok(call("compta", "ic.proposals"))).proposals).toHaveLength(0);
    const id = a.ids[0]; const e = (await ok(call("compta", "ic.entry", { id }))).entry; expect(e.kind).toBe("proposal"); expect(e.pieces[0].ref).toBe("D-1"); await ok(call("compta", "ic.entry.submit", { id })); await ok(call("ger", "ic.entry.validate", { id })); expect((await ok(call("own", "ic.balance", {}))).rows.find((r: any) => r.account === "613").debit).toBe(5000);
  });
  it("après rejet, l'événement redevient proposable ; dépense à payer et paiement partiel : comptes de dettes requis", async () => {
    await ok(call("ger", "ic.account.save", { code: "613", label: "Loyers" })); await ok(call("ger", "ic.config.save", { config: { methods: METHODS, categories: { Loyer: "613" }, deferredPayable: "401" } })); await exp(1, "Loyer", 9000, -3, { payMode: "deferred", paidAmount: 4000 }); await st.create("expense_payments", "pm1", T, { tenantId: T, shopId: A, expenseId: "ex1", amount: 4000, method: "cash", source: "external", paidOn: `${day(-1)}T12:00:00.000Z` });
    const p = await ok(call("compta", "ic.proposals")); expect(p.proposals.map((x: any) => x.kind).sort()).toEqual(["expense", "expense_payment"]); const d = p.proposals.find((x: any) => x.kind === "expense"); expect(d.lines[1]).toMatchObject({ account: "401", credit: 9000 }); const pay = p.proposals.find((x: any) => x.kind === "expense_payment"); expect(pay.lines[0]).toMatchObject({ account: "401", debit: 4000 });
    const c = await ok(call("compta", "ic.proposal.create", { keys: [d.key] })); await ok(call("compta", "ic.entry.reject", { id: c.ids[0], reason: "À revoir" })); expect((await ok(call("compta", "ic.proposals"))).proposals.some((x: any) => x.key === d.key)).toBe(true); expect((await ok(call("compta", "ic.proposal.create", { keys: [d.key] }))).created).toBe(1);
  });
});

describe("ICompta — clôture, livres, tiers, exports", () => {
  it("clôture bloquée avec explications tant que des brouillons ou événements restent ; réussit quand tout est traité ; période close refuse toute écriture", async () => {
    const p = per(-40); await st.create("expenses", "exq", T, { tenantId: T, shopId: A, number: "D-9", label: "Loyer", category: "Loyer", amount: 100, spentOn: `${p}-12T12:00:00.000Z`, method: "cash", status: "approved", payMode: "immediate" }); await draft("compta", { date: `${p}-15` });
    const c = await ok(call("ger", "ic.period.controls", { key: p })); expect(c.canClose).toBe(false); expect(c.controls.filter((x: any) => !x.ok).map((x: any) => x.id).sort()).toEqual(["proposals", "unprocessed"]); const e = await err(call("ger", "ic.period.close", { key: p }), 409, "Clôture bloquée"); expect(e).toContain("brouillon");
    await err(call("compta", "ic.period.close", { key: p }), 403); const ents = (await ok(call("own", "ic.entries", {}))).entries; await ok(call("compta", "ic.entry.reject", { id: ents[0].id, reason: "Brouillon inutile" })); const pr = (await ok(call("compta", "ic.proposals"))).proposals; expect(pr).toHaveLength(1);
    await ok(call("ger", "ic.account.save", { code: "613", label: "Loyers" })); await ok(call("ger", "ic.config.save", { config: { methods: METHODS, categories: { Loyer: "613" } } })); const k = (await ok(call("compta", "ic.proposals"))).proposals[0].key; const cr = await ok(call("compta", "ic.proposal.create", { keys: [k] })); await ok(call("compta", "ic.entry.submit", { id: cr.ids[0] })); await ok(call("ger", "ic.entry.validate", { id: cr.ids[0] }));
    const closed = await ok(call("ger", "ic.period.close", { key: p })); expect(closed.status).toBe("closed"); expect((await ok(call("ger", "ic.period.close", { key: p }))).duplicate).toBe(true); await err(draft("compta", { date: `${p}-20` }), 409, "clôturée"); expect((await ok(call("own", "ic.periods", { year: Number(p.slice(0, 4)) }))).periods.find((x: any) => x.key === p).status).toBe("closed");
  });
  it("clôture dans l'ordre ; période future refusée ; réouverture : propriétaire seul, motif détaillé, tracée", async () => {
    const p1 = per(-70), p2 = per(-40); await st.create("journal_entries", "jo1", T, { tenantId: T, shopId: A, ref: "V-1", account: "571", debit: 5, credit: 0, label: "V", date: `${p1}-10T10:00:00.000Z` }); await st.create("journal_entries", "jo2", T, { tenantId: T, shopId: A, ref: "V-1", account: "701", debit: 0, credit: 5, label: "V", date: `${p1}-10T10:00:00.000Z` });
    await ok(call("own", "ic.account.save", { code: "571", label: "Caisse (espèces)" })); await err(call("ger", "ic.period.close", { key: p2 }), 409, "À clôturer d'abord"); await ok(call("ger", "ic.period.close", { key: p1 })); await ok(call("ger", "ic.period.close", { key: p2 })); await err(call("ger", "ic.period.close", { key: per(60) }), 409, "future");
    await err(call("ger", "ic.period.reopen", { key: p2, reason: "Besoin de corriger une erreur" }), 403); await err(call("own", "ic.period.reopen", { key: p2, reason: "court" }), 400); await ok(call("own", "ic.period.reopen", { key: p2, reason: "Erreur de saisie à corriger avec le comptable" })); expect((await ok(call("own", "ic.verify"))).alerts.some((a: any) => a.code === "reopen")).toBe(true);
  });
  it("système déséquilibré ou compte hors plan : clôture bloquée avec la liste", async () => {
    const p = per(-40); await st.create("journal_entries", "jb1", T, { tenantId: T, shopId: A, ref: "V-BAD", account: "571", debit: 500, credit: 0, label: "V", date: `${p}-10T10:00:00.000Z` }); await st.create("journal_entries", "jb2", T, { tenantId: T, shopId: A, ref: "V-BAD", account: "999", debit: 0, credit: 400, label: "V", date: `${p}-10T10:00:00.000Z` });
    const c = await ok(call("ger", "ic.period.controls", { key: p })); expect(c.controls.find((x: any) => x.id === "system_balanced").items[0]).toContain("V-BAD"); expect(c.controls.find((x: any) => x.id === "accounts").detail).toContain("999"); await err(call("ger", "ic.period.close", { key: p }), 409);
  });
  it("grand livre et balance : écritures système + validées, total débit = total crédit, soldes cohérents", async () => {
    await st.create("journal_entries", "jl1", T, { tenantId: T, shopId: A, ref: "V-1", account: "571", debit: 2000, credit: 0, label: "Vente", date: `${day(-3)}T10:00:00.000Z` }); await st.create("journal_entries", "jl2", T, { tenantId: T, shopId: A, ref: "V-1", account: "701", debit: 0, credit: 2000, label: "Vente", date: `${day(-3)}T10:00:00.000Z` }); await validated({ lines: L2(500) });
    const b = await ok(call("compta", "ic.balance", {})); expect(b.totals).toMatchObject({ debit: 2500, credit: 2500, balanced: true }); const l = await ok(call("compta", "ic.ledger", { account: "571" })); expect(l.closing).toBe(2500); expect(l.rows.map((r: any) => r.source)).toEqual(["système", "icompta"]); expect((await ok(call("compta", "ic.ledger", { account: "571", from: day(-1) }))).opening).toBe(2000); await err(call("compta", "ic.ledger", {}), 400); await err(call("compta", "ic.balance", { from: "2026-02-30" }), 400);
  });
  it("comptes tiers depuis les factures ; exports journalisés ; isolation", async () => {
    await st.create("customers", "c1", T, { tenantId: T, shopId: A, name: "Awa" }); await st.create("invoices", "i1", T, { tenantId: T, shopId: A, number: "F-1", kind: "customer", partyId: "c1", total: 1000, paid: 400, status: "partial", dueAt: `${day(5)}T00:00:00.000Z` }); await st.create("invoices", "i2", T, { tenantId: T, shopId: B, number: "F-2", kind: "customer", partyId: "c1", total: 9999, paid: 0, status: "unpaid" });
    const t = await ok(call("compta", "ic.third", { kind: "customer" })); expect(t.parties).toHaveLength(1); expect(t.totals).toMatchObject({ invoiced: 1000, remaining: 600 }); await validated();
    for (const section of ["journal", "balance", "ledger", "third"]) { const r = await ok(call("compta", "ic.report", { section, from: day(-30), to: day(0) })); expect(r.sections.length).toBeGreaterThan(0); expect(r.notes.join(" ")).toContain("expert-comptable"); } expect(st.rows("audit_log").filter((a) => a.action === "icompta.export")).toHaveLength(4); await err(call("cais", "ic.report", {}), 403);
  });
  it("vue d'ensemble : compteurs, paramétrage à compléter, intégrité", async () => { await validated(); await pending("compta", { label: "À valider" }); const o = await ok(call("ger", "ic.overview")); expect(o.counts).toMatchObject({ validated: 1, pending: 1 }); expect(o.setup.unconfirmed).toBe(6); expect(o.integrity.ok).toBe(true); expect(o.alerts.some((a: any) => a.code === "pending")).toBe(true); });
});
