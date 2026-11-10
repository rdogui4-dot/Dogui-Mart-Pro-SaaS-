import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";

class DatedStore extends MemoryStore { override async create(t: string, id: string, tenant: string, d: Record<string, unknown>) { return super.create(t, id, tenant, { $createdAt: new Date().toISOString(), ...d }); } }
const T = "tenantcrm001";
let st: DatedStore; let A = "", B = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}, shop = A, tenant = T) => handle(st, U[user] ?? user, { action, tenantId: tenant, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); return x.body.error as string; };
const setPlan = (plan: string) => { const row = st.rows("subscriptions").find((r) => r.$id === T); const data = { tenantId: T, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", T, T, data); };
const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);
const day = (o = 0) => new Date(Date.now() + o * 864e5).toISOString().slice(0, 10);
const at = (days: number, h = 10) => new Date(Date.now() + days * 864e5 + h * 36e5 - 12 * 36e5).toISOString();
let sN = 0;
const sale = (customerId: string, total: number, days: number, extra: object = {}, shop = A) => st.create("sales", `sl${++sN}`, T, { tenantId: T, shopId: shop, number: `V-${sN}`, total, customerId, cashierId: "own", status: "paid", payments: JSON.stringify([{ method: "cash", amount: total }]), lines: JSON.stringify([{ productId: "p1", name: "Riz", qty: 2, unitPrice: total / 2 }]), clientId: `cl${sN}`, soldAt: at(days), ...extra });
const newCust = (name: string, extra: object = {}, user = "own") => ok(call(user, "crm.customer.save", { requestKey: rid(), name, ...extra }));
const newLead = (name: string, extra: object = {}, user = "own") => ok(call(user, "crm.lead.save", { requestKey: rid(), name, ...extra }));

beforeEach(async () => {
  st = new DatedStore(); await st.grant(T, "own", ["owner"], []); sN = 0;
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId;
  for (const [u, role, shops] of [["cais", "cashier", [A]], ["ger", "manager", [A, B]], ["stk", "stockkeeper", [A]], ["gerB", "manager", [B]]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: shops }, ""))).userId;
  await st.create("products", "p1", T, { tenantId: T, shopId: A, name: "Riz", price: 1000, cost: 500 }); await st.create("stock_moves", "m0", T, { tenantId: T, shopId: A, productId: "p1", qty: 100, kind: "purchase" });
  setPlan("business");
});

describe("abonnement, rôles, isolation", () => {
  it("Business et plus (402 en Starter) ; module Clients requis (403) ; opportunités et tableau de bord réservés aux gérants", async () => {
    setPlan("starter"); await err(call("own", "crm.customers"), 402); setPlan("business");
    await err(call("stk", "crm.customers"), 403); await ok(call("cais", "crm.customers")); await ok(call("cais", "crm.leads")); await err(call("cais", "crm.opps"), 403); await err(call("cais", "crm.dashboard"), 403); await err(call("cais", "crm.lead.archive", { id: "x" }), 403);
    await ok(call("ger", "crm.dashboard")); await ok(call("ger", "crm.opps"));
  });
  it("isolation par commerce et par boutique : autre tenant et autre boutique ne voient rien", async () => {
    const c = await newCust("Awa Ndiaye"); const l = await newLead("Moussa Fall"); setPlan("pro"); await err(call("gerB", "crm.customer", { id: c.id }, B), 404); await err(call("gerB", "crm.lead", { id: l.id }, B), 404); expect((await ok(call("gerB", "crm.customers", {}, B))).total).toBe(0); expect((await ok(call("gerB", "crm.leads", {}, B))).total).toBe(0);
    await err(call("gerB", "crm.lead.stage", { id: l.id, stage: "contacted" }, B), 404);
  });
});

