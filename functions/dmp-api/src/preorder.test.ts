import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { AUTO_BY, preorderQty } from "./preorder";

class DatedStore extends MemoryStore { override async create(t: string, id: string, tenant: string, d: Record<string, unknown>) { return super.create(t, id, tenant, { $createdAt: new Date().toISOString(), ...d }); } }
const T = "tenantpre01";
let st: DatedStore; let A = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}, shop = A) => handle(st, U[user] ?? user, { action, tenantId: T, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const setPlan = (plan: string) => { const row = st.rows("subscriptions").find((r) => r.$id === T); const data = { tenantId: T, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", T, T, data); };
const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);
const sell = (user: string, productId: string, qty: number, price: number) => call(user, "checkout", { clientId: rid(), lines: [{ productId, qty }], payments: [{ method: "cash", amount: qty * price }] });
const drafts = () => st.rows("purchase_orders").filter((p) => p.createdBy === AUTO_BY && p.status === "draft");
let SUP = "", riz = "", sel = "";

beforeEach(async () => {
  st = new DatedStore(); await st.grant(T, "own", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId;
  U.cais = (await ok(call("own", "staff.create", { name: "cais", username: "cais", password: "motdepasse1", role: "cashier", shopIds: [A] }, ""))).userId;
  setPlan("business"); SUP = (await ok(call("own", "purch.supplier.save", { name: "Grossiste Central", leadDays: 5 }))).id;
  riz = (await ok(call("own", "article.save", { data: { name: "Riz 5 kg", price: 5000, cost: 4000, minStock: 10, supplierId: SUP }, initialQty: 14 }))).id;
  sel = (await ok(call("own", "article.save", { data: { name: "Sel", price: 200, cost: 100, minStock: 5 }, initialQty: 6 }))).id;
});

describe("calcul de la quantité", () => {
  it("rotation × (délai + 30 j) + seuil − stock − en commande ; au moins l'habitude de commande ; sinon 2 × seuil", () => {
    expect(preorderQty({ stock: 8, threshold: 10, onOrder: 0, soldLast30: 30, leadDays: 5, history: [] })).toMatchObject({ qty: 37, daily: 1, basis: "rotation" });
    expect(preorderQty({ stock: 8, threshold: 10, onOrder: 0, soldLast30: 30, leadDays: 5, history: [50, 60, 40] })).toMatchObject({ qty: 50, basis: "history" });
    expect(preorderQty({ stock: 4, threshold: 5, onOrder: 0, soldLast30: 0, leadDays: 7, history: [] })).toMatchObject({ qty: 6, basis: "threshold" });
    expect(preorderQty({ stock: 8, threshold: 10, onOrder: 0, soldLast30: 30, leadDays: 5, history: [], minQty: 48 }).qty).toBe(48);
    expect(preorderQty({ stock: 0.4, threshold: 1, onOrder: 0, soldLast30: 1.5, leadDays: 0, history: [], scale: 3 }).qty).toBe(2.1);
  });
});

describe("déclenchement automatique", () => {
  it("active par défaut : une vente du caissier qui passe le riz sous son seuil crée un brouillon pour son fournisseur, sans le soumettre", async () => {
    await ok(sell("cais", riz, 3, 5000)); expect(drafts()).toHaveLength(0); // 11 > 10
    await ok(sell("cais", riz, 2, 5000)); const d = drafts(); expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ supplierId: SUP, status: "draft" }); const lines = JSON.parse(String(d[0]!.lines)); expect(lines).toHaveLength(1); expect(lines[0]).toMatchObject({ productId: riz, unitPrice: 4000 });
    // ventes 5 sur 30 j, délai 5 j : 5/30 × 35 + 10 − 9 = 6,83 → 7
    expect(lines[0].qty).toBe(7); expect(String(d[0]!.notes)).toContain("Riz 5 kg : stock 9 ≤ seuil 10");
  });
  it("pas de doublon : article déjà en précommande, ou couvert par une commande en cours ; nouvel article ajouté au même brouillon", async () => {
    await ok(sell("cais", riz, 5, 5000)); await ok(sell("cais", riz, 1, 5000)); expect(drafts()).toHaveLength(1); expect(JSON.parse(String(drafts()[0]!.lines))).toHaveLength(1);
    await ok(call("own", "article.save", { id: sel, data: { name: "Sel", price: 200, cost: 100, minStock: 5, supplierId: SUP } })); await ok(sell("cais", sel, 2, 200));
    expect(drafts()).toHaveLength(1); expect(JSON.parse(String(drafts()[0]!.lines)).map((l: any) => l.productId)).toEqual([riz, sel]);
  });
  it("commande validée en cours qui couvre le besoin : aucune précommande", async () => {
    const po = await ok(call("own", "purch.po.save", { clientId: rid(), supplierId: SUP, lines: [{ productId: riz, qty: 20, unitPrice: 4000 }] })); await ok(call("own", "purch.po.validate", { id: po.id }));
    await ok(sell("cais", riz, 6, 5000)); expect(drafts()).toHaveLength(0);
  });
  it("habitude de commande : la médiane des dernières commandes sert de plancher", async () => {
    for (const q of [30, 40, 50]) { const po = await ok(call("own", "purch.po.save", { clientId: rid(), supplierId: SUP, lines: [{ productId: riz, qty: q, unitPrice: 4000 }] })); await ok(call("own", "purch.po.cancel", { id: po.id, reason: "test historique" }).catch(() => null)); }
    // annulées : ignorées ; on les tient pour reçues (historique)
    for (const p of st.rows("purchase_orders")) p.status = "received";
    await ok(sell("cais", riz, 5, 5000)); expect(JSON.parse(String(drafts()[0]!.lines))[0].qty).toBe(40);
  });
  it("sans fournisseur : aucun brouillon, article signalé ; désactivée : rien ; Starter : rien", async () => {
    await ok(sell("cais", sel, 2, 200)); expect(drafts()).toHaveLength(0);
    const s = await ok(call("own", "purch.preorder.status")); expect(s.enabled).toBe(true); expect(s.noSupplier.map((x: any) => x.name)).toEqual(["Sel"]); expect(s.rule).toContain("délai fournisseur");
    await ok(call("own", "purch.preorder.set", { enabled: false })); await ok(sell("cais", riz, 5, 5000)); expect(drafts()).toHaveLength(0);
    await ok(call("own", "purch.preorder.set", { enabled: true })); setPlan("starter"); await ok(sell("own", riz, 1, 5000)); expect(drafts()).toHaveLength(0);
  });
  it("« Analyser maintenant » (gérant) passe en revue toute la boutique ; le caissier ne peut pas régler", async () => {
    await st.create("stock_moves", "corr1", T, { tenantId: T, shopId: A, productId: riz, qty: 6, kind: "loss" });
    const r = await ok(call("own", "purch.preorder.run")); expect(r.drafts).toHaveLength(1);
    const x = await call("cais", "purch.preorder.set", { enabled: false }); expect(x.status).toBeGreaterThanOrEqual(403);
  });
});
