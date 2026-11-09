import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";

const T = "tenantsku001"; let st: MemoryStore; let A = "";
const call = (action: string, payload: unknown) => handle(st, "own", { action, tenantId: T, shopId: A, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const skus = () => st.rows("products").map((p) => p.sku).sort();
beforeEach(async () => {
  st = new MemoryStore(); await st.grant(T, "own", ["owner"], []);
  A = (await ok(handle(st, "own", { action: "shop.create", tenantId: T, shopId: "", payload: { name: "Dakar" } }))).shopId;
});
describe("référence automatique", () => {
  it("attribue ART-000001, 000002… quand la référence est vide, sans toucher une référence saisie", async () => {
    await ok(call("article.save", { data: { name: "A", price: 100 } })); await ok(call("article.save", { data: { name: "B", price: 100, sku: "MA-REF" } })); await ok(call("article.save", { data: { name: "C", price: 100 } }));
    expect(skus()).toEqual(["ART-000001", "ART-000002", "MA-REF"]);
  });
  it("rejouer la même création ne consomme pas de numéro", async () => {
    const p = { requestId: "req-sku-000001", data: { name: "A", price: 100 } }; await ok(call("article.save", p)); await ok(call("article.save", p));
    expect(skus()).toEqual(["ART-000001"]);
  });
  it("modification : référence vide attribuée si absente, conservée si déjà là", async () => {
    const a = (await ok(call("article.save", { data: { name: "A", price: 100, sku: "X1" } }))).id;
    await ok(call("article.save", { id: a, data: { sku: "" } })); expect(st.rows("products").find((p) => p.$id === a)!.sku).toBe("X1");
    const b = (await ok(call("article.save", { data: { name: "B", price: 100 } }))).id; expect(st.rows("products").find((p) => p.$id === b)!.sku).toBe("ART-000001");
  });
});
