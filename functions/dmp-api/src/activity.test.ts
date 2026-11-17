import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";

const T = "tenantac001";
let st: MemoryStore; let A = "", B = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}, shop = A, tenant = T) => handle(st, U[user] ?? user, { action, tenantId: tenant, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); };

beforeEach(async () => {
  st = new MemoryStore(); await st.grant(T, "own", ["owner"], []); st.ownerNames.set("own", "Awa");
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId;
  for (const [u, role, shops] of [["ger", "manager", [A]], ["cais", "cashier", [A]]] as const) U[u] = (await ok(call("own", "staff.create", { name: u === "ger" ? "Moussa" : "Fatou", username: u, password: "motdepasse1", role, shopIds: shops }, ""))).userId;
  await ok(call("own", "article.save", { data: { name: "Riz", price: 1000, cost: 600 } }, A));
  await ok(call("own", "article.save", { data: { name: "Huile", price: 2000, cost: 1500 } }, B));
});

describe("Journal d'activité", () => {
  it("le propriétaire lit les traces réelles de la boutique active, la plus récente en premier, avec l'auteur", async () => {
    const d = await ok(call("own", "activity.list", {}));
    expect(d.count).toBeGreaterThan(0); expect(d.entries.some((e: any) => /Riz/.test(e.detail))).toBe(true);
    expect(d.entries.some((e: any) => /Huile/.test(e.detail))).toBe(false); // jamais une autre boutique
    expect(d.entries[0].by).toBe("Awa");
    const dates = d.entries.map((e: any) => e.at); expect([...dates].sort().reverse()).toEqual(dates);
  });
  it("filtre par module et borne la taille", async () => {
    const d = await ok(call("own", "activity.list", { module: "article", limit: 1 }));
    expect(d.shown).toBeLessThanOrEqual(1); for (const e of d.entries) expect(e.action.startsWith("article.")).toBe(true);
    expect(d.modules.find((m: any) => m.id === "article")?.label).toBe("Articles");
  });
  it("droits : gérant oui, vendeur refusé ; gérant d'une autre boutique sans accès", async () => {
    await ok(call("ger", "activity.list", {}));
    await err(call("cais", "activity.list", {}), 403);
    await err(call("ger", "activity.list", {}, B), 403);
  });
});
