import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { needMaster } from "./master";

const T = "tenantmaster01", T2 = "tenantmaster02";
let st: MemoryStore; let A = "", A2 = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}, shop = A, tenant = T) => handle(st, U[user] ?? user, { action, tenantId: tenant, shopId: shop, payload }, { admins: ["admin1"] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); return x.body.error as string; };
const rid = () => `g${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
const licRaw = (tenant = T, user = "own") => call(user, "md.license", {}, "", tenant);
const lic = (tenant = T, user = "own") => ok(licRaw(tenant, user));
const adm = (action: string, payload: object) => call("admin1", action, payload, "", "");
const ctxOf = (tenantId: string) => ({ userId: "own", tenantId, shopId: "", roles: ["owner"] });

beforeEach(async () => {
  st = new MemoryStore(); await st.grant(T, "own", ["owner"], []); await st.grant(T2, "own2", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, "", T))).shopId; A2 = (await ok(call("own2", "shop.create", { name: "Thiès" }, "", T2))).shopId;
  for (const [u, role] of [["ger", "manager"], ["cais", "cashier"]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: [A] }, "", T))).userId;
  st.ownerNames.set("own", "Propriétaire"); void A2;
});

describe("MASTER DOGUI — licence", () => {
  it("indépendante de l'abonnement principal : lisible même sans abonnement ; rôles : propriétaire et gérant lisent, caissier refusé", async () => {
    const v = await lic(); expect(v).toMatchObject({ state: "none", canStartTrial: true, trialUsed: false, canAnalyze: false }); expect(v.notes.join(" ")).toContain("indépendante");
    expect((await lic(T, "ger")).canStartTrial).toBe(false); await err(licRaw(T, "cais"), 403); const row = st.rows("subscriptions").find((r) => r.$id === T); if (row) row.renewsAt = new Date(Date.now() - 90 * 864e5).toISOString(); expect((await lic()).state).toBe("none");
  });
  it("essai : démarré par le propriétaire seul, 14 jours, sans paiement, idempotent ; aucune écriture sur l'abonnement principal", async () => {
    await err(call("ger", "md.trial.start", {}, "", T), 403, "propriétaire"); const subBefore = JSON.stringify(st.rows("subscriptions")); const a = await ok(call("own", "md.trial.start", {}, "", T)); expect(a).toMatchObject({ state: "trial", duplicate: false, canAnalyze: true, daysLeft: 14 }); const b = await ok(call("own", "md.trial.start", {}, "", T)); expect(b.duplicate).toBe(true); expect(b.endsAt).toBe(a.endsAt);
    expect(st.rows("md_licenses")).toHaveLength(1); expect(JSON.stringify(st.rows("subscriptions"))).toBe(subBefore); expect(st.rows("audit_log").filter((l) => l.action === "master.trial.start")).toHaveLength(1); const v = await lic(); expect(v.canStartTrial).toBe(false); expect(v.nextDue).toMatchObject({ amount: 15_000 });
  });
  it("essai unique par propriétaire : une autre entreprise du même propriétaire est refusée ; une entreprise d'un autre propriétaire est acceptée ; exception administrative motivée", async () => {
    await ok(call("own", "md.trial.start", {}, "", T)); await st.grant("tenantmaster03", "own", ["owner"], []); await ok(call("own", "shop.create", { name: "Autre" }, "", "tenantmaster03")); await err(call("own", "md.trial.start", {}, "", "tenantmaster03"), 409, "déjà été utilisé"); expect(st.rows("audit_log").some((l) => l.action === "master.trial.refused")).toBe(true);
    expect((await ok(call("own2", "md.trial.start", {}, "", T2))).state).toBe("trial"); await err(adm("platform.master.trial", { tenantId: "tenantmaster03" }), 400, "Motif"); await err(call("own", "platform.master.trial", { tenantId: "tenantmaster03", note: "geste commercial" }, "", ""), 403); const g = await ok(adm("platform.master.trial", { tenantId: "tenantmaster03", note: "Erreur de création signalée" })); expect(g.state).toBe("trial"); await err(adm("platform.master.trial", { tenantId: "tenantmaster03", note: "Deuxième fois" }), 409);
  });
  it("garde needMaster : refuse sans essai, accepte en essai, refuse après expiration ; autres actions DOGUI MART PRO inchangées", async () => {
    await expect(needMaster(st, ctxOf(T))).rejects.toThrow(/essai gratuit/); await ok(call("own", "md.trial.start", {}, "", T)); await needMaster(st, ctxOf(T)); const row = st.rows("md_licenses")[0]!; row.trialEndsAt = new Date(Date.now() - 864e5).toISOString(); await expect(needMaster(st, ctxOf(T))).rejects.toThrow(/expirée/); expect((await lic())).toMatchObject({ state: "expired", consultOnly: true });
    expect((await ok(call("own", "shop.create", { name: "Autre boutique" }, "", T))).shopId).toBeTruthy();
  });
  it("activation par la plateforme : réservée à l'administrateur, 15 000 pour 12 mois puis 2 500 par mois, idempotente, journalisée, historique", async () => {
    await err(call("own", "platform.master.activate", { grantId: rid(), tenantId: T, kind: "first" }, "", ""), 403); await err(adm("platform.master.activate", { grantId: "court", tenantId: T, kind: "first" }), 400); await err(adm("platform.master.activate", { grantId: rid(), tenantId: "inconnu", kind: "first" }), 404); await err(adm("platform.master.activate", { grantId: rid(), tenantId: T, kind: "month", count: 1 }), 409, "première période");
    const g1 = rid(); const a = await ok(adm("platform.master.activate", { grantId: g1, tenantId: T, kind: "first", note: "Virement Selar réf. 123" })); expect(a).toMatchObject({ amount: 15_000, state: "active", phase: "first", duplicate: false }); expect((await ok(adm("platform.master.activate", { grantId: g1, tenantId: T, kind: "first" }))).duplicate).toBe(true); expect(st.rows("md_licenses")).toHaveLength(1);
    await err(adm("platform.master.activate", { grantId: rid(), tenantId: T, kind: "first" }), 409, "déjà"); const g2 = rid(); const m = await ok(adm("platform.master.activate", { grantId: g2, tenantId: T, kind: "month", count: 3 })); expect(m.amount).toBe(7_500); expect(Date.parse(m.endsAt)).toBeGreaterThan(Date.parse(a.endsAt)); await err(adm("platform.master.activate", { grantId: rid(), tenantId: T, kind: "month", count: 13 }), 409, "1 à 12");
    const v = await lic(); expect(v.history).toHaveLength(2); expect(v.history[0]!.amount).toBe(7_500); expect(st.rows("audit_log").filter((l) => l.action === "master.activate")).toHaveLength(2); expect((await ok(adm("platform.master.list", {}))).licenses.some((l: any) => l.tenantId === T && l.state === "active")).toBe(true);
  });
  it("deux activations simultanées avec le même grantId : un seul effet", async () => { const g = rid(); const r = await Promise.all([adm("platform.master.activate", { grantId: g, tenantId: T, kind: "first" }), adm("platform.master.activate", { grantId: g, tenantId: T, kind: "first" })]); expect(r.every((x) => x.status === 200 || x.status === 409)).toBe(true); expect(st.rows("md_licenses")).toHaveLength(1); expect(JSON.parse(String(st.rows("md_licenses")[0]!.history))).toHaveLength(1); });
  it("après expiration : consultation conservée, historique intact, renouvellement reprend à partir de maintenant", async () => {
    await ok(adm("platform.master.activate", { grantId: rid(), tenantId: T, kind: "first" })); const row = st.rows("md_licenses")[0]!; row.firstPaidAt = new Date(Date.now() - 400 * 864e5).toISOString(); row.paidUntil = new Date(Date.now() - 35 * 864e5).toISOString(); expect(await lic()).toMatchObject({ state: "expired", consultOnly: true, canAnalyze: false }); expect((await lic()).consequence).toContain("autres modules");
    const r = await ok(adm("platform.master.activate", { grantId: rid(), tenantId: T, kind: "month", count: 1 })); expect(r.state).toBe("active"); expect((await lic()).history.length).toBe(2);
  });
  it("isolation : une entreprise ne voit jamais la licence d'une autre", async () => { await ok(call("own", "md.trial.start", {}, "", T)); await err(call("own", "md.license", {}, "", T2), 403); expect((await lic(T2, "own2")).state).toBe("none"); });
});
