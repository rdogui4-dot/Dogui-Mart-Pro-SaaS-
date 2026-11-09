import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";

const T = "tenantaud001"; let st: MemoryStore; let A = "";
const call = (user: string, action: string, payload: unknown, shop = A) => handle(st, user, { action, tenantId: T, shopId: shop, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); };
beforeEach(async () => { st = new MemoryStore(); await st.grant(T, "own", ["owner"], []); A = (await ok(handle(st, "own", { action: "shop.create", tenantId: T, shopId: "", payload: { name: "Dakar" } }))).shopId; });

describe("remboursement de crédit client", () => {
  it("encaisse, écrit au journal, plafonne au solde, et ne double jamais avec le même identifiant", async () => {
    const c = (await ok(call("own", "entity.save", { table: "customers", data: { name: "Awa", creditLimit: 50000 } }))).id;
    st.rows("customers").find((x) => x.$id === c)!.creditBalance = 10000;
    const body = { customerId: c, amount: 4000, method: "cash", repayId: "repay-uuid-0001" };
    expect((await ok(call("own", "credit.repay", body))).balance).toBe(6000);
    const again = await ok(call("own", "credit.repay", body)); expect(again.duplicate).toBe(true); expect(st.rows("customers").find((x) => x.$id === c)!.creditBalance).toBe(6000); expect(st.rows("journal_entries")).toHaveLength(2);
    expect((await ok(call("own", "credit.repay", { ...body, repayId: "repay-uuid-0002", amount: 99999 }))).repaid).toBe(6000); // plafonné au solde
    await err(call("own", "credit.repay", { ...body, repayId: "repay-uuid-0003" }), 400, "Rien à encaisser"); await err(call("own", "credit.repay", { customerId: "inconnu", amount: 1, method: "cash" }), 404);
  });
});
describe("fiche employé illisible", () => {
  it("n'entraîne pas d'erreur 500 : l'employé n'a simplement accès à aucune boutique", async () => {
    await st.create("staff", "emp", T, { tenantId: T, userId: "emp", name: "E", role: "cashier", shopIds: "{pas du json", active: true }); st.members.set(`${T}:emp`, ["cashier"]);
    await err(call("emp", "checkout", { clientId: "vente-test-00001", lines: [], payments: [] }), 403, "affecté");
  });
});

