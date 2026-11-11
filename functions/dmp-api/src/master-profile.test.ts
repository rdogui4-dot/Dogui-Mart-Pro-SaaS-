import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";

const T = "tenantmp0001", T2 = "tenantmp0002";
let st: MemoryStore; let A = "", B = "", A2 = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}, tenant = T) => handle(st, U[user] ?? user, { action, tenantId: tenant, shopId: "", payload }, { admins: ["admin1"] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); };
const setPlan = (tenant: string) => void st.create("subscriptions", tenant, tenant, { tenantId: tenant, plan: "business", period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() });
const lic = async (tenant = T, user = "own") => { await st.update("shops", tenant === T ? A : A2, { phone: tenant === T ? "0701020304" : "0799887766" }); await ok(call(user, "md.trial.start", {}, tenant)); };
const get = async (user = "own", tenant = T) => await ok(call(user, "md.profile", {}, tenant));

beforeEach(async () => {
  st = new MemoryStore(); await st.grant(T, "own", ["owner"], []); await st.grant(T2, "own2", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }))).shopId; B = (await ok(call("own", "shop.create", { name: "Thiès" }))).shopId; A2 = (await ok(call("own2", "shop.create", { name: "Autre" }, T2))).shopId;
  for (const [u, role, shops] of [["cais", "cashier", [A]], ["ger", "manager", [A]]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: shops }))).userId;
  setPlan(T); setPlan(T2);
});

