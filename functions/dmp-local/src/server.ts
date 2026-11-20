import http from "node:http";
import https from "node:https";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { handle } from "../../dmp-api/src/main";
import { SqliteStore, verifyPassword } from "../../dmp-api/src/sqlite-store";
import { queryRows } from "./query";

/** Serveur local de la version Windows : même fonction métier (`handle`) et même contrat de lecture que le cloud, sur la base SQLite du poste principal.
 *  Il sert aussi l'application web, pour les postes du réseau (navigateur) et pour la fenêtre de bureau. Toute requête de données exige une session. */
export type LocalServerOptions = { store: SqliteStore; webRoot?: string; admins?: string[]; tls?: { key: string | Buffer; cert: string | Buffer } };
const MAX_BODY = 12 * 1024 * 1024;
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8", ".map": "application/json" };

const send = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => { const text = typeof body === "string" ? body : JSON.stringify(body); res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }); res.end(text); };
const readBody = (req: http.IncomingMessage): Promise<string> => new Promise((ok, ko) => { const chunks: Buffer[] = []; let n = 0; req.on("data", (c: Buffer) => { n += c.length; if (n > MAX_BODY) { ko(new Error("trop volumineux")); req.destroy(); } else chunks.push(c); }); req.on("end", () => ok(Buffer.concat(chunks).toString("utf8"))); req.on("error", ko); });
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
      const u = email ? store.userByEmail(email) : null;
      if (!u || !u.active || !verifyPassword(String(b.password ?? ""), u.password)) { f.n++; if (f.n >= 5) { f.until = Date.now() + 5 * 60_000; f.n = 0; } fails.set(email, f); return send(res, 401, { ok: false, error: "Identifiant ou mot de passe incorrect" }); }
      fails.delete(email); const token = store.openSession(u.id); return send(res, 200, { ok: true, token, ...sessionInfo(u.id) });
    }
    const loopback = /^(::1|127\.\d+\.\d+\.\d+|::ffff:127\.\d+\.\d+\.\d+)$/.test(String(req.socket.remoteAddress ?? ""));
    if (path === "/v1/auth/register" && method === "POST") { // premier démarrage seulement, depuis le poste lui-même : création du compte propriétaire (hors ligne)
      if (!needsSetup()) return send(res, 403, { ok: false, error: "Ce poste est déjà configuré : demandez au propriétaire de créer votre compte" });
      if (!loopback) return send(res, 403, { ok: false, error: "La configuration initiale se fait sur le poste principal" });
      const b = JSON.parse((await readBody(req)) || "{}") as { email?: string; password?: string; name?: string }; const email = String(b.email ?? "").trim(); const pw = String(b.password ?? "");
      if (!/^[^\s@]+@[^\s@]+$/.test(email) || pw.length < 8) return send(res, 400, { ok: false, error: "Identifiant (adresse) et mot de passe de 8 caractères minimum requis" });
      if (store.userByEmail(email)) return send(res, 409, { ok: false, error: "Identifiant déjà utilisé" });
      const userId = randomUUID().replace(/-/g, "").slice(0, 20); await store.createUser({ userId, email, password: pw, name: String(b.name ?? "").trim() || email });
      return send(res, 200, { ok: true, token: store.openSession(userId), ...sessionInfo(userId) });
    }
    const who = authed(req, url);
    if (path === "/v1/execute" && method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}"); const r = await handle(store, who?.userId, body, { admins: opts.admins ?? [] }); return send(res, r.status, r.body);
    }
    if (!who) return send(res, 401, { ok: false, error: "Connexion requise" });
    if (path === "/v1/auth/session" && method === "GET") return send(res, 200, { ok: true, ...sessionInfo(who.userId) });
    if (path === "/v1/auth/team" && method === "POST") { // création de l'entreprise du propriétaire, une seule fois par poste
      if (!needsSetup() || store.teamsOf(who.userId).length) return send(res, 403, { ok: false, error: "Ce poste est déjà configuré" });
      if (!loopback) return send(res, 403, { ok: false, error: "La configuration initiale se fait sur le poste principal" });
      const b = JSON.parse((await readBody(req)) || "{}") as { name?: string }; const name = String(b.name ?? "").trim(); if (!name) return send(res, 400, { ok: false, error: "Nom de l'entreprise requis" });
      const teamId = randomUUID().replace(/-/g, "").slice(0, 20); store.createTeam(teamId, name); await store.addMember(teamId, who.userId, ["owner"], store.userById(who.userId)!.name); return send(res, 200, { ok: true, teamId, ...sessionInfo(who.userId) });
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
