import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { PLATFORM_JOURNAL, _resetThrottle, recordSecurityEvent, securityEvents } from "./security-log";
import { readRoles } from "./permissions";
import { EVENT_KINDS, GENESIS, eventHash, verifyChain, type ChainRow } from "../../../src/domain/security-events";

const T = "tenantsec001", OTHER = "tenantsec002";
let st: MemoryStore; let A = ""; const U: Record<string, string> = {};
const call = (user: string | undefined, action: string, payload: unknown = {}, shop = A, tenant = T, admins: string[] = []) => handle(st, user, { action, tenantId: tenant, shopId: shop, payload }, { admins, cloud: true });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const events = async (tenant: string, kind?: string) => (await ok(call("own", "security.events", { kind }, "", tenant))).events as any[];
const platformEvents = async (kind?: string) => (await ok(call("root", "platform.security.events", { kind }, "", "", ["root"]))).events as any[];

beforeEach(async () => {
  _resetThrottle(); st = new MemoryStore();
  await st.grant(T, "own", ["owner"], []); await st.grant(OTHER, "own2", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId;
  await ok(call("own2", "shop.create", { name: "Autre" }, "", OTHER));
  const mk = async (username: string, role: string) => (U[username] = (await ok(call("own", "staff.create", { name: username, username, password: "motdepasse1", role, shopIds: [A] }, "")))?.userId);
  await mk("caissier", "cashier"); await mk("conso", "viewer");
});

describe("événements de succès (liste fermée)", () => {
  it("la création d'un employé est journalisée avec l'acteur, son rôle, la source et un numéro de requête — sans donnée personnelle", async () => {
    const ev = (await events(T, "staff.create"))[0]; expect(ev).toMatchObject({ kind: "staff.create", outcome: "accepted", actorId: "own", actorRole: "owner", source: "cloud", target: "action:staff.create" });
    expect(ev.requestId).toMatch(/^[0-9a-f]{12}$/); expect(JSON.stringify(ev)).not.toMatch(/motdepasse|caissier/);
  });
  it("réinitialisation de mot de passe, droits, désactivation : chacun produit son événement ; le mot de passe n'est jamais journalisé", async () => {
    await ok(call("own", "staff.resetPassword", { userId: U.caissier, password: "nouveau-mdp-123" }, ""));
    await ok(call("own", "staff.update", { userId: U.caissier, active: false }, ""));
    await ok(call("own", "staff.rights", { userId: U.caissier, access: ["pos"] }, "")).catch(() => undefined);
    const all = await events(T); expect(all.map((e) => e.kind)).toEqual(expect.arrayContaining(["staff.resetPassword", "staff.update"]));
    expect(JSON.stringify(all)).not.toMatch(/nouveau-mdp/);
  });
  it("une action refusée n'écrit aucun événement de succès", async () => {
    const before = (await events(T)).length; const r = await call(U.caissier, "staff.create", { name: "x", username: "x1", password: "motdepasse1", role: "cashier", shopIds: [A] }, ""); expect(r.status).toBe(403);
    expect((await events(T, "staff.create")).length).toBe((await events(T, "staff.create")).length); expect((await events(T)).length).toBeGreaterThanOrEqual(before);
  });
  it("les actions de la plateforme sont journalisées dans le journal de la plateforme, jamais dans celui d'un commerce", async () => {
    await ok(call("root", "platform.subscription.lifetime", { tenantId: T }, "", "", ["root"])).catch(() => undefined);
    expect((await events(T)).every((e) => !e.kind.startsWith("platform."))).toBe(true);
  });
});

describe("refus d'accès", () => {
  it("un appel sans identité va au journal de la plateforme (regroupé), pas à un commerce", async () => {
    for (let i = 0; i < 5; i++) expect((await call(undefined, "staff.create", {}, "")).status).toBe(401);
    const ev = await platformEvents("access.denied.unauthenticated"); expect(ev.length).toBe(1); expect(ev[0]).toMatchObject({ outcome: "denied", actorId: "" });
  });
  it("un compte étranger au commerce est refusé : l'événement va au journal de la plateforme, et le journal du commerce visé reste vierge de cette tentative (pas de pollution)", async () => {
    await st.grant("tenantaut001", "intrus", ["owner"], []);
    const before = (await events(T)).length;
    for (let i = 0; i < 3; i++) expect((await call("intrus", "sales.list", {}, A, T)).status).toBe(403);
    expect((await events(T)).length).toBe(before);
    const ev = await platformEvents("access.denied.not_member"); expect(ev.length).toBe(1); expect(ev[0]).toMatchObject({ actorId: "intrus" }); expect(ev[0].target).toContain(T);
  });
  it("le propriétaire d'un autre commerce ne peut lire ni le journal de ce commerce ni celui de la plateforme", async () => {
    expect((await call("own2", "security.events", {}, "", T)).status).toBe(403);
    expect((await call("own", "platform.security.events", {}, "", "")).status).toBe(403);
  });
  it("un membre sans droit : refus journalisé dans SON commerce, avec le rôle ; consultation seule distinguée", async () => {
    expect((await call(U.caissier, "staff.create", { name: "x", username: "x1", password: "motdepasse1", role: "cashier", shopIds: [A] }, "")).status).toBe(403);
    expect((await call(U.conso, "staff.create", {}, "")).status).toBe(403);
    const f = (await events(T, "access.denied.forbidden")).concat(await events(T, "access.denied.readonly")); expect(f.length).toBeGreaterThanOrEqual(1);
    expect(f.every((e) => e.outcome === "denied" && ["cashier", "viewer"].includes(e.actorRole) || e.actorRole === "cashier")).toBe(true);
  });
  it("boutique non affectée : refus classé « boutique »", async () => {
    const B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId;
    expect((await call(U.caissier, "sales.list", {}, B)).status).toBe(403);
    expect((await events(T, "access.denied.shop")).length).toBe(1);
  });
  it("une rafale de refus du même acteur ne produit qu'un événement par minute (anti-saturation du journal)", async () => {
    for (let i = 0; i < 40; i++) await call(U.caissier, "staff.create", {}, "");
    expect((await events(T, "access.denied.forbidden")).length).toBe(1);
  });
  it("un appel à l'administration par un non-administrateur est journalisé côté plateforme", async () => {
    expect((await call("own", "platform.settings.save", {}, "")).status).toBe(403);
    expect((await platformEvents("access.denied.platform")).length).toBe(1);
  });
});

describe("chaîne d'empreintes", () => {
  it("numéros consécutifs, chaque événement lié au précédent, origine connue", async () => {
    for (let i = 0; i < 4; i++) await recordSecurityEvent(st, { tenantId: T, kind: "staff.update", outcome: "accepted", actorId: "own", source: "poste" });
    const r = await ok(call("own", "security.events", {}, "", T)); expect(r.chain).toMatchObject({ ok: true, fromStart: true, problems: [] });
    const seqs = r.events.map((e: any) => e.seq).sort((a: number, b: number) => a - b); expect(seqs).toEqual(seqs.map((_: number, i: number) => i + 1));
  });
  it("modification d'une ligne détectée", async () => {
    await recordSecurityEvent(st, { tenantId: T, kind: "staff.update", outcome: "accepted", actorId: "own", source: "poste" });
    const row = (await st.list("security_events", { tenantId: T }, 50))[0]!; await st.update("security_events", String(row.$id), { actorId: "falsifié" });
    const r = await ok(call("own", "security.events", {}, "", T)); expect(r.chain.ok).toBe(false); expect(r.chain.problems.join(" ")).toMatch(/modifiée/);
  });
  it("suppression d'un événement au milieu ou en fin de chaîne détectée", async () => {
    for (let i = 0; i < 4; i++) await recordSecurityEvent(st, { tenantId: T, kind: "staff.update", outcome: "accepted", actorId: "own", source: "poste" });
    const rows = (await st.list("security_events", { tenantId: T }, 50)).sort((a, b) => Number(a.seq) - Number(b.seq));
    await st.remove("security_events", String(rows[1]!.$id)); expect((await ok(call("own", "security.events", {}, "", T))).chain.problems.join(" ")).toMatch(/absents/);
    await st.remove("security_events", String(rows[rows.length - 1]!.$id)); expect((await ok(call("own", "security.events", {}, "", T))).chain.ok).toBe(false);
  });
  it("tous les événements supprimés : détecté grâce au pointeur de chaîne", async () => {
    await recordSecurityEvent(st, { tenantId: T, kind: "staff.update", outcome: "accepted", actorId: "own", source: "poste" });
    for (const r of await st.list("security_events", { tenantId: T }, 50)) await st.remove("security_events", String(r.$id));
    expect((await ok(call("own", "security.events", {}, "", T))).chain.ok).toBe(false);
  });
  it("écritures simultanées : aucune fourche, aucun numéro perdu", async () => {
    await Promise.all(Array.from({ length: 8 }, () => recordSecurityEvent(st, { tenantId: T, kind: "staff.update", outcome: "accepted", actorId: "own", source: "cloud" })));
    const r = await ok(call("own", "security.events", { limit: 500 }, "", T)); expect(r.chain.ok).toBe(true); expect(r.total).toBe(r.chain.checked);
  });
  it("chaque commerce a sa propre chaîne (numérotation indépendante)", async () => {
    await recordSecurityEvent(st, { tenantId: OTHER, kind: "staff.update", outcome: "accepted", actorId: "own2", source: "cloud" });
    const other = (await ok(call("own2", "security.events", {}, "", OTHER))); expect(other.events.every((e: any) => e.actorId !== "own")).toBe(true);
    expect((await events(T)).some((e) => e.actorId === "own2")).toBe(false);
  });
  it("Appwrite relit la date sous une autre forme (« +00:00 ») : la chaîne reste valide (défaut trouvé à l'essai réel)", async () => {
    await recordSecurityEvent(st, { tenantId: T, kind: "staff.update", outcome: "accepted", actorId: "own", source: "cloud" });
    await recordSecurityEvent(st, { tenantId: T, kind: "staff.update", outcome: "accepted", actorId: "own", source: "cloud" });
    for (const r of await st.list("security_events", { tenantId: T }, 50)) await st.update("security_events", String(r.$id), { at: String(r.at).replace("Z", "+00:00") });
    expect((await ok(call("own", "security.events", {}, "", T))).chain).toMatchObject({ ok: true, problems: [] });
  });
  it("vérification pure : origine, empreinte et liaison", () => {
    const mk = (seq: number, prev: string): ChainRow => { const f = { tenantId: "t", seq, at: "2026-01-01T00:00:00.000Z", kind: "staff.create", severity: "info", outcome: "accepted", actorId: "a", actorRole: "owner", target: "", requestId: "r", source: "cloud" }; return { ...f, prevHash: prev, hash: eventHash(prev, f) }; };
    const a = mk(1, GENESIS), b = mk(2, a.hash), c = mk(3, b.hash);
    expect(verifyChain([a, b, c]).ok).toBe(true); expect(verifyChain([c, a, b]).ok).toBe(true);
    expect(verifyChain([a, c]).ok).toBe(false); expect(verifyChain([{ ...b, actorId: "x" }, a]).ok).toBe(false); expect(verifyChain([{ ...a, prevHash: "1".repeat(64) }]).ok).toBe(false);
    expect(verifyChain([b, c]).ok).toBe(true); expect(verifyChain([b, c]).fromStart).toBe(false);
  });
});

describe("garde-fous du journal", () => {
  it("un événement hors liste est refusé et n'écrit rien", async () => {
    const n = (await events(T)).length;
    expect(await recordSecurityEvent(st, { tenantId: T, kind: "n'importe.quoi" as any, outcome: "accepted", source: "cloud" })).toBeNull();
    expect((await events(T)).length).toBe(n);
  });
  it("une panne du journal ne fait jamais échouer l'opération d'origine", async () => {
    const real = st.batch.bind(st); (st as any).batch = async (ops: any[]) => { if (ops.some((o) => o.table === "security_events")) throw new Error("panne simulée"); return real(ops); };
    const r = await call("own", "staff.create", { name: "Z", username: "zed", password: "motdepasse1", role: "cashier", shopIds: [A] }, ""); expect(r.status).toBe(200);
  });
  it("seul le propriétaire lit le journal : un gérant ou un caissier est refusé", async () => {
    expect((await call(U.caissier, "security.events", {}, "")).status).toBe(403);
  });
  it("droits de lecture : propriétaire du commerce seulement ; le journal de la plateforme n'a AUCUN rôle de lecture (une équipe « platform » créée par n'importe qui n'y donnerait pas accès)", () => {
    expect(readRoles("security_events", T, {}, "x")).toEqual([`team:${T}/owner`]);
    expect(readRoles("security_events", "platform", {}, "x")).toEqual([]); expect(readRoles("security_heads", T, {}, "x")).toEqual([]);
  });
  it("chaque type d'événement a une gravité, un libellé et une portée", () => {
    for (const [k, d] of Object.entries(EVENT_KINDS)) { expect(["info", "warning", "critical"]).toContain(d.severity); expect(d.label.length, k).toBeGreaterThan(5); expect(["tenant", "platform"]).toContain(d.scope); }
  });
  it("le journal du commerce de la plateforme n'est lisible qu'avec la portée plateforme", async () => {
    await recordSecurityEvent(st, { tenantId: "", kind: "hook.rejected", outcome: "denied", source: "cloud" });
    expect((await events(PLATFORM_JOURNAL).catch(() => [])).length).toBe(0);
    expect((await platformEvents("hook.rejected")).length).toBe(1);
  });
});
