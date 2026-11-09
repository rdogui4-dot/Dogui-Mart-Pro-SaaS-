import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";

const T = "tenantpro001", T2 = "tenantpro002";
let st: MemoryStore; let A = "", A2 = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown, shop = A, tenant = T) => handle(st, user, { action, tenantId: tenant, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); return x.body.error as string; };
const setPlan = (plan: string, tenant = T) => { const row = st.rows("subscriptions").find((r) => r.$id === tenant); const data = { tenantId: tenant, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", tenant, tenant, data); };
const iso = (d: number) => new Date(Date.now() + d * 864e5).toISOString();
let n = 0; const id8 = (p: string) => `${p}-${String(++n).padStart(8, "0")}`;
const mk = async (name: string, price: number, cost: number, qty = 0, extra: object = {}) => (await ok(call("own", "article.save", { data: { name, price, cost, ...extra }, ...(qty ? { initialQty: qty } : {}) }))).id as string;
const promo = async (data: object = {}, productIds: string[] | undefined = undefined, extra: object = {}) => (await ok(call("own", "promotion.save", { data: { name: "Promo", kind: "percent", scope: "items", value: 10, startAt: iso(-1), endAt: iso(10), ...data }, productIds: productIds ?? [eau], ...extra }))).id as string;
const enable = (id: string) => ok(call("own", "promotion.status", { id, to: "enabled" }));
const sell = (lines: object[], extra: object = {}, amount = 1_000_000) => call("own", "checkout", { clientId: id8("vente"), lines, payments: [{ method: "cash", amount }], ...extra });
const lastSale = () => st.rows("sales").at(-1)!; const lastLine = (i = 0) => JSON.parse(String(lastSale().lines))[i];
const usage = () => st.rows("promotion_usage"); const row = (id: string) => st.rows("promotions").find((p) => p.$id === id)!;
let eau = "", jus = "", savon = "";

beforeEach(async () => {
  st = new MemoryStore(); n = 0; await st.grant(T, "own", ["owner"], []); await st.grant(T2, "own2", ["owner"], []);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }, ""))).shopId; A2 = (await ok(call("own2", "shop.create", { name: "Autre" }, "", T2))).shopId;
  for (const [u, role] of [["cais", "cashier"], ["ger", "manager"]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: [A] }, ""))).userId;
  setPlan("business"); setPlan("business", T2);
  eau = await mk("Eau", 500, 300, 100); jus = await mk("Jus", 1000, 600, 100); savon = await mk("Savon", 800, 400, 100, { category: "Hygiène" });
});

describe("création et validation", () => {
  it("brouillon à la création ; aucune promotion n'existe tant que le gérant n'en crée pas ; droits et formule", async () => {
    expect(st.rows("promotions")).toHaveLength(0); const id = await promo(); expect(row(id)).toMatchObject({ status: "draft", usageCount: 0, createdBy: "own", kind: "percent", discountValue: 10 }); expect(st.rows("promotion_items")).toHaveLength(1);
    const body = { data: { name: "XX", kind: "percent", scope: "items", value: 5, startAt: iso(0), endAt: iso(5) }, productIds: [eau] };
    await err(call(U.cais!, "promotion.save", body), 403); await ok(call(U.ger!, "promotion.save", body));
    setPlan("starter"); await err(call("own", "promotion.save", body), 402);
  });
  it("refuse les saisies incohérentes, les articles inconnus/archivés/d'une autre boutique, les codes en double", async () => {
    const bad = (data: object, ids: string[] = [eau]) => call("own", "promotion.save", { data: { name: "PP", kind: "percent", scope: "items", value: 10, startAt: iso(-1), endAt: iso(10), ...data }, productIds: ids });
    await err(bad({ value: 0 }), 400); await err(bad({ endAt: iso(-5) }), 400, "postérieure"); await err(bad({}, []), 400, "au moins un article"); await err(bad({ scope: "category", category: "Hygiène" }, [eau]), 400, "ne se choisissent");
    await err(bad({}, ["inconnu"]), 404); const old = await mk("Vieux", 100, 50); await ok(call("own", "article.archive", { id: old, archived: true })); await err(bad({}, [old]), 409, "archivé");
    const other = (await ok(call("own2", "article.save", { data: { name: "Autre", price: 100, cost: 10 } }, A2, T2))).id; await err(bad({}, [other]), 404);
    await promo({ code: "ete10" }); await err(bad({ code: "ETE10" }), 409, "déjà utilisé"); await err(bad({ code: "a b" }), 400);
  });
  it("marge minimale : refus d'un prix final sous coût × (1 + marge) sauf autorisation explicite ; prix promotionnel et montant contrôlés", async () => {
    await err(call("own", "promotion.save", { data: { name: "Cassé", kind: "price", scope: "items", value: 250, startAt: iso(-1), endAt: iso(5) }, productIds: [eau] }), 409, "marge minimale");
    await err(call("own", "promotion.save", { data: { name: "Gros", kind: "amount", scope: "items", value: 400, startAt: iso(-1), endAt: iso(5) }, productIds: [eau] }), 409, "marge minimale");
    await ok(call("own", "shop.save", { minMarginPct: 20 })); await err(call("own", "promotion.save", { data: { name: "20", kind: "percent", scope: "items", value: 30, startAt: iso(-1), endAt: iso(5) }, productIds: [eau] }), 409); // 350 < 300 × 1,2
    await ok(call("own", "promotion.save", { data: { name: "ok", kind: "percent", scope: "items", value: 10, startAt: iso(-1), endAt: iso(5) }, productIds: [eau] }));
    await ok(call("own", "promotion.save", { data: { name: "perte voulue", kind: "price", scope: "items", value: 250, allowBelowMargin: true, startAt: iso(-1), endAt: iso(5) }, productIds: [eau] }));
    await err(call("own", "shop.save", { minMarginPct: 95 }), 400); await err(call("own", "shop.save", { minMarginPct: 1.5 }), 400);
  });
});

