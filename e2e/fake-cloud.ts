import http from "node:http";
import { MemoryStore } from "../functions/dmp-api/src/memory-store";
import { handle } from "../functions/dmp-api/src/main";

/** Faux Appwrite pour l'e2e du poste local : mêmes routes REST que le client cloud du poste (session, équipes, exécution de fonction), mais le moteur métier est le VRAI (`handle`, mode cloud). */
/** Horloge simulée strictement croissante (deux mises à jour dans la même milliseconde n'auraient sinon qu'une date : Appwrite ne le fait pas). */
let lastStamp = 0; const nextStamp = (): string => { lastStamp = Math.max(Date.now() + 1, lastStamp + 1); return new Date(lastStamp).toISOString(); };
class Cloud extends MemoryStore {
  override async create(t: string, id: string, tenant: string, d: Record<string, unknown>) { const now = new Date().toISOString(); return super.create(t, id, tenant, { $createdAt: now, $updatedAt: now, ...d }); }
  override async update(t: string, id: string, d: Record<string, unknown>) { await super.update(t, id, { ...d, $updatedAt: nextStamp() }); }
}
export async function startFakeCloud() {
  const cloud = new Cloud(); const T = "tenante2e0000001"; const EMAIL = "patron@boutique.sn", PW = "Motdepasse1!"; const UID = "ownere2e0000001";
  await cloud.grant(T, UID, ["owner"], []); cloud.users.set(UID, { email: EMAIL, password: PW, active: true, name: "Awa Traoré" }); cloud.ownerNames.set(UID, "Awa Traoré");
  const call = (user: string, action: string, payload: unknown, shopId = "") => handle(cloud, user, { action, tenantId: T, shopId, payload }, { admins: [], cloud: false });
  const callCloud = (user: string, action: string, payload: unknown, shopId = "") => handle(cloud, user, { action, tenantId: T, shopId, payload }, { admins: [], cloud: true });
  const shop = (await call(UID, "shop.create", { name: "Boutique Dakar" }) as any).body.data.shopId as string; await cloud.update("shops", shop, { cashRequired: false });
  await cloud.create("subscriptions", T, T, { tenantId: T, plan: "pro", period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() });
  const prod = (await call(UID, "article.save", { data: { name: "Eau 1,5 L", price: 500, cost: 300, sku: "EAU", barcode: "EAU0" }, initialQty: 50 }, shop) as any).body.data.id as string;
  const state = { down: false, tokens: new Set<string>() };
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer); const text = Buffer.concat(chunks).toString(); const body = text ? JSON.parse(text) : {}; const url = new URL(req.url ?? "/", "http://x"); const p = url.pathname.replace(/^\/v1/, "");
    const send = (status: number, b: unknown, h: Record<string, string> = {}) => { res.writeHead(status, { "content-type": "application/json", ...h }); res.end(JSON.stringify(b)); };
    if (state.down) { res.destroy(); return; }
    const fb = String(req.headers["x-fallback-cookies"] ?? ""); const user = fb.startsWith("tok-") && state.tokens.has(fb) ? fb.split("-")[1]! : "";
    if (p === "/account/sessions/email" && req.method === "POST") { const u = [...cloud.users.entries()].find(([, v]) => v.email === String(body.email).toLowerCase()); if (!u || u[1].password !== body.password) return send(401, { message: "Identifiants invalides" }); const tok = `tok-${u[0]}-${Math.random().toString(36).slice(2)}`; state.tokens.add(tok); return send(201, { userId: u[0] }, { "x-fallback-cookies": tok }); }
    if (p === "/account/sessions/current" && req.method === "DELETE") { state.tokens.delete(fb); return send(204, {}); }
    if (!user) return send(401, { message: "Session absente" });
    if (p === "/teams") return send(200, { teams: [...cloud.members.keys()].filter((k) => k.endsWith(`:${user}`)).map((k) => ({ $id: k.split(":")[0], name: "Boutique Awa" })) });
    const m = /^\/teams\/([^/]+)\/memberships$/.exec(p); if (m) return send(200, { memberships: [...cloud.members.entries()].filter(([k]) => k.startsWith(`${m[1]}:`)).map(([k, roles]) => ({ userId: k.split(":")[1], roles })) });
    if (/^\/functions\/[^/]+\/executions$/.test(p) && req.method === "POST") { const b = JSON.parse(body.body); const r = await handle(cloud, user, b, { admins: [], cloud: true }); return send(201, { responseStatusCode: r.status, responseBody: JSON.stringify(r.status === 200 ? r.body : r.body) }); }
    return send(404, { message: "Route inconnue" });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok)); const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/v1`, cloud, T, UID, EMAIL, PW, shop, prod, state, call, callCloud, close: () => new Promise<void>((ok) => server.close(() => ok())) };
}
