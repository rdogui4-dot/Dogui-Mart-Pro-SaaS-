import http from "node:http";
import https from "node:https";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { handle } from "../../dmp-api/src/main";
import type { SqliteStore } from "../../dmp-api/src/sqlite-store";
import { queryRows } from "./query";
import { connectPage, deviceLabel, type NetworkInfo } from "./network";
import type { CloudConfig } from "./cloud";
import { attachToCloud, cloudFor, hostState, releaseToCloud, runSync } from "./hosting";

/** Serveur local de la version Windows : même fonction métier (`handle`) et même contrat de lecture que le cloud, sur la base SQLite du poste principal.
 *  Il sert aussi l'application web, pour les postes du réseau (navigateur) et pour la fenêtre de bureau. Toute requête de données exige une session. */
export type LocalServerOptions = { store: SqliteStore; webRoot?: string; admins?: string[]; tls?: { key: string | Buffer; cert: string | Buffer }; /** Adresses et certificat à montrer aux autres appareils (poste principal). */ network?: () => NetworkInfo; /** Vérifie un identifiant et un mot de passe auprès du cloud (première connexion en ligne). */ verifyOnline?: (email: string, password: string) => Promise<"ok" | "bad" | "unreachable"> ; /** Liaison au cloud (rattachement, synchronisation, retour au cloud). Absente : le poste reste 100 % local. */ cloud?: { config: CloudConfig; fetch?: typeof fetch } };
const MAX_BODY = 12 * 1024 * 1024;
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8", ".map": "application/json" };

