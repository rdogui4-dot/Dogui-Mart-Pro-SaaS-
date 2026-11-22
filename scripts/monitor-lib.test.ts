import { describe, expect, it } from "vitest";
import { fetchDeploy, observe, probeApi, probeHooks, probeSite, syncIssues, type Cfg, type Deps, type State } from "./monitor-lib";
import { decide } from "../src/domain/monitor";

const SHA = "d".repeat(40);
const cfg: Cfg = { endpoint: "https://appwrite.test/v1", project: "proj", functionId: "dmp-api", hooksUrl: "https://hooks.test/health", siteUrl: "https://site.test/app/", tlsHosts: ["site.test"], repo: "o/r", token: "tok", branch: "main", workflow: "publish.yml" };
type Route = (url: string, init: RequestInit) => Response | Promise<Response> | undefined;
const mkFetch = (routes: Route[], log: { url: string; method: string; headers: Record<string, string>; body?: string }[] = []): typeof fetch => (async (u: any, init: RequestInit = {}) => {
  const url = String(u); log.push({ url, method: String(init.method ?? "GET"), headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)), body: typeof init.body === "string" ? init.body : undefined });
  for (const r of routes) { const x = await r(url, init); if (x) return x; } return new Response("nope", { status: 404 });
}) as typeof fetch;
const J = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers });
const deps = (f: typeof fetch, days: number | null = 90): Deps => ({ fetch: f, tls: async () => days, now: () => new Date("2026-11-22T12:00:00Z") });
const ping = (extra: object = {}) => ({ ok: true, version: SHA, builtAt: "x", at: "x", journal: { seq: 7 }, ...extra });
const hooksRoute: Route = (u) => (u === cfg.hooksUrl ? J({ ...ping(), service: "dmp-hooks" }) : undefined);
const apiRoutes = (log?: string[]): Route[] => [(u, i) => { if (u.endsWith("/account/sessions/anonymous")) { log?.push("session"); return J({ $id: "s" }, 201, { "x-fallback-cookies": '{"a_session_proj":"cookie1"}' }); } if (u.endsWith("/functions/dmp-api/executions")) { log?.push("exec"); return (i.headers as Record<string, string>)["x-fallback-cookies"] ? J({ responseStatusCode: 200, responseBody: JSON.stringify({ ok: true, data: ping() }) }, 201) : J({}, 401); } return undefined; }];
const siteRoutes: Route[] = [(u) => (u.startsWith("https://site.test/app/version.json") ? J({ version: SHA }) : u === "https://site.test/app/" ? new Response('<html><head><meta http-equiv="Content-Security-Policy" content="x" /></head></html>', { status: 200 }) : undefined)];
const ghRuns = (runs: object[]): Route => (u) => (u.includes("/actions/workflows/publish.yml/runs") ? J({ workflow_runs: runs }) : undefined);