describe("fiches clients", () => {
  it("création validée (nom, téléphone, e-mail, origine), idempotente, avec doublons signalés puis confirmables", async () => {
    await err(call("own", "crm.customer.save", { requestKey: rid(), name: "A" }), 400, "Nom"); await err(call("own", "crm.customer.save", { requestKey: rid(), name: "Awa", phone: "abc" }), 400, "Téléphone"); await err(call("own", "crm.customer.save", { requestKey: rid(), name: "Awa", email: "x" }), 400, "E-mail"); await err(call("own", "crm.customer.save", { requestKey: rid(), name: "Awa", source: "zzz" }), 400, "Origine"); await err(call("own", "crm.customer.save", { name: "Awa" }), 400, "requestKey");
    const k = rid(); const a = await ok(call("own", "crm.customer.save", { requestKey: k, name: "Awa Ndiaye", phone: "77 000 11 22", email: "Awa@Mail.sn", company: "Boutique Awa", source: "referral", tags: "vip, Gros", prefs: { channel: "whatsapp", language: "fr" }, consents: { whatsapp: true } })); const again = await ok(call("own", "crm.customer.save", { requestKey: k, name: "Awa Ndiaye" })); expect(again).toMatchObject({ id: a.id, duplicate: true }); expect(st.rows("customers").length).toBe(1);
    const row = st.rows("customers")[0]!; expect(row).toMatchObject({ phone: "770001122", email: "awa@mail.sn", source: "referral", ownerId: "own", points: 0, creditBalance: 0 }); expect(JSON.parse(row.tags)).toEqual(["vip", "gros"]);
    await err(call("own", "crm.customer.save", { requestKey: rid(), name: "Autre Awa", phone: "+221 77 000 11 22" }), 409, "DOUBLON_POSSIBLE"); await err(call("own", "crm.customer.save", { requestKey: rid(), name: "Autre", email: "awa@mail.sn" }), 409, "DOUBLON_POSSIBLE"); expect(st.rows("customers").length).toBe(1);
    await ok(call("own", "crm.customer.save", { requestKey: rid(), name: "Autre Awa", phone: "770001122", confirmDuplicate: true })); expect(st.rows("customers").length).toBe(2);
  });
  it("consentements : la modification est tracée (auteur, date) dans l'historique ; plafond de crédit et catégorie intacts", async () => {
    const c = await newCust("Awa", { phone: "770001122" }); st.rows("customers")[0]!.creditLimit = 5000; await ok(call("cais", "crm.customer.save", { id: c.id, consents: { sms: true, email: false, whatsapp: true } })); const f = await ok(call("own", "crm.customer", { id: c.id }));
    expect(f.consents).toMatchObject({ sms: true, whatsapp: true, email: false }); expect(f.consents.by).toBe("cais"); expect(f.timeline.some((e: any) => e.type === "consent" && e.by === "cais")).toBe(true); expect(st.rows("customers")[0]!.creditLimit).toBe(5000);
    await err(call("cais", "crm.customer.save", { id: c.id, archived: true }), 403); await err(call("cais", "crm.customer.save", { id: c.id, ownerId: "own" }), 403); await err(call("ger", "crm.customer.save", { id: c.id, ownerId: "inconnu" }), 400);
  });
  it("recherche, filtres (segment, origine, étiquette, responsable), tri, pagination ; archivés masqués", async () => {
    for (let i = 0; i < 5; i++) await newCust(`Client ${i}`, { phone: `7700000${i}0`, source: i % 2 ? "social" : "walkin", tags: i === 0 ? "vip" : "" }); const x = await ok(call("own", "crm.customers", { limit: 2, offset: 0 })); expect(x.total).toBe(5); expect(x.customers.length).toBe(2); expect((await ok(call("own", "crm.customers", { limit: 2, offset: 4 }))).customers.length).toBe(1);
    expect((await ok(call("own", "crm.customers", { q: "client 3" }))).total).toBe(1); expect((await ok(call("own", "crm.customers", { q: "7700000" }))).total).toBe(5); expect((await ok(call("own", "crm.customers", { source: "social" }))).total).toBe(2); expect((await ok(call("own", "crm.customers", { tag: "vip" }))).total).toBe(1); expect((await ok(call("own", "crm.customers", { owner: "mine" }))).total).toBe(5); expect((await ok(call("ger", "crm.customers", { owner: "mine" }))).total).toBe(0);
    const id = st.rows("customers")[0]!.$id; await ok(call("ger", "crm.customer.save", { id, archived: true })); expect((await ok(call("own", "crm.customers"))).total).toBe(4); expect((await ok(call("own", "crm.customers", { archived: true }))).total).toBe(1);
  });
});

