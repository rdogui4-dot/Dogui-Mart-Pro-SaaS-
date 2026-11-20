import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteStore } from "../../dmp-api/src/sqlite-store";
import { startLocalServer } from "./main";
import { accessUrls, connectPage, deviceLabel } from "./network";
import { mdnsAnswers } from "./mdns";

describe("adresses, appareils, annonce mDNS", () => {
  it("adresses d'accès : IP du poste puis dogui.local ; port omis s'il est standard", () => {
    expect(accessUrls(["192.168.1.20"], 8787, true)).toEqual(["https://192.168.1.20:8787", "https://dogui.local:8787"]); expect(accessUrls(["10.0.0.5"], 443, true)).toEqual(["https://10.0.0.5", "https://dogui.local"]); expect(accessUrls([], 80, false)).toEqual(["http://dogui.local"]);
  });
  it("libellé d'appareil d'après l'agent utilisateur", () => {
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36")).toBe("Chrome · Android"); expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1")).toBe("Safari · iPhone");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36 Edg/126.0")).toBe("Edge · Windows"); expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0) Electron/33.0 Chrome/130")).toBe("Application Windows · Windows"); expect(deviceLabel("")).toBe("Appareil inconnu");
  });
  it("mDNS : dogui.local répond avec les adresses du poste ; service _dogui._tcp (PTR, SRV, TXT) ; autres noms ignorés", () => {
    const info = { hostName: "dogui.local", port: 8787, ips: ["192.168.1.20", "10.0.0.5"], https: true };
    expect(mdnsAnswers({ name: "dogui.local", type: "A" }, info).map((a) => a.data)).toEqual(["192.168.1.20", "10.0.0.5"]); expect(mdnsAnswers({ name: "DOGUI.local", type: "A" }, info)).toHaveLength(2);
    expect(mdnsAnswers({ name: "_dogui._tcp.local", type: "PTR" }, info)[0]!.data).toBe("Dogui Mart Pro._dogui._tcp.local"); expect(mdnsAnswers({ name: "Dogui Mart Pro._dogui._tcp.local", type: "SRV" }, info)[0]!.data).toMatchObject({ port: 8787, target: "dogui.local" });
    expect(mdnsAnswers({ name: "Dogui Mart Pro._dogui._tcp.local", type: "TXT" }, info)[0]!.data).toContain("scheme=https"); expect(mdnsAnswers({ name: "autre.local", type: "A" }, info)).toEqual([]); expect(mdnsAnswers({ name: "dogui.local", type: "AAAA" }, info)).toEqual([]);
  });
  it("page « Connecter un appareil » : QR code, adresses, certificat ; version HTTP sans certificat ; aucune donnée d'entreprise", async () => {
    const info = { app: "Dogui Mart Pro", hostName: "dogui.local", port: 8787, https: true, urls: ["https://192.168.1.20:8787", "https://dogui.local:8787"], certificate: { fingerprint: "AA:BB:CC", notAfter: "2028-01-01T00:00:00.000Z", hosts: ["localhost"] }, mdns: false };
    const h = await connectPage(info); expect(h).toContain("<svg"); expect(h).toContain("https://192.168.1.20:8787/"); expect(h).toContain("/v1/certificate.crt"); expect(h).toContain("AA:BB:CC"); expect(h).toContain("iPhone"); expect(h).toContain("Android");
    const http = await connectPage({ ...info, https: false, certificate: null }); expect(http).not.toContain("/v1/certificate.crt"); expect(http).toContain("HTTP");
    expect(await connectPage({ ...info, urls: ['https://x"><script>alert(1)</script>'] })).not.toContain("<script>alert(1)</script>");
  });
});