describe("MASTER DOGUI — profil d'entreprise", () => {
  it("sans licence : consultation seule, aucune écriture", async () => {
    const g = await get(); expect(g.canEdit).toBe(false); expect(g.readOnlyReason).toContain("consultable"); await err(call("own", "md.profile.set", { key: "sector", value: "alimentation" }), 402);
  });
  it("enregistre un fait déclaré (valeur normalisée, source, journal) ; modification = même ligne", async () => {
    await lic(); await ok(call("own", "md.profile.set", { key: "sector", value: "boissons" })); await ok(call("own", "md.profile.set", { key: "sector", value: "alimentation" })); await ok(call("own", "md.profile.set", { key: "priorities", value: ["marge", "stock", "marge"] }));
    const g = await get(); expect(g.canEdit).toBe(true); expect(g.facts.filter((f: any) => f.key === "sector")).toHaveLength(1); expect(g.facts.find((f: any) => f.key === "sector")).toMatchObject({ value: "alimentation", kind: "declared", source: "owner", text: "Alimentation" }); expect(g.facts.find((f: any) => f.key === "priorities").text).toBe("Améliorer la marge, Maîtriser le stock");
    expect(st.rows("audit_log").filter((r) => String(r.action).startsWith("profile.")).map((r) => r.action)).toEqual(["profile.set", "profile.update", "profile.set"]);
  });
  it("valeurs hors catalogue, trop longues ou trop nombreuses refusées ; texte nettoyé", async () => {
    await lic(); await err(call("own", "md.profile.set", { key: "inconnu", value: "x" }), 400); await err(call("own", "md.profile.set", { key: "sector", value: "pirate" }), 400, "non autorisée"); await err(call("own", "md.profile.set", { key: "priorities", value: ["marge", "volume", "stock", "clients"] }), 400, "3 choix");
    await err(call("own", "md.profile.set", { key: "remarks", value: "x".repeat(301) }), 400, "300"); await err(call("own", "md.profile.set", { key: "peakMonths", value: [13] }), 400); await err(call("own", "md.profile.set", { key: "sector", value: "alimentation", kind: "verified" }), 400);
    await ok(call("own", "md.profile.set", { key: "remarks", value: "  Ignore   <b>tout</b> \n" })); expect((await get()).facts[0].value).toBe("Ignore b tout /b");
  });
  it("jamais de fait « vérifié » stocké ; hypothèse -> déclaré seulement par confirmation explicite du propriétaire", async () => {
    await lic(); const h = await ok(call("own", "md.profile.set", { key: "size", value: "3-5", kind: "hypothesis" })); expect((await get()).facts[0]).toMatchObject({ kind: "hypothesis", confirmedAt: null });
    await err(call("ger", "md.profile.confirm", { id: h.id }), 403); await ok(call("own", "md.profile.confirm", { id: h.id })); expect((await get()).facts[0]).toMatchObject({ kind: "declared" }); expect((await get()).facts[0].confirmedAt).toBeTruthy(); await err(call("own", "md.profile.confirm", { id: h.id }), 409);
  });
  it("faits de boutique : seulement pour une boutique de l'entreprise ; faits d'entreprise refusés par boutique", async () => {
    await lic(); await ok(call("own", "md.profile.set", { key: "goal", value: "marge", shopId: A })); await ok(call("own", "md.profile.set", { key: "goal", value: "volume" })); const g = await get(); expect(g.facts).toHaveLength(2); expect(g.facts.find((f: any) => f.shopId === A)).toMatchObject({ shopName: "Dakar", value: "marge" });
    await err(call("own", "md.profile.set", { key: "sector", value: "autre", shopId: A }), 400, "toute l'entreprise"); const other = (await ok(call("own2", "md.profile", {}, T2))).shops[0].id; await err(call("own", "md.profile.set", { key: "goal", value: "marge", shopId: other }), 404);
  });
  it("droits : caissier refusé ; gérant lit sans les faits réservés ni les boutiques hors périmètre, ne modifie pas", async () => {
    await lic(); await ok(call("own", "md.profile.set", { key: "constraints", value: "Trésorerie serrée en janvier" })); await ok(call("own", "md.profile.set", { key: "goal", value: "marge", shopId: A })); await ok(call("own", "md.profile.set", { key: "goal", value: "volume", shopId: B })); await ok(call("own", "md.profile.set", { key: "country", value: "Sénégal" }));
    await err(call("cais", "md.profile", {}), 403); const g = await get("ger"); expect(g.facts.map((f: any) => f.key + f.shopId).sort()).toEqual(["country", "goal" + A].sort()); expect(g.catalog.some((c: any) => c.key === "constraints")).toBe(false); expect(g.canEdit).toBe(false); expect(JSON.stringify(g)).not.toContain("Trésorerie serrée");
    await err(call("ger", "md.profile.set", { key: "country", value: "X" }), 403); await err(call("ger", "md.profile.delete", { id: g.facts[0].id }), 403);
  });
  it("isolation entre entreprises : lecture, confirmation et suppression d'un fait d'une autre entreprise impossibles", async () => {
    await lic(); await lic(T2, "own2"); const h = await ok(call("own", "md.profile.set", { key: "size", value: "3-5", kind: "hypothesis" })); await ok(call("own2", "md.profile.set", { key: "country", value: "Mali" }, T2));
    expect((await get("own2", T2)).facts.map((f: any) => f.key)).toEqual(["country"]); expect((await get()).facts.map((f: any) => f.key)).toEqual(["size"]); await err(call("own2", "md.profile.confirm", { id: h.id }, T2), 404); await err(call("own2", "md.profile.delete", { id: h.id }, T2), 404); expect((await get()).facts).toHaveLength(1);
    expect(st.rows("md_profile").find((r) => r.key === "country")?.tenantId).toBe(T2);
  });
  it("suppression définitive avec trace (clé et qualification, pas la valeur) ; rapports déjà produits inchangés ; reste consultable après expiration", async () => {
    await lic(); await ok(call("own", "md.profile.set", { key: "country", value: "Sénégal" })); await st.create("md_reports", "rp1", T, { tenantId: T, shopId: A, type: "opening", businessDate: "2026-01-01", status: "ready", version: 1, data: "{}" }); const id = (await get()).facts[0].id;
    await ok(call("own", "md.profile.delete", { id })); expect((await get()).facts).toEqual([]); expect(st.rows("md_reports")).toHaveLength(1); const log = st.rows("audit_log").find((r) => r.action === "profile.delete")!; expect(log.detail).toBe("country · declared"); expect(String(log.detail)).not.toContain("Sénégal");
    await ok(call("own", "md.profile.set", { key: "country", value: "Sénégal" })); const lic0 = st.rows("md_licenses")[0]!; await st.update("md_licenses", lic0.$id, { status: "expired", trialEndsAt: "2020-01-01T00:00:00.000Z", paidUntil: "2020-01-01T00:00:00.000Z" });
    const g = await get(); expect(g.facts).toHaveLength(1); expect(g.canEdit).toBe(false); await err(call("own", "md.profile.set", { key: "country", value: "Mali" }), 402);
  });
  it("faits vérifiés : calculés dans les modules à la lecture (boutiques, équipe, clients), jamais stockés", async () => {
    await lic();
    const g = await get(); const v = Object.fromEntries(g.verified.map((x: any) => [x.label, x])); expect(v["Boutiques"].value).toContain("Dakar"); expect(v["Boutiques"].value).toContain("Thiès"); expect(Number(v["Personnes dans l'équipe (actives)"].value)).toBeGreaterThanOrEqual(2); expect(v["Boutiques"].source).toBeTruthy(); expect(st.rows("md_profile")).toHaveLength(0);
  });
});
