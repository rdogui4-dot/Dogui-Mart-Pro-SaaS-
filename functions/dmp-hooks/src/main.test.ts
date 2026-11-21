import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../dmp-api/src/memory-store";
import { handle } from "../../dmp-api/src/main";
import { _resetThrottle } from "../../dmp-api/src/security-log";

let st: MemoryStore;
vi.mock("../../dmp-api/src/appwrite-store", () => ({ appwriteStore: () => st }));
const MAP = { ref: "data.id", amount: "data.amount", email: "data.customer.email", status: "event", currency: "data.currency", successValues: ["charge.success"], expectedCurrency: "" };
const adm = (action: string, payload: object = {}) => handle(st, "admin1", { action, tenantId: "", shopId: "", payload }, { admins: ["admin1"] });
const run = async (k: string, body: unknown) => { const { default: fn } = await import("./main"); let out: { body: any; status: number } = { body: null, status: 0 }; await fn({ req: { method: "POST", headers: { "x-appwrite-key": "k", "content-type": "application/json" }, query: { k }, bodyJson: body }, res: { json: (b: unknown, s?: number) => { out = { body: b, status: s ?? 200 }; return out; } } } as any); return out; };
const journal = async (kind: string) => ((await adm("platform.security.events", { kind })).body as any).data.events as any[];

beforeEach(() => { st = new MemoryStore(); _resetThrottle(); process.env.APPWRITE_FUNCTION_API_ENDPOINT = "x"; process.env.APPWRITE_FUNCTION_PROJECT_ID = "p"; });
describe("dmp-hooks — journal de sécurité", () => {
  it("jeton refusé : événement regroupé, sans le jeton ni le corps ; notification valide puis doublon : événements distincts", async () => {
    await adm("platform.master.hook.save", { mapping: MAP, links: { first: "https://s.example/a", month: "https://s.example/m" }, baseUrl: "https://h.example.test" });
    const token = ((await adm("platform.master.hook.rotate")).body as any).data.token as string; await adm("platform.master.hook.save", { enabled: true });
    const bad = "a".repeat(40); for (let i = 0; i < 3; i++) expect((await run(bad, {})).status).toBe(404);
    const rej = await journal("hook.rejected"); expect(rej.length).toBe(1); expect(JSON.stringify(await journal("hook.rejected"))).not.toContain(bad);
    const body = { event: "charge.success", data: { id: "TX-1", amount: 1, currency: "XOF", customer: { email: "x@example.test" } } };
    expect((await run(token, body)).status).toBe(200); expect((await run(token, body)).status).toBe(200);
    expect((await journal("hook.accepted")).length).toBe(1); expect((await journal("hook.duplicate")).length).toBe(1);
    expect(JSON.stringify(await journal("hook.accepted"))).not.toContain(token);
  });
});