describe("moniteur : observation (réseau simulé)", () => {
  it("hooks : lit la version et l'ancre sans identité ; statut anormal, panne réseau, réponse inattendue = injoignable", async () => {
    expect(await probeHooks(cfg, deps(mkFetch([hooksRoute])))).toMatchObject({ reachable: true, version: SHA, journalSeq: 7 });
    expect((await probeHooks(cfg, deps(mkFetch([(u) => (u === cfg.hooksUrl ? J({}, 500) : undefined)])))).reachable).toBe(false);
    const boom = (async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }); }) as unknown as typeof fetch; expect((await probeHooks(cfg, deps(boom))).error).toContain("ENOTFOUND");
    expect((await probeHooks(cfg, deps(mkFetch([(u) => (u === cfg.hooksUrl ? J({ autre: 1 }) : undefined)])))).reachable).toBe(false);
  });
  it("api : crée une session anonyme une seule fois puis la réutilise ; l'expire (401) la recrée ; aucun identifiant de compte n'est envoyé", async () => {
    const log: string[] = []; const reqs: any[] = []; const f = mkFetch(apiRoutes(log), reqs); const st: State = { anchor: null, session: null };
    expect(await probeApi(cfg, deps(f), st)).toMatchObject({ reachable: true, version: SHA, journalSeq: 7 }); expect(log).toEqual(["session", "exec"]); expect(st.session).toContain("cookie1");
    log.length = 0; await probeApi(cfg, deps(f), st); expect(log).toEqual(["exec"]);
    st.session = "expiree"; const f2 = mkFetch([(u, i) => (u.endsWith("/executions") && (i.headers as any)["x-fallback-cookies"] === "expiree" ? J({}, 401) : undefined), ...apiRoutes(log)]); log.length = 0; expect((await probeApi(cfg, deps(f2), st)).reachable).toBe(true); expect(log).toContain("session");
    expect(JSON.stringify(reqs.map((r) => r.headers))).not.toMatch(/x-appwrite-key|authorization/i);
    const exec = reqs.find((r) => r.url.endsWith("/executions")); expect(JSON.parse(JSON.parse(exec.body).body).action).toBe("health.ping");
  });
  it("api : la fonction répond une erreur / la base est muette / la réponse est illisible", async () => {
    const bad = (code: number): Route[] => [(u) => (u.endsWith("/sessions/anonymous") ? J({}, 201, { "x-fallback-cookies": "c" }) : u.endsWith("/executions") ? J({ responseStatusCode: code, responseBody: "" }, 201) : undefined)];
    expect((await probeApi(cfg, deps(mkFetch(bad(500))), { anchor: null, session: null })).reachable).toBe(false);
    const dbDown: Route[] = [(u) => (u.endsWith("/sessions/anonymous") ? J({}, 201, { "x-fallback-cookies": "c" }) : u.endsWith("/executions") ? J({ responseStatusCode: 200, responseBody: JSON.stringify({ ok: true, data: ping({ journal: null }) }) }, 201) : undefined)];
    expect(await probeApi(cfg, deps(mkFetch(dbDown)), { anchor: null, session: null })).toMatchObject({ reachable: true, journalSeq: null });
    const junk: Route[] = [(u) => (u.endsWith("/sessions/anonymous") ? J({}, 201, { "x-fallback-cookies": "c" }) : u.endsWith("/executions") ? J({ responseStatusCode: 200, responseBody: "<html>" }, 201) : undefined)];
    expect((await probeApi(cfg, deps(mkFetch(junk)), { anchor: null, session: null })).reachable).toBe(false);
  });
  it("site : statut, présence de la CSP et version publiée", async () => {
    expect(await probeSite(cfg, deps(mkFetch(siteRoutes)))).toEqual({ reachable: true, status: 200, csp: true, version: SHA });
    const noCsp = await probeSite(cfg, deps(mkFetch([(u) => (u === "https://site.test/app/" ? new Response("<html></html>", { status: 200 }) : undefined)]))); expect(noCsp).toMatchObject({ csp: false }); expect(noCsp.version).toBeUndefined();
    expect((await probeSite(cfg, deps(mkFetch([(u) => (u === "https://site.test/app/" ? new Response("", { status: 503 }) : undefined)])))).status).toBe(503);
  });
  it("déploiements : dernier succès et déploiement en cours ; accès refusé = null (jamais une version inventée)", async () => {
    const runs = [{ status: "in_progress", conclusion: null, head_sha: "n".repeat(40), updated_at: "2026-11-22T11:58:00Z", run_started_at: "2026-11-22T11:57:00Z", created_at: "2026-11-22T11:57:00Z" }, { status: "completed", conclusion: "failure", head_sha: "f".repeat(40), updated_at: "2026-11-22T10:00:00Z", created_at: "2026-11-22T10:00:00Z" }, { status: "completed", conclusion: "success", head_sha: SHA, updated_at: "2026-11-22T09:00:00Z", created_at: "2026-11-22T08:58:00Z" }];
    expect(await fetchDeploy(cfg, deps(mkFetch([ghRuns(runs)])))).toEqual({ latestSuccessSha: SHA, latestSuccessAt: "2026-11-22T09:00:00Z", inProgressSince: "2026-11-22T11:57:00Z" });
    expect(await fetchDeploy(cfg, deps(mkFetch([(u) => (u.includes("/runs") ? J({}, 403) : undefined)])))).toBeNull();
  });
  it("de bout en bout : tout en ordre ⇒ aucune alerte ; coupure d'une fonction ⇒ alerte ; version différente ⇒ dérive", async () => {
    const ok = [hooksRoute, ...apiRoutes(), ...siteRoutes, ghRuns([{ status: "completed", conclusion: "success", head_sha: SHA, updated_at: "2026-11-22T08:00:00Z", created_at: "2026-11-22T07:58:00Z" }])];
    const o = await observe(cfg, deps(mkFetch(ok)), { anchor: 7, session: null }); expect(decide(o)).toEqual([]); expect(o.tls).toEqual([{ host: "site.test", daysLeft: 90 }]);
    const down = await observe(cfg, deps(mkFetch(ok.filter((r) => r !== hooksRoute))), { anchor: 7, session: null }); expect(decide(down).map((a) => a.id)).toContain("hooks_down");
    const drift = await observe(cfg, deps(mkFetch([...ok.slice(0, -1), ghRuns([{ status: "completed", conclusion: "success", head_sha: "e".repeat(40), updated_at: "2026-11-22T08:00:00Z", created_at: "2026-11-22T07:58:00Z" }])])), { anchor: 7, session: null }); expect(decide(drift).map((a) => a.id).sort()).toEqual(["drift_api", "drift_hooks", "drift_site"]);
  });
});