const send = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => { const text = typeof body === "string" ? body : JSON.stringify(body); res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }); res.end(text); };
const readBody = (req: http.IncomingMessage): Promise<string> => new Promise((ok, ko) => { const chunks: Buffer[] = []; let n = 0; req.on("data", (c: Buffer) => { n += c.length; if (n > MAX_BODY) { ko(new Error("trop volumineux")); req.destroy(); } else chunks.push(c); }); req.on("end", () => ok(Buffer.concat(chunks).toString("utf8"))); req.on("error", ko); });
const clientIp = (req: http.IncomingMessage): string => String(req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
const sha16 = (token: string): string => createHash("sha256").update(token).digest("hex").slice(0, 16);
const bearer = (req: http.IncomingMessage, url: URL): string => { const h = String(req.headers.authorization ?? ""); return h.startsWith("Bearer ") ? h.slice(7) : url.searchParams.get("token") ?? ""; };

export function createLocalServer(opts: LocalServerOptions) {
  const { store } = opts; const root = opts.webRoot ? resolve(opts.webRoot) : "";
  const fails = new Map<string, { n: number; until: number }>(); // limite les essais de mot de passe par identifiant
  const sse = new Set<http.ServerResponse>();
  store.events.on("change", (e: { table: string; id: string }) => { for (const r of sse) r.write(`data: ${JSON.stringify(e)}\n\n`); });
  const keepAlive = setInterval(() => { for (const r of sse) r.write(": ping\n\n"); }, 25_000); keepAlive.unref();

  const authed = (req: http.IncomingMessage, url: URL): { userId: string; token: string } | null => { const token = bearer(req, url); if (!token) return null; const userId = store.sessionUser(token); return userId ? { userId, token } : null; };
  const sessionInfo = (userId: string) => { const u = store.userById(userId)!; return { user: { id: u.id, name: u.name, email: u.email }, teams: store.teamsOf(userId) }; };
  const needsSetup = () => !store.db.prepare("SELECT 1 FROM teams LIMIT 1").get();

  async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    const path = url.pathname; const method = req.method ?? "GET";
    if (path === "/v1/setup" && method === "GET") return send(res, 200, { needsSetup: needsSetup() });
    if (path === "/v1/auth/login" && method === "POST") {
      const b = JSON.parse((await readBody(req)) || "{}") as { email?: string; password?: string }; const email = String(b.email ?? "").trim(); const f = fails.get(email) ?? { n: 0, until: 0 };
      if (f.until > Date.now()) return send(res, 429, { ok: false, error: "Trop d'essais : réessayez dans quelques minutes" });
      const pw = String(b.password ?? ""); const lu = email ? await store.verifyLogin(email, pw) : null; let granted = !!lu && lu.known && lu.active; let why = "Identifiant ou mot de passe incorrect";
      if (!granted && lu && lu.active && opts.verifyOnline) { // mot de passe inconnu du poste (jamais vu, ou changé au cloud depuis) : vérification en ligne, puis empreinte gardée pour les connexions hors ligne
        const r = await opts.verifyOnline(email, pw); if (r === "ok") { store.cacheCredential(lu.id, pw); granted = true; } else if (r === "unreachable" && !store.userHasCredential(lu.id)) why = "Connexion impossible hors ligne : ce compte doit d'abord se connecter une fois avec internet";
      }
      const u = granted ? store.userById(lu!.id) : null;
      if (!u) { f.n++; if (f.n >= 5) { f.until = Date.now() + 5 * 60_000; f.n = 0; } fails.set(email, f); return send(res, 401, { ok: false, error: why }); }
      fails.delete(email); const token = store.openSession(u.id, deviceLabel(String(req.headers["user-agent"] ?? "")), clientIp(req)); return send(res, 200, { ok: true, token, ...sessionInfo(u.id) });
    }
    const loopback = /^(::1|127\.\d+\.\d+\.\d+|::ffff:127\.\d+\.\d+\.\d+)$/.test(String(req.socket.remoteAddress ?? ""));
    if (path === "/v1/auth/register" && method === "POST") { // premier démarrage seulement, depuis le poste lui-même : création du compte propriétaire (hors ligne)
      if (!needsSetup()) return send(res, 403, { ok: false, error: "Ce poste est déjà configuré : demandez au propriétaire de créer votre compte" });
      if (!loopback) return send(res, 403, { ok: false, error: "La configuration initiale se fait sur le poste principal" });
      const b = JSON.parse((await readBody(req)) || "{}") as { email?: string; password?: string; name?: string }; const email = String(b.email ?? "").trim(); const pw = String(b.password ?? "");
      if (!/^[^\s@]+@[^\s@]+$/.test(email) || pw.length < 8) return send(res, 400, { ok: false, error: "Identifiant (adresse) et mot de passe de 8 caractères minimum requis" });
      if (store.userByEmail(email)) return send(res, 409, { ok: false, error: "Identifiant déjà utilisé" });
      const userId = randomUUID().replace(/-/g, "").slice(0, 20); await store.createUser({ userId, email, password: pw, name: String(b.name ?? "").trim() || email });
      return send(res, 200, { ok: true, token: store.openSession(userId, deviceLabel(String(req.headers["user-agent"] ?? "")), clientIp(req)), ...sessionInfo(userId) });
    }
    if (path === "/v1/connect" && method === "GET") return send(res, 200, opts.network?.() ?? null); // public : adresses du poste et empreinte du certificat, aucune donnée d'entreprise
    if (path === "/v1/certificate.crt" && method === "GET") { const c = opts.tls?.cert; if (!c) return send(res, 404, { ok: false, error: "Aucun certificat : ce poste fonctionne en HTTP" }); res.writeHead(200, { "content-type": "application/x-x509-ca-cert", "content-disposition": 'attachment; filename="dogui-mart-pro.crt"', "cache-control": "no-store" }); return void res.end(c); }
    if (path === "/v1/cloud/attach" && method === "POST") { // rattachement d'un poste vierge à un commerce du cloud : poste principal uniquement
      if (!opts.cloud) return send(res, 404, { ok: false, error: "Liaison au cloud non disponible sur ce poste" });
      if (!needsSetup()) return send(res, 403, { ok: false, error: "Ce poste est déjà configuré" }); if (!loopback) return send(res, 403, { ok: false, error: "Le rattachement se fait sur le poste principal" });
      const b = JSON.parse((await readBody(req)) || "{}") as { email?: string; password?: string; stationName?: string; tenantId?: string };
      const r = await attachToCloud(store, cloudFor(store, opts.cloud.config, opts.cloud.fetch), { email: String(b.email ?? ""), password: String(b.password ?? ""), stationName: String(b.stationName ?? ""), tenantId: b.tenantId ? String(b.tenantId) : undefined });
      return send(res, r.ok ? 200 : 400, r.ok ? { ok: true, tenantId: r.tenantId, report: r.report } : r);
    }
    const who = authed(req, url);
    if (path === "/v1/execute" && method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}"); const r = await handle(store, who?.userId, body, { admins: opts.admins ?? [] }); return send(res, r.status, r.body);
    }
    if (!who) return send(res, 401, { ok: false, error: "Connexion requise" });
    store.touchSession(who.token);
    if (path === "/v1/auth/session" && method === "GET") return send(res, 200, { ok: true, ...sessionInfo(who.userId) });
    if (path === "/v1/auth/team" && method === "POST") { // création de l'entreprise du propriétaire, une seule fois par poste
      if (!needsSetup() || store.teamsOf(who.userId).length) return send(res, 403, { ok: false, error: "Ce poste est déjà configuré" });
      if (!loopback) return send(res, 403, { ok: false, error: "La configuration initiale se fait sur le poste principal" });
      const b = JSON.parse((await readBody(req)) || "{}") as { name?: string }; const name = String(b.name ?? "").trim(); if (!name) return send(res, 400, { ok: false, error: "Nom de l'entreprise requis" });
      const teamId = randomUUID().replace(/-/g, "").slice(0, 20); store.createTeam(teamId, name); await store.addMember(teamId, who.userId, ["owner"], store.userById(who.userId)!.name); return send(res, 200, { ok: true, teamId, ...sessionInfo(who.userId) });
    }
    const ownerTeam = (): string | null => store.teamsOf(who.userId).find((t) => t.roles.includes("owner"))?.id ?? null;
    if (path === "/v1/network" && method === "GET") { // état du réseau local : réservé au propriétaire
      const tid = ownerTeam(); if (!tid) return send(res, 403, { ok: false, error: "Réservé au propriétaire" });
      const since = Date.now() - 15 * 60_000; const devices = store.sessionsOfTenant(tid).map((d) => ({ ...d, current: false, active: Date.parse(d.lastSeen) >= since }));
      const mine = store.sessionsOfTenant(tid).find((d) => d.id === sha16(who.token)); return send(res, 200, { ok: true, info: opts.network?.() ?? null, devices: devices.map((d) => ({ ...d, current: d.id === mine?.id })) });
    }
    if (path === "/v1/network/revoke" && method === "POST") { const tid = ownerTeam(); if (!tid) return send(res, 403, { ok: false, error: "Réservé au propriétaire" }); const b = JSON.parse((await readBody(req)) || "{}") as { id?: string }; const ok = store.revokeSession(tid, String(b.id ?? "")); return send(res, ok ? 200 : 404, { ok, error: ok ? undefined : "Appareil introuvable" }); }
    if (path.startsWith("/v1/cloud/")) {
      const tid = ownerTeam(); if (!tid) return send(res, 403, { ok: false, error: "Réservé au propriétaire" }); if (!opts.cloud) return send(res, 404, { ok: false, error: "Liaison au cloud non disponible sur ce poste" });
      if (path === "/v1/cloud/status" && method === "GET") return send(res, 200, { ok: true, ...hostState(store) });
      if (path === "/v1/cloud/sync" && method === "POST") { const r = await runSync(store, cloudFor(store, opts.cloud.config, opts.cloud.fetch), { force: true }); return send(res, 200, { ok: !r.error, report: r, ...hostState(store) }); }
      if (path === "/v1/cloud/release" && method === "POST") { const r = await releaseToCloud(store, cloudFor(store, opts.cloud.config, opts.cloud.fetch)); return send(res, r.ok ? 200 : 409, r); }
    }
    if (path === "/v1/auth/logout" && method === "POST") { store.closeSession(who.token); return send(res, 200, { ok: true }); }
    let m = /^\/v1\/rows\/([A-Za-z0-9_]+)$/.exec(path);
    if (m && method === "GET") { let queries: string[] = []; try { queries = JSON.parse(url.searchParams.get("q") ?? "[]"); } catch { return send(res, 400, { ok: false, error: "Requêtes invalides" }); }
      try { return send(res, 200, queryRows(store, m[1]!, queries, store.rolesOf(who.userId))); } catch (e) { return send(res, 400, { ok: false, error: (e as Error).message }); } }
    m = /^\/v1\/rows\/([A-Za-z0-9_]+)\/([^/]+)$/.exec(path);
    if (m && method === "GET") { const r = queryRows(store, m[1]!, [JSON.stringify({ method: "equal", attribute: "$id", values: [decodeURIComponent(m[2]!)] }), JSON.stringify({ method: "limit", values: [1] })], store.rolesOf(who.userId)).rows[0];
      return r ? send(res, 200, r) : send(res, 404, { ok: false, error: "Ligne introuvable" }); }
    m = /^\/v1\/files\/([A-Za-z0-9_.-]+)$/.exec(path);
    if (m && method === "GET") { const f = store.fileMeta(m[1]!); const mine = new Set(store.rolesOf(who.userId));
      if (!f || !f.readRoles.some((r) => mine.has(r))) return send(res, 404, { ok: false, error: "Fichier introuvable" });
      res.writeHead(200, { "content-type": f.mime, "content-length": String(f.data.length), "cache-control": "private, max-age=300" }); return void res.end(Buffer.from(f.data)); }
    if (path === "/v1/events" && method === "GET") { res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" }); res.write(": ok\n\n"); sse.add(res); req.on("close", () => sse.delete(res)); return; }
    return send(res, 404, { ok: false, error: "Introuvable" });
  }

  function statics(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    if (!root) { res.writeHead(404); return void res.end(); }
    let rel = normalize(decodeURIComponent(url.pathname)); if (rel.includes("\0")) { res.writeHead(400); return void res.end(); }
    let file = join(root, rel); if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); return void res.end(); }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    const spa = !existsSync(file) && !extname(rel); if (spa) file = join(root, "index.html");
    if (!existsSync(file)) { res.writeHead(404); return void res.end("Introuvable"); }
    const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream"; let data: Buffer | string = readFileSync(file);
    if (file.endsWith("index.html") && file === join(root, "index.html")) data = data.toString("utf8").replace("<head>", '<head><meta name="dmp-local" content="1" />'); // l'application sait qu'elle parle au serveur local
    const immutable = /\/assets\/.+-[A-Za-z0-9_-]{8}\./.test(rel);
    res.writeHead(200, { "content-type": type, "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache", "x-content-type-options": "nosniff" }); res.end(data);
  }

  const listener: http.RequestListener = (req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (url.pathname.startsWith("/v1/")) { api(req, res, url).catch((e) => { console.error(e); if (!res.headersSent) send(res, 500, { ok: false, error: "Erreur interne" }); else res.end(); }); return; }
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return void res.end(); }
    if (url.pathname === "/connect" && opts.network) { connectPage(opts.network()).then((h) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); res.end(h); }).catch(() => { res.writeHead(500); res.end(); }); return; }
    try { statics(req, res, url); } catch (e) { console.error(e); if (!res.headersSent) res.writeHead(500); res.end(); }
  };
  const server = opts.tls ? https.createServer({ key: opts.tls.key, cert: opts.tls.cert }, listener) : http.createServer(listener);
  server.requestTimeout = 60_000;
  return {
    server,
    listen: (port = 0, host = "0.0.0.0") => new Promise<{ port: number }>((ok, ko) => { server.once("error", ko); server.listen(port, host, () => ok({ port: (server.address() as { port: number }).port })); }),
    close: () => new Promise<void>((ok) => { clearInterval(keepAlive); for (const r of sse) r.end(); server.close(() => ok()); (server as http.Server).closeAllConnections?.(); }),
  };
}
