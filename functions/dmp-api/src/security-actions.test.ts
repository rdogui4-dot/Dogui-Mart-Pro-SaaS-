import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { _resetThrottle } from "./security-log";

const T = "tenantsac001", OTHER = "tenantsac002";
let st: MemoryStore; let A = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}, shop = A, tenant = T, cloud = true) => handle(st, user, { action, tenantId: tenant, shopId: shop, payload }, { admins: [], cloud });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const events = async (kind?: string, tenant = T, user = "own") => (await ok(call(user, "security.events", { kind }, "", tenant))).events as any[];

beforeEach(async () => {
  _resetThrottle(); st = new MemoryStore(); await st.grant(T, "own", ["owner"], []); await st.grant(OTHER, "own2", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; await ok(call("own2", "shop.create", { name: "Autre" }, "", OTHER));
  const mk = async (u: string, role: string, tenant = T, owner = "own", shop = A) => (U[u] = (await ok(call(owner, "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: [shop] }, "", tenant))).userId);
  await mk("caissier", "cashier"); await mk("gerant", "manager"); U.autre = (await ok(call("own2", "staff.create", { name: "x", username: "autre", password: "motdepasse1", role: "cashier", shopIds: [(await st.list("shops", { tenantId: OTHER }, 5))[0]!.$id as string] }, "", OTHER))).userId;
});

describe("fermeture des sessions d'un employé", () => {
  it("le propriétaire ferme les sessions d'un employé : l'événement et la ligne d'activité sont écrits, sans donnée personnelle", async () => {
    st.security.set(U.caissier!, { lastLogin: null, sessions24h: 3, mfa: false });
    const r = await ok(call("own", "security.sessions.revoke", { userId: U.caissier }, "")); expect(r.revoked).toBe(3); expect(st.revoked).toEqual([U.caissier]);
    const ev = (await events("staff.sessions.revoke"))[0]; expect(ev).toMatchObject({ outcome: "accepted", actorRole: "owner", severity: "warning", source: "cloud", target: "compte:employé" }); expect(JSON.stringify(ev)).not.toContain(U.caissier!);
    expect(st.rows("audit_log").some((a) => a.action === "staff.sessions.revoke" && /3 session/.test(String(a.detail)))).toBe(true);
  });
  it("jamais un propriétaire, jamais un compte d'un autre commerce, jamais un identifiant inventé : 404, rien n'est fermé", async () => {
    for (const userId of ["own", U.autre, "inconnu", "", undefined]) { const x = await call("own", "security.sessions.revoke", { userId }, ""); expect(x.status, String(userId)).toBe(404); }
    expect(st.revoked).toEqual([]);
  });
  it("réservé au propriétaire : un gérant, un caissier, un étranger sont refusés (403) et rien n'est fermé", async () => {
    for (const u of [U.gerant!, U.caissier!, "intrus"]) expect((await call(u, "security.sessions.revoke", { userId: U.caissier }, "")).status, u).toBe(403);
    expect(st.revoked).toEqual([]);
  });
  it("permise même quand un poste héberge le commerce (un compte compromis doit pouvoir être coupé tout de suite)", async () => {
    await st.update("subscriptions", T, { hostedBy: JSON.stringify({ name: "Caisse", since: new Date().toISOString(), by: "own" }) });
    expect((await call("own", "security.sessions.revoke", { userId: U.caissier }, "")).status).toBe(200);
  });
});

describe("désactivation et réactivation d'un compte", () => {
  it("événements dédiés (désactivé = avertissement, réactivé = information) en plus de la modification générale ; aucun événement si l'état ne change pas", async () => {
    await ok(call("own", "staff.update", { userId: U.caissier, active: false }, "")); await ok(call("own", "staff.update", { userId: U.caissier, active: false }, ""));
    expect((await events("staff.disable")).length).toBe(1); expect((await events("staff.disable"))[0]).toMatchObject({ severity: "warning", actorRole: "owner" });
    await ok(call("own", "staff.update", { userId: U.caissier, active: true }, "")); expect((await events("staff.enable")).length).toBe(1); expect((await events("staff.update")).length).toBeGreaterThanOrEqual(3);
    await ok(call("own", "staff.update", { userId: U.caissier, name: "Nouveau nom" }, "")); expect((await events("staff.disable")).length).toBe(1);
  });
  it("sur le poste, la source de l'événement est « poste »", async () => {
    await ok(call("own", "staff.update", { userId: U.caissier, active: false }, "", T, false)); expect((await events("staff.disable"))[0].source).toBe("poste");
  });
  it("un autre commerce ne voit rien de ces événements", async () => {
    await ok(call("own", "staff.update", { userId: U.caissier, active: false }, "")); expect((await events("staff.disable", OTHER, "own2")).length).toBe(0); expect((await events("staff.sessions.revoke", OTHER, "own2")).length).toBe(0);
  });
});