describe("historique réel : ventes, paiements, articles, promotions", () => {
  it("une vente confirmée met la fiche à jour sans doublon ; annulées, en attente et remboursées exclues ; segments et clients inactifs", async () => {
    const a = (await newCust("Awa")).id, b = (await newCust("Bara")).id, c = (await newCust("Cheikh")).id, d = (await newCust("Dieynaba")).id;
    await sale(a, 5000, -3); await sale(a, 3000, -40); await sale(a, 9999, -2, { status: "pending" }); await sale(a, 7777, -1, { status: "cancelled" }); await sale(b, 8000, -90); await sale(c, 4000, -300);
    const s = await ok(call("own", "crm.customers")); const by = (id: string) => s.customers.find((x: any) => x.id === id); expect(by(a)).toMatchObject({ salesCount: 2, total: 8000, segment: "active" }); expect(by(b).segment).toBe("inactive"); expect(by(c).segment).toBe("dormant"); expect(by(d)).toMatchObject({ segment: "never", salesCount: 0 }); expect(s.segments).toMatchObject({ active: 1, inactive: 1, dormant: 1, never: 1 });
    expect((await ok(call("own", "crm.customers", { segment: "inactive" }))).customers.map((x: any) => x.name)).toEqual(["Bara"]); expect((await ok(call("own", "crm.customers", { sort: "spent" }))).customers[0].name).toBe("Awa");
    const f = await ok(call("own", "crm.customer", { id: a })); expect(f.stats).toMatchObject({ salesCount: 2, total: 8000, average: 4000 }); expect(f.timeline.filter((t: any) => t.type === "sale").map((t: any) => t.title)).toEqual(["Vente V-1", "Vente V-2"]); expect(f.timeline.find((t: any) => t.type === "sale").detail).toMatch(/cash 5000/); expect(f.topArticles[0]).toMatchObject({ name: "Riz", qty: 4 });
    await sale(a, 1000, 0); const g = await ok(call("own", "crm.customer", { id: a })); expect(g.stats.salesCount).toBe(3); expect((await ok(call("own", "crm.customer", { id: a }))).stats.salesCount).toBe(3);
  });
  it("vente réelle passée par la caisse : l'historique du client se met à jour, rejouer la vente ne crée ni doublon ni second achat", async () => {
    const c = (await newCust("Awa")).id; const body = { clientId: "client-uuid-0001", customerId: c, lines: [{ productId: "p1", qty: 2 }], payments: [{ method: "cash", amount: 2000 }] };
    await ok(call("cais", "checkout", body)); await ok(call("cais", "checkout", body)); const f = await ok(call("own", "crm.customer", { id: c })); expect(f.stats.salesCount).toBe(1); expect(f.stats.total).toBe(2000); expect(f.timeline.filter((t: any) => t.type === "sale").length).toBe(1); expect(f.topArticles[0]).toMatchObject({ name: "Riz", qty: 2 });
  });
  it("remboursement : une vente entièrement remboursée ne compte plus ; un remboursement partiel réduit le total net", async () => {
    const a = (await newCust("Awa")).id; await sale(a, 5000, -5); await sale(a, 4000, -4, { status: "refunded" }); await st.create("sale_returns", "r1", T, { tenantId: T, shopId: A, saleId: "sl1", saleNumber: "V-1", kind: "refund", amount: 1500, status: "done", at: at(-3), userId: "own", reason: "Défaut" });
    const f = await ok(call("own", "crm.customer", { id: a })); expect(f.stats).toMatchObject({ salesCount: 1, total: 3500 }); expect(f.timeline.some((t: any) => t.type === "return" && t.amount === -1500)).toBe(true);
  });
  it("promotions utilisées par le client : nombre et économies", async () => {
    const a = (await newCust("Awa")).id; await st.create("promotion_usage", "u1", T, { tenantId: T, shopId: A, promotionId: "pr1", saleId: "sl1", customerId: a, discount: 500 }); await st.create("promotion_usage", "u2", T, { tenantId: T, shopId: A, promotionId: "pr1", saleId: "sl2", customerId: a, discount: 250 });
    const f = await ok(call("own", "crm.customer", { id: a })); expect(f.stats).toMatchObject({ promoSaved: 750, promoCount: 2 });
  });
});