describe("statuts", () => {
  it("transitions contrôlées ; activation refusée si période passée ou sans article ; fin anticipée", async () => {
    const id = await promo(); await err(call("own", "promotion.status", { id, to: "suspended" }), 409); await enable(id); expect(row(id).status).toBe("enabled");
    await ok(call("own", "promotion.status", { id, to: "suspended" })); await enable(id); await ok(call("own", "promotion.status", { id, to: "ended" })); expect(Date.parse(String(row(id).endAt))).toBeLessThanOrEqual(Date.now() + 1000); await err(call("own", "promotion.status", { id, to: "enabled" }), 409);
    const past = await promo({ startAt: iso(-10), endAt: iso(-5) }); await err(call("own", "promotion.status", { id: past, to: "enabled" }), 409, "date de fin"); await err(call("own", "promotion.status", { id: "inconnu", to: "enabled" }), 404); await err(call("own", "promotion.status", { id, to: "xyz" }), 400);
  });
  it("suppression : brouillon ou jamais utilisée seulement", async () => {
    const id = await promo(); await ok(call("own", "promotion.delete", { id })); expect(st.rows("promotions")).toHaveLength(0); expect(st.rows("promotion_items")).toHaveLength(0);
    const used = await promo(); await enable(used); await ok(sell([{ productId: eau, qty: 1 }])); await err(call("own", "promotion.delete", { id: used }), 409, "déjà été utilisée"); expect(usage()).toHaveLength(1);
  });
});

