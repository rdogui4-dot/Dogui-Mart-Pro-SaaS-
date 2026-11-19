import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";

const T = "tenantprofile1";
let st: MemoryStore; let A = "";
const call = (user: string, action: string, payload: unknown = {}, shop = A) => handle(st, user, { action, tenantId: T, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const shop = () => st.rows("shops").find((r) => r.$id === A)!;

beforeEach(async () => { st = new MemoryStore(); await st.grant(T, "own", ["owner"], []); await st.grant(T, "mgr", ["manager"], []); A = (await ok(call("own", "shop.create", { name: "Dakar" }))).shopId; });

describe("assistant d'accueil : profil entreprise et boutique", () => {
  it("enregistre étape par étape sans effacer les champs déjà saisis ; le pays fixe le fuseau ; forme juridique et RCCM facultatifs", async () => {
    await ok(call("own", "shop.save", { companyName: "Dogui Distribution", sector: "Commerce / Distribution", country: "CI", city: "Abidjan", address: "Cocody", phone: "+225 07 00 00 00 00", description: "Vente de produits" }));
    expect(shop()).toMatchObject({ companyName: "Dogui Distribution", sector: "Commerce / Distribution", country: "CI", promoTz: "Africa/Abidjan", description: "Vente de produits" }); expect(shop().legalForm).toBeUndefined(); expect(shop().legal ?? "").toBe("");
    await ok(call("own", "shop.save", { name: "Dogui Mart Abidjan", shopType: "Commerce de détail", openDays: "1111110", openFrom: "08:00", openTo: "20:00" }));
    expect(shop()).toMatchObject({ name: "Dogui Mart Abidjan", companyName: "Dogui Distribution", country: "CI", shopType: "Commerce de détail", openDays: "1111110", openFrom: "08:00", openTo: "20:00" });
    await ok(call("own", "shop.save", { legalForm: "SARL", legal: "CI-ABJ-2024-B-12345" })); expect(shop()).toMatchObject({ legalForm: "SARL", legal: "CI-ABJ-2024-B-12345" });
    await ok(call("own", "shop.save", { legalForm: "" })); expect(shop().legalForm).toBe("");
  });
  it("refuse les valeurs inconnues (400) et le personnel non propriétaire (403)", async () => {
    for (const b of [{ country: "FR" }, { sector: "x" }, { shopType: "x" }, { openFrom: "20:00", openTo: "08:00" }, { openDays: "abc" }]) expect((await call("own", "shop.save", b)).status, JSON.stringify(b)).toBe(400);
    expect((await call("mgr", "shop.save", { sector: "Services" })).status).toBe(403);
  });
});