describe("prospects et pipeline", () => {
  it("création validée et idempotente ; doublon avec un client existant signalé ; étapes avec historique (auteur, date)", async () => {
    await newCust("Awa", { phone: "770001122" }); await err(call("own", "crm.lead.save", { requestKey: rid(), name: "Awa bis", phone: "770001122" }), 409, "DOUBLON_POSSIBLE"); const k = rid(); const l = await ok(call("cais", "crm.lead.save", { requestKey: k, name: "Moussa Fall", phone: "770009999", source: "whatsapp", notes: "Intéressé par 50 sacs" })); expect(await ok(call("cais", "crm.lead.save", { requestKey: k, name: "Moussa Fall" }))).toMatchObject({ id: l.id, duplicate: true }); expect(st.rows("crm_leads").length).toBe(1);
    await ok(call("cais", "crm.lead.stage", { id: l.id, stage: "contacted" })); await ok(call("cais", "crm.lead.stage", { id: l.id, stage: "qualified" })); await ok(call("cais", "crm.lead.stage", { id: l.id, stage: "proposal" })); expect(await ok(call("cais", "crm.lead.stage", { id: l.id, stage: "proposal" }))).toMatchObject({ unchanged: true });
    const d = await ok(call("own", "crm.lead", { id: l.id })); expect(d.stage).toBe("proposal"); expect(d.timeline.filter((e: any) => e.type === "stage").length).toBe(3); expect(d.timeline.every((e: any) => e.by)).toBe(true); expect(d.timeline.some((e: any) => /Qualifié → Proposition/.test(e.detail))).toBe(true);
    await err(call("own", "crm.lead.stage", { id: l.id, stage: "bidon" }), 400); const lst = await ok(call("own", "crm.leads")); expect(lst.counts.proposal).toBe(1); expect(lst.counts.new).toBe(0);
  });
  it("« Gagné » impossible sans conversion ; « Perdu » exige un motif ; clôturé = gérant pour rouvrir", async () => {
    const l = await newLead("Moussa"); await err(call("own", "crm.lead.stage", { id: l.id, stage: "won" }), 409, "conversion"); await err(call("own", "crm.lead.stage", { id: l.id, stage: "lost" }), 400, "Motif"); await ok(call("cais", "crm.lead.stage", { id: l.id, stage: "lost", reason: "Prix trop élevé" }));
    expect((await ok(call("own", "crm.lead", { id: l.id }))).lostReason).toBe("Prix trop élevé"); await err(call("cais", "crm.lead.stage", { id: l.id, stage: "new" }), 409); await err(call("cais", "crm.lead.save", { id: l.id, notes: "x" }), 409, "clôturé"); await ok(call("ger", "crm.lead.stage", { id: l.id, stage: "new" })); expect((await ok(call("own", "crm.lead", { id: l.id }))).stage).toBe("new");
  });
  it("conversion RÉELLE : crée un seul client (idempotente), rattache opportunités, relances et historique, ne crée pas de client avant", async () => {
    const l = await newLead("Moussa Fall", { phone: "770009999", source: "referral", consents: { sms: true } }); expect(st.rows("customers").length).toBe(0); const o = await ok(call("ger", "crm.opp.save", { requestKey: rid(), leadId: l.id, title: "50 sacs de riz", value: 1500000 })); const t = await ok(call("cais", "crm.task.save", { requestKey: rid(), leadId: l.id, kind: "call", title: "Rappeler", dueAt: at(1) })); await ok(call("cais", "crm.note", { requestKey: rid(), leadId: l.id, text: "Visite en boutique" }));
    const r = await ok(call("cais", "crm.lead.convert", { id: l.id })); const r2 = await ok(call("cais", "crm.lead.convert", { id: l.id })); expect(r2).toMatchObject({ customerId: r.customerId, unchanged: true }); expect(st.rows("customers").length).toBe(1); const cu = st.rows("customers")[0]!; expect(cu).toMatchObject({ name: "Moussa Fall", phone: "770009999", source: "referral", points: 0 });
    expect(st.rows("crm_opps")[0]!.customerId).toBe(cu.$id); expect(st.rows("crm_tasks")[0]!.customerId).toBe(cu.$id); expect(st.rows("crm_leads")[0]).toMatchObject({ stage: "won", customerId: cu.$id }); const f = await ok(call("own", "crm.customer", { id: cu.$id })); expect(f.timeline.some((e: any) => e.type === "conversion")).toBe(true); expect(f.timeline.some((e: any) => e.detail === "Visite en boutique")).toBe(true); expect(f.opps.length).toBe(1); expect(f.tasks.length).toBe(1); void o;
    await err(call("cais", "crm.lead.stage", { id: l.id, stage: "lost", reason: "oups" }), 409);
  });
  it("conversion : doublon avec un client existant refusé, rattachement explicite à ce client possible", async () => {
    const c = await newCust("Awa", { phone: "770001122" }); const l = await newLead("Awa N.", { phone: "770001122", confirmDuplicate: true }); await err(call("own", "crm.lead.convert", { id: l.id }), 409, "DOUBLON_POSSIBLE"); expect(st.rows("customers").length).toBe(1);
    const r = await ok(call("own", "crm.lead.convert", { id: l.id, existingCustomerId: c.id })); expect(r.customerId).toBe(c.id); expect(st.rows("customers").length).toBe(1);
  });
  it("transitions atomiques : une panne réseau pendant la conversion ne laisse ni client orphelin ni prospect à moitié converti", async () => {
    const l = await newLead("Moussa", { phone: "770009999" }); const real = st.batch.bind(st); st.batch = async () => { throw new Error("réseau coupé"); }; const x = await handle(st, "own", { action: "crm.lead.convert", tenantId: T, shopId: A, payload: { id: l.id } }, { admins: [] }); expect(x.status).toBe(500); st.batch = real; expect(st.rows("customers").length).toBe(0); expect(st.rows("crm_leads")[0]!.stage).toBe("new"); await ok(call("own", "crm.lead.convert", { id: l.id })); expect(st.rows("customers").length).toBe(1);
  });
});