/** Test d'invariants : une suite d'opérations pseudo-aléatoires (reproductible) sur tous les types d'articles ; après chacune, le stock doit rester cohérent. */
describe("invariants de stock sous opérations aléatoires", () => {
  const totals = new Map<number, number>();
  const rnd = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) it(`graine ${seed}`, async () => {
    const R = rnd(seed); const pick = <X,>(a: X[]) => a[Math.floor(R() * a.length)]!;
    const B = (await ok(call("own", "shop.create", { name: "Thiès" }, ""))).shopId;
    const sub = st.rows("subscriptions").find((r) => r.$id === T); const data = { tenantId: T, plan: "pro", period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (sub) Object.assign(sub, data); else await st.create("subscriptions", T, T, data);
    const mk = async (data: object, qty = 0, shop = A) => (await ok(call("own", "article.save", { data, ...(qty ? { initialQty: qty } : {}) }, shop))).id as string;
    const plain = await mk({ name: "Eau", price: 500, cost: 300 }, 40); const lot = await mk({ name: "Yaourt", price: 500, cost: 300, tracking: "lot" }); const ser = await mk({ name: "Tel", price: 5000, cost: 4000, tracking: "serial" });
    const dec = await mk({ name: "Riz", price: 700, cost: 500, unit: "kg", qtyScale: 2 }); await ok(call("own", "stock.adjust", { productId: dec, counted: "20" }));
    const virt = await mk({ name: "Pack", price: 1000, kind: "bundle" }); await ok(call("own", "bundle.components", { bundleId: virt, components: [{ productId: plain, qty: 2 }, { productId: lot, qty: 1 }, { productId: ser, qty: 1 }, { productId: dec, qty: "0,5" }] }));
    const kit = await mk({ name: "Kit", price: 1500, kind: "bundle", bundleMode: "kit" }); await ok(call("own", "bundle.components", { bundleId: kit, components: [{ productId: plain, qty: 1 }, { productId: dec, qty: "0,25" }] }));
    let n = 0; const id = (p: string) => `${p}-${String(++n).padStart(6, "0")}-${seed}`; let sn = 0;
    const moves = (shop: string, pid: string) => st.rows("stock_moves").filter((m) => m.productId === pid && m.shopId === shop);
    const sign = (m: any) => (m.kind === "adjust" ? Number(m.qty) : (["sale", "loss", "transfer_out", "assembly_out"].includes(String(m.kind)) ? -1 : 1) * Math.abs(Number(m.qty)));
    const stock = (shop: string, pid: string) => moves(shop, pid).reduce((a, m) => a + sign(m), 0);
    const check = (label: string) => {
      const bal = new Map<string, number>(); for (const j of st.rows("journal_entries")) bal.set(String(j.ref), (bal.get(String(j.ref)) ?? 0) + Number(j.debit ?? 0) - Number(j.credit ?? 0)); for (const [ref, d] of bal) if (d !== 0) throw new Error(`${label} : écritures déséquilibrées pour ${ref} (${d})`);
      for (const p of st.rows("products")) {
        const s = stock(String(p.shopId), p.$id); if (s < 0 && p.kind !== "bundle") throw new Error(`${label} : stock négatif ${s} pour ${p.name} (${p.shopId})`);
        if (p.tracking === "lot") { const byLot = new Map<string, number>(); for (const m of moves(String(p.shopId), p.$id)) if (m.lotId) byLot.set(String(m.lotId), (byLot.get(String(m.lotId)) ?? 0) + sign(m)); const sum = [...byLot.values()].reduce((a, b) => a + b, 0); if (sum !== s) throw new Error(`${label} : lots ${sum} ≠ stock ${s} pour ${p.name} (${p.shopId})`); for (const [l, q] of byLot) if (q < 0) throw new Error(`${label} : lot ${l} négatif`); }
        if (p.tracking === "serial") { const avail = st.rows("article_serials").filter((r) => r.productId === p.$id && r.status === "available").length; if (avail !== s) throw new Error(`${label} : séries disponibles ${avail} ≠ stock ${s} pour ${p.name} (${p.shopId})`); }
        if (p.kind === "bundle" && p.bundleMode !== "kit" && moves(String(p.shopId), p.$id).length) throw new Error(`${label} : le bundle virtuel ${p.name} a des mouvements propres`);
      }
    };
    const okOps = new Map<number, number>(); let cur = 0; const call2 = async (...a: Parameters<typeof call>) => { const r = await call(...a); if (r.status === 200) okOps.set(cur, (okOps.get(cur) ?? 0) + 1); else if (r.status >= 500) throw new Error(`HTTP ${r.status} ${(r.body as { error?: string }).error}`); return r; };
    for (let i = 0; i < 90; i++) {
      const op = Math.floor(R() * 9); cur = op; let label = `op${i}:${op}`;
      const shop = R() < 0.8 ? A : B; const here = (x: string) => st.rows("products").find((p) => p.shopId === shop && (p.$id === x || p.originId === x))?.$id;
      try {
        if (op === 0) await call2("own", "checkout", { clientId: id("v"), lines: [{ productId: plain, qty: 1 + Math.floor(R() * 4) }], payments: [{ method: "cash", amount: 100000 }] }, A);
        else if (op === 1) await call2("own", "checkout", { clientId: id("v"), lines: [{ productId: virt, qty: 1 + Math.floor(R() * 2) }, ...(R() < 0.5 ? [{ productId: plain, qty: 2 }] : [])], payments: [{ method: "cash", amount: 100000 }] }, A);
        else if (op === 2) await call2("own", "lot.receive", { productId: lot, lotNo: pick(["A", "B", "C"]), qty: 1 + Math.floor(R() * 6), expiresAt: new Date(Date.now() + (5 + Math.floor(R() * 5)) * 864e5).toISOString().slice(0, 10).replace(/-\d\d$/, "-28") }, A);
        else if (op === 3) await call2("own", "serial.add", { productId: ser, serials: Array.from({ length: 1 + Math.floor(R() * 3) }, () => `SN${++sn}`).join(" ") }, A);
        else if (op === 4) await call2("own", "checkout", { clientId: id("v"), lines: [{ productId: pick([lot, ser, kit, dec]), qty: pick([1, 2]) }], payments: [{ method: "cash", amount: 100000 }] }, A);
        else if (op === 5) await call2("own", "stock.transfer", { transferId: id("t"), toShopId: shop === A ? B : A, lines: [{ productId: pick([plain, lot, ser, dec].map((x) => here(x) ?? x)), qty: 1 + Math.floor(R() * 3) }] }, shop);
        else if (op === 6) await call2("own", "kit.assemble", { requestId: id("k"), bundleId: kit, qty: 1 + Math.floor(R() * 3), type: R() < 0.7 ? "assemble" : "disassemble" }, A);
        else if (op === 7) { const l = pick(st.rows("article_lots").filter((x) => x.shopId === A)); if (l) await call2("own", "lot.writeoff", { lotId: l.$id, qty: 1, reason: "test", requestId: id("w") }, A); }
        else { const s = pick(st.rows("article_serials").filter((x) => x.shopId === A && x.status === "available")); if (s) await call2("own", "serial.status", { id: s.$id, status: "defective" }, A); }
      } catch (e) { throw new Error(`${label} : exception ${(e as Error).message}`); }
      check(label);
    }
    for (const [op, k] of okOps) totals.set(op, (totals.get(op) ?? 0) + k);
  });
  it("couverture : chaque type d'opération a réellement réussi au moins une fois (le test ne passe pas à vide)", () => { for (const op of [0, 1, 2, 3, 4, 5, 6, 7, 8]) expect(totals.get(op) ?? 0, `opération ${op}`).toBeGreaterThan(0); });
});
