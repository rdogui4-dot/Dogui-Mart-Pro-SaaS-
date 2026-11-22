import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { createCloudClient, CloudError } from "./cloud";

/** Faux Appwrite (REST) : mêmes chemins, en-têtes et formes de réponse que le vrai service pour ce que le poste utilise. */
let srv: http.Server; let base = ""; const seen: { method: string; url: string; headers: http.IncomingHttpHeaders; body: any }[] = []; let mode: "ok" | "down" = "ok";
const start = () => new Promise<void>((ok) => { srv = http.createServer((req, res) => { let t = ""; req.on("data", (d) => (t += d)); req.on("end", () => {
  const body = t ? JSON.parse(t) : null; seen.push({ method: req.method!, url: req.url!, headers: req.headers, body }); const j = (s: number, b: unknown, h: Record<string, string> = {}) => { res.writeHead(s, { "content-type": "application/json", ...h }); res.end(JSON.stringify(b)); };
  if (mode === "down") return j(503, { message: "indisponible" });
  if (req.url === "/v1/account/sessions/email" && req.method === "POST") return body.password === "bon" ? j(201, { userId: "u1", $id: "s1" }, { "x-fallback-cookies": '{"a_session_p1":"secretabc"}' }) : j(401, { message: "Invalid credentials" });
  if (req.url === "/v1/account/sessions/current" && req.method === "DELETE") return j(204, {});
  if (req.headers["x-fallback-cookies"] !== '{"a_session_p1":"secretabc"}') return j(401, { message: "unauthorized" });
  if (req.url === "/v1/teams") return j(200, { teams: [{ $id: "t1", name: "Boutique" }, { $id: "t2", name: "Autre" }] });
  if (req.url === "/v1/teams/t1/memberships") return j(200, { memberships: [{ userId: "u1", roles: ["owner"] }] });
  if (req.url === "/v1/teams/t2/memberships") return j(200, { memberships: [{ userId: "u1", roles: ["cashier"] }] });
  if (req.url === "/v1/functions/dmp-api/executions") { const inner = JSON.parse(body.body); return inner.action === "refuse" ? j(201, { responseStatusCode: 403, responseBody: JSON.stringify({ ok: false, error: "Droits insuffisants" }) }) : j(201, { responseStatusCode: 200, responseBody: JSON.stringify({ ok: true, data: { echo: inner } }) }); }
  return j(404, { message: "not found" });
}); }); srv.listen(0, "127.0.0.1", () => { base = `http://127.0.0.1:${(srv.address() as { port: number }).port}/v1`; ok(); }); });
afterEach(() => new Promise<void>((ok) => { seen.length = 0; mode = "ok"; srv?.close(() => ok()); srv?.closeAllConnections?.(); }));