describe("opportunités (gérants)", () => {
  it("création validée, valeur pondérée, étapes, gagnée/perdue avec auteur et date, probabilité, échéance en retard", async () => {
    const l = await newLead("Moussa"); await err(call("ger", "crm.opp.save", { requestKey: rid(), title: "X", value: 10 }), 400, "Intitulé"); await err(call("ger", "crm.opp.save", { requestKey: rid(), title: "Gros contrat", value: -5, leadId: l.id }), 400, "Valeur"); await err(call("ger", "crm.opp.save", { requestKey: rid(), title: "Gros contrat", value: 100, leadId: l.id, customerId: "x" }), 400, "OU"); await err(call("ger", "crm.opp.save", { requestKey: rid(), title: "Gros contrat", value: 100, leadId: l.id, probability: 120 }), 400, "Probabilité"); await err(call("ger", "crm.opp.save", { requestKey: rid(), title: "Gros contrat", value: 100, leadId: l.id, dueOn: "2026-13-01" }), 400, "Échéance");
    const k = rid(); const o = await ok(call("ger", "crm.opp.save", { requestKey: k, title: "Gros contrat", value: 1000000, leadId: l.id, stage: "proposal", dueOn: day(-3), nextAction: "Envoyer le devis", nextActionOn: day(1) })); expect((await ok(call("ger", "crm.opp.save", { requestKey: k, title: "Gros contrat", value: 1, leadId: l.id }))).duplicate).toBe(true);
    let list = await ok(call("ger", "crm.opps", { status: "open" })); expect(list.opportunities[0]).toMatchObject({ probability: 60, weighted: 600000, overdue: true, owner: "ger", nextAction: "Envoyer le devis" }); expect(list.totals).toMatchObject({ openCount: 1, openValue: 1000000, weighted: 600000, overdue: 1 });
    await ok(call("ger", "crm.opp.save", { id: o.id, probability: 90 })); await err(call("ger", "crm.opp.stage", { id: o.id, stage: "lost" }), 400, "Motif"); const w = await ok(call("ger", "crm.opp.stage", { id: o.id, stage: "won" })); expect(w.suggestConvert).toBe(true); list = await ok(call("ger", "crm.opps", { status: "won" })); expect(list.opportunities[0]).toMatchObject({ stage: "won", probability: 100, closedBy: "ger" }); expect(list.opportunities[0].closedAt).toBeTruthy(); await err(call("ger", "crm.opp.save", { id: o.id, title: "Autre" }), 409, "clôturée");
    await ok(call("ger", "crm.opp.stage", { id: o.id, stage: "negotiation", probability: 70 })); expect((await ok(call("ger", "crm.opps", { status: "open" }))).opportunities[0]).toMatchObject({ probability: 70, closedAt: "" });
  });
  it("opportunité sur un prospect perdu ou un client inexistant refusée ; filtres et recherche", async () => {
    const c = await newCust("Awa"); const l = await newLead("Moussa"); await ok(call("own", "crm.lead.stage", { id: l.id, stage: "lost", reason: "Injoignable" })); await err(call("ger", "crm.opp.save", { requestKey: rid(), title: "Contrat", value: 10, leadId: l.id }), 409, "perdu"); await err(call("ger", "crm.opp.save", { requestKey: rid(), title: "Contrat", value: 10, customerId: "zzz" }), 404);
    await ok(call("ger", "crm.opp.save", { requestKey: rid(), title: "Contrat Awa", value: 50000, customerId: c.id })); expect((await ok(call("ger", "crm.opps", { q: "awa" }))).total).toBe(1); expect((await ok(call("ger", "crm.opps", { q: "inconnu" }))).total).toBe(0); expect((await ok(call("ger", "crm.opps", { owner: "mine" }))).total).toBe(1); expect((await ok(call("own", "crm.opps", { owner: "mine" }))).total).toBe(0);
  });
});

