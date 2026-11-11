import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";

const T = "tenanticomp002";
let st: MemoryStore; let A = "", B = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}, shop = A, tenant = T) => handle(st, U[user] ?? user, { action, tenantId: tenant, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); return x.body.error as string; };
const setPlan = (plan: string) => { const row = st.rows("subscriptions").find((r) => r.$id === T); const data = { tenantId: T, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", T, T, data); };
const PLAN = "571;Caisse (test)\n521;Banque (test)\n701;Ventes (test)\n401;Fournisseurs (test)\n411;Clients (test)\n601;Achats (test)\n241;Matériel (test)\n2841;Amortissements matériel (test)\n681;Dotations (test)\n771;Résultat de cession (test)\n603;Pertes de stock (test)\n31;Stock (test)";
const rid = () => `k${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
const day = (o = 0) => new Date(Date.now() + o * 864e5).toISOString().slice(0, 10);
const L2 = (amount = 1000, a = "571", b = "701") => [{ account: a, debit: amount, credit: 0 }, { account: b, debit: 0, credit: amount }];
const draft = (user = "compta", over: object = {}, shop = A) => call(user, "ic.entry.save", { requestKey: rid(), journal: "OD", date: day(0), label: "Apport en caisse", lines: L2(), pieces: [{ ref: "REC-001" }], ...over }, shop);
const pending = async (user = "compta", over: object = {}) => { const d = await ok(draft(user, over)); await ok(call(user, "ic.entry.submit", { id: d.id })); return d.id as string; };
const validated = async (over: object = {}) => { const id = await pending("compta", over); await ok(call("ger", "ic.entry.validate", { id })); return id as string; };
const pdf = () => Buffer.from(`%PDF-1.4\n${"justificatif ".repeat(30)}`).toString("base64");
const verifyOk = async () => { const v = await ok(call("own", "ic.verify")); expect(v.issues, JSON.stringify(v.issues)).toEqual([]); };

beforeEach(async () => {
  st = new MemoryStore(); await st.grant(T, "own", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId;
  for (const [u, role, shops] of [["ger", "manager", [A]], ["ger2", "manager", [A]], ["gerB", "manager", [B]], ["compta", "accountant", [A]], ["cais", "cashier", [A]]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: shops }, ""))).userId;
  setPlan("pro"); await ok(call("ger", "ic.account.import", { text: PLAN })); await ok(call("ger", "ic.config.save", { config: { methods: { cash: "571", transfer: "521" } } }));
});

describe("ICompta Pro — abonnement et droits", () => {
  it("Business : actions Pro refusées, mais historique et lectures conservés ; Starter refusé", async () => {
    await ok(call("ger", "icp.dim.save", { kind: "activity", code: "BAR", label: "Bar" })); const asset = await ok(call("ger", "icp.asset.save", { requestKey: rid(), name: "Congélateur", accountAsset: "241", accountDepr: "2841", accountExpense: "681", cost: 600_000, residual: 0, months: 12, startOn: day(-40), convention: "same" }));
    setPlan("business"); await err(call("ger", "icp.dim.save", { kind: "activity", code: "X1", label: "Autre" }), 402); await err(call("ger", "icp.asset.save", { requestKey: rid(), name: "Machine", accountAsset: "241", accountDepr: "2841", accountExpense: "681", cost: 1000, residual: 0, months: 12, startOn: day(-1), convention: "same" }), 402); await err(call("ger", "icp.piece.add", { id: "x", data: pdf() }), 402); await err(call("ger", "icp.letter.create", { kind: "customer", partyId: "x", invoiceIds: ["i"], requestKey: rid() }), 402); await err(call("ger", "icp.config.save", { analyticRequired: true }), 402);
    expect((await ok(call("compta", "icp.assets"))).assets).toHaveLength(1); expect((await ok(call("compta", "icp.dims"))).dims).toHaveLength(1); expect((await ok(call("compta", "icp.overview"))).pro).toBe(false); expect(asset.id).toBeTruthy(); await ok(call("compta", "icp.statements")); await ok(call("compta", "icp.analytic"));
    setPlan("starter"); await err(call("own", "icp.assets"), 402); await err(call("cais", "icp.overview"), 403);
  });
  it("employé refusé ; comptable lit mais ne paramètre pas", async () => { await err(call("cais", "icp.assets"), 403); await err(call("compta", "icp.dim.save", { kind: "activity", code: "A1", label: "Alpha" }), 403); await err(call("compta", "icp.asset.save", { requestKey: rid() }), 403); });
});

describe("ICompta Pro — double approbation", () => {
  beforeEach(async () => { await err(call("ger", "icp.config.save", { approval: { twoFrom: 5000 } }), 403, "propriétaire"); await ok(call("own", "icp.config.save", { approval: { twoFrom: 5000, requireOwner: false } })); });
  it("sous le seuil : une validation ; au-dessus : deux approbateurs distincts, l'auteur ne compte pas, doublon sans effet, chaîne intacte", async () => {
    const small = await pending("compta", { lines: L2(4999) }); expect((await ok(call("ger", "ic.entry.validate", { id: small }))).status).toBe("validated");
    const big = await pending("compta", { lines: L2(10_000) }); await err(call("compta", "ic.entry.validate", { id: big }), 403); const a1 = await ok(call("ger", "ic.entry.validate", { id: big })); expect(a1).toMatchObject({ status: "pending", approvals: 1, required: 2 }); const again = await ok(call("ger", "ic.entry.validate", { id: big })); expect(again).toMatchObject({ status: "pending", duplicate: true, approvals: 1 });
    expect(st.rows("acct_entries").find((e) => e.$id === big)!.seq ?? null).toBeNull(); const a2 = await ok(call("ger2", "ic.entry.validate", { id: big })); expect(a2.status).toBe("validated"); const e = (await ok(call("own", "ic.entry", { id: big }))).entry; expect(e.approvals.map((x: any) => x.by)).toEqual([U.ger, U.ger2]); expect(e.number).toMatch(/^ICE-/); await verifyOk();
    const dup = await ok(call("ger2", "ic.entry.validate", { id: big })); expect(dup.duplicate).toBe(true);
  });
  it("propriétaire auteur : approuve mais l'écriture est signalée, une seconde personne reste requise ; propriétaire exigé si demandé", async () => {
    const own = await ok(call("own", "ic.entry.save", { requestKey: rid(), journal: "OD", date: day(0), label: "Apport du propriétaire", lines: L2(9000), pieces: [{ ref: "R1" }] })); await ok(call("own", "ic.entry.submit", { id: own.id })); expect((await ok(call("own", "ic.entry.validate", { id: own.id }))).status).toBe("pending"); expect((await ok(call("ger", "ic.entry.validate", { id: own.id }))).status).toBe("validated"); expect(st.rows("acct_entries").find((e) => e.$id === own.id)!.selfValidated).toBe(true);
    await ok(call("own", "icp.config.save", { approval: { twoFrom: 5000, requireOwner: true } })); const big = await pending("compta", { lines: L2(8000) }); await ok(call("ger", "ic.entry.validate", { id: big })); expect((await ok(call("ger2", "ic.entry.validate", { id: big }))).status).toBe("pending"); expect((await ok(call("own", "ic.entry.validate", { id: big }))).status).toBe("validated"); await verifyOk();
  });
  it("falsifier la liste des approbations après validation est détecté", async () => {
    const big = await pending("compta", { lines: L2(10_000) }); await ok(call("ger", "ic.entry.validate", { id: big })); await ok(call("ger2", "ic.entry.validate", { id: big })); await verifyOk(); const row = st.rows("acct_entries").find((e) => e.$id === big)!; row.approvals = JSON.stringify([{ by: "complice", at: "2020-01-01T00:00:00Z", role: "manager" }]); const v = await ok(call("own", "ic.verify")); expect(v.ok).toBe(false); expect(v.issues.some((i: any) => i.code === "hash")).toBe(true);
  });
  it("retour à Business : une écriture déjà approuvée une fois reste validable, chaîne valide", async () => { const big = await pending("compta", { lines: L2(10_000) }); await ok(call("ger", "ic.entry.validate", { id: big })); setPlan("business"); expect((await ok(call("ger2", "ic.entry.validate", { id: big }))).status).toBe("validated"); await verifyOk(); });
  it("les écritures sans approbation gardent leur empreinte (compatibilité)", async () => { await validated({ lines: L2(100) }); const row = st.rows("acct_entries")[0]!; expect(row.approvals ?? null).toBeNull(); await verifyOk(); });
});

describe("ICompta Pro — pièces avec empreinte", () => {
  it("ajout, empreinte serveur, doublon, vérification, altération détectée, brouillon seulement", async () => {
    const d = await ok(draft("compta")); const r = await ok(call("compta", "icp.piece.add", { id: d.id, name: "facture.pdf", data: pdf() })); expect(r.sha256).toMatch(/^[0-9a-f]{64}$/); expect(r.duplicate).toBe(false); expect((await ok(call("compta", "icp.piece.add", { id: d.id, name: "copie.pdf", data: pdf() }))).duplicate).toBe(true);
    await err(call("compta", "icp.piece.add", { id: d.id, name: "x.txt", data: Buffer.from("pas un pdf".repeat(20)).toString("base64") }), 400, "Format"); await err(call("cais", "icp.piece.add", { id: d.id, data: pdf() }), 403);
    expect((await ok(call("compta", "icp.piece.verify", { id: d.id }))).ok).toBe(true); const upd = await ok(call("compta", "ic.entry.save", { id: d.id, journal: "OD", date: day(0), label: "Apport modifié", lines: L2(), pieces: [{ ref: "REC-002" }] })); expect(upd.id).toBe(d.id); expect((await ok(call("compta", "ic.entry", { id: d.id }))).entry.pieces.filter((p: any) => p.file)).toHaveLength(1);
    await ok(call("compta", "ic.entry.submit", { id: d.id })); await err(call("compta", "icp.piece.add", { id: d.id, name: "autre.pdf", data: Buffer.from(`%PDF-1.4\n${"autre ".repeat(40)}`).toString("base64") }), 409, "brouillon"); await ok(call("ger", "ic.entry.validate", { id: d.id })); await verifyOk();
    const file = [...st.files.values()][0]!; file.data = new Uint8Array(Buffer.from(`%PDF-1.4\n${"falsifié ".repeat(30)}`)); const v = await ok(call("own", "icp.piece.verify", { id: d.id })); expect(v.ok).toBe(false); expect(v.pieces[0].state).toBe("altérée");
  });
  it("retrait d'un brouillon supprime le fichier ; impossible sur une écriture soumise", async () => { const d = await ok(draft("compta")); const r = await ok(call("compta", "icp.piece.add", { id: d.id, name: "a.pdf", data: pdf() })); expect(st.files.size).toBe(1); await ok(call("compta", "icp.piece.remove", { id: d.id, file: r.fileId })); expect(st.files.size).toBe(0); });
});

describe("ICompta Pro — lettrage", () => {
  const inv = async (id: string, total: number, paid: number, kind = "customer", party = "c1") => { await st.create("invoices", id, T, { tenantId: T, shopId: A, number: `F-${id}`, kind, partyId: party, total, paid, vat: 0, status: paid >= total ? "paid" : paid > 0 ? "partial" : "unpaid", dueAt: day(5), issuedOn: day(-3), payments: "[]", lines: "[]", saleId: "", ref: "" }); };
  beforeEach(async () => { await st.create("customers", "c1", T, { tenantId: T, shopId: A, name: "Awa" }); await inv("i1", 5000, 5000); await inv("i2", 3000, 3000); await inv("i3", 4000, 1000); });
  it("candidates : seules les factures soldées ; lettre A puis B ; doublon de clé idempotent ; facture déjà lettrée et non soldée refusées ; annulation motivée libère", async () => {
    const c = await ok(call("compta", "icp.letter.candidates")); expect(c.parties[0].invoices.map((i: any) => i.id).sort()).toEqual(["i1", "i2"]); const k = rid(); const l1 = await ok(call("ger", "icp.letter.create", { kind: "customer", partyId: "c1", invoiceIds: ["i1"], requestKey: k })); expect(l1.letter).toBe("A"); expect((await ok(call("ger", "icp.letter.create", { kind: "customer", partyId: "c1", invoiceIds: ["i1"], requestKey: k }))).duplicate).toBe(true);
    await err(call("ger", "icp.letter.create", { kind: "customer", partyId: "c1", invoiceIds: ["i1"], requestKey: rid() }), 409, "déjà lettrée"); await err(call("ger", "icp.letter.create", { kind: "customer", partyId: "c1", invoiceIds: ["i3"], requestKey: rid() }), 409, "non soldée"); await err(call("ger", "icp.letter.create", { kind: "customer", partyId: "autre", invoiceIds: ["i2"], requestKey: rid() }), 409, "introuvable");
    const l2 = await ok(call("ger", "icp.letter.create", { kind: "customer", partyId: "c1", invoiceIds: ["i2"], requestKey: rid() })); expect(l2.letter).toBe("B"); await err(call("compta", "icp.letter.undo", { id: l1.id, reason: "erreur de saisie" }), 403); await err(call("ger", "icp.letter.undo", { id: l1.id, reason: "x" }), 400); await ok(call("ger", "icp.letter.undo", { id: l1.id, reason: "lettrage erroné" }));
    expect((await ok(call("ger", "icp.letter.undo", { id: l1.id, reason: "lettrage erroné" }))).duplicate).toBe(true); const list = (await ok(call("compta", "icp.letters"))).letters; expect(list).toHaveLength(2); expect(list.find((x: any) => x.letter === "A").status).toBe("undone"); expect((await ok(call("compta", "icp.letter.candidates"))).parties[0].invoices.map((i: any) => i.id)).toEqual(["i1"]);
    expect(st.rows("audit_log").filter((a) => String(a.action).startsWith("icompta.letter")).length).toBe(3);
  });
  it("deux lettrages simultanés de la même facture : un seul gagne", async () => { const r = await Promise.all([call("ger", "icp.letter.create", { kind: "customer", partyId: "c1", invoiceIds: ["i1"], requestKey: rid() }), call("ger2", "icp.letter.create", { kind: "customer", partyId: "c1", invoiceIds: ["i1"], requestKey: rid() })]); expect(r.map((x) => x.status).sort()).toEqual([200, 409]); expect(st.rows("acct_letters").filter((l) => l.status === "active")).toHaveLength(1); });
});

describe("ICompta Pro — immobilisations", () => {
  const first = () => `${new Date(Date.now() - 62 * 864e5).toISOString().slice(0, 7)}-01`;
  const mk = (over: object = {}) => call("ger", "icp.asset.save", { requestKey: rid(), name: "Congélateur", accountAsset: "241", accountDepr: "2841", accountExpense: "681", cost: 100_000, residual: 10_000, months: 9, startOn: first(), convention: "same", ...over });
  it("aucune durée ni convention présumée ; comptes du plan obligatoires ; idempotence", async () => {
    await err(mk({ months: undefined }), 400, "Durée"); await err(mk({ convention: undefined }), 400, "convention"); await err(mk({ accountExpense: "999" }), 400, "plan de comptes"); await err(mk({ residual: 100_000 }), 400, "résiduelle"); const k = rid(); const a = await ok(mk({ requestKey: k })); expect((await ok(mk({ requestKey: k }))).duplicate).toBe(true); expect(a.id).toBeTruthy(); expect(st.rows("acct_assets")).toHaveLength(1);
  });
  it("dotations proposées, créées une seule fois, validées ; valeur nette ; clôture bloquée tant que les dotations ne sont pas validées", async () => {
    const a = await ok(mk()); const props = (await ok(call("ger", "ic.proposals"))).proposals.filter((p: any) => p.kind === "depreciation"); expect(props.length).toBe(3); expect(props.every((p: any) => p.ready)).toBe(true); expect(props.map((p: any) => p.lines[0].debit)).toEqual([10_000, 10_000, 10_000]);
    const keys = props.map((p: any) => p.key); const r = await ok(call("compta", "ic.proposal.create", { keys })); expect(r.created).toBe(3); expect((await ok(call("compta", "ic.proposal.create", { keys }))).created).toBe(0); expect((await ok(call("compta", "ic.proposals"))).proposals.filter((p: any) => p.kind === "depreciation")).toHaveLength(0);
    const ents = (await ok(call("ger", "ic.entries"))).entries; expect(ents.every((e: any) => e.kind === "depreciation")).toBe(true); const ctl = (await ok(call("ger", "ic.period.controls", { key: ents[0].date.slice(0, 7) }))).controls; expect(ctl.find((c: any) => c.id === "unprocessed").ok).toBe(false);
    for (const e of ents) { await ok(call("compta", "ic.entry.submit", { id: e.id })); await ok(call("ger", "ic.entry.validate", { id: e.id })); } const list = (await ok(call("ger", "icp.assets"))).assets[0]; expect(list.cumulated).toBe(30_000); expect(list.netValue).toBe(70_000); expect(list.schedule.filter((p: any) => p.state === "validated")).toHaveLength(3); expect(list.id).toBe(a.id); await verifyOk();
  });
  it("cession : exige les dotations validées, écriture équilibrée à valider, plus aucune dotation ensuite, statut cédée", async () => {
    const a = await ok(mk({ residual: 0, months: 3, cost: 90_000 })); await err(call("ger", "icp.asset.dispose", { id: a.id, requestKey: rid(), date: day(0), proceeds: 0, reason: "Mise au rebut", resultAccount: "771" }), 409, "amortissements");
    const props = (await ok(call("ger", "ic.proposals"))).proposals.filter((p: any) => p.kind === "depreciation"); await ok(call("compta", "ic.proposal.create", { keys: props.map((p: any) => p.key) })); for (const e of (await ok(call("ger", "ic.entries"))).entries) { await ok(call("compta", "ic.entry.submit", { id: e.id })); await ok(call("ger", "ic.entry.validate", { id: e.id })); }
    await err(call("ger", "icp.asset.dispose", { id: a.id, requestKey: rid(), date: day(0), proceeds: 0, reason: "Mise au rebut" }), 400, "compte"); const k = rid(); const d = await ok(call("ger", "icp.asset.dispose", { id: a.id, requestKey: k, date: day(0), proceeds: 20_000, proceedsAccount: "521", resultAccount: "771", reason: "Vente du matériel" })); expect(d.result).toBe(20_000 - 0); expect((await ok(call("ger", "icp.asset.dispose", { id: a.id, requestKey: k, date: day(0), proceeds: 20_000, proceedsAccount: "521", resultAccount: "771", reason: "Vente du matériel" }))).duplicate).toBe(true);
    expect((await ok(call("ger", "icp.assets"))).assets[0].status).toBe("disposing"); await ok(call("ger", "ic.entry.submit", { id: d.entryId })); await ok(call("ger2", "ic.entry.validate", { id: d.entryId })); const done = (await ok(call("ger", "icp.assets"))).assets[0]; expect(done.status).toBe("disposed"); const lines = (await ok(call("ger", "ic.entry", { id: d.entryId }))).entry.lines; expect(lines.reduce((s: number, l: any) => s + l.debit - l.credit, 0)).toBe(0); expect(lines.find((l: any) => l.account === "241")).toMatchObject({ credit: 90_000 }); expect((await ok(call("ger", "ic.proposals"))).proposals.filter((p: any) => p.kind === "depreciation")).toHaveLength(0); await verifyOk();
  });
  it("compte de dotation désactivé : proposition bloquée", async () => { await ok(mk()); await ok(call("ger", "ic.account.save", { code: "681", active: false })); const p = (await ok(call("ger", "ic.proposals"))).proposals.filter((x: any) => x.kind === "depreciation"); expect(p.every((x: any) => !x.ready && x.blocked.includes("681"))).toBe(true); });
});

describe("ICompta Pro — analytique", () => {
  beforeEach(async () => { await ok(call("ger", "icp.dim.save", { kind: "activity", code: "BAR", label: "Bar" })); await ok(call("ger", "icp.dim.save", { kind: "activity", code: "BOUT", label: "Boutique" })); await ok(call("ger", "icp.dim.save", { kind: "project", code: "EXT", label: "Extension" })); });
  it("lignes étiquetées validées, inconnues refusées, rapports par activité et par projet avec comparaison, sans répartition arbitraire", async () => {
    await err(draft("compta", { lines: [{ account: "601", debit: 700, credit: 0, act: "XXX" }, { account: "571", debit: 0, credit: 700 }] }), 400, "inconnue"); await validated({ lines: [{ account: "601", debit: 700, credit: 0, act: "BAR", proj: "EXT" }, { account: "571", debit: 0, credit: 700 }] }); await validated({ lines: [{ account: "571", debit: 2000, credit: 0 }, { account: "701", debit: 0, credit: 2000, act: "BAR" }] }); await validated({ lines: [{ account: "571", debit: 500, credit: 0 }, { account: "701", debit: 0, credit: 500 }] });
    const a = await ok(call("compta", "icp.analytic", { axis: "act" })); expect(a.rows).toEqual([{ code: "(sans axe)", label: "", charges: 0, produits: 500, result: 500 }, { code: "BAR", label: "Bar", charges: 700, produits: 2000, result: 1300 }]); const p = await ok(call("compta", "icp.analytic", { axis: "proj", compareFrom: day(-400), compareTo: day(-300) })); expect(p.rows.find((r: any) => r.code === "EXT")).toMatchObject({ charges: 700, delta: -700 }); await verifyOk();
    const dims = (await ok(call("compta", "icp.dims"))).dims; expect(dims).toHaveLength(3); await ok(call("ger", "icp.dim.save", { kind: "activity", code: "BOUT", active: false })); await err(draft("compta", { lines: [{ account: "601", debit: 7, credit: 0, act: "BOUT" }, { account: "571", debit: 0, credit: 7 }] }), 400, "inconnue ou désactivée");
  });
  it("activité obligatoire (propriétaire) sur les comptes 6 et 7 ; Business refuse les axes", async () => {
    await ok(call("own", "icp.config.save", { analyticRequired: true })); await err(draft("compta", { lines: L2(500, "571", "701") }), 400, "obligatoire"); await ok(draft("compta", { lines: [{ account: "571", debit: 500, credit: 0 }, { account: "701", debit: 0, credit: 500, act: "BAR" }] })); setPlan("business"); await err(draft("compta", { lines: [{ account: "571", debit: 5, credit: 0 }, { account: "701", debit: 0, credit: 5, act: "BAR" }] }), 403, "Pro");
  });
});

describe("ICompta Pro — états, clôture guidée, règles", () => {
  it("résultat provisoire indicatif ; aucun état officiel sans correspondance ; correspondance de l'expert (préfixe le plus long, comptes non rattachés listés) ; export journalisé", async () => {
    await validated({ lines: L2(1000, "601", "571") }); await validated({ lines: L2(3000, "571", "701") }); const s = await ok(call("compta", "icp.statements")); expect(s.provisional).toEqual({ charges: 1000, produits: 3000, result: 2000 }); expect(s.mapConfigured).toBe(false); expect(s.mapped).toBeNull(); expect(s.note).toContain("PROVISOIRE");
    await err(call("compta", "icp.map.save", { map: [] }), 403); await err(call("ger", "icp.map.save", { map: [{ section: "x", label: "", prefixes: ["a"], sign: "?" }] }), 400); await ok(call("ger", "icp.map.save", { map: [{ section: "income", label: "Achats", prefixes: ["6"], sign: "debit" }, { section: "income", label: "Ventes", prefixes: ["70"], sign: "credit" }] }));
    const m = await ok(call("compta", "icp.statements")); expect(m.mapped.lines.map((l: any) => l.amount)).toEqual([1000, 3000]); expect(m.mapped.unmapped.map((u: any) => u.account)).toEqual(["571"]); const rep = await ok(call("compta", "icp.report", { section: "statements" })); expect(rep.sections[0].rows[0]).toEqual([1000, 3000, 2000]); expect(st.rows("audit_log").some((a) => a.action === "icompta.export" && String(a.detail).startsWith("pro:statements"))).toBe(true);
  });
  it("clôture guidée : étapes bloquantes, rapprochement bancaire exigé seulement si le compte est paramétré", async () => {
    const key = day(0).slice(0, 7); await validated(); let g = await ok(call("ger", "icp.close.guide", { key })); expect(g.steps.length).toBeGreaterThan(6); expect(g.steps.find((x: any) => x.id === "bank")).toBeUndefined();
    await ok(call("ger", "fin.account.save", { requestKey: rid(), name: "Banque BICIS", kind: "bank", methods: ["transfer"], openingBalance: 0, openingDate: day(-30) })); const fid = st.rows("fin_accounts")[0]!.$id; await ok(call("ger", "icp.config.save", { bankMap: { [fid]: "521" } })); g = await ok(call("ger", "icp.close.guide", { key })); const bank = g.steps.find((x: any) => x.id === "bank"); expect(bank.ok).toBe(false); expect(bank.blocking).toBe(true); expect(g.canClose).toBe(false); await err(call("ger", "icp.config.save", { bankMap: { inconnu: "521" } }), 400);
    await err(call("ger", "icp.close.guide", { key: "2026-13" }), 400);
  });
  it("perte de stock : bloquée sans règle, valorisée qty × coût avec règle, une seule écriture", async () => {
    await st.create("products", "p1", T, { tenantId: T, shopId: A, name: "Eau 1,5L", price: 500, cost: 300, qtyScale: 0 }); await st.create("stock_moves", "ml1", T, { tenantId: T, shopId: A, productId: "p1", qty: 4, kind: "loss", refId: "casse" });
    let p = (await ok(call("ger", "ic.proposals"))).proposals.find((x: any) => x.kind === "stock_loss"); expect(p.ready).toBe(false); expect(p.blocked).toContain("non paramétrée"); await err(call("ger", "icp.config.save", { stockLoss: { debit: "999", credit: "31" } }), 400); await ok(call("ger", "icp.config.save", { stockLoss: { debit: "603", credit: "31" } }));
    p = (await ok(call("ger", "ic.proposals"))).proposals.find((x: any) => x.kind === "stock_loss"); expect(p.ready).toBe(true); expect(p.amount).toBe(1200); expect(p.lines).toEqual([{ account: "603", debit: 1200, credit: 0 }, { account: "31", debit: 0, credit: 1200 }]); await ok(call("compta", "ic.proposal.create", { keys: [p.key] })); expect((await ok(call("compta", "ic.proposal.create", { keys: [p.key] }))).created).toBe(0); expect(st.rows("acct_entries").filter((e) => e.kind === "stock_loss")).toHaveLength(1);
    await st.create("products", "p2", T, { tenantId: T, shopId: A, name: "Sans coût", price: 500, cost: 0, qtyScale: 0 }); await st.create("stock_moves", "ml2", T, { tenantId: T, shopId: A, productId: "p2", qty: 1, kind: "loss", refId: "vol" }); const q = (await ok(call("ger", "ic.proposals"))).proposals.find((x: any) => x.label.includes("Sans coût")); expect(q.blocked).toContain("non valorisable");
  });
  it("paramétrage Pro : seul le propriétaire fixe seuil et obligation ; la configuration Business est conservée", async () => {
    await ok(call("own", "icp.config.save", { approval: { twoFrom: 20_000, requireOwner: true } })); await ok(call("ger", "ic.config.save", { config: { methods: { cash: "571", transfer: "521" }, deferredPayable: "401" } })); const c = await ok(call("own", "icp.config")); expect(c.config.approval).toEqual({ twoFrom: 20_000, requireOwner: true }); expect((await ok(call("own", "ic.config"))).config.deferredPayable).toBe("401"); await err(call("ger", "icp.config.save", { analyticRequired: true }), 403); await err(call("own", "icp.config.save", { approval: { twoFrom: -5 } }), 400);
    expect(st.rows("audit_log").filter((a) => a.action === "icompta.pro.config")).toHaveLength(1);
  });
  it("isolation entre boutiques : un gérant d'une autre boutique ne voit ni immobilisations ni lettrages", async () => { await ok(call("ger", "icp.dim.save", { kind: "activity", code: "BAR", label: "Bar" })); await ok(call("gerB", "ic.account.import", { text: PLAN }, B)); expect((await ok(call("gerB", "icp.dims", {}, B))).dims).toEqual([]); await err(call("gerB", "icp.assets", {}, A), 403); void B; });
});
