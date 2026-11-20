import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.VITE_APPWRITE_ENDPOINT = "http://appwrite.test/v1"; process.env.VITE_APPWRITE_PROJECT_ID = "p1"; });
import { Query } from "appwrite";
import { appwriteBackend, backend, setBackend, type DataRow } from "./backend";
import { api, ApiError, publicApi } from "./api";
import { list, listAll, listTenant } from "./data";
import type { Session } from "./session";

const s = { userId: "u", name: "U", tenantId: "t1", shopId: "s1", role: "owner", shops: [], modules: [] } as unknown as Session;
afterEach(() => setBackend());

describe("couche d'accès au serveur (Appwrite par défaut, remplaçable)", () => {
  it("par défaut : Appwrite ; setBackend remplace une partie, sans argument on revient à Appwrite", () => {
    expect(backend()).toBe(appwriteBackend); const fake = { execute: async () => ({ status: 200, body: "{}" }) };
    setBackend({ transport: fake }); expect(backend().transport).toBe(fake); expect(backend().data).toBe(appwriteBackend.data); setBackend(); expect(backend().transport).toBe(appwriteBackend.transport);
  });
  it("les lectures de l'interface passent par la source de données : filtres commerce et boutique, pagination par curseur, tables du commerce", async () => {
    const calls: { table: string; queries: string[] }[] = []; const rows = (n: number, from = 0): DataRow[] => Array.from({ length: n }, (_, i) => ({ $id: `r${from + i}` }));
    setBackend({ data: { getRow: async () => ({ $id: "x" }), listRows: async (table, queries) => { calls.push({ table, queries }); const cursor = queries.map((q) => JSON.parse(q)).find((q) => q.method === "cursorAfter")?.values[0]; const start = cursor ? Number(String(cursor).slice(1)) + 1 : 0; const lim = queries.map((q) => JSON.parse(q)).find((q) => q.method === "limit")?.values[0] ?? 25; return { rows: rows(Math.max(0, Math.min(lim, 230 - start)), start), total: 230 }; } } });
    expect((await listAll("products", s)).length).toBe(230); expect(calls.length).toBeGreaterThanOrEqual(3);
    const q0 = calls[0]!.queries.map((q) => JSON.parse(q)); expect(q0).toContainEqual({ method: "equal", attribute: "tenantId", values: ["t1"] }); expect(q0).toContainEqual({ method: "equal", attribute: "shopId", values: ["s1"] });
    calls.length = 0; expect((await list("sales", s, [], 150)).length).toBe(150); calls.length = 0; await listTenant("shops", s); expect(calls[0]!.queries.map((q) => JSON.parse(q)).some((q) => q.attribute === "shopId")).toBe(false);
  });
  it("les appels serveur passent par le transport : succès, erreur, refus de formule (402) et appel public", async () => {
    const sent: string[] = []; let next = { status: 200, body: JSON.stringify({ ok: true, data: { n: 1 } }) };
    setBackend({ transport: { execute: async (b) => { sent.push(b); return next; } } });
    expect(await api(s, "a.b", { x: 1 })).toEqual({ n: 1 }); expect(JSON.parse(sent[0]!)).toEqual({ action: "a.b", tenantId: "t1", shopId: "s1", payload: { x: 1 } });
    next = { status: 403, body: JSON.stringify({ ok: false, error: "Droits insuffisants" }) }; await expect(api(s, "a.b")).rejects.toMatchObject({ status: 403, message: "Droits insuffisants" });
    next = { status: 500, body: "pas du json" }; await expect(api(s, "a.b")).rejects.toBeInstanceOf(ApiError);
    next = { status: 200, body: JSON.stringify({ ok: true, data: 7 }) }; expect(await publicApi("invite.peek", { token: "t" })).toBe(7); expect(JSON.parse(sent.at(-1)!)).toEqual({ action: "invite.peek", payload: { token: "t" } });
  });
  it("temps réel et fichiers : branchés sur la couche, désabonnement rendu", async () => {
    const un = vi.fn(); const subscribe = vi.fn(() => un); const fetchFile = vi.fn(async () => new Response("ok"));
    setBackend({ realtime: { subscribe }, files: { fetch: fetchFile } }); const off = backend().realtime.subscribe(["c"], () => undefined); off(); expect(subscribe).toHaveBeenCalledWith(["c"], expect.any(Function)); expect(un).toHaveBeenCalled();
    expect((await backend().files.fetch("f1", "preview", 40)).ok).toBe(true); expect(fetchFile).toHaveBeenCalledWith("f1", "preview", 40);
  });
  it("contrat des requêtes : l'interface n'utilise que ces méthodes, que le serveur local devra comprendre", () => {
    const m = (q: string) => JSON.parse(q).method as string;
    expect([Query.equal("a", 1), Query.limit(5), Query.orderDesc("a"), Query.orderAsc("a"), Query.cursorAfter("x"), Query.or([Query.equal("a", 1)]), Query.startsWith("a", "b"), Query.search("a", "b"), Query.isNull("a"), Query.isNotNull("a"), Query.greaterThanEqual("a", 1)].map(m))
      .toEqual(["equal", "limit", "orderDesc", "orderAsc", "cursorAfter", "or", "startsWith", "search", "isNull", "isNotNull", "greaterThanEqual"]);
  });
});