describe("agenda : appels, rendez-vous, tâches, relances", () => {
  it("création validée ; auteur, date et statut conservés ; faite avec résultat puis relance suivante créée sans doublon", async () => {
    const c = (await newCust("Awa")).id; await err(call("cais", "crm.task.save", { requestKey: rid(), title: "R", dueAt: at(1) }), 400, "Intitulé"); await err(call("cais", "crm.task.save", { requestKey: rid(), title: "Rappeler Awa", dueAt: "bientôt" }), 400, "Date"); await err(call("cais", "crm.task.save", { requestKey: rid(), title: "Rappeler Awa", dueAt: at(1), kind: "zz" }), 400, "Type"); await err(call("cais", "crm.task.save", { requestKey: rid(), title: "Rappeler Awa", dueAt: at(1), customerId: "zzz" }), 404); await err(call("cais", "crm.task.save", { requestKey: rid(), title: "Rappeler Awa", dueAt: at(1), ownerId: "ger" }), 403);
    const k = rid(); const t = await ok(call("cais", "crm.task.save", { requestKey: k, kind: "followup", title: "Relancer Awa", dueAt: at(-1), customerId: c, notes: "Commande en attente" })); expect((await ok(call("cais", "crm.task.save", { requestKey: k, title: "Relancer Awa", dueAt: at(1) }))).duplicate).toBe(true);
    let l = await ok(call("cais", "crm.tasks")); expect(l.tasks[0]).toMatchObject({ status: "open", overdue: true, createdBy: "cais", owner: "cais", party: "Awa", kindLabel: "Relance" }); expect(l.counts.overdue).toBe(1); expect(l.tasks[0].createdAt).toBeTruthy();
    const nk = { title: "Relancer Awa (2)", kind: "followup", dueAt: at(5) }; const d = await ok(call("cais", "crm.task.done", { id: t.id, outcome: "Awa rappellera lundi", next: nk })); const d2 = await ok(call("cais", "crm.task.done", { id: t.id, outcome: "x", next: nk })); expect(d2.unchanged).toBe(true); expect(st.rows("crm_tasks").length).toBe(2);
    l = await ok(call("cais", "crm.tasks", { status: "done" })); expect(l.tasks[0]).toMatchObject({ status: "done", doneBy: "cais", outcome: "Awa rappellera lundi" }); expect(l.tasks[0].doneAt).toBeTruthy(); expect((await ok(call("cais", "crm.tasks", { status: "open" }))).tasks.map((x: any) => x.title)).toEqual(["Relancer Awa (2)"]); expect(d.nextId).toBeTruthy();
    await err(call("cais", "crm.task.save", { id: t.id, title: "Modifié" }), 409, "plus"); await err(call("cais", "crm.task.cancel", { id: t.id, reason: "non" }), 409, "clôturé");
  });
  it("annulation avec motif obligatoire, droits : un employé ne voit et ne clôt que ses éléments ; le gérant voit tout et filtre par période, type, responsable", async () => {
    const t1 = await ok(call("cais", "crm.task.save", { requestKey: rid(), title: "Mon appel", dueAt: at(2), kind: "call" })); const t2 = await ok(call("ger", "crm.task.save", { requestKey: rid(), title: "Rendez-vous fournisseur", dueAt: at(3), kind: "meeting", ownerId: "own" }));
    expect((await ok(call("cais", "crm.tasks"))).tasks.map((x: any) => x.title)).toEqual(["Mon appel"]); expect((await ok(call("ger", "crm.tasks"))).total).toBe(2); await err(call("cais", "crm.task.done", { id: t2.id }), 403); await err(call("cais", "crm.task.cancel", { id: t1.id }), 400, "Motif"); await ok(call("cais", "crm.task.cancel", { id: t1.id, reason: "Client injoignable" })); expect((await ok(call("ger", "crm.tasks", { status: "cancelled" }))).tasks[0]).toMatchObject({ outcome: "Client injoignable", doneBy: "cais" });
    expect((await ok(call("ger", "crm.tasks", { kind: "meeting" }))).total).toBe(1); expect((await ok(call("ger", "crm.tasks", { owner: "own" }))).total).toBe(1); expect((await ok(call("ger", "crm.tasks", { from: day(3), to: day(3) }))).total).toBe(1); await err(call("ger", "crm.tasks", { from: "n'importe quoi" }), 400);
  });
  it("une relance sur une opportunité exige un gérant ; aucune relance sur un élément d'un autre commerce", async () => {
    const l = await newLead("Moussa"); const o = await ok(call("ger", "crm.opp.save", { requestKey: rid(), title: "Contrat", value: 100, leadId: l.id })); await err(call("cais", "crm.task.save", { requestKey: rid(), title: "Relance contrat", dueAt: at(1), oppId: o.id }), 403); await ok(call("ger", "crm.task.save", { requestKey: rid(), title: "Relance contrat", dueAt: at(1), oppId: o.id })); await err(call("gerB", "crm.task.save", { requestKey: rid(), title: "Relance", dueAt: at(1), leadId: l.id }, B), 404);
  });
});