describe("moniteur : tickets d'alerte", () => {
  const issues = (open: { number: number; title: string }[], calls: any[]) => mkFetch([(u, i) => {
    const m = String(i.method ?? "GET");
    if (m === "GET" && u.includes("/issues?")) return J(open.map((x) => ({ ...x, state: "open" })));
    calls.push({ m, u, body: i.body ? JSON.parse(String(i.body)) : null }); return J({}, 201);
  }]);
  const A = { id: "api_down", severity: "critical" as const, title: "t", detail: "d" };
  it("une alerte nouvelle ouvre UN ticket ; la même alerte déjà ouverte n'en ouvre pas un deuxième", async () => {
    const c: any[] = []; expect(await syncIssues(cfg, deps(issues([], c)), [A], false)).toEqual({ opened: ["api_down"], closed: [] }); expect(c[0].body).toMatchObject({ title: "[Alerte sécurité] api_down", labels: ["alerte-securite"] });
    const c2: any[] = []; expect(await syncIssues(cfg, deps(issues([{ number: 4, title: "[Alerte sécurité] api_down" }], c2)), [A], false)).toEqual({ opened: [], closed: [] }); expect(c2).toEqual([]);
  });
  it("une alerte disparue ferme son ticket (commentaire puis clôture) ; les tickets d'autres sortes ne sont pas touchés", async () => {
    const c: any[] = []; const r = await syncIssues(cfg, deps(issues([{ number: 4, title: "[Alerte sécurité] api_down" }, { number: 9, title: "Question d'un client" }], c)), [], false);
    expect(r.closed).toEqual(["api_down"]); expect(c.map((x) => `${x.m} ${x.u.split("/issues/")[1]}`)).toEqual(["POST 4/comments", "PATCH 4"]); expect(c[1].body.state).toBe("closed");
  });
  it("les simulations ne ferment que les simulations (et inversement) : un essai ne masque jamais un incident réel", async () => {
    const c: any[] = []; await syncIssues(cfg, deps(issues([{ number: 4, title: "[Alerte sécurité] api_down" }], c)), [], true); expect(c).toEqual([]);
    const d: any[] = []; await syncIssues(cfg, deps(issues([{ number: 5, title: "[SIMULATION] [Alerte sécurité] api_down" }], d)), [], false); expect(d).toEqual([]);
    const e: any[] = []; const r = await syncIssues(cfg, deps(issues([{ number: 5, title: "[SIMULATION] [Alerte sécurité] api_down" }], e)), [], true); expect(r.closed).toEqual(["api_down"]);
  });
  it("échec de GitHub : l'erreur remonte (le moniteur échoue au lieu de se taire)", async () => { await expect(syncIssues(cfg, deps(mkFetch([(u) => (u.includes("/issues?") ? J({}, 500) : undefined)])), [A], false)).rejects.toThrow(/HTTP 500/); });
});