describe("application aux ventes", () => {
  it("remise calculée par le serveur : prix initial conservé, remise, prix final, total ; utilisation liée à la vente", async () => {
    const id = await promo({ value: 20 }); await enable(id); await ok(sell([{ productId: eau, qty: 3 }, { productId: jus, qty: 1 }]));
    expect(lastLine(0)).toMatchObject({ productId: eau, baseAmount: 1500, amount: 1200, promo: { id, discount: 300, kind: "percent", value: 20 } }); expect(lastLine(1).promo).toBeUndefined(); expect(lastSale().total).toBe(1200 + 1000);
    const u = usage()[0]!; expect(u).toMatchObject({ promotionId: id, saleId: lastSale().$id, saleNumber: lastSale().number, discount: 300, baseAmount: 1500, finalAmount: 1200, userId: "own" }); expect(row(id).usageCount).toBe(1);
  });
  it("ne s'applique ni expirée, ni suspendue, ni programmée, ni en brouillon ; la date de la vente fait foi (vente hors ligne)", async () => {
    const id = await promo({ startAt: iso(-1), endAt: iso(5) }); await sell([{ productId: eau, qty: 1 }]); expect(usage()).toHaveLength(0); // brouillon
    await enable(id); await ok(call("own", "promotion.status", { id, to: "suspended" })); await sell([{ productId: eau, qty: 1 }]); expect(lastLine().promo).toBeUndefined();
    const fut = await promo({ startAt: iso(2), endAt: iso(9) }); await enable(fut); await sell([{ productId: eau, qty: 1 }]); expect(lastLine().promo).toBeUndefined();
    st.rows("promotions").find((p) => p.$id === id)!.status = "enabled"; await ok(sell([{ productId: eau, qty: 1 }], { soldAt: iso(-0.5) })); expect(lastLine().promo?.id).toBe(id); // vente d'hier soir : la promotion était active
    st.rows("promotions").find((p) => p.$id === id)!.endAt = iso(-0.1); await sell([{ productId: eau, qty: 1 }]); expect(lastLine().promo).toBeUndefined(); // expirée
    await ok(sell([{ productId: eau, qty: 1 }], { soldAt: iso(-0.5) })); expect(lastLine().promo?.id).toBe(id); // mais encore applicable à une vente hors ligne antérieure à la fin
  });
  it("code promo : regroupe plusieurs articles et s'applique AUTOMATIQUEMENT à la caisse (aucun code à saisir) ; un seul type de remise pour tout le code", async () => {
    const id = await promo({ code: "rentree26", kind: "percent", value: 10 }, [eau, jus, savon]); expect(row(id).code).toBe("RENTREE26"); await enable(id);
    await ok(sell([{ productId: eau, qty: 2 }, { productId: jus, qty: 1 }, { productId: savon, qty: 1 }, { productId: await mk("Hors code", 700, 300, 10), qty: 1 }]));
    expect([0, 1, 2, 3].map((i) => lastLine(i).promo?.id)).toEqual([id, id, id, undefined]); expect(lastSale().total).toBe(900 + 900 + 720 + 700);
    expect(usage()).toHaveLength(1); expect(usage()[0]).toMatchObject({ code: "RENTREE26", discount: 100 + 100 + 80 }); expect(row(id).usageCount).toBe(1); // une utilisation par vente, même avec plusieurs articles du code
    const p = await ok(call("own", "promotions.preview", { lines: [{ productId: eau, qty: 1 }] })); expect(p.promotions[0]).toMatchObject({ promoId: id, code: "RENTREE26" });
  });
  it("le code est généré s'il n'est pas saisi, unique, et plus aucune promotion « toute la vente »", async () => {
    const a = await promo({ name: "Soldes d'hiver" }); const b = await promo({ name: "Soldes d'hiver" }); expect(row(a).code).toMatch(/^SOLDES\d{3}$/); expect(row(b).code).not.toBe(row(a).code);
    await err(call("own", "promotion.save", { data: { name: "Tout", kind: "percent", scope: "cart", value: 10, startAt: iso(-1), endAt: iso(5) }, productIds: [] }), 400, "Portée inconnue");
  });
  it("catégorie, quantité minimale, panier minimal", async () => {
    const cat = await promo({ scope: "category", category: "hygiène", value: 50 }, []); await enable(cat); await ok(sell([{ productId: savon, qty: 1 }, { productId: eau, qty: 1 }])); expect(lastLine(0).promo?.id).toBe(cat); expect(lastLine(1).promo).toBeUndefined(); expect(lastSale().total).toBe(400 + 500);
    const q = await promo({ minQty: 3, value: 40, code: "", allowBelowMargin: true }, [jus]); await enable(q); await sell([{ productId: jus, qty: 2 }]); expect(lastLine().promo).toBeUndefined(); await sell([{ productId: jus, qty: 3 }]); expect(lastLine().promo?.id).toBe(q);
    const m = await promo({ minCart: 5000, value: 10 }, [eau]); await enable(m); await sell([{ productId: eau, qty: 2 }]); expect(lastLine().promo).toBeUndefined(); await sell([{ productId: eau, qty: 10 }]); expect(lastLine().promo?.id).toBe(m);
  });
  it("prix promotionnel et montant fixe : jamais de prix négatif ni de remise supérieure à la ligne", async () => {
    const p = await promo({ kind: "price", value: 400, allowBelowMargin: true }, [jus]); await enable(p); await ok(sell([{ productId: jus, qty: 2 }])); expect(lastLine().amount).toBe(800); expect(lastLine().promo.discount).toBe(1200);
    const a = await promo({ kind: "amount", value: 450, allowBelowMargin: true }, [eau]); await enable(a); await ok(sell([{ productId: eau, qty: 1 }])); expect(lastLine().amount).toBe(50); const a2 = await promo({ kind: "amount", value: 900, allowBelowMargin: true, priority: 9 }, [eau]); await enable(a2); await ok(sell([{ productId: eau, qty: 1 }])); expect(lastLine().amount).toBe(0); expect(lastSale().total).toBe(0);
  });
  it("pas de cumul : une seule promotion par ligne (la plus avantageuse) ; une remise manuelle l'emporte (aucune promotion)", async () => {
    const small = await promo({ name: "petite", value: 10 }, [eau]); const big = await promo({ name: "grande", value: 30 }, [eau]); await enable(small); await enable(big);
    await ok(sell([{ productId: eau, qty: 2 }])); expect(lastLine().promo.id).toBe(big); expect(usage()).toHaveLength(1); expect(row(small).usageCount).toBe(0);
    await ok(call("own", "checkout", { clientId: id8("vente"), lines: [{ productId: eau, qty: 2, discountPct: 5 }], payments: [{ method: "cash", amount: 100000 }] })); expect(lastLine().promo).toBeUndefined(); expect(lastSale().total).toBe(950);
  });
  it("marge : si le coût monte après la création, la promotion est ignorée à la vente (jamais de vente sous la marge)", async () => {
    const id = await promo({ value: 20 }, [eau]); await enable(id); await ok(call("own", "article.save", { id: eau, data: { cost: 450 } })); await sell([{ productId: eau, qty: 1 }]); expect(lastLine().promo).toBeUndefined(); expect(usage()).toHaveLength(0);
  });
  it("Starter : plus de promotion appliquée, données conservées", async () => {
    const id = await promo(); await enable(id); setPlan("starter"); await sell([{ productId: eau, qty: 1 }]); expect(lastLine().promo).toBeUndefined(); expect(st.rows("promotions")).toHaveLength(1); setPlan("business"); await ok(sell([{ productId: eau, qty: 1 }])); expect(lastLine().promo?.id).toBe(id);
  });
  it("isolation : la promotion d'un autre commerce ne s'applique jamais", async () => {
    const other = (await ok(call("own2", "article.save", { data: { name: "Eau", price: 500, cost: 300 }, initialQty: 10 }, A2, T2))).id;
    const p2 = (await ok(call("own2", "promotion.save", { data: { name: "Autre", kind: "percent", scope: "items", value: 50, allowBelowMargin: true, startAt: iso(-1), endAt: iso(5) }, productIds: [other] }, A2, T2))).id; await ok(call("own2", "promotion.status", { id: p2, to: "enabled" }, A2, T2));
    const id = await promo(); await enable(id); await err(call("own", "promotion.status", { id: p2, to: "suspended" }), 404); await err(call("own", "promotion.delete", { id: p2 }), 404);
    await ok(sell([{ productId: eau, qty: 1 }])); expect(lastLine().promo.id).toBe(id); expect(usage().every((u) => u.promotionId === id)).toBe(true);
  });
});

