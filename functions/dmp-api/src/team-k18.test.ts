import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { ACTIONS } from "./handlers";
import { READ_ACTIONS } from "./viewer";

const T = "t1", S = "s1", S2 = "s2";
let st: MemoryStore;
const call = (user: string | undefined, action: string, payload: unknown = {}, tenant = T, shop = S) => handle(st, user, { action, tenantId: tenant, shopId: shop, payload });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };

beforeEach(async () => {
  st = new MemoryStore();
  await st.addShop(T, S, "Plateau"); await st.addShop(T, S2, "Yopougon"); await st.addShop("t2", "x2", "Ailleurs");
  await st.grant(T, "own", ["owner"], []); await st.grant("t2", "own2", ["owner"], []);
  st.ownerNames.set("own", "Emmanuel");
});

describe("rôle Consultant (lecture seule vérifiée par le serveur)", () => {
  it("la liste de consultation ne contient que des actions existantes", () => {
    for (const a of READ_ACTIONS) expect(Object.hasOwn(ACTIONS, a), a).toBe(true);
    for (const w of ["entity.save", "checkout", "staff.create", "expense.create", "ic.entry.save", "promotion.save", "stock.adjust", "md.chat.ask"]) expect(READ_ACTIONS.has(w), w).toBe(false);
  });
  it("un consultant consulte ses modules mais toute écriture est refusée (403), même dans un module accordé", async () => {
    const c = await ok(call("own", "staff.create", { name: "Fatou", username: "fatou", password: "motdepasse1", role: "viewer", shopIds: [S] }, T, ""));
    const uid = c.userId;
    expect((await call(uid, "fin.accounts")).status).not.toBe(403);
    const w: any = await call(uid, "entity.save", { table: "products", data: { name: "X", price: 1 } }); expect(w.status).toBe(403); expect(w.body.error).toMatch(/Consultant/);
    expect((await call(uid, "ic.entry.save", { lines: [] })).status).toBe(403);
    expect((await call(uid, "staff.create", { name: "Z", username: "zzz", password: "motdepasse1", role: "cashier", shopIds: [S] }, T, "")).status).toBe(403);
    // le propriétaire peut lui donner plus de modules : il reste en lecture seule
    await ok(call("own", "staff.update", { userId: uid, access: ["pos", "stock", "reports"] }, T, ""));
    expect((await call(uid, "checkout", { saleId: "sale-000000001", lines: [] })).status).toBe(403);
  });
});

