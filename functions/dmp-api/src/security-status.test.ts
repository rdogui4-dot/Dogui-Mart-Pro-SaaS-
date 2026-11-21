import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { PLATFORM_JOURNAL, RETENTION_MONTHS, _resetThrottle, purgeSecurityEvents, readJournal, recordSecurityEvent } from "./security-log";
import type { StatusProbe } from "./store";

const T = "tenantsst001";
let st: MemoryStore; let A = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}, shop = A, tenant = T, probe?: StatusProbe) => handle(st, user, { action, tenantId: tenant, shopId: shop, payload }, { admins: ["root"], cloud: true, probe });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const status = (probe?: StatusProbe) => ok(call("own", "security.status", {}, "", T, probe));
const chk = (s: any, id: string) => s.checks.find((c: any) => c.id === id);
const ev = (t = T, kind: any = "staff.update") => recordSecurityEvent(st, { tenantId: t, kind, outcome: "accepted", actorId: "own", source: "cloud" });

beforeEach(async () => {
  _resetThrottle(); st = new MemoryStore(); await st.grant(T, "own", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId;
  U.caissier = (await ok(call("own", "staff.create", { name: "c", username: "caissier", password: "motdepasse1", role: "cashier", shopIds: [A] }, ""))).userId;
});
afterEach(() => vi.useRealTimers());

describe("security.status", () => {
  it("réservé au propriétaire : un employé est refusé", async () => { expect((await call(U.caissier!, "security.status", {}, "")).status).toBe(403); });
  it("contrôles mesurés depuis les données réelles ; ceux qui ne peuvent pas l'être restent « inconnus » ; limites annoncées", async () => {
    const s = await status();
    expect(chk(s, "mfa_owner").state).toBe("watch"); // le compte du propriétaire n'a pas de 2FA dans le magasin de test
    expect(chk(s, "subscription").state).toBe("ok"); expect(chk(s, "sync").state).toBe("na"); expect(chk(s, "backups").state).toBe("unknown");
    expect(chk(s, "journal_chain").state).toBe("ok"); expect(chk(s, "denials").state).toBe("ok");
    expect(s.limits.length).toBeGreaterThanOrEqual(3); expect(s.measuredAt).toMatch(/Z$/); expect(chk(s, "mfa_owner").measuredAt).toBe(s.measuredAt); expect(chk(s, "backups").measuredAt).toBeNull();
  });
  it("2FA : lue dans l'annuaire ; propriétaire protégé = ok", async () => { st.security.set("own", { lastLogin: null, sessions24h: 0, mfa: true }); expect(chk(await status(), "mfa_owner").state).toBe("ok"); });
  it("annuaire illisible : 2FA inconnue (jamais ok)", async () => {
    const real = st.listOwners.bind(st); (st as any).listOwners = async () => { throw new Error("panne annuaire"); };
    expect(chk(await status(), "mfa_owner").state).toBe("unknown"); (st as any).listOwners = real;
    (st as any).userSecurity = async () => { throw new Error("pas de droit de lecture des sessions"); }; expect(chk(await status(), "mfa_owner").state).toBe("unknown");
  });
  it("journal vide = inconnu ; après des événements = ok", async () => {
    const empty = new MemoryStore(); await empty.grant("tenantsst009", "o9", ["owner"], []); const r = await handle(empty, "o9", { action: "security.status", tenantId: "tenantsst009", shopId: "", payload: {} }, { cloud: true });
    expect(chk((r.body as any).data, "journal_chain").state).toBe("unknown"); await ev(); expect(chk(await status(), "journal_chain")).toMatchObject({ state: "ok" });
  });
  it("chaîne rompue : état critique avec la cause", async () => {
    await ev(); await ev(); await ev(); const rows = (await st.list("security_events", { tenantId: T }, 50)).sort((a, b) => Number(a.seq) - Number(b.seq)); await st.remove("security_events", String(rows[1]!.$id));
    const c = chk(await status(), "journal_chain"); expect(c.state).toBe("critical"); expect(c.evidence).toMatch(/absents|Rupture/);
  });
  it("refus d'accès des 24 dernières heures comptés (le regroupement compte les répétitions)", async () => {
    for (let i = 0; i < 25; i++) { _resetThrottle(); await call(U.caissier!, "staff.create", {}, ""); }
    expect(chk(await status(), "denials").state).toBe("watch");
  });
  it("sondes du poste : sauvegardes et synchronisation mesurées quand le poste les fournit", async () => {
    await st.update("subscriptions", T, { hostedBy: JSON.stringify({ name: "Caisse", since: new Date().toISOString(), by: "own" }) });
    const probe: StatusProbe = { station: () => ({ lastSyncOkAt: new Date().toISOString(), pending: 0, sessionOk: true, openConflicts: 1, alertHours: 24 }), backups: () => ({ lastOkAt: new Date().toISOString(), hasBackups: true, externalError: null }) };
    const s = await status(probe); expect(chk(s, "sync").state).toBe("ok"); expect(chk(s, "backups").state).toBe("ok"); expect(chk(s, "conflicts").state).toBe("watch");
    const cloudView = await status(); expect(chk(cloudView, "sync").state).toBe("unknown"); expect(chk(cloudView, "backups").state).toBe("unknown");
  });
  it("aucune donnée d'un autre commerce : le score d'un commerce ignore les événements d'un autre", async () => {
    await st.grant("tenantsst002", "own2", ["owner"], []); for (let i = 0; i < 30; i++) { _resetThrottle(); await recordSecurityEvent(st, { tenantId: "tenantsst002", kind: "access.denied.forbidden", outcome: "denied", actorId: "x", throttleKey: `k${i}`, source: "cloud" }); }
    expect(chk(await status(), "denials").state).toBe("ok");
  });
});

describe("rétention du journal (13 mois) et ancrage de la chaîne", () => {
  const P = "tenantsst005"; const at = (iso: string) => vi.setSystemTime(new Date(iso)); const evP = () => ev(P);
  const sorted = async () => (await st.list("security_events", { tenantId: P }, 50)).sort((a, b) => Number(a.seq) - Number(b.seq));
  it("les événements de plus de 13 mois sont purgés ; la chaîne conservée reste vérifiable grâce à l'ancre ; le dernier événement n'est jamais purgé", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at("2025-01-10T10:00:00Z"); await evP(); await evP(); at("2025-02-10T10:00:00Z"); await evP(); at("2026-10-01T10:00:00Z"); await evP(); await evP(); at("2026-11-21T12:00:00Z");
    const before = await readJournal(st, P); expect(before.chain.ok).toBe(true); expect(before.rows.length).toBe(5);
    const r = await purgeSecurityEvents(st, P); expect(r).toEqual({ purged: 3, anchorSeq: 3 });
    const after = await readJournal(st, P); expect(after.rows.map((x) => Number(x.seq)).sort()).toEqual([4, 5]); expect(after.chain).toMatchObject({ ok: true, fromStart: false }); expect(after.total).toBe(5);
    await evP(); expect((await readJournal(st, P)).chain.ok).toBe(true); expect((await purgeSecurityEvents(st, P)).purged).toBe(0);
  });
  it("le dernier événement n'est jamais purgé, même s'il est ancien", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); at("2024-01-10T10:00:00Z"); await evP(); await evP(); at("2026-11-21T12:00:00Z");
    expect((await purgeSecurityEvents(st, P)).purged).toBe(1); const j = await readJournal(st, P); expect(j.rows.length).toBe(1); expect(j.chain.ok).toBe(true);
  });
  it("rien de récent n'est purgé ; une durée demandée plus courte que 13 mois est ramenée à 13 mois", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); at("2026-01-10T10:00:00Z"); await evP(); await evP(); at("2026-11-21T12:00:00Z");
    expect(RETENTION_MONTHS).toBe(13); expect((await purgeSecurityEvents(st, P, { months: 1 })).purged).toBe(0); expect((await readJournal(st, P)).rows.length).toBe(2);
  });
  it("une suppression après la purge est toujours détectée ; un trou entre l'ancre et le premier événement conservé aussi", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); at("2025-01-10T10:00:00Z"); await evP(); await evP(); at("2026-10-01T10:00:00Z"); await evP(); await evP(); await evP(); at("2026-11-21T12:00:00Z");
    await purgeSecurityEvents(st, P); const rows = await sorted(); expect(rows.map((x) => Number(x.seq))).toEqual([3, 4, 5]);
    await st.remove("security_events", String(rows[0]!.$id)); const j = await readJournal(st, P); expect(j.chain.ok).toBe(false); expect(j.chain.problems.join(" ")).toMatch(/purge|absents/);
  });
  it("chaîne rompue : purge refusée (on n'efface pas ce qu'on n'a pas examiné)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); at("2025-01-10T10:00:00Z"); await evP(); await evP(); await evP(); at("2026-11-21T12:00:00Z"); const rows = await sorted(); await st.update("security_events", String(rows[0]!.$id), { actorId: "falsifié" });
    await expect(purgeSecurityEvents(st, P)).rejects.toThrow(/rompue/);
  });
  it("action d'administration : réservée à l'administrateur de la plateforme, journalisée, jamais pour un propriétaire de commerce", async () => {
    await st.grant(P, "ownP", ["owner"], []); vi.useFakeTimers({ toFake: ["Date"] }); at("2025-01-10T10:00:00Z"); await evP(); await evP(); at("2026-11-21T12:00:00Z");
    expect((await call("ownP", "platform.security.purge", { tenantId: P }, "", "")).status).toBe(403);
    const r = await ok(call("root", "platform.security.purge", { tenantId: P }, "", "")); expect(r.purged).toBe(1);
    const log = await ok(call("ownP", "security.events", { kind: "security.purge" }, "", P)); expect(log.events.length).toBe(1); expect(log.events[0]).toMatchObject({ actorRole: "platform", target: "purge:1" }); expect(log.chain.ok).toBe(true);
    expect((await call("root", "platform.security.purge", { tenantId: "../x" }, "", "")).status).toBe(400);
  });
  it("le journal de la plateforme se purge de la même façon", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); at("2025-01-10T10:00:00Z"); await recordSecurityEvent(st, { tenantId: "", kind: "hook.rejected", outcome: "denied", source: "cloud" }); await recordSecurityEvent(st, { tenantId: "", kind: "hook.accepted", outcome: "accepted", source: "cloud" }); at("2026-11-21T12:00:00Z");
    expect((await ok(call("root", "platform.security.purge", {}, "", ""))).purged).toBe(1); expect((await readJournal(st, PLATFORM_JOURNAL)).chain.ok).toBe(true);
  });
});
