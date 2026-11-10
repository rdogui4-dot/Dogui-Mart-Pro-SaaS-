import { describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";

describe("point d'entrée : actions", () => {
  it("refuse les noms issus du prototype (constructor, toString, __proto__…) : aucune fuite de l'état interne", async () => {
    const st = new MemoryStore(); await st.addShop("t1", "s1"); await st.grant("t1", "own", ["owner"], []);
    for (const a of ["constructor", "toString", "hasOwnProperty", "__proto__", "valueOf", "isPrototypeOf", "toLocaleString", "__defineGetter__"]) {
      const r = await handle(st, "own", { action: a, tenantId: "t1", shopId: "s1", payload: {} }); expect(r.status, a).toBe(400); expect(JSON.stringify(r.body)).not.toContain("tables");
    }
  });
  it("refuse une action absente ou non textuelle, et un appel sans identité", async () => {
    const st = new MemoryStore(); await st.addShop("t1", "s1"); await st.grant("t1", "own", ["owner"], []);
    for (const a of [undefined, null, 5, {}, ["count.get"]]) expect((await handle(st, "own", { action: a, tenantId: "t1", shopId: "s1" })).status).toBe(400);
    expect((await handle(st, undefined, { action: "shop.list", tenantId: "t1", shopId: "s1" })).status).toBe(401); expect((await handle(st, "own", undefined)).status).toBe(400);
  });
  it("un non-membre ne peut rien, même avec une action valide", async () => {
    const st = new MemoryStore(); await st.addShop("t1", "s1"); await st.grant("t1", "own", ["owner"], []);
    expect((await handle(st, "intrus", { action: "count.list", tenantId: "t1", shopId: "s1" })).status).toBe(403);
  });
});