describe("client du cloud (Appwrite REST)", () => {
  it("connexion du propriétaire : session conservée sous la forme X-Fallback-Cookies, mot de passe jamais conservé ; identifiants faux refusés", async () => {
    await start(); let kept: unknown = null; const c = createCloudClient({ endpoint: base, projectId: "p1" }, { onSession: (s) => { kept = s; } });
    await expect(c.login("a@b.sn", "faux")).rejects.toMatchObject({ status: 401 }); expect(c.hasSession()).toBe(false);
    const s = await c.login("a@b.sn", "bon"); expect(s).toMatchObject({ userId: "u1", email: "a@b.sn", fallbackCookies: '{"a_session_p1":"secretabc"}' }); expect(JSON.stringify(kept)).not.toContain("bon\"");
    expect(seen[0]!.headers["x-appwrite-project"]).toBe("p1");
  });
  it("équipes du compte, rôle propriétaire vérifié, appels de la fonction avec la session ; refus et erreurs relayés", async () => {
    await start(); const c = createCloudClient({ endpoint: base, projectId: "p1" }); await c.login("a@b.sn", "bon");
    expect(await c.myTeams()).toEqual([{ id: "t1", name: "Boutique" }, { id: "t2", name: "Autre" }]); expect(await c.ownerOf("t1")).toBe(true); expect(await c.ownerOf("t2")).toBe(false);
    const r = await c.execute<{ echo: any }>("sync.pull", "t1", { table: "sales" }); expect(r.echo).toEqual({ action: "sync.pull", tenantId: "t1", shopId: "", payload: { table: "sales" } }); const last = seen.at(-1)!; expect(last.headers["x-fallback-cookies"]).toContain("secretabc"); expect(last.body).toMatchObject({ async: false, path: "/", method: "POST" });
    await expect(c.execute("refuse", "t1")).rejects.toMatchObject({ status: 403, message: "Droits insuffisants" });
    const e = createCloudClient({ endpoint: base, projectId: "p1" }); await expect(e.execute("x", "t1")).rejects.toMatchObject({ status: 401 });
  });
  it("vérification en ligne d'un mot de passe : ok (session refermée), bad, injoignable (réseau ou service en panne)", async () => {
    await start(); const c = createCloudClient({ endpoint: base, projectId: "p1" });
    expect(await c.verifyOnline("a@b.sn", "bon")).toBe("ok"); expect(seen.some((x) => x.method === "DELETE" && x.url === "/v1/account/sessions/current")).toBe(true); expect(c.hasSession()).toBe(false);
    expect(await c.verifyOnline("a@b.sn", "faux")).toBe("bad"); mode = "down"; expect(await c.verifyOnline("a@b.sn", "bon")).toBe("unreachable");
    expect(await createCloudClient({ endpoint: "http://127.0.0.1:1/v1", projectId: "p1" }).verifyOnline("a@b.sn", "bon")).toBe("unreachable");
  });
  it("cloud en panne ou injoignable : erreur de réseau distinguée d'un refus", async () => {
    await start(); const c = createCloudClient({ endpoint: base, projectId: "p1" }); await c.login("a@b.sn", "bon"); mode = "down"; await expect(c.execute("x", "t1")).rejects.toMatchObject({ status: 503, network: true });
    await expect(createCloudClient({ endpoint: "http://127.0.0.1:1/v1", projectId: "p1" }).login("a@b.sn", "bon")).rejects.toBeInstanceOf(CloudError);
  });
  it("se déconnecter ferme la session côté cloud et la oublie", async () => {
    await start(); let kept: unknown = "x"; const c = createCloudClient({ endpoint: base, projectId: "p1" }, { onSession: (s) => { kept = s; } }); await c.login("a@b.sn", "bon"); await c.logout(); expect(kept).toBeNull(); expect(c.hasSession()).toBe(false); expect(seen.at(-1)).toMatchObject({ method: "DELETE" });
  });
});

import { unreachableMessage } from "./cloud";
describe("message d'erreur quand le cloud est injoignable (au lieu de « fetch failed »)", () => {
  const e = (name: string, code: string, msg = "fetch failed") => Object.assign(new TypeError(msg), { name, cause: { code, message: code } });
  const B = "https://fra.cloud.appwrite.io/v1";
  it("pas d'Internet / DNS : le dit, avec l'hôte", () => { const m = unreachableMessage(e("TypeError", "ENOTFOUND"), B); expect(m).toMatch(/fra\.cloud\.appwrite\.io/); expect(m).toMatch(/accès à Internet/); expect(m).not.toBe("fetch failed"); });
  it("délai dépassé", () => { expect(unreachableMessage(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }), B)).toMatch(/ne répond pas à temps/); expect(unreachableMessage(e("TypeError", "UND_ERR_CONNECT_TIMEOUT"), B)).toMatch(/ne répond pas à temps/); });
  it("certificat refusé : cite la date du PC et l'antivirus", () => { expect(unreachableMessage(e("TypeError", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"), B)).toMatch(/date et l'heure du PC/); expect(unreachableMessage(e("TypeError", "CERT_HAS_EXPIRED"), B)).toMatch(/antivirus/); });
  it("connexion refusée ou coupée : pare-feu, antivirus, proxy", () => { expect(unreachableMessage(e("TypeError", "ECONNREFUSED"), B)).toMatch(/pare-feu/); expect(unreachableMessage(e("TypeError", "ECONNRESET"), B)).toMatch(/proxy/); });
  it("cause inconnue : message général, jamais « fetch failed » seul ; la cause technique reste visible pour le support", () => { const m = unreachableMessage(new TypeError("fetch failed"), B); expect(m).toMatch(/injoignable/); expect(m).toMatch(/fetch failed/); expect(m.length).toBeGreaterThan(40); });
});
