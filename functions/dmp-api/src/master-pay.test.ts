import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { processWebhook } from "./master-pay";

const T = "tenantpay0001", T2 = "tenantpay0002";
let st: MemoryStore; let A = ""; let TOKEN = "";
const call = (user: string, action: string, payload: unknown = {}, shop = A, tenant = T) => handle(st, user, { action, tenantId: tenant, shopId: shop, payload }, { admins: ["admin1"] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); return x.body.error as string; };
const adm = (action: string, payload: object = {}) => call("admin1", action, payload, "", "");
const MAP = { ref: "data.id", amount: "data.amount", email: "data.customer.email", status: "event", currency: "data.currency", successValues: ["charge.success"], expectedCurrency: "" };
const evt = (o: Record<string, unknown> = {}) => JSON.stringify({ event: "charge.success", data: { id: `TX-${Math.random().toString(36).slice(2, 8)}`, amount: 15000, currency: "XOF", customer: { email: "own@example.test" } }, ...o });
const hook = (raw: string, token = TOKEN, ctype = "application/json") => processWebhook(st, { token, raw, contentType: ctype });
const configure = async () => { await ok(adm("platform.master.hook.save", { mapping: MAP, links: { first: "https://selar.example/first", month: "https://selar.example/month" }, baseUrl: "https://hooks.example.test" })); TOKEN = (await ok(adm("platform.master.hook.rotate"))).token; await ok(adm("platform.master.hook.save", { enabled: true })); };

beforeEach(async () => {
  st = new MemoryStore(); await st.grant(T, "own", ["owner"], []); await st.grant(T2, "own2", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, "", T))).shopId; await ok(call("own2", "shop.create", { name: "Thiès" }, "", T2));
});