describe("notes et interactions", () => {
  it("notes datées avec auteur, ajout seul, idempotentes ; types contrôlés ; rattachement obligatoire", async () => {
    const c = (await newCust("Awa")).id; const k = rid(); await ok(call("cais", "crm.note", { requestKey: k, customerId: c, kind: "call", text: "A appelé pour une commande" })); expect((await ok(call("cais", "crm.note", { requestKey: k, customerId: c, text: "autre" }))).duplicate).toBe(true);
    await err(call("cais", "crm.note", { requestKey: rid(), customerId: c, text: "x" }), 400, "Texte"); await err(call("cais", "crm.note", { requestKey: rid(), customerId: c, kind: "sms", text: "bonjour" }), 400, "Type"); await err(call("cais", "crm.note", { requestKey: rid(), text: "orpheline" }), 400, "Rattachez"); await err(call("cais", "crm.note", { requestKey: rid(), customerId: "zzz", text: "inconnu" }), 404);
    const f = await ok(call("own", "crm.customer", { id: c })); const n = f.timeline.filter((e: any) => e.type === "call"); expect(n.length).toBe(1); expect(n[0]).toMatchObject({ detail: "A appelé pour une commande", by: "cais" }); expect(n[0].at).toBeTruthy(); expect(st.rows("crm_events").filter((e) => e.text === "A appelé pour une commande").length).toBe(1);
  });
  it("chronologie unique triée du plus récent au plus ancien : ventes, notes, relances", async () => {
    const c = (await newCust("Awa")).id; await sale(c, 3000, -20); await sale(c, 2000, -5); await new Promise((r) => setTimeout(r, 8)); await ok(call("cais", "crm.note", { requestKey: rid(), customerId: c, text: "Note récente" })); const f = await ok(call("own", "crm.customer", { id: c })); const ats = f.timeline.map((e: any) => e.at); expect([...ats].sort().reverse()).toEqual(ats); expect(f.timeline[0].detail).toBe("Note récente");
  });
});