describe("invitations à usage unique", () => {
  const create = (over: object = {}) => ok(call("own", "staff.invite.create", { inviteId: "invite-000001", name: "Aka Blandine", role: "cashier", shopIds: [S], ...over }, T, ""));
  it("création : jeton renvoyé une fois, seule l'empreinte est stockée ; idempotente ; réservée au propriétaire", async () => {
    const a = await create();
    expect(a.token).toMatch(/^[a-f0-9]{64}$/); expect(a.invite).toMatchObject({ name: "Aka Blandine", role: "cashier", roleLabel: "Caissier", status: "pending", shopIds: [S] });
    const row = st.rows("staff_invites")[0]!; expect(row.tokenHash).not.toBe(a.token); expect(JSON.stringify(row)).not.toContain(a.token);
    expect((await create()).token).toBeNull();
    expect((await call("own2", "staff.invite.create", { inviteId: "invite-000001", name: "X", role: "cashier", shopIds: ["x2"] }, "t2", "")).status).toBe(409);
    expect((await call("own", "staff.invite.create", { inviteId: "invite-000002", name: "X", role: "cashier", shopIds: ["x2"] }, T, "")).status).toBe(404); // boutique d'un autre commerce
    expect((await call("own", "staff.invite.create", { inviteId: "invite-000003", name: "X", role: "root", shopIds: [S] }, T, "")).status).toBe(400);
  });
  it("aperçu public puis acceptation : compte créé avec le rôle, les accès et les boutiques de l'invitation ; lien inutilisable ensuite", async () => {
    const a = await create({ role: "stockkeeper", shopIds: [S, S2] });
    const p = await ok(call(undefined, "invite.peek", { token: a.token }));
    expect(p).toMatchObject({ name: "Aka Blandine", roleLabel: "Magasinier", shops: ["Plateau", "Yopougon"] });
    expect((await call(undefined, "invite.accept", { token: a.token, username: "ab", password: "motdepasse1" })).status).toBe(400); // identifiant trop court
    expect(st.rows("staff_invites")[0]!.status).toBe("pending"); // échec : l'invitation redevient utilisable
    const r = await ok(call(undefined, "invite.accept", { token: a.token, username: "blandine", password: "motdepasse1" }));
    expect(r.login).toBe("blandine");
    const staff = st.rows("staff").find((x) => x.username === "blandine")!;
    expect(staff).toMatchObject({ role: "stockkeeper", active: true }); expect(JSON.parse(String(staff.shopIds))).toEqual([S, S2]);
    expect((await call(undefined, "invite.accept", { token: a.token, username: "autre", password: "motdepasse1" })).status).toBe(410);
    expect((await call(undefined, "invite.peek", { token: a.token })).status).toBe(410);
    expect(st.rows("audit_log").some((l) => l.action === "invite.accept")).toBe(true);
  });
  it("renvoi (l'ancien lien cesse de fonctionner), annulation, expiration, jeton inconnu", async () => {
    const a = await create();
    const b = await ok(call("own", "staff.invite.renew", { inviteId: "invite-000001" }, T, ""));
    expect(b.token).not.toBe(a.token);
    expect((await call(undefined, "invite.peek", { token: a.token })).status).toBe(404);
    expect((await call(undefined, "invite.peek", { token: b.token })).status).toBe(200);
    await ok(call("own", "staff.invite.revoke", { inviteId: "invite-000001" }, T, ""));
    expect((await call(undefined, "invite.peek", { token: b.token })).status).toBe(410);
    const c = await ok(call("own", "staff.invite.renew", { inviteId: "invite-000001" }, T, ""));
    st.rows("staff_invites")[0]!.expiresAt = new Date(Date.now() - 1000).toISOString();
    const e: any = await call(undefined, "invite.accept", { token: c.token, username: "blandine", password: "motdepasse1" }); expect(e.status).toBe(410); expect(e.body.error).toMatch(/expiré/);
    expect((await call(undefined, "invite.peek", { token: "0".repeat(64) })).status).toBe(404);
    expect((await call(undefined, "invite.peek", { token: "abc" })).status).toBe(404);
    const l = await ok(call("own", "staff.invite.list", {}, T, "")); expect(l.invites[0].status).toBe("expired");
  });
  it("les actions publiques sont les seules permises sans connexion", async () => {
    expect((await call(undefined, "staff.invite.list", {}, T, "")).status).toBe(401);
    expect((await call(undefined, "team.overview", {}, T, "")).status).toBe(401);
  });
});

describe("vue Équipe", () => {
  it("membres réels avec dernière connexion et 2FA de l'annuaire, invitations, activité, constats", async () => {
    const c = await ok(call("own", "staff.create", { name: "Kouamé", username: "kouame", password: "motdepasse1", role: "manager", shopIds: [S, S2] }, T, ""));
    await ok(call("own", "staff.create", { name: "Koffi", username: "koffi", password: "motdepasse1", role: "cashier", access: ["pos", "customers", "accounting"], shopIds: [S] }, T, ""));
    st.security.set("own", { lastLogin: new Date().toISOString(), sessions24h: 2, mfa: true });
    st.security.set(c.userId, { lastLogin: new Date(Date.now() - 40 * 864e5).toISOString(), sessions24h: 0, mfa: false });
    await create2();
    const d = await ok(call("own", "team.overview", {}, T, ""));
    expect(d.counts).toMatchObject({ members: 3, active: 3, roles: 3, logins24h: 2, mfa: 1, pendingInvites: 1 });
    expect(d.members.find((m: any) => m.role === "owner")).toMatchObject({ name: "Emmanuel", mfa: true });
    const ids = d.insights.map((i: any) => i.id); expect(ids).toEqual(expect.arrayContaining(["dormant", "custom", "allshops", "mfa"]));
    expect(d.activity.some((a: any) => a.label === "Ajout d'un membre" && a.by === "Emmanuel")).toBe(true);
    expect(d.activity.every((a: any) => !/shopIds/.test(a.detail))).toBe(true);
    expect((await call(c.userId, "team.overview", {}, T, "")).status).toBe(403);
  });
  it("annuaire illisible : connexions et 2FA indisponibles, jamais inventées", async () => {
    st.userSecurity = async () => { throw new Error("scope"); };
    const d = await ok(call("own", "team.overview", {}, T, ""));
    expect(d.securityAvailable).toBe(false); expect(d.counts.logins24h).toBeNull(); expect(d.counts.mfa).toBeNull();
    expect(d.insights.some((i: any) => i.id === "mfa")).toBe(false);
  });
});
const create2 = () => ok(call("own", "staff.invite.create", { inviteId: "invite-000009", name: "Konan", role: "cashier", shopIds: [S] }, T, ""));