describe("MASTER DOGUI — webhook de paiement", () => {
  it("administration : réservée à l'administrateur ; jeton affiché une fois, seule l'empreinte est conservée ; impossible d'activer sans jeton", async () => {
    await err(call("own", "platform.master.hook.get", {}, "", ""), 403); await err(adm("platform.master.hook.save", { enabled: true }), 409, "jeton"); const r = await ok(adm("platform.master.hook.rotate")); expect(r.token).toMatch(/^[0-9a-f]{48}$/); expect(JSON.stringify(st.rows("platform_settings"))).not.toContain(r.token); expect(r.note).toContain("plus affiché");
    await err(adm("platform.master.hook.save", { links: { first: "http://pas-https" } }), 400, "https"); expect((await ok(adm("platform.master.hook.get"))).tokenSet).toBe(true); expect(st.rows("audit_log").filter((a) => String(a.action).startsWith("master.hook")).length).toBeGreaterThanOrEqual(1);
  });
  it("jeton absent, faux, désactivé : 404 sans information ; corps trop gros ou illisible : refusé", async () => {
    expect((await hook(evt(), "x")).status).toBe(404); await configure(); expect((await hook(evt(), "")).status).toBe(404); expect((await hook(evt(), TOKEN + "0")).status).toBe(404); expect((await hook("x".repeat(25_000))).status).toBe(413); expect((await hook("pas du json")).status).toBe(400); await ok(adm("platform.master.hook.save", { enabled: false })); expect((await hook(evt())).status).toBe(404); expect(st.rows("md_events")).toHaveLength(0);
  });
  it("sans paramétrage complet : tout part en examen, brut conservé pour calibrer, aucune activation", async () => {
    await ok(adm("platform.master.hook.save", { mapping: { ref: "data.id" } })); TOKEN = (await ok(adm("platform.master.hook.rotate"))).token; await ok(adm("platform.master.hook.save", { enabled: true })); const r = await hook(evt()); expect(r.body).toMatchObject({ ok: true, status: "review" }); const e = (await ok(adm("platform.master.events", { status: "review" }))).events[0]; expect(e.raw).toContain("charge.success"); expect(e.note).toContain("incomplet"); expect(st.rows("md_licenses").every((l) => !l.paidUntil)).toBe(true);
  });
  it("paiement conforme : demande du propriétaire + notification (même e-mail, même montant) = licence activée automatiquement, une seule fois", async () => {
    await configure(); const rq = await ok(call("own", "md.pay.request", { kind: "first" }, "", T)); expect(rq).toMatchObject({ amount: 15_000, kind: "first", payerEmail: "own@example.test", link: "https://selar.example/first", automatic: true }); expect(rq.reference).toMatch(/^MD-/);
    const raw = evt({ data: { id: "TX-OK-1", amount: "15 000", currency: "XOF", customer: { email: "OWN@example.test" } } }); const r = await hook(raw); expect(r.body).toMatchObject({ ok: true, status: "matched" }); const lic = await ok(call("own", "md.license", {}, "", T)); expect(lic).toMatchObject({ state: "active", phase: "first" }); expect(lic.history).toHaveLength(1);
    expect((await hook(raw)).body).toMatchObject({ duplicate: true }); expect(JSON.parse(String(st.rows("md_licenses")[0]!.history))).toHaveLength(1); expect(st.rows("md_events")).toHaveLength(1); expect((await ok(call("own", "md.pay.list", {}, "", T))).requests[0].status).toBe("paid"); expect(st.rows("audit_log").some((a) => a.action === "master.event.matched")).toBe(true);
  });
  it("mauvais montant, mauvais e-mail, statut non abouti, aucune demande : examen, jamais d'activation", async () => {
    await configure(); await ok(call("own", "md.pay.request", { kind: "first" }, "", T)); for (const raw of [evt({ data: { id: "A1", amount: 14000, currency: "XOF", customer: { email: "own@example.test" } } }), evt({ data: { id: "A2", amount: 15000, currency: "XOF", customer: { email: "autre@example.test" } } }), evt({ event: "charge.failed", data: { id: "A3", amount: 15000, currency: "XOF", customer: { email: "own@example.test" } } })]) expect((await hook(raw)).body).toMatchObject({ status: "review" });
    expect(st.rows("md_licenses")).toHaveLength(0); expect((await ok(adm("platform.master.events", { status: "review" }))).events).toHaveLength(3);
  });
  it("deux notifications simultanées pour la même demande : une seule activation", async () => {
    await configure(); await ok(call("own", "md.pay.request", { kind: "first" }, "", T)); const mk = (id: string) => evt({ data: { id, amount: 15000, currency: "XOF", customer: { email: "own@example.test" } } }); const r = await Promise.all([hook(mk("R1")), hook(mk("R2"))]); expect(r.every((x) => x.status === 200)).toBe(true); expect(JSON.parse(String(st.rows("md_licenses")[0]!.history))).toHaveLength(1);
  });
  it("renouvellement : 2 500 × mois, après la première période seulement ; une demande en remplace une autre", async () => {
    await configure(); await err(call("own", "md.pay.request", { kind: "month", count: 2 }, "", T), 409, "première période"); await ok(call("own", "md.pay.request", { kind: "first" }, "", T)); await hook(evt({ data: { id: "F1", amount: 15000, currency: "XOF", customer: { email: "own@example.test" } } })); await err(call("own", "md.pay.request", { kind: "first" }, "", T), 409, "déjà activée");
    const a = await ok(call("own", "md.pay.request", { kind: "month", count: 3 }, "", T)); expect(a.amount).toBe(7_500); const b = await ok(call("own", "md.pay.request", { kind: "month", count: 1 }, "", T)); expect(b.amount).toBe(2_500); expect((await ok(call("own", "md.pay.list", {}, "", T))).requests.filter((r: any) => r.status === "awaiting")).toHaveLength(1);
    await hook(evt({ data: { id: "F2", amount: 2500, currency: "XOF", customer: { email: "own@example.test" } } })); expect((await ok(call("own", "md.license", {}, "", T))).history).toHaveLength(2);
  });
  it("décision manuelle : approuvée avec motif (idempotente) ou rejetée ; réservée à l'administrateur ; isolation entre entreprises", async () => {
    await configure(); await ok(call("own", "md.pay.request", { kind: "first" }, "", T)); await hook(evt({ data: { id: "M1", amount: 15000, currency: "XOF", customer: { email: "inconnu@example.test" } } })); const ev = (await ok(adm("platform.master.events", { status: "review" }))).events[0];
    await err(call("own", "platform.master.event.decide", { eventId: ev.id, action: "approve" }, "", ""), 403); await err(adm("platform.master.event.decide", { eventId: ev.id, action: "approve", tenantId: T2, kind: "first", note: "x" }), 400, "Motif"); const d = await ok(adm("platform.master.event.decide", { eventId: ev.id, action: "approve", tenantId: T2, kind: "first", note: "Paiement vérifié sur Selar" })); expect(d.status).toBe("matched"); expect((await ok(adm("platform.master.event.decide", { eventId: ev.id, action: "approve", tenantId: T2, kind: "first", note: "Paiement vérifié sur Selar" }))).duplicate).toBe(true);
    expect((await ok(call("own2", "md.license", {}, "", T2))).state).toBe("active"); expect((await ok(call("own", "md.license", {}, "", T))).state).toBe("none"); await hook(evt({ data: { id: "M2", amount: 1, currency: "XOF", customer: { email: "x@example.test" } } })); const e2 = (await ok(adm("platform.master.events", { status: "review" }))).events[0]; expect((await ok(adm("platform.master.event.decide", { eventId: e2.id, action: "reject", note: "Montant sans rapport" }))).status).toBe("rejected");
  });
  it("devise attendue : une autre devise part en examen", async () => { await configure(); await ok(adm("platform.master.hook.save", { mapping: { expectedCurrency: "XOF" } })); await ok(call("own", "md.pay.request", { kind: "first" }, "", T)); expect((await hook(evt({ data: { id: "C1", amount: 15000, currency: "USD", customer: { email: "own@example.test" } } }))).body).toMatchObject({ status: "review" }); });
  it("formulaire encodé (application/x-www-form-urlencoded) accepté", async () => { await ok(adm("platform.master.hook.save", { mapping: { ref: "id", amount: "amount", email: "email", status: "status", successValues: ["success"] }, baseUrl: "https://h.example.test" })); TOKEN = (await ok(adm("platform.master.hook.rotate"))).token; await ok(adm("platform.master.hook.save", { enabled: true })); await ok(call("own", "md.pay.request", { kind: "first" }, "", T)); const r = await hook("id=F-9&amount=15000&email=own%40example.test&status=success", TOKEN, "application/x-www-form-urlencoded"); expect(r.body).toMatchObject({ status: "matched" }); });
});