describe("base créée avant le réseau local : migration des sessions", () => {
  it("ajoute l'appareil et l'adresse aux sessions existantes sans perdre les données", () => {
    const dir = mkdtempSync(join(tmpdir(), "dmp-mig-")); try {
      const path = join(dir, "old.sqlite"); const old = new DatabaseSync(path); old.exec("CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, last_seen TEXT NOT NULL); INSERT INTO sessions VALUES ('abc', 'u1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');"); old.close();
      const st = new SqliteStore({ path }); expect(st.db.prepare("SELECT token_hash, device, ip FROM sessions").get()).toMatchObject({ token_hash: "abc", device: "", ip: "" }); st.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("serveur du réseau local : connexion des appareils, état du réseau, appareils connectés", () => {
  let dir = ""; let srv: Awaited<ReturnType<typeof startLocalServer>>; let base = "";
  const j = async (path: string, init: RequestInit & { token?: string; ua?: string } = {}) => { const r = await fetch(base + path, { ...init, headers: { "content-type": "application/json", ...(init.ua ? { "user-agent": init.ua } : {}), ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) } }); const t = await r.text(); let body: any = t; try { body = JSON.parse(t); } catch { /* texte */ } return { status: r.status, body, headers: r.headers }; };
  beforeAll(async () => { dir = mkdtempSync(join(tmpdir(), "dmp-net-")); srv = await startLocalServer({ dataDir: dir, port: 0, host: "127.0.0.1" }); base = `http://127.0.0.1:${srv.port}`; });
  afterAll(async () => { await srv.close(); rmSync(dir, { recursive: true, force: true }); });
  it("adresses publiques sans donnée d'entreprise ; pas de certificat en HTTP", async () => {
    const c = await j("/v1/connect"); expect(c.status).toBe(200); expect(c.body).toMatchObject({ app: "Dogui Mart Pro", hostName: "dogui.local", https: false, certificate: null, mdns: false }); expect(c.body.port).toBe(srv.port); expect(c.body.urls.at(-1)).toBe(`http://dogui.local:${srv.port}`);
    expect((await j("/v1/certificate.crt")).status).toBe(404); expect((await fetch(`${base}/connect`)).headers.get("content-type")).toContain("text/html"); expect(await (await fetch(`${base}/connect`)).text()).toContain("Connecter cet appareil");
  });
  it("état du réseau et appareils : propriétaire seulement ; appareil libellé ; dernier passage ; déconnexion à distance", async () => {
    const reg = await j("/v1/auth/register", { method: "POST", ua: "Mozilla/5.0 (Windows NT 10.0) Chrome/126 Safari/537.36", body: JSON.stringify({ email: "patron@boutique.local", password: "motdepasse1", name: "Patron" }) }); const own = reg.body.token as string;
    const team = await j("/v1/auth/team", { method: "POST", token: own, body: JSON.stringify({ name: "Ma Boutique" }) }); const tid = team.body.teamId as string;
    const exec = (token: string, action: string, payload: unknown, shopId = "") => j("/v1/execute", { method: "POST", token, body: JSON.stringify({ action, tenantId: tid, shopId, payload }) });
    const shop = (await exec(own, "shop.create", { name: "Dakar" })).body.data.shopId as string;
    const cais = (await exec(own, "staff.create", { name: "Awa", username: "awa", password: "motdepasse1", role: "cashier", shopIds: [shop] })).body.data; const email = srv.store.userById(cais.userId)!.email;
    const cl = await j("/v1/auth/login", { method: "POST", ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126 Mobile Safari/537.36", body: JSON.stringify({ email, password: "motdepasse1" }) }); const ctoken = cl.body.token as string;
    expect((await j("/v1/network")).status).toBe(401); expect((await j("/v1/network", { token: ctoken })).status).toBe(403);
    const n = await j("/v1/network", { token: own }); expect(n.status).toBe(200); expect(n.body.info.port).toBe(srv.port); const devs = n.body.devices as any[]; expect(devs.length).toBeGreaterThanOrEqual(2);
    const mineD = devs.find((d) => d.current); expect(mineD).toMatchObject({ name: "Patron", device: "Chrome · Windows", active: true }); const awa = devs.find((d) => d.name === "Awa"); expect(awa).toMatchObject({ device: "Chrome · Android", current: false, active: true, roles: ["cashier"] });
    expect(JSON.stringify(devs)).not.toContain(ctoken); expect(awa.id).toHaveLength(16);
    expect((await j("/v1/network/revoke", { method: "POST", token: ctoken, body: JSON.stringify({ id: mineD.id }) })).status).toBe(403); expect((await j("/v1/network/revoke", { method: "POST", token: own, body: JSON.stringify({ id: "inconnu" }) })).status).toBe(404);
    expect((await j("/v1/auth/session", { token: ctoken })).status).toBe(200); expect((await j("/v1/network/revoke", { method: "POST", token: own, body: JSON.stringify({ id: awa.id }) })).status).toBe(200); expect((await j("/v1/auth/session", { token: ctoken })).status).toBe(401);
    expect(((await j("/v1/network", { token: own })).body.devices as any[]).some((d) => d.name === "Awa")).toBe(false);
  });
  it("dernier passage mis à jour au plus une fois toutes les 30 secondes ; appareil inactif au-delà de 15 minutes", async () => {
    const uid = srv.store.userByEmail("patron@boutique.local")!.id; const tk = srv.store.openSession(uid, "Test", "1.2.3.4"); const h = (await import("node:crypto")).createHash("sha256").update(tk).digest("hex");
    const old = new Date(Date.now() - 20 * 60_000).toISOString(); srv.store.db.prepare("UPDATE sessions SET last_seen = ? WHERE token_hash = ?").run(old, h);
    const own = srv.store.openSession(uid); const before = ((await j("/v1/network", { token: own })).body.devices as any[]).find((d) => d.device === "Test"); expect(before.active).toBe(false);
    await j("/v1/auth/session", { token: tk }); const after = ((await j("/v1/network", { token: own })).body.devices as any[]).find((d) => d.device === "Test"); expect(after.active).toBe(true); expect(after.lastSeen > old).toBe(true);
    const seen = srv.store.db.prepare("SELECT last_seen FROM sessions WHERE token_hash = ?").get(h)!.last_seen; await j("/v1/auth/session", { token: tk }); expect(srv.store.db.prepare("SELECT last_seen FROM sessions WHERE token_hash = ?").get(h)!.last_seen).toBe(seen);
  });
});

describe("HTTPS : certificat téléchargeable (jamais la clé privée)", () => {
  it("le certificat public est servi aux appareils, avec la page de connexion et l'empreinte", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dmp-nettls-")); const srv = await startLocalServer({ dataDir: dir, port: 0, host: "127.0.0.1", https: true }); const { request } = await import("node:https");
    const get = (path: string) => new Promise<{ status: number; type: string; body: string }>((ok, ko) => { const r = request({ host: "localhost", port: srv.port, path, ca: srv.certificate!.cert }, (res) => { let t = ""; res.on("data", (d) => (t += d)); res.on("end", () => ok({ status: res.statusCode!, type: String(res.headers["content-type"]), body: t })); }); r.on("error", ko); r.end(); });
    try {
      const c = await get("/v1/certificate.crt"); expect(c.status).toBe(200); expect(c.type).toContain("x509"); expect(c.body).toContain("BEGIN CERTIFICATE"); expect(c.body).not.toContain("PRIVATE KEY");
      const info = JSON.parse((await get("/v1/connect")).body); expect(info.https).toBe(true); expect(info.certificate.fingerprint).toBe(srv.certificate!.fingerprint); expect(info.urls[0]).toMatch(/^https:\/\//);
      const page = await get("/connect"); expect(page.body).toContain(srv.certificate!.fingerprint); expect(page.body).toContain("<svg");
    } finally { await srv.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