describe("tableau de bord", () => {
  it("chiffres réels : segments, pipeline pondéré, conversion, agenda en retard, meilleurs clients, inactifs à relancer, origines", async () => {
    const a = (await newCust("Awa", { source: "referral" })).id, b = (await newCust("Bara", { source: "social" })).id; await sale(a, 20000, -3); await sale(b, 8000, -100);
    const l1 = await newLead("P1", { source: "whatsapp" }); const l2 = await newLead("P2"); await ok(call("own", "crm.lead.stage", { id: l2.id, stage: "contacted" })); await ok(call("own", "crm.lead.convert", { id: l1.id }));
    await ok(call("ger", "crm.opp.save", { requestKey: rid(), title: "O1", value: 100000, customerId: a, stage: "negotiation" })); const o2 = await ok(call("ger", "crm.opp.save", { requestKey: rid(), title: "O2", value: 50000, customerId: b, stage: "proposal" })); await ok(call("ger", "crm.opp.stage", { id: o2.id, stage: "won" }));
    await ok(call("cais", "crm.task.save", { requestKey: rid(), title: "Relancer Bara", dueAt: at(-2), customerId: b })); await ok(call("cais", "crm.task.save", { requestKey: rid(), title: "Appeler Awa", dueAt: at(2), customerId: a }));
    const d = await ok(call("ger", "crm.dashboard")); expect(d.customers.segments).toMatchObject({ new: 1, inactive: 1, never: 1 }); expect(d.customers.total).toBe(3); expect(d.leads).toMatchObject({ total: 2, createdInPeriod: 2, convertedInPeriod: 1, conversionRate: 50 }); expect(d.leads.byStage).toMatchObject({ contacted: 1, won: 1 });
    expect(d.pipeline).toMatchObject({ openCount: 1, openValue: 100000, weighted: 80000, wonCount: 1, wonValue: 50000 }); expect(d.agenda).toMatchObject({ open: 2, overdue: 1 }); expect(d.agenda.bySeller[0]).toMatchObject({ name: "cais", open: 2, overdue: 1 }); expect(d.topCustomers[0]).toMatchObject({ name: "Awa", total: 20000 }); expect(d.inactive.map((x: any) => x.name)).toEqual(["Bara"]); expect(d.inactive[0].days).toBeGreaterThanOrEqual(99);
    expect(d.sources.find((s: any) => s.source === "referral").count).toBe(1); expect(d.notes.join(" ")).toMatch(/aucune donnée d'exemple/);
  });
  it("base vide : zéros partout, aucune donnée fictive", async () => { const d = await ok(call("own", "crm.dashboard")); expect(d.customers.total).toBe(0); expect(d.pipeline.openCount).toBe(0); expect(d.topCustomers).toEqual([]); expect(d.inactive).toEqual([]); expect(d.leads.conversionRate).toBeNull(); });
});

describe("abonnement : Pro → Business → Starter sans perte", () => {
  it("les données CRM restent intactes en Starter (lecture refusée), puis reviennent à la remontée de formule", async () => {
    const c = (await newCust("Awa")).id; const l = await newLead("Moussa"); await sale(c, 5000, -2); const before = st.rows("crm_leads").length + st.rows("customers").length + st.rows("crm_events").length; setPlan("starter"); await err(call("own", "crm.leads"), 402); await err(call("own", "crm.lead.convert", { id: l.id }), 402); expect(st.rows("crm_leads").length + st.rows("customers").length + st.rows("crm_events").length).toBe(before); setPlan("business"); expect((await ok(call("own", "crm.customer", { id: c }))).stats.salesCount).toBe(1); expect((await ok(call("own", "crm.leads"))).total).toBe(1);
  });
});
