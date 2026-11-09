import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { action: string; payload: Record<string, unknown> }[] = [];
let behaviour: (p: Record<string, unknown>) => unknown = () => ({ number: "V-1", verifyCode: "DMP1.V-1.1000.abcdef0123456789" });
vi.mock("./api", () => ({
  ApiError: class ApiError extends Error { constructor(public status: number, m: string) { super(m); } },
  api: vi.fn(async (_s: unknown, action: string, payload: Record<string, unknown>) => { calls.push({ action, payload }); return behaviour(payload); }),
}));
import { ApiError } from "./api";
import { discardRejected, onSyncResult, pendingCount, queueSale, rejectedSales, saleStatus, syncPending, type PendingSale } from "./offline";

const session = { tenantId: "t", shopId: "s", userId: "u", role: "cashier" } as never;
const sale = (id: string, extra: Partial<PendingSale> = {}): PendingSale => ({ clientId: id, soldAt: new Date().toISOString(), lines: [{ productId: "p", qty: 1 }], payments: [{ method: "cash", amount: 500 }], session, ...extra });

beforeEach(async () => {
  vi.stubGlobal("navigator", { onLine: true }); calls.length = 0; behaviour = () => ({ number: "V-1", verifyCode: "DMP1.V-1.1000.abcdef0123456789" });
  for (const r of await rejectedSales()) await discardRejected(r.clientId);
  while ((await pendingCount()) > 0) { behaviour = () => ({ number: "x" }); await syncPending(); }
  calls.length = 0; behaviour = () => ({ number: "V-1", verifyCode: "DMP1.V-1.1000.abcdef0123456789" });
});

describe("file locale de ventes : jamais « synchronisée » avant la confirmation du serveur", () => {
  it("vente hors ligne : reste en attente, rien n'est envoyé, statut « pending »", async () => {
    vi.stubGlobal("navigator", { onLine: false }); await queueSale(sale("off-0001-aaaa")); expect(await syncPending()).toBe(0); expect(calls.length).toBe(0); expect(await pendingCount()).toBe(1); expect(await saleStatus("off-0001-aaaa")).toBe("pending");
  });
  it("coupure réseau (erreur non métier) : la vente reste en attente et sera renvoyée avec le MÊME clientId (idempotence)", async () => {
    await queueSale(sale("net-0001-aaaa")); behaviour = () => { throw new Error("réseau"); }; expect(await syncPending()).toBe(0); expect(await saleStatus("net-0001-aaaa")).toBe("pending");
    behaviour = () => ({ number: "V-9", verifyCode: "DMP1.V-9.500.0123456789abcdef" }); const got: unknown[] = []; const off = onSyncResult((r) => got.push(r)); expect(await syncPending()).toBe(1); off();
    expect(calls.map((c) => c.payload.clientId)).toEqual(["net-0001-aaaa", "net-0001-aaaa"]); expect(await saleStatus("net-0001-aaaa")).toBe("synced"); expect(got).toEqual([{ clientId: "net-0001-aaaa", status: "synced", number: "V-9", verifyCode: "DMP1.V-9.500.0123456789abcdef" }]);
  });
  it("le statut « synced » n'existe qu'après la réponse du serveur ; le code de vérification vient du serveur", async () => {
    await queueSale(sale("ok-00001-aaaa")); expect(await saleStatus("ok-00001-aaaa")).toBe("pending"); await syncPending(); expect(await saleStatus("ok-00001-aaaa")).toBe("synced"); expect(await pendingCount()).toBe(0);
  });
  it("refus métier (stock, approbation, doublon de référence…) : statut « rejected » conservé pour décision humaine, jamais présenté comme réussi ni perdu", async () => {
    await queueSale(sale("rej-0001-aaaa")); behaviour = () => { throw new ApiError(409, "Stock insuffisant : Eau (0)"); }; await syncPending();
    expect(await saleStatus("rej-0001-aaaa")).toBe("rejected"); expect((await rejectedSales())[0]).toMatchObject({ clientId: "rej-0001-aaaa", error: "Stock insuffisant : Eau (0)" }); expect(await pendingCount()).toBe(0);
    calls.length = 0; await syncPending(); expect(calls.length).toBe(0); // une vente refusée n'est pas renvoyée en boucle
  });
  it("approbations jointes à la vente et paiements avec référence envoyés tels quels au serveur ; abonnement expiré : la vente reste en attente", async () => {
    await queueSale(sale("apr-0001-aaaa", { approvals: { discount: "ap1" }, payments: [{ method: "card", amount: 500, reference: "TPE-1" }] })); behaviour = () => { throw new ApiError(402, "Abonnement expiré : renouvelez"); }; expect(await syncPending()).toBe(0);
    expect(calls[0]!.payload).toMatchObject({ approvals: { discount: "ap1" }, payments: [{ method: "card", reference: "TPE-1" }] }); expect(await saleStatus("apr-0001-aaaa")).toBe("pending");
  });
  it("deux ventes en file partent dans l'ordre, une par une ; la même vente mise deux fois en file n'existe qu'une fois", async () => {
    await queueSale(sale("dup-0001-aaaa")); await queueSale(sale("dup-0001-aaaa")); await queueSale(sale("dup-0002-aaaa")); expect(await pendingCount()).toBe(2); await Promise.all([syncPending(), syncPending()]); expect(calls.map((c) => c.payload.clientId).sort()).toEqual(["dup-0001-aaaa", "dup-0002-aaaa"]);
  });
});