describe("limites d'utilisation", () => {
  it("limite globale : dernière utilisation honorée, ensuite plus de remise ; réservation atomique (conflit → vente refusée, rien d'écrit)", async () => {
    const id = await promo({ usageLimit: 2 }); await enable(id); await ok(sell([{ productId: eau, qty: 1 }])); await ok(sell([{ productId: eau, qty: 1 }])); expect(row(id).usageCount).toBe(2);
    await ok(sell([{ productId: eau, qty: 1 }])); expect(lastLine().promo).toBeUndefined(); expect(usage()).toHaveLength(2);
    const one = await promo({ usageLimit: 1, value: 50, code: "", allowBelowMargin: true }, [jus]); await enable(one);
    // course : une autre vente a réservé l'unique place entre la lecture et l'écriture
    await ok(sell([{ productId: jus, qty: 1 }])); const claimedBy = usage().find((u) => u.promotionId === one)!; expect(claimedBy.slot).toBe(1);
    st.rows("promotions").find((p) => p.$id === one)!.usageCount = 0; const before = st.rows("sales").length; await err(sell([{ productId: jus, qty: 1 }]), 409, "épuisée"); expect(st.rows("sales")).toHaveLength(before);
  });
  it("limite par client : exige un client identifié, compte ses utilisations", async () => {
    const c = (await ok(call("own", "entity.save", { table: "customers", data: { name: "Awa" } }))).id; const id = await promo({ perCustomerLimit: 1 }); await enable(id);
    await sell([{ productId: eau, qty: 1 }]); expect(lastLine().promo).toBeUndefined(); await ok(sell([{ productId: eau, qty: 1 }], { customerId: c })); expect(lastLine().promo.id).toBe(id); expect(usage()[0]!.customerId).toBe(c);
    await sell([{ productId: eau, qty: 1 }], { customerId: c }); expect(lastLine().promo).toBeUndefined(); expect(usage()).toHaveLength(1);
  });
  it("même vente rejouée : une seule utilisation, une seule remise (protection contre les doubles remises)", async () => {
    const id = await promo({ usageLimit: 5 }); await enable(id); const body = { clientId: "vente-rejeu-promo1", lines: [{ productId: eau, qty: 2 }], payments: [{ method: "cash", amount: 5000 }] };
    await ok(call("own", "checkout", body)); const again = await ok(call("own", "checkout", body)); expect(again.duplicate).toBe(true); expect(usage()).toHaveLength(1); expect(row(id).usageCount).toBe(1); expect(st.rows("sales")).toHaveLength(1);
    // reprise d'une vente interrompue : la remise figée est conservée, même si la promotion a été suspendue entre-temps
    const s = st.rows("sales")[0]!; s.status = "pending"; await ok(call("own", "promotion.status", { id, to: "suspended" })); await ok(call("own", "checkout", body)); expect(JSON.parse(String(st.rows("sales")[0]!.lines))[0].promo.id).toBe(id); expect(st.rows("sales")[0]!.total).toBe(900); expect(usage()).toHaveLength(1);
  });
});

