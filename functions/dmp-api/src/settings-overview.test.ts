import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";

const T = "tenantsettings1";
let st: MemoryStore; let A = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}) => handle(st, U[user] ?? user, { action, tenantId: T, shopId: A, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 1)]).toString("base64");
const setPlan = (plan: string) => { const row = st.rows("subscriptions").find((r) => r.$id === T); const data = { tenantId: T, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", T, T, data); };

beforeEach(async () => {
  st = new MemoryStore(); await st.grant(T, "own", ["owner"], []); A = (await ok(call("own", "shop.create", { name: "Dakar" }))).shopId;
  for (const [u, role] of [["ger", "manager"], ["cais", "cashier"]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: [A] }))).userId;
  setPlan("business");
});

describe("Paramètres généraux", () => {
  it("raison sociale, régime fiscal et fuseau horaire enregistrés ; fuseau inconnu refusé ; gérant refusé", async () => {
    await ok(call("own", "shop.save", { companyName: "Dogui Distribution SARL", taxRegime: "Réel simplifié", promoTz: "Africa/Abidjan" }));
    const s = st.rows("shops").find((r) => r.$id === A)!; expect(s).toMatchObject({ companyName: "Dogui Distribution SARL", taxRegime: "Réel simplifié", promoTz: "Africa/Abidjan" });
    await err(call("own", "shop.save", { promoTz: "Mars/Olympus" }), 400, "Fuseau"); await err(call("ger", "shop.save", { companyName: "X" }), 403);
  });
  it("logo : format vérifié, propriétaire seul, retrait ; journalisé", async () => {
    await err(call("own", "shop.logo", { data: Buffer.alloc(300, 7).toString("base64") }), 400, "Format"); await err(call("ger", "shop.logo", { data: JPEG }), 403);
    const r = await ok(call("own", "shop.logo", { data: JPEG })); expect(st.rows("shops").find((x) => x.$id === A)!.logoFileId).toBe(r.fileId);
    await ok(call("own", "shop.logo", { data: null })); expect(st.rows("shops").find((x) => x.$id === A)!.logoFileId).toBe(""); expect(st.rows("audit_log").filter((x) => String(x.action).startsWith("shop.logo")).length).toBe(2);
  });
  it("synthèse : boutiques, utilisateurs actifs, modules de la formule, liste de vérification ; employé refusé", async () => {
    const o = await ok(call("ger", "settings.overview")); expect(o).toMatchObject({ shops: 1, users: 3, canEdit: false }); expect(o.modules).toMatchObject({ active: 9, total: 10 }); expect(o.finAccounts).toBe(0);
    expect(o.checklist.items.find((i: any) => i.id === "staff").done).toBe(true); expect(o.checklist.items.find((i: any) => i.id === "company").done).toBe(false);
    await ok(call("own", "shop.save", { companyName: "Dogui SARL" })); expect((await ok(call("own", "settings.overview"))).checklist.items.find((i: any) => i.id === "company").done).toBe(true);
    setPlan("pro"); expect((await ok(call("own", "settings.overview"))).modules.active).toBe(10); await err(call("cais", "settings.overview"), 403);
  });
});