describe("cohérence avec les ventes passées", () => {
  it("modifier ou terminer une promotion ne recalcule jamais une vente confirmée ; l'historique reste après expiration", async () => {
    const id = await promo({ value: 10 }); await enable(id); await ok(sell([{ productId: eau, qty: 4 }])); const total = lastSale().total; const before = JSON.stringify(lastSale().lines);
    await err(call("own", "promotion.save", { id, data: { name: "Renommée", kind: "percent", scope: "items", value: 30, startAt: iso(-1), endAt: iso(10) }, productIds: [eau] }), 409, "déjà été utilisée");
    await ok(call("own", "promotion.save", { id, data: { name: "Renommée", description: "d", kind: "percent", scope: "items", value: 10, startAt: iso(-1), endAt: iso(20), usageLimit: 50 }, productIds: [eau] })); expect(row(id)).toMatchObject({ name: "Renommée", usageLimit: 50 });
    await err(call("own", "promotion.save", { id, data: { name: "xx", kind: "percent", scope: "items", value: 10, startAt: iso(-1), endAt: iso(20), usageLimit: 0 }, productIds: [eau] }), 400); await ok(call("own", "promotion.status", { id, to: "ended" }));
    expect(lastSale().total).toBe(total); expect(JSON.stringify(lastSale().lines)).toBe(before); expect(usage()).toHaveLength(1); await err(call("own", "promotion.save", { id, data: { name: "xx", kind: "percent", scope: "items", value: 10, startAt: iso(-1), endAt: iso(20) }, productIds: [eau] }), 409, "terminée");
  });
  it("aperçu = vente réelle (mêmes prix, mêmes remises) et n'écrit rien", async () => {
    const id = await promo({ value: 15 }); await enable(id); const lines = [{ productId: eau, qty: 3 }, { productId: jus, qty: 2 }]; const snap = () => JSON.stringify([...st.tables.entries()].filter(([, v]) => v.size > 0).map(([k, v]) => [k, v.size]));
    const before = snap(); const p = await ok(call("own", "promotions.preview", { lines })); expect(snap()).toBe(before); expect(p).toMatchObject({ dryRun: true, total: 1275 + 2000, discountTotal: 225 }); expect(p.promotions[0]).toMatchObject({ promoId: id, discount: 225 });
    await ok(sell(lines)); expect(lastSale().total).toBe(p.total); await err(call("own", "promotions.preview", { lines: [] }), 400); await err(call("own", "promotions.preview", { lines: [{ productId: "x", qty: 1 }] }), 404);
  });
});

describe("suivi", () => {
  it("compte les promotions par statut, les utilisations, les remises et le chiffre d'affaires net — sans le présenter comme un bénéfice", async () => {
    const a = await promo({ value: 10 }); await enable(a); await promo({ name: "Brouillon" }); const f = await promo({ startAt: iso(3), endAt: iso(9) }); await enable(f);
    await ok(sell([{ productId: eau, qty: 2 }])); await ok(sell([{ productId: eau, qty: 4 }, { productId: jus, qty: 1 }]));
    const s = await ok(call("own", "promotions.stats", {})); expect(s).toMatchObject({ created: 3, uses: 2, discountTotal: 100 + 200, promoRevenue: 900 + 1800 }); expect(s.byStatus).toMatchObject({ draft: 1, scheduled: 1, active: 1, ended: 0 });
    expect(s.items[0]).toMatchObject({ id: a, uses: 2, discount: 300, revenue: 2700 }); expect(s.note).toContain("pas un bénéfice");
    await err(call("own", "promotions.stats", { from: "2026-12-01", to: "2026-11-01" }), 400); await err(call(U.cais!, "promotions.stats", {}), 403);
    const other = await ok(call("own2", "promotions.stats", {}, A2, T2)); expect(other.created).toBe(0); expect(other.uses).toBe(0);
  });
});
